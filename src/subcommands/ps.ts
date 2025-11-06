import { Table } from "@cliffy/table";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime.js";
import utc from "dayjs/plugin/utc.js";
import { Effect, pipe } from "effect";
import { ctx } from "../context.ts";
import type { VirtualMachine } from "../db.ts";

dayjs.extend(relativeTime);
dayjs.extend(utc);

const queryVirtualMachines = (all: boolean) =>
  Effect.tryPromise({
    try: () =>
      ctx.db.selectFrom("virtual_machines")
        .selectAll()
        .where((eb) => {
          if (all) {
            return eb("id", "!=", "");
          }
          return eb("status", "=", "RUNNING");
        })
        .execute(),
    catch: (cause) => new Error(`Failed to query virtual machines: ${cause}`),
  });

const createTableHeaders = () =>
  new Table([
    "NAME",
    "VCPU",
    "MEMORY",
    "STATUS",
    "PID",
    "BRIDGE",
    "PORTS",
    "CREATED",
  ]);

const formatVmTableRow = (vm: VirtualMachine): string[] => [
  vm.name,
  vm.cpus.toString(),
  vm.memory,
  formatStatus(vm),
  formatPid(vm),
  vm.bridge ?? "-",
  formatPorts(vm.portForward),
  dayjs.utc(vm.createdAt).local().fromNow(),
];

const populateTable = (vms: VirtualMachine[]) =>
  Effect.sync(() => {
    const table = createTableHeaders();

    for (const vm of vms) {
      table.push(formatVmTableRow(vm));
    }

    return table;
  });

const displayTable = (table: Table) =>
  Effect.sync(() => {
    console.log(table.padding(2).toString());
  });

const listVirtualMachines = (all: boolean) =>
  pipe(
    queryVirtualMachines(all),
    Effect.flatMap(populateTable),
    Effect.flatMap(displayTable),
  );

export default async function (all: boolean) {
  const program = pipe(
    listVirtualMachines(all),
    Effect.catchAll((error) =>
      Effect.sync(() => {
        console.error(`Error: ${String(error)}`);
        Deno.exit(1);
      })
    ),
  );

  await Effect.runPromise(program);
}

function formatPid(vm: VirtualMachine) {
  if (!vm.pid) {
    return "-";
  }

  if (vm.status !== "RUNNING") {
    return "-";
  }

  return vm.pid.toString();
}

function formatStatus(vm: VirtualMachine) {
  switch (vm.status) {
    case "RUNNING":
      return `Up ${
        dayjs.utc(vm.updatedAt).local().fromNow().replace("ago", "")
      }`;
    case "STOPPED":
      return `Exited ${dayjs.utc(vm.updatedAt).local().fromNow()}`;
    default:
      return vm.status;
  }
}

function formatPorts(portForward?: string) {
  if (!portForward) {
    return "-";
  }

  const mappings = portForward.split(",");
  return mappings.map((mapping) => {
    const [hostPort, guestPort] = mapping.split(":");
    return `${hostPort}->${guestPort}`;
  }).join(", ");
}
