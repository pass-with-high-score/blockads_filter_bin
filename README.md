# BlockAds Filter List Compiler

A high-performance Golang CLI tool to download raw ad-blocking filter lists and compile them into memory-mapped-friendly binary formats (`.trie` and `.bloom`).

These output files are designed specifically to be consumed by the **BlockAds Android Go engine**, utilizing custom big-endian binary serialization and FNV double-hashing to match the Android implementation exactly.

## Features

- **Blazing Fast Concurrent Downloads**: Fetches and processes multiple large filter lists simultaneously.
- **Memory Efficient**: Streams HTTP responses line-by-line (`bufio.Scanner`) instead of buffering gigabytes of RAM.
- **Smart Domain Parsing**: Automatically handles standard Domains, Hosts files (`0.0.0.0 domain.com`), and AdBlock Plus formats (`||domain.com^`).
- **Binary Format Compliance**: Generates zero-allocation mmap-ready `.trie` and `.bloom` files matching the exact specification documented in `bloom_trie_build_doc.md`.

## Prerequisites

- [Go](https://go.dev/doc/install) 1.22+ installed locally.

## Build Instructions

To build the executable, run:

```bash
CGO_ENABLED=0 go build -o blockads-filtering .
```

*(Note: `CGO_ENABLED=0` is recommended, particularly on macOS, to prevent known `dyld: missing LC_UUID` crashes when building binaries locally.)*

## Usage

By default, running the application reads the `config.json` file in the current directory and outputs the binary compiled lists to an `output/` folder.

```bash
./blockads-filtering
```

### Command Line Flags

The tool supports the following optional flags to customize execution:

- `-config <path>`: Path to a JSON configuration file (default: `config.json`).
- `-urls <path>`: Alternative path to a plain text file containing one URL per line. (Overrides `-config`. Example: `-urls filter.txt`).
- `-output <path>`: Directory where the `.trie` and `.bloom` output files will be saved (default: `output`).
- `-concurrency <int>`: Max number of concurrent lists to process at once (default: `4`).

**Example: Running with a custom plain text list**
```bash
./blockads-filtering -urls filter.txt -output builds/ -concurrency 8
```

## Configuration Format

If using the default JSON format (`config.json`), the file should contain a list of objects with a unique `name` suffix and the source `url`:

```json
[
  {
    "name": "abpvn",
    "url": "https://abpvn.com/android/abpvn.txt"
  },
  {
    "name": "hagezi_light",
    "url": "https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/adblock/light.txt"
  }
]
```

This configuration will generate `output/abpvn.trie`, `output/abpvn.bloom`, `output/hagezi_light.trie`, and `output/hagezi_light.bloom`.

## Output Details

For each list processed, the tool generates two files:

1. **`*.trie`**: Contains the full tree of blocked domains compressed into backward-lookup labels. Used for the absolute "Is Blocked?" resolution layer.
2. **`*.bloom`**: A 0.1% False Positive Rate (FPR) Bloom Filter acting as a pre-filter gating the Trie. Rejecting ~99.9% of clean queries in O(1) time before Trie traversing happens.
