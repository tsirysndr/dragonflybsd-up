import { Data, Effect, pipe } from "effect";
import type { Image, VirtualMachine } from "../db.ts";
import { getImage } from "../images.ts";
import { getInstanceState } from "../state.ts";

class ItemNotFoundError extends Data.TaggedError("ItemNotFoundError")<{
  name: string;
}> {}

const find = (name: string) =>
  pipe(
    Effect.all([getInstanceState(name), getImage(name)]),
    Effect.flatMap(([vm, image]) =>
      vm || image
        ? Effect.succeed(vm || image)
        : Effect.fail(new ItemNotFoundError({ name }))
    ),
  );

const display = (vm: VirtualMachine | Image | undefined) =>
  Effect.sync(() => {
    console.log(vm);
  });

const handleError = (error: ItemNotFoundError | Error) =>
  Effect.sync(() => {
    if (error instanceof ItemNotFoundError) {
      console.error(
        `Virtual machine with name or ID ${error.name} not found.`,
      );
    } else {
      console.error(`An error occurred: ${error}`);
    }
    Deno.exit(1);
  });

const inspectEffect = (name: string) =>
  pipe(
    find(name),
    Effect.flatMap(display),
    Effect.catchAll(handleError),
  );

export default async function (name: string) {
  await Effect.runPromise(inspectEffect(name));
}
