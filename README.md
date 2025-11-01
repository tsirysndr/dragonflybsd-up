# dflybsd-up ≽༏≼

A convenient CLI tool to quickly spin up DragonflyBSD virtual machines using
QEMU with sensible defaults.

![Preview](./preview.png)

## ✨ Features

- **⚡ Quick Start**: Launch DragonflyBSD with a single command
- **📥 Automatic ISO Download**: Fetches DragonflyBSD ISO images automatically
  from official mirrors
- **🔢 Version Support**: Specify any DragonflyBSD version (defaults to 6.4.2)
- **🎯 Flexible Input**: Accepts version numbers, local ISO paths, or download
  URLs
- **💾 Smart Caching**: Skips re-downloading already downloaded ISOs
- **🚀 KVM Acceleration**: Leverages KVM for optimal performance
- **🔌 SSH Port Forwarding**: Automatically forwards port 2222 to guest port 22
- **💻 Serial Console**: Direct terminal access without graphical overhead
- **💿 Persistent Storage**: Optional disk image support for persistent
  installations
- **⚙️ Customizable Resources**: Configure CPU, memory, and disk settings

## 📋 Prerequisites

- [Deno](https://deno.com) runtime
- QEMU with KVM support (`qemu-system-x86_64`)
- KVM kernel modules enabled

## 📦 Installation

```bash
deno install -A -g -r -f --config deno.json ./main.ts -n dflybsd-up
```

## 🚀 Usage

### Basic Usage

```bash
# Launch with defaults (DragonflyBSD 6.4.2, 2 CPUs, 2GB RAM)
dflybsd-up

# Specify a version (automatically downloads the RELEASE ISO)
dflybsd-up 6.4.2

# Use a local ISO file
dflybsd-up /path/to/dragonflybsd.iso

# Download from a specific URL
dflybsd-up https://mirror-master.dragonflybsd.org/iso-images/dfly-x86_64-6.4.2_REL.iso
```

### Advanced Options

```bash
# Custom CPU and memory configuration
dflybsd-up --cpu host --cpus 4 --memory 4G

# Specify output path for downloaded ISO
dflybsd-up 6.4.2 --output ~/isos/dragonfly.iso

# Use a persistent disk image
dflybsd-up --drive dragonfly.img --disk-format raw

# Combine options
dflybsd-up 6.4.2 \
  --cpus 4 \
  --memory 8G \
  --drive dragonfly.qcow2 \
  --disk-format qcow2
```

## ⚙️ Options

| Option          | Short | Description                          | Default                 |
| --------------- | ----- | ------------------------------------ | ----------------------- |
| `--output`      | `-o`  | Output path for downloaded ISO       | Auto-generated from URL |
| `--cpu`         | `-c`  | CPU type to emulate                  | `host`                  |
| `--cpus`        | `-C`  | Number of CPU cores                  | `2`                     |
| `--memory`      | `-m`  | Amount of memory for VM              | `2G`                    |
| `--drive`       | `-d`  | Path to VM disk image                | None                    |
| `--disk-format` |       | Disk image format (qcow2, raw, etc.) | `raw`                   |

## 🔢 Version Format

Simply provide the version number (e.g., `6.4.2` or `6.2`), and the tool will
automatically construct the download URL for the corresponding RELEASE ISO.

Examples:

- `6.4.2` → downloads `dfly-x86_64-6.4.2_REL.iso`
- `6.2` → downloads `dfly-x86_64-6.2_REL.iso`
- `7.0` → downloads `dfly-x86_64-7.0_REL.iso`

## 💿 Creating a Persistent Disk

To install DragonflyBSD persistently:

```bash
# Create a disk image
qemu-img create -f qcow2 dragonfly.qcow2 20G

# Launch with the disk attached
dflybsd-up 6.4.2 --drive dragonfly.qcow2 --disk-format qcow2
```

## 🔐 SSH Access

The VM automatically forwards host port 2222 to guest port 22. After configuring
SSH in your DragonflyBSD installation:

```bash
ssh -p 2222 user@localhost
```

## 📄 License

See [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

> [!NOTE]
>
> This tool is designed for development and testing purposes. For production
> DragonflyBSD deployments, consider using proper installation methods.
