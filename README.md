<div align="center">

# Nikki Concord

**OpenWrt 上 Rust Concord 内核的实验性移植与资源占用测试 · 基于 OpenWrt Nikki**

**简体中文 · [English](README.en.md)**

</div>

---

## 实验性质与免责声明

> [!IMPORTANT]
> - **实验目的与非长期维护**：本项目仅为个人实验性质的技术尝试，初衷是**研究和验证 Rust 编写的 Concord 内核在 OpenWrt 低内存路由器上的实际运行效果与闪存/内存占用表现**。本项目**不是长期维护项目**，不承诺持续更新、问题修复或技术支持，随时可能停止维护或归档。如有长期使用或定制需求，建议有兴趣的开发者基于源码自行 fork 构建，或关注并等待 [OpenWrt Nikki](https://github.com/nikkinikki-org/OpenWrt-nikki) 等上游官方项目的原生整合。
> - **用途与合规声明**：本仓库仅提供开源项目的适配、构建与打包脚本，**不包含、不提供、也不推荐任何节点、订阅或第三方网络服务**。所有代码与构建产物均按「原样」（AS IS）提供，不附带任何明示或暗示担保；仅限合法合规的技术学习、性能测试与研究用途，使用者须自行评估风险并严格遵守所在地法律法规，相关后果由使用者自行承担。
> - **独立性说明**：本项目与 OpenWrt、OpenWrt Nikki、Concord、Zashboard 等上游项目无官方从属或背书关系，各上游代码的版权与开源许可均归原作者所有。

本包将 [OpenWrt Nikki](https://github.com/nikkinikki-org/OpenWrt-nikki) 的服务脚本和 LuCI 界面移植到独立命名空间（**服务 → Nikki Concord**，独立配置与 nftables 表），并集成 [Concord](https://github.com/Vialibrex/concord) 内核与 [Zashboard](https://github.com/Zephyruso/zashboard) 面板，用于隔离对比测试。

---

## 实验关注点

这个实验想了解，在闪存和内存有限的 OpenWrt 路由器上，运行 Rust 编写的 Concord 核心会怎样影响整套服务的资源占用和运行表现。以 Linksys E8450 为例，观察解包后的文件大小，以及服务在空载、短时并发和停压后的内存占用。

下方对比采用相同的隔离负载，记录两套部署的 RSS、请求完成情况和吞吐。结果反映这两套部署在该条件下的表现，包含核心实现和内存分配器设置的影响。本次对比未覆盖长期稳定性、CPU 开销和极限吞吐。

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

## 注意事项

完整协议与字段差异见 [Concord 上游兼容性说明](https://github.com/Vialibrex/concord/blob/faaadad9c93d1967d44a65732bfcb02b7a93aefc/docs/compatibility.md)。

- **面板与快速重载**：对外监听控制器须配置 API 密钥；开启快速重载时，变更控制器地址、密钥、TLS 或面板链接后需点击「重启服务」。

---

## 上游项目与许可

| 项目 | 作用 | 说明 |
| :--- | :--- | :--- |
| [**OpenWrt Nikki**](https://github.com/nikkinikki-org/OpenWrt-nikki) | 服务脚本与 LuCI 基础实现 | 仓库保留用于构建的 v1.26.2 源码与对应许可 |
| [**Concord**](https://github.com/Vialibrex/concord) | Rust 网络内核 | 固定上游提交与本项目补丁位于 `core/`，第三方许可随源码保留 |
| [**Zashboard v3.30.0**](https://github.com/Zephyruso/zashboard/releases/tag/v3.30.0) | 内置网页面板 | 仓库保留原有许可与第三方声明 |
