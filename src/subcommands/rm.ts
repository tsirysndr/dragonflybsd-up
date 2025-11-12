import { Effect, pipe } from "effect";
import { getInstanceStateOrFail, removeInstanceState } from "../state.ts";

const removeVirtualMachine = (name: string) =>
  pipe(
    getInstanceStateOrFail(name),
    Effect.flatMap((vm) => {
      console.log(`Removing virtual machine ${vm.name} (ID: ${vm.id})...`);
      return removeInstanceState(name);
    }),
  );

export default async function (name: string) {
  const program = pipe(
    removeVirtualMachine(name),
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
