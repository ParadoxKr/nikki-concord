<div align="center">

# Nikki Concord

**OpenWrt 上 Rust Concord 内核的实验性移植与资源占用测试 · 基于 OpenWrt Nikki**

**简体中文 · [English](README.en.md)**

[![Release](https://img.shields.io/github/v/release/user-7392/nikki-concord?include_prereleases&label=Release&color=blue)](https://github.com/user-7392/nikki-concord/releases/tag/v0.1.0-r32)
[![OpenWrt](https://img.shields.io/badge/OpenWrt-25.12%20%7C%2024.10%20%7C%2023.05-00B5E2)](#下载安装)
[![Arch](https://img.shields.io/badge/Arch-aarch64%20%7C%20x86__64-555555)](#下载安装)
[![License](https://img.shields.io/badge/License-GPL--3.0--or--later-green)](#上游项目与许可)

[实验声明与免责](#实验性质与免责声明) · [闪存与内存对比](#闪存与内存对比) · [下载安装](#下载安装) · [注意事项](#注意事项) · [从源码构建](#从源码构建) · [上游项目与许可](#上游项目与许可)

</div>

---

## 实验性质与免责声明

> [!IMPORTANT]
> - **实验目的与非长期维护**：本项目仅为个人实验性质的技术尝试，初衷是**研究和验证 Rust 编写的 Concord 内核在 OpenWrt 低内存路由器上的实际运行效果与闪存/内存占用表现**。本项目**不是长期维护项目**，不承诺持续更新、问题修复或技术支持，随时可能停止维护或归档。如有长期使用或定制需求，建议有兴趣的开发者基于源码自行 fork 构建，或关注并等待 [OpenWrt Nikki](https://github.com/nikkinikki-org/OpenWrt-nikki) 等上游官方项目的原生整合。
> - **用途与合规声明**：本仓库仅提供开源项目的适配、构建与打包脚本，**不包含、不提供、也不推荐任何节点、订阅或第三方网络服务**。所有代码与构建产物均按「原样」（AS IS）提供，不附带任何明示或暗示担保；仅限合法合规的技术学习、性能测试与研究用途，使用者须自行评估风险并严格遵守所在地法律法规，相关后果由使用者自行承担。
> - **独立性说明**：本项目与 OpenWrt、OpenWrt Nikki、Concord、Zashboard 等上游项目无官方从属或背书关系，各上游代码的版权与开源许可均归原作者所有。

本包将 [OpenWrt Nikki](https://github.com/nikkinikki-org/OpenWrt-nikki) 的服务脚本和 LuCI 界面移植到独立命名空间（**服务 → Nikki Concord**，独立配置与 nftables 表），并集成 [Concord](https://github.com/Vialibrex/concord) 内核与 [Zashboard](https://github.com/Zephyruso/zashboard) 面板，用于隔离对比测试。

---

## 闪存与内存对比

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/benchmark-zh-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="assets/benchmark-zh-light.svg" />
  <img alt="Nikki Concord 闪存与内存占用对比" src="assets/benchmark-zh-light.svg" width="100%" />
</picture>

**E8450 日常观察**：Nikki Concord r27 约 **28–34 MiB RSS**；上图空载与峰值数据来自 Linksys E8450（OpenWrt 25.12.6）约 50 秒的隔离网络压测。

<details>
<summary>查看详细对比数据与测试条件</summary>

| 对比项 | 原版 Nikki 1.26.2 + Mihomo v1.19.34 | Nikki Concord (r27) | 差异 |
| :--- | ---: | ---: | ---: |
| **闪存占用**（解压后文件合计） | **54.82 MiB** | **29.51 MiB** | **-25.31 MiB（-46.2%）** |
| **内存占用**（服务进程 RSS 合计） | 空载 **46.58 MiB** · 峰值 **79.49 MiB** | 空载 **16.23 MiB** · 峰值 **18.58 MiB** | 空载 **-30.35 MiB** · 峰值 **-60.91 MiB** |

- **测试条件**：隔离网络、48 个本地 SOCKS5 测试节点与 8 个规则集（120,290 条规则），开启 DNS Fake-IP、Fake-IP 持久化与 TUN；每秒约 20 个新建 HTTPS 请求（最高 32 并发，持续约 50 秒，共 1,000 请求均零失败，吞吐约 2.54 MiB/s）。停压 30 秒后原版为 79.50 MiB，Concord 为 18.55 MiB。

</details>

---

## 下载安装

- **适用固件**：**OpenWrt 25.12.x**（`.apk`），以及使用 `opkg` + `firewall4 (nftables)` 的 **OpenWrt / ImmortalWrt 23.05 / 24.10**（`.ipk`，需软件源含 Go 版 `yq` 和 `rpcd-mod-ucode`，不支持 `iptables / fw3`）。
- **测试说明**：仅在 OpenWrt 25.12 实机测过 `.apk`；`.ipk` 仅通过结构与脚本校验，安装前请先备份配置。

查看固件架构：`cat /etc/apk/arch`（25.12+）或 `opkg print-architecture`（23.05 / 24.10）。

前往 [**v0.1.0-r32 发布页**](https://github.com/user-7392/nikki-concord/releases/tag/v0.1.0-r32) 下载对应安装包（校验值见 `SHA256SUMS-r32-all`）：

| 架构 | OpenWrt 25.12+（`.apk`） | OpenWrt / ImmortalWrt 23.05 & 24.10（`.ipk`） |
| :--- | :--- | :--- |
| `aarch64_cortex-a53` | `luci-app-nikki-concord-0.1.0-r32.apk` | `luci-app-nikki-concord-0.1.0-r32_aarch64_cortex-a53.ipk` |
| `aarch64_cortex-a72` | `luci-app-nikki-concord-0.1.0-r32_aarch64_cortex-a72.apk` | `luci-app-nikki-concord-0.1.0-r32_aarch64_cortex-a72.ipk` |
| `aarch64_generic` | `luci-app-nikki-concord-0.1.0-r32_aarch64_generic.apk` | `luci-app-nikki-concord-0.1.0-r32_aarch64_generic.ipk` |
| `x86_64` | `luci-app-nikki-concord-0.1.0-r32_x86_64.apk` | `luci-app-nikki-concord-0.1.0-r32_x86_64.ipk` |

> [!NOTE]
> 如需测试 `smart` 策略组的 `uselightgbm: true` 推理支持，可前往独立实验分支发布页 [**v0.1.0-r32-lgbm**](https://github.com/user-7392/nikki-concord/releases/tag/v0.1.0-r32-lgbm)（主包已原生支持启发式 `smart`）。

上传到路由器后安装（首次安装默认关闭，可在 **服务 → Nikki Concord** 启用，启用透明代理前请先停止其他代理服务）：

```sh
# OpenWrt 25.12+ (apk)
apk add --allow-untrusted ./文件名.apk

# OpenWrt / ImmortalWrt 23.05 & 24.10 (opkg)
opkg update && opkg install ./文件名.ipk
```

---

## 注意事项

完整协议与字段差异见 [Concord 上游兼容性说明](https://github.com/Vialibrex/concord/blob/faaadad9c93d1967d44a65732bfcb02b7a93aefc/docs/compatibility.md)：

- **TUN**：须通过顶层 `tun:` 启用（`listeners` 中的 `type: tun` 不会启用）；`mips`、`mixed`、`system`、`gvisor` 均对应同一个 Concord 用户态栈。
- **规则与 GeoIP**：本地规则集/代理集须放在 `/etc/nikkic/run/core/` 下使用相对路径；不支持 `SAFE_PATHS`、自定义 `GeoIP.dat` 与 `BundleMRS.7z`。
- **DNS**：`dns.fallback-filter` 默认 `geoip: false`；`dhcp://<接口>` 按 `system://` 处理，避免与 dnsmasq 形成解析环路。
- **面板与快速重载**：对外监听控制器须配置 API 密钥；开启快速重载时，变更控制器地址、密钥、TLS 或面板链接后需点击「重启服务」。

---

## 从源码构建

需准备 `git`、`python3`、`node`、`gzip`、`unzip`、OpenWrt LuCI SDK 的 `po2lmo`、Concord 固定的 Rust 工具链，以及 `zig` 与 `cargo-zigbuild`。

<details>
<summary>展开完整交叉编译与打包命令</summary>

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

# 打包 OpenWrt 25.12+ (.apk)
python3 pack.py "build/package-$cpu" "release/luci-app-nikki-concord-0.1.0-r32_$arch.apk"

# 打包 OpenWrt / ImmortalWrt 23.05 & 24.10 (.ipk)
python3 pack.py "build/package-$cpu" "release/luci-app-nikki-concord-0.1.0-r32_$arch.ipk"
```

ARM64 三种架构共用 `cpu=aarch64` 的编译产物，打包时替换 `arch` 即可；构建 `x86_64` 时将 `cpu` 与 `arch` 均设为 `x86_64`。

</details>

---

## 上游项目与许可

| 项目 | 作用 | 说明 |
| :--- | :--- | :--- |
| [**OpenWrt Nikki**](https://github.com/nikkinikki-org/OpenWrt-nikki) | 服务脚本与 LuCI 基础实现 | 仓库保留用于构建的 v1.26.2 源码与对应许可 |
| [**Concord**](https://github.com/Vialibrex/concord) | Rust 网络内核 | 固定上游提交与本项目补丁位于 `core/`，第三方许可随源码保留 |
| [**Zashboard v3.30.0**](https://github.com/Zephyruso/zashboard/releases/tag/v3.30.0) | 内置网页面板 | 仓库保留原有许可与第三方声明 |
