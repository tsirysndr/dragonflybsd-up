import { Effect, pipe } from "effect";
import { getInstanceStateOrFail } from "../state.ts";

const inspectVirtualMachine = (name: string) =>
  pipe(
    getInstanceStateOrFail(name),
    Effect.flatMap(Effect.log),
  );

export default async function (name: string) {
  const program = pipe(
    inspectVirtualMachine(name),
    Effect.catchTags({
      InstanceNotFoundError: (_error) =>
        Effect.sync(() => {
          console.error(`Virtual machine with name or ID ${name} not found.`);
          Deno.exit(1);
        }),
      DatabaseQueryError: (error) =>
        Effect.sync(() => {
          console.error(`Database error: ${error.message}`);
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
