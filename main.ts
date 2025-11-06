#!/usr/bin/env -S deno run --allow-run --allow-read --allow-env

import { Command } from "@cliffy/command";
import { Effect } from "effect";
import pkg from "./deno.json" with { type: "json" };
import { createBridgeNetworkIfNeeded } from "./src/network.ts";
import inspect from "./src/subcommands/inspect.ts";
import logs from "./src/subcommands/logs.ts";
import ps from "./src/subcommands/ps.ts";
import restart from "./src/subcommands/restart.ts";
import rm from "./src/subcommands/rm.ts";
import start from "./src/subcommands/start.ts";
import stop from "./src/subcommands/stop.ts";
import {
  createDriveImageIfNeeded,
  downloadIso,
  emptyDiskImage,
  handleInput,
  type Options,
  runQemu,
} from "./src/utils.ts";

export * from "./src/mod.ts";

if (import.meta.main) {
  await new Command()
    .name("dflybsd-up")
    .version(pkg.version)
    .description("Start a DragonflyBSD virtual machine using QEMU")
    .arguments(
      "[path-or-url-to-iso-or-version:string]",
    )
    .option("-o, --output <path:string>", "Output path for downloaded ISO")
    .option("-c, --cpu <type:string>", "Type of CPU to emulate", {
      default: "host",
    })
    .option("-C, --cpus <number:number>", "Number of CPU cores", {
      default: 2,
    })
    .option("-m, --memory <size:string>", "Amount of memory for the VM", {
      default: "2G",
    })
    .option("-i, --image <path:string>", "Path to VM disk image")
    .option(
      "--disk-format <format:string>",
      "Disk image format (e.g., qcow2, raw)",
      {
        default: "raw",
      },
    )
    .option(
      "--size <size:string>",
      "Size of the VM disk image to create if it doesn't exist (e.g., 20G)",
      {
        default: "20G",
      },
    )
    .option(
      "-b, --bridge <name:string>",
      "Name of the network bridge to use for networking (e.g., br0)",
    )
    .option(
      "-d, --detach",
      "Run VM in the background and print VM name",
    )
    .option(
      "-p, --port-forward <mappings:string>",
      "Port forwarding rules in the format hostPort:guestPort (comma-separated for multiple)",
    )
    .example(
      "Default usage",
      "dflybsd-up",
    )
    .example(
      "Specific version",
      "dflybsd-up 6.4.2",
    )
    .example(
      "Local ISO file",
      "dflybsd-up /path/to/dragonflybsd.iso",
    )
    .example(
      "Download URL",
      "dflybsd-up https://mirror-master.dragonflybsd.org/iso-images/dfly-x86_64-6.4.2_REL.iso",
    )
    .example(
      "List running VMs",
      "dflybsd-up ps",
    )
    .example(
      "List all VMs",
      "dflybsd-up ps --all",
    )
    .example(
      "Start a VM",
      "dflybsd-up start my-vm",
    )
    .example(
      "Stop a VM",
      "dflybsd-up stop my-vm",
    )
    .example(
      "Inspect a VM",
      "dflybsd-up inspect my-vm",
    )
    .action(async (options: Options, input?: string) => {
      const resolvedInput = handleInput(input);
      let isoPath: string | null = resolvedInput;

      if (
        resolvedInput.startsWith("https://") ||
        resolvedInput.startsWith("http://")
      ) {
        isoPath = await Effect.runPromise(downloadIso(resolvedInput, options));
      }

      if (options.image) {
        await Effect.runPromise(createDriveImageIfNeeded(options));
      }

      if (
        !input && options.image &&
        !await Effect.runPromise(emptyDiskImage(options.image))
      ) {
        isoPath = null;
      }

      if (options.bridge) {
        await createBridgeNetworkIfNeeded(options.bridge);
      }

      await Effect.runPromise(runQemu(isoPath, options));
    })
    .command("ps", "List all virtual machines")
    .option("--all, -a", "Show all virtual machines, including stopped ones")
    .action(async (options: { all?: unknown }) => {
      await ps(Boolean(options.all));
    })
    .command("start", "Start a virtual machine")
    .arguments("<vm-name:string>")
    .option("-c, --cpu <type:string>", "Type of CPU to emulate", {
      default: "host",
    })
    .option("-C, --cpus <number:number>", "Number of CPU cores", {
      default: 2,
    })
    .option("-m, --memory <size:string>", "Amount of memory for the VM", {
      default: "2G",
    })
    .option("-i, --image <path:string>", "Path to VM disk image")
    .option(
      "--disk-format <format:string>",
      "Disk image format (e.g., qcow2, raw)",
      {
        default: "raw",
      },
    )
    .option(
      "--size <size:string>",
      "Size of the VM disk image to create if it doesn't exist (e.g., 20G)",
      {
        default: "20G",
      },
    )
    .option(
      "-b, --bridge <name:string>",
      "Name of the network bridge to use for networking (e.g., br0)",
    )
    .option(
      "-d, --detach",
      "Run VM in the background and print VM name",
    )
    .option(
      "-p, --port-forward <mappings:string>",
      "Port forwarding rules in the format hostPort:guestPort (comma-separated for multiple)",
    )
    .action(async (options: unknown, vmName: string) => {
      await start(vmName, Boolean((options as { detach: boolean }).detach));
    })
    .command("stop", "Stop a virtual machine")
    .arguments("<vm-name:string>")
    .action(async (_options: unknown, vmName: string) => {
      await stop(vmName);
    })
    .command("inspect", "Inspect a virtual machine")
    .arguments("<vm-name:string>")
    .action(async (_options: unknown, vmName: string) => {
      await inspect(vmName);
    })
    .command("rm", "Remove a virtual machine")
    .arguments("<vm-name:string>")
    .action(async (_options: unknown, vmName: string) => {
      await rm(vmName);
    })
    .command("logs", "View logs of a virtual machine")
    .option("--follow, -f", "Follow log output")
    .arguments("<vm-name:string>")
    .action(async (options: unknown, vmName: string) => {
      await logs(vmName, Boolean((options as { follow: boolean }).follow));
    })
    .command("restart", "Restart a virtual machine")
    .arguments("<vm-name:string>")
    .action(async (_options: unknown, vmName: string) => {
      await restart(vmName);
    })
    .parse(Deno.args);
}
