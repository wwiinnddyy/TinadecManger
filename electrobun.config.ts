import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "TinadecManger",
    identifier: "com.tinadec.manager",
    version: "0.1.0",
    // Consumed by the .desktop entry the CLI writes into the Linux bundle.
    // build-appimage.sh replaces that entry for the AppImage.
    description: "Tinadec 生态桌面软件管理器",
  },
  build: {
    // The CLI defaults this to src/bun/index.ts and throws when that file is absent.
    bun: { entrypoint: "src/main/index.ts" },
    // Vite emits the renderer bundle into dist/ before Electrobun packages it.
    copy: {
      "dist/index.html": "views/mainview/index.html",
      "dist/assets": "views/mainview/assets",
      // A publicDir asset lands in dist/ root, so it needs its own entry.
      "dist/favicon.svg": "views/mainview/favicon.svg",
    },
    mac: {
      bundleCEF: false,
      codesign: false,
      notarize: false,
      icons: "icon.iconset",
    },
    linux: {
      bundleCEF: false,
      // Also the switch that makes the CLI emit a .desktop file, which AppImage needs.
      icon: "assets/logo-white.png",
    },
    win: {
      bundleCEF: false,
      icon: "assets/tinadec-large.ico",
    },
  },
  release: { baseUrl: "", generatePatch: false },
} satisfies ElectrobunConfig;
