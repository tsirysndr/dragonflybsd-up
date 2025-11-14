import _ from "@es-toolkit/es-toolkit/compat";
import { createId } from "@paralleldrive/cuid2";
import chalk from "chalk";
import { Data, Effect, pipe } from "effect";
import Moniker from "moniker";
import { EMPTY_DISK_THRESHOLD_KB, LOGS_DIR } from "./constants.ts";
import type { Image } from "./db.ts";
import { generateRandomMacAddress } from "./network.ts";
import { saveInstanceState, updateInstanceState } from "./state.ts";

export class FileSystemError extends Data.TaggedError("FileSystemError")<{
  cause: unknown;
  message: string;
}> {}

export class CommandExecutionError
  extends Data.TaggedError("CommandExecutionError")<{
    cause: unknown;
    message: string;
    exitCode?: number;
  }> {}

export class ProcessKillError extends Data.TaggedError("ProcessKillError")<{
  cause: unknown;
  message: string;
  pid: number;
}> {}

class InvalidImageNameError extends Data.TaggedError("InvalidImageNameError")<{
  image: string;
  cause?: unknown;
}> {}

class NoSuchImageError extends Data.TaggedError("NoSuchImageError")<{
  cause: string;
}> {}

export const DEFAULT_VERSION = "6.4.2";

export interface Options {
  output?: string;
  cpu: string;
  cpus: number;
  memory: string;
  image?: string;
  diskFormat: string;
  size: string;
  bridge?: string;
  portForward?: string;
  detach?: boolean;
  install?: boolean;
  volume?: string;
}

export const getCurrentArch = (): string => {
  switch (Deno.build.arch) {
    case "x86_64":
      return "amd64";
    case "aarch64":
      return "arm64";
    default:
      return Deno.build.arch;
  }
};

export const isValidISOurl = (url?: string): boolean => {
  return Boolean(
    (url?.startsWith("http://") || url?.startsWith("https://")) &&
      url?.endsWith(".iso"),
  );
};

export const humanFileSize = (blocks: number) =>
  Effect.sync(() => {
    const blockSize = 512; // bytes per block
    let bytes = blocks * blockSize;
    const thresh = 1024;

    if (Math.abs(bytes) < thresh) {
      return `${bytes}B`;
    }

    const units = ["KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
    let u = -1;

    do {
      bytes /= thresh;
      ++u;
    } while (Math.abs(bytes) >= thresh && u < units.length - 1);

    return `${bytes.toFixed(1)}${units[u]}`;
  });

export const validateImage = (
  image: string,
): Effect.Effect<string, InvalidImageNameError, never> => {
  const regex =
    /^(?:[a-zA-Z0-9.-]+(?:\.[a-zA-Z0-9.-]+)*\/)?[a-z0-9]+(?:[._-][a-z0-9]+)*\/[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[a-zA-Z0-9._-]+)?$/;

  if (!regex.test(image)) {
    return Effect.fail(
      new InvalidImageNameError({
        image,
        cause:
          "Image name does not conform to expected format. Should be in the format 'repository/name:tag'.",
      }),
    );
  }
  return Effect.succeed(image);
};

export const extractTag = (name: string) =>
  pipe(
    validateImage(name),
    Effect.flatMap((image) => Effect.succeed(image.split(":")[1] || "latest")),
  );

export const failOnMissingImage = (
  image: Image | undefined,
): Effect.Effect<Image, Error, never> =>
  image
    ? Effect.succeed(image)
    : Effect.fail(new NoSuchImageError({ cause: "No such image" }));

export const du = (path: string) =>
  Effect.tryPromise({
    try: async () => {
      const cmd = new Deno.Command("du", {
        args: [path],
        stdout: "piped",
        stderr: "inherit",
      });

      const { stdout } = await cmd.spawn().output();
      const output = new TextDecoder().decode(stdout).trim();
      const size = parseInt(output.split("\t")[0], 10);
      return size;
    },
    catch: (cause) =>
      new CommandExecutionError({
        cause,
        message: `Failed to get disk usage for path: ${path}`,
      }),
  });

export const emptyDiskImage = (path: string) =>
  pipe(
    Effect.tryPromise({
      try: () => Deno.stat(path),
      catch: () =>
        new FileSystemError({
          cause: undefined,
          message: `File does not exist: ${path}`,
        }),
    }),
    Effect.catchAll(() => Effect.succeed(true)), // File doesn't exist, consider it empty
    Effect.flatMap((exists) => {
      if (exists === true) {
        return Effect.succeed(true);
      }
      return pipe(
        du(path),
        Effect.map((size) => size < EMPTY_DISK_THRESHOLD_KB),
      );
    }),
  );

export const downloadIso = (url: string, options: Options) => {
  const filename = url.split("/").pop()!;
  const outputPath = options.output ?? filename;

  return Effect.tryPromise({
    try: async () => {
      // Check if image exists and is not empty
      if (options.image) {
        try {
          await Deno.stat(options.image);
          const driveSize = await Effect.runPromise(du(options.image));
          if (driveSize > EMPTY_DISK_THRESHOLD_KB) {
            console.log(
              chalk.yellowBright(
                `Drive image ${options.image} is not empty (size: ${driveSize} KB), skipping ISO download to avoid overwriting existing data.`,
              ),
            );
            return null;
          }
        } catch {
          // Image doesn't exist, continue
        }
      }

      // Check if output file already exists
      try {
        await Deno.stat(outputPath);
        console.log(
          chalk.yellowBright(
            `File ${outputPath} already exists, skipping download.`,
          ),
        );
        return outputPath;
      } catch {
        // File doesn't exist, proceed with download
      }

      // Download the file
      const cmd = new Deno.Command("curl", {
        args: ["-L", "-o", outputPath, url],
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });

      const status = await cmd.spawn().status;
      if (!status.success) {
        throw new Error(`Download failed with exit code ${status.code}`);
      }

      console.log(chalk.greenBright(`Downloaded ISO to ${outputPath}`));
      return outputPath;
    },
    catch: (cause) =>
      new CommandExecutionError({
        cause,
        message: `Failed to download ISO from ${url}`,
      }),
  });
};

export function constructDownloadUrl(version: string): string {
  return `https://mirror-master.dragonflybsd.org/iso-images/dfly-x86_64-${version}_REL.iso`;
}

export function setupPortForwardingArgs(portForward?: string): string {
  if (!portForward) {
    return "";
  }

  const forwards = portForward.split(",").map((pair) => {
    const [hostPort, guestPort] = pair.split(":");
    return `hostfwd=tcp::${hostPort}-:${guestPort}`;
  });

  return forwards.join(",");
}

export function setupNATNetworkArgs(portForward?: string): string {
  if (!portForward) {
    return "user,id=net0";
  }

  const portForwarding = setupPortForwardingArgs(portForward);
  return `user,id=net0,${portForwarding}`;
}

const buildQemuArgs = (
  isoPath: string | null,
  options: Options,
  macAddress: string,
) => [
  ..._.compact([options.bridge && "qemu-system-x86_64"]),
  ...Deno.build.os === "linux" ? ["-enable-kvm"] : [],
  "-cpu",
  options.cpu,
  "-m",
  options.memory,
  "-smp",
  options.cpus.toString(),
  ..._.compact([isoPath && "-cdrom", isoPath]),
  "-netdev",
  options.bridge
    ? `bridge,id=net0,br=${options.bridge}`
    : setupNATNetworkArgs(options.portForward),
  "-device",
  `e1000,netdev=net0,mac=${macAddress}`,
  ...(options.install ? [] : ["-snapshot"]),
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
  ..._.compact(
    options.image && [
      "-drive",
      `file=${options.image},format=${options.diskFormat},if=virtio`,
    ],
  ),
];

const createVMInstance = (
  name: string,
  isoPath: string | null,
  options: Options,
  macAddress: string,
  pid: number,
) => ({
  id: createId(),
  name,
  bridge: options.bridge,
  macAddress,
  memory: options.memory,
  cpus: options.cpus,
  cpu: options.cpu,
  diskSize: options.size,
  diskFormat: options.diskFormat,
  portForward: options.portForward,
  isoPath: isoPath ? Deno.realPathSync(isoPath) : undefined,
  drivePath: options.image ? Deno.realPathSync(options.image) : undefined,
  version: DEFAULT_VERSION,
  status: "RUNNING" as const,
  pid,
});

const runDetachedQemu = (
  name: string,
  isoPath: string | null,
  options: Options,
  macAddress: string,
  qemuArgs: string[],
) =>
  pipe(
    Effect.tryPromise({
      try: () => Deno.mkdir(LOGS_DIR, { recursive: true }),
      catch: (cause) =>
        new FileSystemError({
          cause,
          message: "Failed to create logs directory",
        }),
    }),
    Effect.flatMap(() => {
      const logPath = `${LOGS_DIR}/${name}.log`;
      const fullCommand = options.bridge
        ? `sudo qemu-system-x86_64 ${
          qemuArgs.slice(1).join(" ")
        } >> "${logPath}" 2>&1 & echo $!`
        : `qemu-system-x86_64 ${
          qemuArgs.join(" ")
        } >> "${logPath}" 2>&1 & echo $!`;

      return pipe(
        Effect.tryPromise({
          try: async () => {
            const cmd = new Deno.Command("sh", {
              args: ["-c", fullCommand],
              stdin: "null",
              stdout: "piped",
            });

            const { stdout } = await cmd.spawn().output();
            return parseInt(new TextDecoder().decode(stdout).trim(), 10);
          },
          catch: (cause) =>
            new CommandExecutionError({
              cause,
              message: `Failed to start detached QEMU process: ${cause}`,
            }),
        }),
        Effect.flatMap((qemuPid) =>
          pipe(
            saveInstanceState(
              createVMInstance(name, isoPath, options, macAddress, qemuPid),
            ),
            Effect.flatMap(() =>
              Effect.sync(() => {
                console.log(
                  `Virtual machine ${name} started in background (PID: ${qemuPid})`,
                );
                console.log(`Logs will be written to: ${logPath}`);
                Deno.exit(0);
              })
            ),
          )
        ),
      );
    }),
  );

const runAttachedQemu = (
  name: string,
  isoPath: string | null,
  options: Options,
  macAddress: string,
  qemuArgs: string[],
) =>
  Effect.tryPromise({
    try: async () => {
      const cmd = new Deno.Command(
        options.bridge ? "sudo" : "qemu-system-x86_64",
        {
          args: qemuArgs,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        },
      ).spawn();

      await Effect.runPromise(
        saveInstanceState(
          createVMInstance(name, isoPath, options, macAddress, cmd.pid),
        ),
      );

      const status = await cmd.status;
      await Effect.runPromise(updateInstanceState(name, "STOPPED"));

      if (!status.success) {
        throw new Error(`QEMU exited with code ${status.code}`);
      }
    },
    catch: (cause) =>
      new CommandExecutionError({
        cause,
        message: "Failed to run attached QEMU process",
      }),
  });

export const runQemu = (isoPath: string | null, options: Options) => {
  return pipe(
    generateRandomMacAddress(),
    Effect.flatMap((macAddress) => {
      const name = Moniker.choose();
      const qemuArgs = buildQemuArgs(isoPath, options, macAddress);

      return options.detach
        ? runDetachedQemu(name, isoPath, options, macAddress, qemuArgs)
        : runAttachedQemu(name, isoPath, options, macAddress, qemuArgs);
    }),
  );
};

export function handleInput(input?: string): string {
  if (!input) {
    console.log(
      `No ISO path provided, defaulting to ${chalk.cyan("DragonflyBSD")} ${
        chalk.cyan(DEFAULT_VERSION)
      }...`,
    );
    return constructDownloadUrl(DEFAULT_VERSION);
  }

  const versionRegex = /^\d{1,2}\.\d{1,2}\.\d{1,2}$/;

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

const executeKillCommand = (args: string[]) =>
  Effect.tryPromise({
    try: async () => {
      const cmd = new Deno.Command(args[0], {
        args: args.slice(1),
        stdout: "null",
        stderr: "null",
      });
      return await cmd.spawn().status;
    },
    catch: (cause) =>
      new CommandExecutionError({
        cause,
        message: `Failed to execute kill command: ${args.join(" ")}`,
      }),
  });

const waitForDelay = (ms: number) =>
  Effect.tryPromise({
    try: () => new Promise((resolve) => setTimeout(resolve, ms)),
    catch: () => new Error("Wait delay failed"),
  });

const checkProcessAlive = (pid: number) =>
  Effect.tryPromise({
    try: async () => {
      const checkCmd = new Deno.Command("kill", {
        args: ["-0", pid.toString()],
        stdout: "null",
        stderr: "null",
      });
      const status = await checkCmd.spawn().status;
      return status.success; // true if process exists, false if not
    },
    catch: (cause) =>
      new ProcessKillError({
        cause,
        message: `Failed to check if process ${pid} is alive`,
        pid,
      }),
  });

export const safeKillQemu = (pid: number, useSudo: boolean = false) => {
  const termArgs = useSudo
    ? ["sudo", "kill", "-TERM", pid.toString()]
    : ["kill", "-TERM", pid.toString()];

  const killArgs = useSudo
    ? ["sudo", "kill", "-KILL", pid.toString()]
    : ["kill", "-KILL", pid.toString()];

  return pipe(
    executeKillCommand(termArgs),
    Effect.flatMap((termStatus) => {
      if (termStatus.success) {
        return pipe(
          waitForDelay(3000),
          Effect.flatMap(() => checkProcessAlive(pid)),
          Effect.flatMap((isAlive) => {
            if (!isAlive) {
              return Effect.succeed(true);
            }
            // Process still alive, use KILL signal
            return pipe(
              executeKillCommand(killArgs),
              Effect.map((killStatus) => killStatus.success),
            );
          }),
        );
      }
      // TERM failed, try KILL directly
      return pipe(
        executeKillCommand(killArgs),
        Effect.map((killStatus) => killStatus.success),
      );
    }),
  );
};

const checkDriveImageExists = (path: string) =>
  Effect.tryPromise({
    try: () => Deno.stat(path),
    catch: () =>
      new FileSystemError({
        cause: undefined,
        message: `Drive image does not exist: ${path}`,
      }),
  });

const createDriveImageFile = (path: string, format: string, size: string) =>
  Effect.tryPromise({
    try: async () => {
      const cmd = new Deno.Command("qemu-img", {
        args: ["create", "-f", format, path, size],
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });

      const status = await cmd.spawn().status;
      if (!status.success) {
        throw new Error(`qemu-img create failed with exit code ${status.code}`);
      }
      return path;
    },
    catch: (cause) =>
      new CommandExecutionError({
        cause,
        message: `Failed to create drive image at ${path}`,
      }),
  });

export const createDriveImageIfNeeded = (
  options: Pick<Options, "image" | "diskFormat" | "size">,
) => {
  const { image: path, diskFormat: format, size } = options;

  if (!path || !format || !size) {
    return Effect.fail(
      new Error("Missing required parameters: image, diskFormat, or size"),
    );
  }

  return pipe(
    checkDriveImageExists(path),
    Effect.flatMap(() => {
      console.log(
        chalk.yellowBright(
          `Drive image ${path} already exists, skipping creation.`,
        ),
      );
      return Effect.succeed(undefined);
    }),
    Effect.catchAll(() =>
      pipe(
        createDriveImageFile(path, format, size),
        Effect.flatMap((createdPath) => {
          console.log(
            chalk.greenBright(`Created drive image at ${createdPath}`),
          );
          return Effect.succeed(undefined);
        }),
      )
    ),
  );
};
