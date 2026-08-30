/**
 * Electrobun main process entry. The only place that touches Electrobun APIs:
 * creates the window + tray, wires the ManagerContext onto the RPC schema,
 * and installs global error boundaries for main/renderer/rpc failures.
 */

import { BrowserWindow, Tray, Utils, defineElectrobunRPC } from "electrobun";
import type { ElectrobunRPCHandle } from "electrobun";
import type {
  AppSettings,
  OperationRecord,
  OperationRequest,
} from "../shared/domain";
import { ManagerError } from "../shared/errors";
import type { ManagerApiSchema } from "../shared/rpc";
import { ManagerContext } from "./context";
import { buildPaths } from "./paths";
import { ConfiguredCatalogClient } from "./catalog/catalog-client";

const APP_VERSION = "0.1.0";

function logCrash(kind: string, error: unknown): void {
  console.error(`[main:${kind}]`, error);
}

type RpcResultOf<T> =
  | { ok: true; value: T }
  | { ok: false; error: ReturnType<typeof ManagerError.from> };

function toResult<T>(fn: () => Promise<T> | T): Promise<RpcResultOf<T>> {
  return Promise.resolve()
    .then(fn)
    .then(
      (value): RpcResultOf<T> => ({ ok: true, value }),
      (error): RpcResultOf<T> => ({ ok: false, error: ManagerError.from(error) }),
    );
}

// ---- rpc (declared before the context so event callbacks can reference it) ----

let rpc: ElectrobunRPCHandle | null = null;

// ---- context ----

const paths = buildPaths();
const context = new ManagerContext({
  paths,
  catalog: new ConfiguredCatalogClient(paths, { catalogUrl: null }),
  events: {
    onOperationUpdated: (id: string) => {
      const record = context.queue.get(id);
      if (record) rpc?.send("operation-updated", { operation: record });
    },
    onSnapshotChanged: (reason) => rpc?.send("snapshot-changed", { reason }),
    onHealthUpdated: () => rpc?.send("snapshot-changed", { reason: "health" }),
    onCatalogStatus: () => rpc?.send("snapshot-changed", { reason: "catalog" }),
  },
});
context.logs.subscribe((entry) => {
  rpc?.send("log-appended", { entry });
});

// ---- rpc schema implementation ----

const handlers = {
  getSnapshot: () => toResult(() => context.snapshot()),
  saveSettings: (settings: AppSettings) =>
    toResult(() => context.applySettings(settings)),
  refreshCatalog: (params: { force?: boolean }) =>
    toResult(() => context.catalog.refresh(params)),
  injectCatalogFixture: (params: { manifest?: unknown; clear?: boolean }) =>
    toResult(async () => {
      if ("clear" in params && params.clear) {
        return context.catalog.clearFixture();
      }
      return context.catalog.injectFixture(params.manifest as never);
    }),

  install: (params: OperationRequest) => toResult(() => context.install(params)),
  update: (params: OperationRequest) => toResult(() => context.update(params)),
  batchUpdate: (params: { installationIds: string[] }) =>
    toResult(() => context.batchUpdate(params.installationIds)),
  repair: (params: OperationRequest) => toResult(() => context.repair(params)),
  uninstall: (params: {
    installationId: string;
    confirmed?: boolean;
    deleteFiles?: boolean;
  }) => toResult(() => context.uninstall(params)),
  register: (params: {
    productId: string;
    path: string;
    endpointOverride?: string;
  }) => toResult(() => context.register(params)),
  unregister: (params: { installationId: string; confirmed: boolean }) =>
    toResult(() => context.unregister(params)),
  cancelOperation: (params: { operationId: string }) =>
    toResult((): OperationRecord => context.queue.cancel(params.operationId)),
  retryOperation: (params: { operationId: string }) =>
    toResult(() => context.retryOperation(params.operationId)),

  start: (params: { installationId: string }) =>
    toResult(() => context.start(params.installationId)),
  stop: (params: { installationId: string }) =>
    toResult(() => context.stop(params.installationId)),
  probe: (params: { installationId: string }) =>
    toResult(() => context.probeInstallation(params.installationId)),
  probeAll: () => toResult(() => context.probeAll()),

  chooseDirectory: (params: {
    kind: "directory" | "file";
    startingFolder?: string;
    fileTypes?: string;
  }) =>
    toResult(async () => {
      const result = await Utils.openFileDialog({
        canChooseDirectories: params.kind === "directory",
        canChooseFiles: params.kind === "file",
        startingFolder: params.startingFolder,
        fileTypes: params.fileTypes,
      });
      return result?.paths ?? [];
    }),
  openPath: (params: { path: string; mode: "directory" | "item" }) =>
    toResult(async () => {
      await Utils.openPath(params.path);
      return true as const;
    }),
  defaultInstallRoot: () => toResult(async () => buildPaths().installRoot),
  platform: () =>
    toResult(async () => ({
      platform:
        process.platform === "win32"
          ? ("windows" as const)
          : process.platform === "darwin"
            ? ("macos" as const)
            : ("linux" as const),
      architecture: process.arch === "arm64" ? ("arm64" as const) : ("x64" as const),
      appVersion: APP_VERSION,
    })),
  logs: (params: { installationId?: string; tail?: number }) =>
    toResult(async () =>
      context.logs.query({
        installationId: params.installationId,
        tail: params.tail,
      }),
    ),
};

rpc = defineElectrobunRPC("bun", {
  maxRequestTime: 60_000,
  handlers: {
    requests: handlers as unknown as Record<string, (params: never) => unknown>,
    messages: {},
  },
});
void (rpc satisfies import("electrobun").ElectrobunRPCHandle);
void ({} as ManagerApiSchema); // keep the contract import checked

// ---- window + tray ----

const isDev = process.argv.includes("--dev");
const rendererUrl = isDev ? "http://127.0.0.1:5173" : "views/mainview/index.html";

const win = new BrowserWindow({
  title: "Tinadec Manager",
  url: rendererUrl,
  width: 1280,
  height: 820,
  minWidth: 980,
  minHeight: 620,
  rpc,
});

try {
  new Tray({
    tooltip: "Tinadec Manager",
    onClick: () => {
      win.show();
    },
  });
} catch (error) {
  logCrash("tray", error);
}

// ---- error boundaries ----

process.on("uncaughtException", (error) => logCrash("uncaught", error));
process.on("unhandledRejection", (error) => logCrash("unhandled-rejection", error));

context
  .initialize()
  .then(() => context.probeAll())
  .catch((error) => logCrash("init", error));
