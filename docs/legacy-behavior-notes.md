# Legacy .NET 行为笔记（迁移基线）

> 删除 `TinadecManger.Core` / `TinadecManger.App`（.NET 10 + MewUI）前提取的行为约定。
> 新的 Electrobun 主进程实现必须保持这些对外行为与数据兼容。

## 存储（%APPDATA%/TinadecManger/）

- `registry.json`：`{ version: 1, components: InstalledComponent[] }`，camelCase、缩进 JSON。
  - `InstalledComponent`: `{ id, path, executable?, endpointOverride?, registeredAtUtc, lastKnownVersion? }`。
  - 写入原子（`.tmp` + move）；损坏时移为 `.bak` 并回退默认。
- `settings.json`：`{ installRoot, coreUrl, gatewayUrl, theme, dashboardAutoRefresh, dashboardRefreshIntervalSeconds, minimizeToTray }`，同样的原子写与 `.bak` 策略。
- 默认地址：Core `http://127.0.0.1:48731`，Gateway `http://127.0.0.1:48730`。
- 迁移要求：保留旧 id、path、executable、endpointOverride、lastKnownVersion；新记录增加 productId/source/ownership 等字段，legacy 记录标记 `legacy-unmanaged`。

## 内置目录（BuiltInCatalog）

| id | 名称 | 家族 | 交付 | 探测 | 探测目标 | 期望产物 | 备注 |
|---|---|---|---|---|---|---|---|
| tinadec-core | TinadecCore | core | dotnet-publish-dir | http-health | http://127.0.0.1:48731/api/v1/health | TinadecCore.Api.exe | 状态权威 |
| tinadec-gateway | TinadecGateway | gateway | bun-script | http-health | http://127.0.0.1:48730/api/v1/health | src/index.ts | BFF 门面 |
| tinadec-tools | TinadecTools | tools | native-exe | process-name | `TinadecTools` | TinadecTools.exe | 不支持独立启动（Core 托管） |
| tinadec-office-desktop | TinadecOffice Desktop | app | portable-exe | process-name | `TinadecOffice` | TinadecOffice-*-portable.exe | 允许多实例 |
| tinadec-code | TinadecCode | app | yui-app | file-only | — | — | 不支持独立启动，多实例 |

## 注册（Register）

- 路径 trim 并去除两侧引号；校验：
  - `bun-script`：`<path>/src/index.ts` 必须存在。
  - 其他：`ArtifactExists(path, expectedArtifact)` —— 支持通配符（顶层目录匹配）、目录或文件本身。
- 单实例组件 id 固定为产品 id，重复注册报“已注册，请先注销旧记录”；多实例组件 id 为 `{productId}:{8位guid}`。
- 注销只删登记，不删磁盘文件。

## 探测（Probe，超时 2s）

- HTTP：endpointOverride 优先；503 → Stopped；连接失败 → Stopped；超时 → Unhealthy；
  非 2xx → Running（上游可能不可达）；2xx → 解析 body JSON 的 `version`，含 `"ok"` 或有 version → Running，否则 Unhealthy。
- Process：按进程名枚举 + 磁盘产物判断 Running / Stopped（已装未跑）/ NotInstalled（无文件）。
- FileOnly：登记路径存在 → Stopped（已装），否则 NotInstalled。
- 探测到 version 时回写 `lastKnownVersion`（best-effort，失败不影响探测）。

## 启停（Launcher）

- `supportsStandaloneLaunch=false` 直接拒绝启动。
- exe 类：解析顺序 = 显式 executable（相对 path 解析）→ path 本身是文件 → 目录下首个非 `TinadecManger*` 的 `.exe` → 目录下无扩展名且不以 `lib` 开头的 apphost；工作目录 = 安装目录。
- bun-script：`bun run <path>/src/index.ts`，工作目录 = 安装目录。
- stdout/stderr 重定向进组件日志（debug/warning 级），进程退出写 ExitCode。
- Stop：本会话启动的进程按记录 kill 整棵进程树；外部进程按进程名匹配，主模块路径以安装目录为前缀校验（无法读取模块时放行按名停止）。

## 品牌与 UI（已迁移到 assets/）

- `assets/tinadec-logo.png`、`assets/logo-white.png`、`assets/tinadec-large.ico` 为品牌资源；`assets/icons/*.svg` 为旧页面图标（新 UI 用 lucide）。
- 旧 UI 为深色优先、中文文案；健康色语义：running=绿、stopped=灰、unhealthy/not-installed=黄/红。
