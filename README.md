# TinadecManger

Tinadec 生态链管理器 —— 安装、管理与监控 Tinadec 生态组件的跨平台桌面工具。

基于 [.NET 10](https://dotnet.microsoft.com/) 与 [MewUI](https://github.com/aprillz/MewUI)
（code-first C# markup，无 XAML，NativeAOT 友好），目标平台为
Windows / Linux / macOS。

## Tinadec 生态

Tinadec 是前后端分离、组件互相独立的生态：

| 组件 | 职责 | 交付形态 |
|------|------|----------|
| **TinadecCore** | 智能体编排与治理服务（端口 48731） | `dotnet publish` 可执行目录 |
| **TinadecTools** | 审批感知工具宿主（Core 子进程） | NativeAOT 可执行文件 |
| **TinadecGateway** | 无状态 BFF/代理（端口 48730） | Bun + Elysia 应用 |
| **TinadecApps** | 客户端（Electron 的 TinadecOfficeDesktop、yui 形态的 TinadecCode 等） | 各自安装包 |

## 功能

- **仪表盘**：并发探测各组件健康状态（`/api/v1/health`、进程、文件），显示版本与运行状态
- **组件**：注册本地已安装的组件、启动/停止、注销登记
- **设置**：安装根目录、服务端点、外观主题

> 在线安装/更新/市场分发不在当前范围内（产品定义文档明确延期）。

## 结构

```
src/
├── TinadecManger.Core/   # 逻辑核：组件目录、安装注册表、探测、进程生命周期（无 UI 依赖）
└── TinadecManger.App/    # MewUI 前端：品牌壳 + 仪表盘/组件/设置三页
```

## 开发

```bash
dotnet build TinadecManger.slnx
dotnet run --project src/TinadecManger.App
```

## 发布

```bash
dotnet publish src/TinadecManger.App -c Release -p:PublishProfile=win-x64
```

发布配置见 `src/TinadecManger.App/Properties/PublishProfiles/`
（win-x64 / linux-x64 / osx-x64，NativeAOT 优先，失败回退单文件自包含）。

## 许可

`AGPL-3.0-or-later`，见 [LICENSE](LICENSE)。
品牌素材来源见 [assets/ATTRIBUTION.md](assets/ATTRIBUTION.md)。
