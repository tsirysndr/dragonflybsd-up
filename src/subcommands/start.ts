import { parseFlags } from "@cliffy/flags";
import _ from "@es-toolkit/es-toolkit/compat";
import { Data, Effect, pipe } from "effect";
import { LOGS_DIR } from "../constants.ts";
import type { VirtualMachine } from "../db.ts";
import { getImage } from "../images.ts";
import { getInstanceStateOrFail, updateInstanceState } from "../state.ts";
import { setupNATNetworkArgs } from "../utils.ts";
import { createVolume, getVolume } from "../volumes.ts";

export class VmAlreadyRunningError
  extends Data.TaggedError("VmAlreadyRunningError")<{
    name: string;
  }> {}

const logStartingMessage = (vm: VirtualMachine) =>
  Effect.sync(() => {
    console.log(`Starting virtual machine ${vm.name} (ID: ${vm.id})...`);
  });

export const buildQemuArgs = (vm: VirtualMachine) => [
  ..._.compact([vm.bridge && "qemu-system-x86_64"]),
  ...Deno.build.os === "linux" ? ["-enable-kvm"] : [],
  "-cpu",
  vm.cpu,
  "-m",
  vm.memory,
  "-smp",
  vm.cpus.toString(),
  ..._.compact([vm.isoPath && "-cdrom", vm.isoPath]),
  "-netdev",
  vm.bridge
    ? `bridge,id=net0,br=${vm.bridge}`
    : setupNATNetworkArgs(vm.portForward),
  "-device",
  `e1000,netdev=net0,mac=${vm.macAddress}`,
  "-display",
  "none",
  "-vga",
  "none",
  "-monitor",
  "none",
  "-chardev",
  "stdio,id=con0,signal=off",
  "-serial",
  "chardev:con0",
  ..._.compact(
    vm.drivePath && [
      "-drive",
      `file=${vm.drivePath},format=${vm.diskFormat},if=virtio`,
    ],
  ),
];

export const createLogsDir = () =>
  Effect.tryPromise({
    try: () => Deno.mkdir(LOGS_DIR, { recursive: true }),
    catch: (cause) => new Error(`Failed to create logs directory: ${cause}`),
  });

export const buildDetachedCommand = (
  vm: VirtualMachine,
  qemuArgs: string[],
  logPath: string,
) =>
  vm.bridge
    ? `sudo qemu-system-x86_64 ${
      qemuArgs.slice(1).join(" ")
    } >> "${logPath}" 2>&1 & echo $!`
    : `qemu-system-x86_64 ${qemuArgs.join(" ")} >> "${logPath}" 2>&1 & echo $!`;

export const startDetachedQemu = (fullCommand: string) =>
  Effect.tryPromise({
    try: async () => {
      const cmd = new Deno.Command("sh", {
        args: ["-c", fullCommand],
        stdin: "null",
        stdout: "piped",
      }).spawn();

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const { stdout } = await cmd.output();
      return parseInt(new TextDecoder().decode(stdout).trim(), 10);
    },
    catch: (cause) => new Error(`Failed to start QEMU: ${cause}`),
  });

const logDetachedSuccess = (
  vm: VirtualMachine,
  qemuPid: number,
  logPath: string,
) =>
  Effect.sync(() => {
    console.log(
      `Virtual machine ${vm.name} started in background (PID: ${qemuPid})`,
    );
    console.log(`Logs will be written to: ${logPath}`);
    Deno.exit(0);
  });

const startVirtualMachineDetached = (name: string, vm: VirtualMachine) =>
  Effect.gen(function* () {
    yield* failIfVMRunning(vm);
    const volume = yield* createVolumeIfNeeded(vm);
    const qemuArgs = buildQemuArgs({
      ...vm,
      drivePath: volume ? volume.path : vm.drivePath,
      diskFormat: volume ? "qcow2" : vm.diskFormat,
    });
    const logPath = `${LOGS_DIR}/${vm.name}.log`;
    const fullCommand = buildDetachedCommand(vm, qemuArgs, logPath);

    return yield* pipe(
      createLogsDir(),
      Effect.flatMap(() => startDetachedQemu(fullCommand)),
      Effect.flatMap((qemuPid) =>
        pipe(
          updateInstanceState(name, "RUNNING", qemuPid),
          Effect.flatMap(() => logDetachedSuccess(vm, qemuPid, logPath)),
        )
      ),
    );
  });

const startAttachedQemu = (
  name: string,
  vm: VirtualMachine,
  qemuArgs: string[],
) =>
  Effect.tryPromise({
    try: async () => {
      const cmd = new Deno.Command(
        vm.bridge ? "sudo" : "qemu-system-x86_64",
        {
          args: qemuArgs,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        },
      );

      const child = cmd.spawn();
      await Effect.runPromise(
        updateInstanceState(name, "RUNNING", child.pid),
      );

      const status = await child.status;
      await Effect.runPromise(
        updateInstanceState(name, "STOPPED", child.pid),
      );

      return status;
    },
    catch: (cause) => new Error(`Failed to run QEMU: ${cause}`),
  });

const validateQemuExit = (status: Deno.CommandStatus) =>
  Effect.sync(() => {
    if (!status.success) {
      throw new Error(`QEMU exited with code ${status.code}`);
    }
  });

export const failIfVMRunning = (vm: VirtualMachine) =>
  Effect.gen(function* () {
    if (vm.status === "RUNNING") {
      return yield* Effect.fail(
        new VmAlreadyRunningError({ name: vm.name }),
      );
    }
    return vm;
  });

const createVolumeIfNeeded = (vm: VirtualMachine) =>
  Effect.gen(function* () {
    const { flags } = parseFlags(Deno.args);
    if (!flags.volume) {
      return;
    }
    const volume = yield* getVolume(flags.volume as string);
    if (volume) {
      return volume;
    }

    if (!vm.drivePath) {
      throw new Error(
        `Cannot create volume: Virtual machine ${vm.name} has no drivePath defined.`,
      );
    }

    let image = yield* getImage(vm.drivePath);

    if (!image) {
      const volume = yield* getVolume(vm.drivePath);
      if (volume) {
        image = yield* getImage(volume.baseImageId);
      }
    }

    const newVolume = yield* createVolume(flags.volume as string, image!);
    return newVolume;
  });

const startVirtualMachineAttached = (name: string, vm: VirtualMachine) => {
  return pipe(
    failIfVMRunning(vm),
    Effect.flatMap(() => createVolumeIfNeeded(vm)),
    Effect.flatMap((volume) =>
      Effect.succeed(
        buildQemuArgs({
          ...vm,
          drivePath: volume ? volume.path : vm.drivePath,
          diskFormat: volume ? "qcow2" : vm.diskFormat,
        }),
      )
    ),
    Effect.flatMap((qemuArgs) => startAttachedQemu(name, vm, qemuArgs)),
    Effect.flatMap(validateQemuExit),
  );
};

const startVirtualMachine = (name: string, detach: boolean = false) =>
  pipe(
    getInstanceStateOrFail(name),
    Effect.flatMap((vm) => {
      const mergedVm = mergeFlags(vm);

      return pipe(
        logStartingMessage(mergedVm),
        Effect.flatMap(() =>
          detach
            ? startVirtualMachineDetached(name, mergedVm)
            : startVirtualMachineAttached(name, mergedVm)
        ),
      );
    }),
  );

export default async function (name: string, detach: boolean = false) {
  const program = pipe(
    startVirtualMachine(name, detach),
    Effect.catchTags({
      InstanceNotFoundError: (_error) =>
        Effect.sync(() => {
          console.error(`Virtual machine with name or ID ${name} not found.`);
          Deno.exit(1);
        }),
    }),
    Effect.catchAll((error) =>
      Effect.sync(() => {
        console.error(`Error: ${String(error)}`);
        Deno.exit(1);
      })
    ),
  );

  await Effect.runPromise(program);
}

function mergeFlags(vm: VirtualMachine): VirtualMachine {
  const { flags } = parseFlags(Deno.args);
  return {
    ...vm,
    memory: (flags.memory || flags.m)
      ? String(flags.memory || flags.m)
      : vm.memory,
    cpus: (flags.cpus || flags.C) ? Number(flags.cpus || flags.C) : vm.cpus,
    cpu: (flags.cpu || flags.c) ? String(flags.cpu || flags.c) : vm.cpu,
    diskFormat: flags.diskFormat ? String(flags.diskFormat) : vm.diskFormat,
    portForward: (flags.portForward || flags.p)
      ? String(flags.portForward || flags.p)
      : vm.portForward,
    drivePath: (flags.image || flags.i)
      ? String(flags.image || flags.i)
      : vm.drivePath,
    bridge: (flags.bridge || flags.b)
      ? String(flags.bridge || flags.b)
      : vm.bridge,
    diskSize: (flags.size || flags.s)
      ? String(flags.size || flags.s)
      : vm.diskSize,
  };
}
