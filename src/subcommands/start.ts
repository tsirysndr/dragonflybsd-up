import { parseFlags } from "@cliffy/flags";
import _ from "lodash";
import { LOGS_DIR } from "../constants.ts";
import type { VirtualMachine } from "../db.ts";
import { getInstanceState, updateInstanceState } from "../state.ts";
import { setupNATNetworkArgs } from "../utils.ts";

export default async function (name: string, detach: boolean = false) {
  let vm = await getInstanceState(name);
  if (!vm) {
    console.error(
      `Virtual machine with name or ID ${name} not found.`,
    );
    Deno.exit(1);
  }

  console.log(`Starting virtual machine ${vm.name} (ID: ${vm.id})...`);

  vm = mergeFlags(vm);

  const qemuArgs = [
    ..._.compact([vm.bridge && "qemu-system-x86_64"]),
    ..._.compact(Deno.build.os === "linux" && ["-enable-kvm"]),
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

  if (detach) {
    await Deno.mkdir(LOGS_DIR, { recursive: true });
    const logPath = `${LOGS_DIR}/${vm.name}.log`;

    const fullCommand = vm.bridge
      ? `sudo qemu-system-x86_64 ${
        qemuArgs.slice(1).join(" ")
      } >> "${logPath}" 2>&1 & echo $!`
      : `qemu-system-x86_64 ${
        qemuArgs.join(" ")
      } >> "${logPath}" 2>&1 & echo $!`;

    const cmd = new Deno.Command("sh", {
      args: ["-c", fullCommand],
      stdin: "null",
      stdout: "piped",
    });

    const { stdout } = await cmd.spawn().output();
    const qemuPid = parseInt(new TextDecoder().decode(stdout).trim(), 10);

    await updateInstanceState(name, "RUNNING", qemuPid);

    console.log(
      `Virtual machine ${vm.name} started in background (PID: ${qemuPid})`,
    );
    console.log(`Logs will be written to: ${logPath}`);

    // Exit successfully while keeping VM running in background
    Deno.exit(0);
  } else {
    const cmd = new Deno.Command(vm.bridge ? "sudo" : "qemu-system-x86_64", {
      args: qemuArgs,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    const child = cmd.spawn();
    await updateInstanceState(name, "RUNNING", child.pid);

    const status = await child.status;

    await updateInstanceState(name, "STOPPED", child.pid);

    if (!status.success) {
      Deno.exit(status.code);
    }
  }
}

function mergeFlags(vm: VirtualMachine): VirtualMachine {
  const { flags } = parseFlags(Deno.args);
  return {
    ...vm,
    memory: flags.memory ? String(flags.memory) : vm.memory,
    cpus: flags.cpus ? Number(flags.cpus) : vm.cpus,
    cpu: flags.cpu ? String(flags.cpu) : vm.cpu,
    diskFormat: flags.diskFormat ? String(flags.diskFormat) : vm.diskFormat,
    portForward: flags.portForward ? String(flags.portForward) : vm.portForward,
    drivePath: flags.image ? String(flags.image) : vm.drivePath,
    bridge: flags.bridge ? String(flags.bridge) : vm.bridge,
    diskSize: flags.size ? String(flags.size) : vm.diskSize,
  };
}
