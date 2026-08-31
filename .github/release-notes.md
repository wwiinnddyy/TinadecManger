# 未签名构建

本仓库的发布流水线**不做代码签名与公证**。Electrobun 1.16.0 只提供 Apple 侧的
签名能力（读取 `ELECTROBUN_DEVELOPER_ID` 与 `ELECTROBUN_APPLE*` 系列环境变量），
Windows 侧完全没有签名实现。拿到证书后，把 `electrobun.config.ts` 里的
`build.mac.codesign` / `build.mac.notarize` 打开，并在仓库 secrets 中配置对应变量；
Windows 需要另加一步 `signtool`。

因此首次打开各平台产物时，请预期以下系统提示：

- **macOS**：Gatekeeper 会提示"无法验证开发者"。可在访达中右键选择"打开"，
  或执行 `xattr -dr com.apple.quarantine /Applications/TinadecManger.app`。
- **Windows**：SmartScreen 会提示"未知发布者"。点"更多信息"→"仍要应用程序"。
  注意 `.exe` 图标由 Inno Setup 提供；Electrobun 自带的 `launcher.exe` /
  `Setup.exe` 图标嵌入在其发布产物中始终失败（内部硬编码了它自己构建机的路径），
  属于上游限制。
- **Linux AppImage**：先 `chmod +x`。若系统没有 FUSE（例如部分精简容器与
  新版发行版），用 `./TinadecManger-<version>-linux-x64.AppImage --appimage-extract-and-run` 运行。
  本项目使用系统 WebView 而非内嵌 CEF，因此需要发行版自带
  `libwebkit2gtk-4.1`（GTKWebKit）；Debian/Ubuntu 上为
  `sudo apt install libwebkit2gtk-4.1-0`。

Electrobun 自身产出的 `*-Setup.tar.gz`（内含一个真正单文件的自解压 `installer`）
与 `*-Setup.zip` 一并附在 Assets 中，作为 AppImage 之外的备选方案。
