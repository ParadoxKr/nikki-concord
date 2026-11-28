<div align="center">

# Nikki Concord

**Experimental OpenWrt port evaluating the Rust Concord core · Based on OpenWrt Nikki**

**[简体中文](README.md) · English**

</div>

---

## Experimental Notice & Disclaimer

> [!IMPORTANT]
> - **Experimental purpose & no long-term maintenance**: This repository is a personal, experimental project created to **evaluate the real-world runtime behavior and flash/memory footprint of the Rust-based Concord core on resource-constrained OpenWrt routers**. It is **not** a long-term maintained project, carries no guarantee of future updates, bug fixes, or support, and may be discontinued or archived at any time. Interested users are encouraged to fork and build from source, or wait for potential official integration in upstream [OpenWrt Nikki](https://github.com/nikkinikki-org/OpenWrt-nikki).
> - **Intended use & compliance**: This repository only contains open-source integration, build, and packaging scripts. It **does not** include, provide, host, or endorse any proxy nodes, subscriptions, or third-party network services. All code and prebuilt artifacts are provided **"AS IS"** without warranty of any kind, strictly for lawful technical learning, benchmarking, and research. Users assume all risks and responsibility for complying with applicable local laws and regulations.
> - **No affiliation**: This project is independent and not affiliated with or endorsed by OpenWrt, OpenWrt Nikki, Concord, or Zashboard. All upstream copyrights and licenses remain with their respective authors.

This package ports [OpenWrt Nikki](https://github.com/nikkinikki-org/OpenWrt-nikki)'s service scripts and LuCI UI into a separate namespace (**Services → Nikki Concord**, isolated UCI config and nftables table) bundled with the [Concord](https://github.com/Vialibrex/concord) core and [Zashboard](https://github.com/Zephyruso/zashboard) for side-by-side evaluation.

---

## What the experiment measures

This experiment explores how running the Rust-based Concord core affects resource usage and runtime behavior on OpenWrt routers with limited flash and RAM. On a Linksys E8450, it tracks unpacked file size and service memory use at idle, during a short concurrent workload, and after the load stops.

The comparison below records RSS, request completion, and throughput for both deployments under the same isolated workload. The figures reflect how each full deployment behaves under those conditions, including the effects of the core implementation and allocator settings. Long-term stability, CPU overhead, and maximum throughput are still untested in this comparison.

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

## Notes

Full protocol and field list: [Concord compatibility](https://github.com/Vialibrex/concord/blob/faaadad9c93d1967d44a65732bfcb02b7a93aefc/docs/compatibility.md).

- **Dashboard & Fast Reload**: Non-loopback controllers require an API secret; with Fast Reload enabled, click **Restart Service** after changing controller address, secret, TLS, or dashboard URL.

---

## Upstream projects and licenses

| Project | Role | Notes |
| :--- | :--- | :--- |
| [**OpenWrt Nikki**](https://github.com/nikkinikki-org/OpenWrt-nikki) | Service scripts and LuCI base | v1.26.2 source and license retained in this repo |
| [**Concord**](https://github.com/Vialibrex/concord) | Rust network core | Pinned revision and patches under `core/`; third-party licenses retained |
| [**Zashboard v3.30.0**](https://github.com/Zephyruso/zashboard/releases/tag/v3.30.0) | Bundled web dashboard | Original license and notices retained |
