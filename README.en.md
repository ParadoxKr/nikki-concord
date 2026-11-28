<div align="center">

# Nikki Concord

**Experimental OpenWrt port evaluating the Rust Concord core · Based on OpenWrt Nikki**

**[简体中文](README.md) · English**

[![Release](https://img.shields.io/github/v/release/user-7392/nikki-concord?include_prereleases&label=Release&color=blue)](https://github.com/user-7392/nikki-concord/releases/tag/v0.1.0-r32)
[![OpenWrt](https://img.shields.io/badge/OpenWrt-25.12%20%7C%2024.10%20%7C%2023.05-00B5E2)](#installation)
[![Arch](https://img.shields.io/badge/Arch-aarch64%20%7C%20x86__64-555555)](#installation)
[![License](https://img.shields.io/badge/License-GPL--3.0--or--later-green)](#upstream-projects-and-licenses)

[Disclaimer](#experimental-notice--disclaimer) · [Footprint](#flash-and-memory-usage) · [Installation](#installation) · [Notes](#notes) · [Build](#building-from-source) · [Licenses](#upstream-projects-and-licenses)

</div>

---

## Experimental Notice & Disclaimer

> [!IMPORTANT]
> - **Experimental purpose & no long-term maintenance**: This repository is a personal, experimental project created to **evaluate the real-world runtime behavior and flash/memory footprint of the Rust-based Concord core on resource-constrained OpenWrt routers**. It is **not** a long-term maintained project, carries no guarantee of future updates, bug fixes, or support, and may be discontinued or archived at any time. Interested users are encouraged to fork and build from source, or wait for potential official integration in upstream [OpenWrt Nikki](https://github.com/nikkinikki-org/OpenWrt-nikki).
> - **Intended use & compliance**: This repository only contains open-source integration, build, and packaging scripts. It **does not** include, provide, host, or endorse any proxy nodes, subscriptions, or third-party network services. All code and prebuilt artifacts are provided **"AS IS"** without warranty of any kind, strictly for lawful technical learning, benchmarking, and research. Users assume all risks and responsibility for complying with applicable local laws and regulations.
> - **No affiliation**: This project is independent and not affiliated with or endorsed by OpenWrt, OpenWrt Nikki, Concord, or Zashboard. All upstream copyrights and licenses remain with their respective authors.

This package ports [OpenWrt Nikki](https://github.com/nikkinikki-org/OpenWrt-nikki)'s service scripts and LuCI UI into a separate namespace (**Services → Nikki Concord**, isolated UCI config and nftables table) bundled with the [Concord](https://github.com/Vialibrex/concord) core and [Zashboard](https://github.com/Zephyruso/zashboard) for side-by-side evaluation.

---

## Flash and memory usage

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/benchmark-en-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="assets/benchmark-en-light.svg" />
  <img alt="Nikki Concord flash and memory footprint comparison" src="assets/benchmark-en-light.svg" width="100%" />
</picture>

**Daily observation on Linksys E8450**: Nikki Concord r27 used roughly **28–34 MiB RSS**; the chart's idle and peak figures come from an isolated ~50-second load test on OpenWrt 25.12.6.

<details>
<summary>View detailed numbers and benchmark conditions</summary>

| Metric | Original Nikki 1.26.2 + Mihomo v1.19.34 | Nikki Concord (r27) | Difference |
| :--- | ---: | ---: | ---: |
| **Flash** (uncompressed installed files) | **54.82 MiB** | **29.51 MiB** | **-25.31 MiB (-46.2%)** |
| **Memory** (combined service RSS) | Idle **46.58 MiB** · Peak **79.49 MiB** | Idle **16.23 MiB** · Peak **18.58 MiB** | Idle **-30.35 MiB** · Peak **-60.91 MiB** |

- **Setup**: Isolated network, 48 local SOCKS5 test nodes, 8 rule sets (120,290 rules), DNS Fake-IP + persistence + TUN enabled; ~20 new HTTPS requests/s (up to 32 concurrent, ~50 s, 1,000 requests with 0 failures at ~2.54 MiB/s). After 30 s idle: 79.50 MiB vs 18.55 MiB.

</details>

---

## Installation

- **Supported firmware**: **OpenWrt 25.12.x** (`.apk`), and **OpenWrt / ImmortalWrt 23.05 / 24.10** with `opkg` + `firewall4` (`.ipk`; feeds must provide Go `yq` and `rpcd-mod-ucode`; `iptables / fw3` is unsupported).
- **Testing note**: Only `.apk` has been tested on physical OpenWrt 25.12 hardware; `.ipk` packages were checked for structure and scripts only. Back up your config before installing.

Check architecture: `cat /etc/apk/arch` (25.12+) or `opkg print-architecture` (23.05 / 24.10).

Download from the [**v0.1.0-r32 release**](https://github.com/user-7392/nikki-concord/releases/tag/v0.1.0-r32) (checksums in `SHA256SUMS-r32-all`):

| Architecture | OpenWrt 25.12+ (`.apk`) | OpenWrt / ImmortalWrt 23.05 and 24.10 (`.ipk`) |
| :--- | :--- | :--- |
| `aarch64_cortex-a53` | `luci-app-nikki-concord-0.1.0-r32.apk` | `luci-app-nikki-concord-0.1.0-r32_aarch64_cortex-a53.ipk` |
| `aarch64_cortex-a72` | `luci-app-nikki-concord-0.1.0-r32_aarch64_cortex-a72.apk` | `luci-app-nikki-concord-0.1.0-r32_aarch64_cortex-a72.ipk` |
| `aarch64_generic` | `luci-app-nikki-concord-0.1.0-r32_aarch64_generic.apk` | `luci-app-nikki-concord-0.1.0-r32_aarch64_generic.ipk` |
| `x86_64` | `luci-app-nikki-concord-0.1.0-r32_x86_64.apk` | `luci-app-nikki-concord-0.1.0-r32_x86_64.ipk` |

> [!NOTE]
> For experimental `uselightgbm: true` inference in `smart` groups, see the separate branch release [**v0.1.0-r32-lgbm**](https://github.com/user-7392/nikki-concord/releases/tag/v0.1.0-r32-lgbm) (the main build already supports heuristic `smart` groups).

Upload to your router and install (disabled by default; enable under **Services → Nikki Concord** after stopping other transparent proxies):

```sh
# OpenWrt 25.12+ (apk)
apk add --allow-untrusted ./package.apk

# OpenWrt / ImmortalWrt 23.05 and 24.10 (opkg)
opkg update && opkg install ./package.ipk
```

---

## Notes

Full protocol and field list: [Concord compatibility](https://github.com/Vialibrex/concord/blob/faaadad9c93d1967d44a65732bfcb02b7a93aefc/docs/compatibility.md).

- **TUN**: Configure via top-level `tun:` (`type: tun` in `listeners` is not opened); `mips`, `mixed`, `system`, and `gvisor` all map to Concord's userspace stack.
- **Rule sets & GeoIP**: Place local providers under `/etc/nikkic/run/core/` with relative paths; `SAFE_PATHS`, custom `GeoIP.dat`, and `BundleMRS.7z` are unsupported.
- **DNS**: `dns.fallback-filter` defaults to `geoip: false`; `dhcp://<interface>` is handled as `system://`—use explicit upstreams if dnsmasq forwards to Concord.
- **Dashboard & Fast Reload**: Non-loopback controllers require an API secret; with Fast Reload enabled, click **Restart Service** after changing controller address, secret, TLS, or dashboard URL.

---

## Building from source

Requires `git`, `python3`, `node`, `gzip`, `unzip`, `po2lmo` from the OpenWrt LuCI SDK, Concord's pinned Rust toolchain, `zig`, and `cargo-zigbuild`.

<details>
<summary>Cross-build and packaging commands</summary>

```sh
mkdir -p build/dashboard release
git clone https://github.com/Vialibrex/concord.git build/concord-src
git -C build/concord-src checkout --detach "$(cat core/upstream-revision)"
git -C build/concord-src apply "$PWD/core/concord.patch"
git -C build/concord-src apply "$PWD/core/concord-openwrt-controller.patch"

cpu=aarch64
arch=aarch64_cortex-a53
target="$cpu-unknown-linux-musl"

mkdir -p build/zig-bin
printf '#!/bin/sh\nexec zig ar "$@"\n' > build/zig-bin/ar
printf '#!/bin/sh\nexec zig ranlib "$@"\n' > build/zig-bin/ranlib
chmod +x build/zig-bin/ar build/zig-bin/ranlib

(cd build/concord-src && PATH="$PWD/../zig-bin:$PATH" \
  JEMALLOC_SYS_WITH_LG_PAGE=12 \
  JEMALLOC_SYS_WITH_MALLOC_CONF="background_thread:false,dirty_decay_ms:0,muzzy_decay_ms:0,narenas:1,tcache:false" \
  cargo zigbuild --locked --release --target "$target" -p concord-desktop)

gzip -n -9 -c "build/concord-src/target/$target/release/concord" > "build/concord-$cpu.gz"
unzip -q assets/zashboard-v3.30.0.zip -d build/zashboard-extract
cp -R build/zashboard-extract/dist/. build/dashboard/

python3 build-root.py --direct-core --cpu "$cpu" --core "build/concord-$cpu.gz" "build/package-$cpu"
node check-luci.mjs "build/package-$cpu"

# Package for OpenWrt 25.12+ (.apk)
python3 pack.py "build/package-$cpu" "release/luci-app-nikki-concord-0.1.0-r32_$arch.apk"

# Package for OpenWrt / ImmortalWrt 23.05 & 24.10 (.ipk)
python3 pack.py "build/package-$cpu" "release/luci-app-nikki-concord-0.1.0-r32_$arch.ipk"
```

All three ARM64 architectures share the `cpu=aarch64` build; set both `cpu` and `arch` to `x86_64` for x86-64.

</details>

---

## Upstream projects and licenses

| Project | Role | Notes |
| :--- | :--- | :--- |
| [**OpenWrt Nikki**](https://github.com/nikkinikki-org/OpenWrt-nikki) | Service scripts and LuCI base | v1.26.2 source and license retained in this repo |
| [**Concord**](https://github.com/Vialibrex/concord) | Rust network core | Pinned revision and patches under `core/`; third-party licenses retained |
| [**Zashboard v3.30.0**](https://github.com/Zephyruso/zashboard/releases/tag/v3.30.0) | Bundled web dashboard | Original license and notices retained |
