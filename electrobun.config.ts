export default {
  app: {
    name: "TinadecManger",
    identifier: "com.tinadec.manager",
    version: "0.1.0",
  },
  build: {
    // Vite emits the renderer bundle into dist/ before Electrobun packages it.
    copy: {
      "dist/index.html": "views/mainview/index.html",
      "dist/assets": "views/mainview/assets",
    },
    watchIgnore: ["dist/**"],
    mac: {
      bundleCEF: false,
      codesign: false,
      notarize: false,
    },
    linux: {
      bundleCEF: false,
    },
    win: {
      bundleCEF: false,
    },
  },
};
