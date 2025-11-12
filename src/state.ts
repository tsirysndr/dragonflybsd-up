import { Data, Effect } from "effect";
import type { DeleteResult, InsertResult, UpdateResult } from "kysely";
import { ctx } from "./context.ts";
import type { VirtualMachine } from "./db.ts";
import type { STATUS } from "./types.ts";

export class DbError extends Data.TaggedError("DatabaseError")<{
  cause?: unknown;
}> {}

export class InstanceNotFoundError
  extends Data.TaggedError("InstanceNotFoundError")<{
    name: string;
    message?: string;
  }> {}

export const saveInstanceState = (
  vm: VirtualMachine,
): Effect.Effect<InsertResult[], DbError, never> =>
  Effect.tryPromise({
    try: () =>
      ctx.db.insertInto("virtual_machines")
        .values(vm)
        .execute(),
    catch: (error) => new DbError({ cause: error }),
  });

export const updateInstanceState = (
  name: string,
  status: STATUS,
  pid?: number,
): Effect.Effect<UpdateResult[], DbError, never> =>
  Effect.tryPromise({
    try: () =>
      ctx.db.updateTable("virtual_machines")
        .set({
          status,
          pid,
          updatedAt: new Date().toISOString(),
        })
        .where((eb) =>
          eb.or([
            eb("name", "=", name),
            eb("id", "=", name),
          ])
        )
        .execute(),
    catch: (error) => new DbError({ cause: error }),
  });

export const removeInstanceState = (
  name: string,
): Effect.Effect<DeleteResult[], DbError, never> =>
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
    catch: (error) => new DbError({ cause: error }),
  });

export const getInstanceState = (
  name: string,
): Effect.Effect<VirtualMachine | undefined, DbError, never> =>
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
    catch: (error) => new DbError({ cause: error }),
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
