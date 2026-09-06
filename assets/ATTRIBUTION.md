# 品牌素材来源

## 素材登记

本目录与 `src/renderer/` 内的品牌素材复制自
[TinadecOffice](https://github.com/) 仓库（提交时点：2026-08 首次复制，2026-09-01 扩充）：

| 本仓库文件 | Office 源文件 | 用途 |
|------------|---------------|------|
| `tinadec-large.ico` | `apps/desktop/public/tinadec-large.ico` | 应用可执行文件图标 |
| `logo-white.png` | `apps/desktop/public/Logo - 白.png`（重命名，避免空格文件名） | Linux 图标与 CI mac iconset 输入 |
| `tinadec-logo.png` | `apps/desktop/public/tinadec-logo.png` | 无引用，仅为素材保留 |
| `src/renderer/public/favicon.svg` | `apps/desktop/public/favicon.svg`（逐字节一致） | 渲染层站点图标 |
| `src/renderer/components/brand.tsx` | `apps/desktop/src/components/BrandLogo.vue` 与 `TinadecCalligraphy.vue` | 侧边栏图形标与书法文字标；两条 `<path d>` 逐字节一致，仅由 Vue 模板改写为 JSX |

Office 侧被视作可分发品牌资产的文件集合见其 `scripts/sync-tinadec-ui.mjs`。
`assets/icons/*.svg` 是旧页面图标，当前 UI 使用 lucide，无人引用。

## 字体

`@fontsource-variable/geist@5.3.0` 提供 `Geist Variable` 可变字体（woff2 子集 ×5，
`src/renderer/styles.css` 的 body 字体族首位）。字体本身不入库，由该 npm 包在构建时
产出到 `dist/assets/`。

- 许可：SIL Open Font License 1.1，全文见 `node_modules/@fontsource-variable/geist/LICENSE`。
- 上游版权声明：`Copyright 2024 The Geist Project Authors`（<https://github.com/vercel/geist-font>）。
- 本仓库仅嵌入与引用，未修改任何字形。OFL 允许在再分发作品中嵌入该字体。

Geist 不含 CJK 字形，因此 body 字体族在其后保留 `Microsoft YaHei UI` / `Microsoft YaHei`
回退，中文实际仍由系统字体渲染。

## 许可

`apps/desktop` 目录下的代码与多数素材随 TinadecOffice 适用 `GPL-3.0-or-later`；
TinadecOffice 根目录适用 `GPL-3.0-or-later`，TinadecCore 适用 `MIT`。
本仓库（TinadecManger）适用 `AGPL-3.0-or-later`，与上述条款兼容。

**一项例外必须单独记录**：TinadecOffice 根 `NOTICE` 第 3 节把
`apps/desktop/public/Logo - 白.png`（即本仓库的 `logo-white.png`）标注为
`Copyright (c) 2026 Lincube, all rights reserved`，并注明「不受 GPL/AGPL/MIT 覆盖，
使用需获授权」。该文件当前用于 `electrobun.config.ts` 的 Linux 图标与
`.github/workflows/release.yml` 的 mac iconset 生成输入。

两个仓库的版权人同为 Lincube（TinadecOffice 根 `LICENSE` 为 `Copyright (c) 2026 Lincube`，
本仓库提交者为 `lincube`），因此本仓库内对该素材的使用由版权方自身许可，不走
GPL/AGPL 兼容性判定。该保留权利条款约束的是仓库之外的接收方：任何衍生项目要复用
`logo-white.png`，仍需单独取得 Lincube 许可。本仓库其余品牌素材
（`tinadec-logo.png`、`tinadec-large.ico`、`favicon.svg`、两条 SVG path）未被该例外条目列出。
