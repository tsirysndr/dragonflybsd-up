import _ from "@es-toolkit/es-toolkit/compat";
import chalk from "chalk";
import { Effect, pipe } from "effect";
import { LOGS_DIR } from "../constants.ts";
import type { VirtualMachine } from "../db.ts";
import { getInstanceStateOrFail, updateInstanceState } from "../state.ts";
import { safeKillQemu, setupNATNetworkArgs } from "../utils.ts";

const killQemuProcess = (vm: VirtualMachine) =>
  pipe(
    safeKillQemu(vm.pid, Boolean(vm.bridge)),
    Effect.flatMap((success) => {
      if (!success) {
        return Effect.fail(
          new Error(`Failed to stop virtual machine ${vm.name}`),
        );
      }
      return Effect.succeed(vm);
    }),
  );

const markInstanceAsStopped = (vm: VirtualMachine) =>
  updateInstanceState(vm.id, "STOPPED");

const waitForDelay = (ms: number) =>
  Effect.tryPromise({
    try: () => new Promise((resolve) => setTimeout(resolve, ms)),
    catch: () => new Error("Sleep failed"),
  });

const createLogsDirectory = () =>
  Effect.tryPromise({
    try: () => Deno.mkdir(LOGS_DIR, { recursive: true }),
    catch: (cause) => new Error(`Failed to create logs directory: ${cause}`),
  });

const buildQemuArgs = (vm: VirtualMachine) => [
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

const buildQemuCommand = (vm: VirtualMachine, logPath: string) => {
  const qemuArgs = buildQemuArgs(vm);
  return vm.bridge
    ? `sudo qemu-system-x86_64 ${
      qemuArgs.slice(1).join(" ")
    } >> "${logPath}" 2>&1 & echo $!`
    : `qemu-system-x86_64 ${qemuArgs.join(" ")} >> "${logPath}" 2>&1 & echo $!`;
};

const startQemuProcess = (fullCommand: string) =>
  Effect.tryPromise({
    try: async () => {
      const cmd = new Deno.Command("sh", {
        args: ["-c", fullCommand],
        stdin: "null",
        stdout: "piped",
      });

      const { stdout } = await cmd.spawn().output();
      return parseInt(new TextDecoder().decode(stdout).trim(), 10);
    },
    catch: (cause) => new Error(`Failed to start QEMU: ${cause}`),
  });

const markInstanceAsRunning = (vm: VirtualMachine, qemuPid: number) =>
  updateInstanceState(vm.id, "RUNNING", qemuPid);

const logRestartSuccess = (
  vm: VirtualMachine,
  qemuPid: number,
  logPath: string,
) =>
  Effect.sync(() => {
    console.log(
      `${chalk.greenBright(vm.name)} restarted with PID ${
        chalk.greenBright(qemuPid)
      }.`,
    );
    console.log(
      `Logs are being written to ${chalk.blueBright(logPath)}`,
    );
  });

const startVirtualMachineProcess = (vm: VirtualMachine) => {
  const logPath = `${LOGS_DIR}/${vm.name}.log`;
  const fullCommand = buildQemuCommand(vm, logPath);

  return pipe(
    startQemuProcess(fullCommand),
    Effect.flatMap((qemuPid) =>
      pipe(
        waitForDelay(2000),
        Effect.flatMap(() => markInstanceAsRunning(vm, qemuPid)),
        Effect.flatMap(() => logRestartSuccess(vm, qemuPid, logPath)),
      )
    ),
  );
};

const restartVirtualMachine = (name: string) =>
  pipe(
    getInstanceStateOrFail(name),
    Effect.flatMap((vm) =>
      pipe(
        killQemuProcess(vm),
        Effect.flatMap(() => markInstanceAsStopped(vm)),
        Effect.flatMap(() => waitForDelay(2000)),
        Effect.flatMap(() => createLogsDirectory()),
        Effect.flatMap(() => startVirtualMachineProcess(vm)),
      )
    ),
  );

export default async function (name: string) {
  const program = pipe(
    restartVirtualMachine(name),
    Effect.catchTags({
      InstanceNotFoundError: (_error) =>
        Effect.sync(() => {
          console.error(
            `Virtual machine with name or ID ${
              chalk.greenBright(name)
            } not found.`,
          );
          Deno.exit(1);
        }),
    }),
    Effect.catchAll((error) =>
      Effect.sync(() => {
        console.error(`Error: ${error.message}`);
        Deno.exit(1);
      })
    ),
  );

  await Effect.runPromise(program);

  await new Promise((resolve) => setTimeout(resolve, 2000));
  Deno.exit(0);
}
