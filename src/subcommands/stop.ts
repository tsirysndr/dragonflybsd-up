import _ from "@es-toolkit/es-toolkit/compat";
import chalk from "chalk";
import { Effect, pipe } from "effect";
import type { VirtualMachine } from "../db.ts";
import { getInstanceStateOrFail, updateInstanceState } from "../state.ts";

const logStoppingMessage = (vm: VirtualMachine) =>
  Effect.sync(() => {
    console.log(
      `Stopping virtual machine ${chalk.greenBright(vm.name)} (ID: ${
        chalk.greenBright(vm.id)
      })...`,
    );
  });

const buildKillCommand = (vm: VirtualMachine) => ({
  command: vm.bridge ? "sudo" : "kill",
  args: [
    ..._.compact([vm.bridge && "kill"]),
    "-TERM",
    vm.pid.toString(),
  ],
});

const executeKillCommand = (vm: VirtualMachine) => {
  const { command, args } = buildKillCommand(vm);

  return Effect.tryPromise({
    try: async () => {
      const cmd = new Deno.Command(command, {
        args,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });

      return await cmd.spawn().status;
    },
    catch: (cause) => new Error(`Failed to execute kill command: ${cause}`),
  });
};

const validateKillResult = (vm: VirtualMachine, status: Deno.CommandStatus) =>
  Effect.sync(() => {
    if (!status.success) {
      throw new Error(`Failed to stop virtual machine ${vm.name}`);
    }
    return vm;
  });

const markInstanceAsStopped = (vm: VirtualMachine) =>
  updateInstanceState(vm.name, "STOPPED");

const logStopSuccess = (vm: VirtualMachine) =>
  Effect.sync(() => {
    console.log(`Virtual machine ${chalk.greenBright(vm.name)} stopped.`);
  });

const stopVirtualMachineProcess = (vm: VirtualMachine) =>
  pipe(
    executeKillCommand(vm),
    Effect.flatMap((status) => validateKillResult(vm, status)),
    Effect.flatMap(() => markInstanceAsStopped(vm)),
    Effect.flatMap(() => logStopSuccess(vm)),
  );

const stopVirtualMachine = (name: string) =>
  pipe(
    getInstanceStateOrFail(name),
    Effect.flatMap((vm) =>
      pipe(
        logStoppingMessage(vm),
        Effect.flatMap(() => stopVirtualMachineProcess(vm)),
      )
    ),
  );

export default async function (name: string) {
  const program = pipe(
    stopVirtualMachine(name),
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
      DatabaseQueryError: (error) =>
        Effect.sync(() => {
          console.error(`Database error: ${error.message}`);
          Deno.exit(1);
        }),
      DatabaseUpdateError: (error) =>
        Effect.sync(() => {
          console.error(`Failed to update database: ${error.message}`);
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
}
