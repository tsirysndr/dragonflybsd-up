import { Effect, pipe } from "effect";
import { LOGS_DIR } from "../constants.ts";

const ensureLogsDirectory = () =>
  Effect.tryPromise({
    try: () => Deno.mkdir(LOGS_DIR, { recursive: true }),
    catch: (cause) => new Error(`Failed to create logs directory: ${cause}`),
  });

const buildLogPath = (name: string) =>
  Effect.sync(() => `${LOGS_DIR}/${name}.log`);

const buildLogCommand = (follow: boolean, logPath: string) =>
  Effect.sync(() => ({
    command: follow ? "tail" : "cat",
    args: [
      ...(follow ? ["-n", "100", "-f"] : []),
      logPath,
    ],
  }));

const executeLogCommand = (command: string, args: string[]) =>
  Effect.tryPromise({
    try: async () => {
      const cmd = new Deno.Command(command, {
        args,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });

      return await cmd.spawn().status;
    },
    catch: (cause) => new Error(`Failed to execute log command: ${cause}`),
  });

const validateLogCommandResult = (name: string, status: Deno.CommandStatus) =>
  Effect.sync(() => {
    if (!status.success) {
      throw new Error(`Failed to view logs for virtual machine ${name}`);
    }
  });

const viewVirtualMachineLogs = (name: string, follow: boolean) =>
  pipe(
    ensureLogsDirectory(),
    Effect.flatMap(() => buildLogPath(name)),
    Effect.flatMap((logPath) =>
      pipe(
        buildLogCommand(follow, logPath),
        Effect.flatMap(({ command, args }) => executeLogCommand(command, args)),
        Effect.flatMap((status) => validateLogCommandResult(name, status)),
      )
    ),
  );

export default async function (name: string, follow: boolean) {
  const program = pipe(
    viewVirtualMachineLogs(name, follow),
    Effect.catchAll((error) =>
      Effect.sync(() => {
        console.error(`Error: ${String(error)}`);
        Deno.exit(1);
      })
    ),
  );

  await Effect.runPromise(program);
}
