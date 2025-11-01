#!/usr/bin/env -S deno run --allow-run --allow-read --allow-env

import { Command } from "@cliffy/command";
import chalk from "chalk";

const DEFAULT_VERSION = "6.4.2";

interface Options {
  output?: string;
  cpu: string;
  cpus: number;
  memory: string;
  drive?: string;
  diskFormat: string;
  size: string;
}

async function downloadIso(url: string, outputPath?: string): Promise<string> {
  const filename = url.split("/").pop()!;
  outputPath = outputPath ?? filename;

  if (await Deno.stat(outputPath).catch(() => false)) {
    console.log(
      chalk.yellowBright(
        `File ${outputPath} already exists, skipping download.`,
      ),
    );
    return outputPath;
  }

  const cmd = new Deno.Command("curl", {
    args: ["-L", "-o", outputPath, url],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const status = await cmd.spawn().status;
  if (!status.success) {
    console.error(chalk.redBright("Failed to download ISO image."));
    Deno.exit(status.code);
  }

  console.log(chalk.greenBright(`Downloaded ISO to ${outputPath}`));
  return outputPath;
}

function constructDownloadUrl(version: string): string {
  return `https://mirror-master.dragonflybsd.org/iso-images/dfly-x86_64-${version}_REL.iso`;
}

async function runQemu(isoPath: string, options: Options): Promise<void> {
  const cmd = new Deno.Command("qemu-system-x86_64", {
    args: [
      "-enable-kvm",
      "-cpu",
      options.cpu,
      "-m",
      options.memory,
      "-smp",
      options.cpus.toString(),
      "-cdrom",
      isoPath,
      "-netdev",
      "user,id=net0,hostfwd=tcp::2222-:22",
      "-device",
      "e1000,netdev=net0",
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
      ...(options.drive
        ? [
          "-drive",
          `file=${options.drive},format=${options.diskFormat},if=virtio`,
        ]
        : []),
    ],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const status = await cmd.spawn().status;

  if (!status.success) {
    Deno.exit(status.code);
  }
}

function handleInput(input?: string): string {
  if (!input) {
    console.log(
      `No ISO path provided, defaulting to ${chalk.cyan("DragonflyBSD")} ${
        chalk.cyan(DEFAULT_VERSION)
      }...`,
    );
    return constructDownloadUrl(DEFAULT_VERSION);
  }

  const versionRegex = /^\d{1,2}\.\d{1,2}$/;

  if (versionRegex.test(input)) {
    console.log(
      chalk.blueBright(
        `Detected version ${chalk.cyan(input)}, constructing download URL...`,
      ),
    );
    return constructDownloadUrl(input);
  }

  return input;
}

async function createDriveImageIfNeeded(
  {
    drive: path,
    diskFormat: format,
    size,
  }: Options,
): Promise<void> {
  if (await Deno.stat(path!).catch(() => false)) {
    console.log(
      chalk.yellowBright(
        `Drive image ${path} already exists, skipping creation.`,
      ),
    );
    return;
  }

  const cmd = new Deno.Command("qemu-img", {
    args: ["create", "-f", format, path!, size!],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const status = await cmd.spawn().status;
  if (!status.success) {
    console.error(chalk.redBright("Failed to create drive image."));
    Deno.exit(status.code);
  }

  console.log(chalk.greenBright(`Created drive image at ${path}`));
}

if (import.meta.main) {
  await new Command()
    .name("dflybsd-up")
    .version("0.1.0")
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
    .option("-d, --drive <path:string>", "Path to VM disk image")
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
    .example(
      "Default usage",
      "dflybsd-up",
    )
    .example(
      "Specific version",
      "dflyhbsd-up 6.4.2",
    )
    .example(
      "Local ISO file",
      "dflybsd-up /path/to/dragonflybsd.iso",
    )
    .example(
      "Download URL",
      "dflybsd-up https://mirror-master.dragonflybsd.org/iso-images/dfly-x86_64-6.4.2_REL.iso",
    )
    .action(async (options: Options, input?: string) => {
      const resolvedInput = handleInput(input);
      let isoPath = resolvedInput;

      if (
        resolvedInput.startsWith("https://") ||
        resolvedInput.startsWith("http://")
      ) {
        isoPath = await downloadIso(resolvedInput, options.output);
      }

      if (options.drive) {
        await createDriveImageIfNeeded(options);
      }

      await runQemu(isoPath, {
        cpu: options.cpu,
        memory: options.memory,
        cpus: options.cpus,
        drive: options.drive,
        diskFormat: options.diskFormat,
        size: options.size,
      });
    })
    .parse(Deno.args);
}
