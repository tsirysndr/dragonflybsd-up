import { Data, Effect } from "effect";
import { ctx } from "./context.ts";
import type { VirtualMachine } from "./db.ts";
import type { STATUS } from "./types.ts";

export class DatabaseInsertError
  extends Data.TaggedError("DatabaseInsertError")<{
    cause: unknown;
    message: string;
  }> {}

export class DatabaseUpdateError
  extends Data.TaggedError("DatabaseUpdateError")<{
    cause: unknown;
    message: string;
  }> {}

export class DatabaseDeleteError
  extends Data.TaggedError("DatabaseDeleteError")<{
    cause: unknown;
    message: string;
  }> {}

export class DatabaseQueryError extends Data.TaggedError("DatabaseQueryError")<{
  cause: unknown;
  message: string;
}> {}

export class InstanceNotFoundError
  extends Data.TaggedError("InstanceNotFoundError")<{
    name: string;
    message: string;
  }> {}

export const saveInstanceState = (vm: VirtualMachine) =>
  Effect.tryPromise({
    try: () =>
      ctx.db.insertInto("virtual_machines")
        .values(vm)
        .execute(),
    catch: (cause) =>
      new DatabaseInsertError({
        cause,
        message: `Failed to save instance state for VM: ${vm.name}`,
      }),
  });

export const updateInstanceState = (
  name: string,
  status: STATUS,
  pid?: number,
) =>
  Effect.tryPromise({
    try: () =>
      ctx.db.updateTable("virtual_machines")
        .set({ status, pid, updatedAt: new Date().toISOString() })
        .where((eb) =>
          eb.or([
            eb("name", "=", name),
            eb("id", "=", name),
          ])
        )
        .execute(),
    catch: (cause) =>
      new DatabaseUpdateError({
        cause,
        message: `Failed to update instance state for: ${name}`,
      }),
  });

export const removeInstanceState = (name: string) =>
  Effect.tryPromise({
    try: () =>
      ctx.db.deleteFrom("virtual_machines")
        .where((eb) =>
          eb.or([
            eb("name", "=", name),
            eb("id", "=", name),
          ])
        )
        .execute(),
    catch: (cause) =>
      new DatabaseDeleteError({
        cause,
        message: `Failed to remove instance state for: ${name}`,
      }),
  });

export const getInstanceState = (name: string) =>
  Effect.tryPromise({
    try: () =>
      ctx.db.selectFrom("virtual_machines")
        .selectAll()
        .where((eb) =>
          eb.or([
            eb("name", "=", name),
            eb("id", "=", name),
          ])
        )
        .executeTakeFirst(),
    catch: (cause) =>
      new DatabaseQueryError({
        cause,
        message: `Failed to query instance state for: ${name}`,
      }),
  });

export const getInstanceStateOrFail = (name: string) =>
  Effect.flatMap(
    getInstanceState(name),
    (vm) =>
      vm ? Effect.succeed(vm) : Effect.fail(
        new InstanceNotFoundError({
          name,
          message: `Instance not found: ${name}`,
        }),
      ),
  );
