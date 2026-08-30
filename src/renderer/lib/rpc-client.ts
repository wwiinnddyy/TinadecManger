/**
 * Renderer-side RPC client.
 *
 * Inside Electrobun this wraps defineElectrobunRPC("webview", …) + Electroview.
 * Outside (plain `vite` dev in a browser), it falls back to a local mock main
 * process that serves fixture data so the UI is fully developable without the
 * native shell.
 */

import { Electroview } from "electrobun/view";
import type { ManagerSnapshot, OperationRecord } from "shared/domain";
import type { RpcResult } from "shared/errors";
import type {
  BunMessages,
  BunRequests,
  ManagerApiSchema,
} from "shared/rpc";

type RequestName = keyof BunRequests & string;
type MessageName = keyof BunMessages & string;
type MessageListener<K extends MessageName> = (
  payload: BunMessages[K],
) => void;

export interface ManagerRpc {
  request<K extends RequestName>(
    name: K,
    ...args: BunRequests[K]["params"] extends undefined ? [] : [BunRequests[K]["params"]]
  ): Promise<BunRequests[K]["response"]>;
  onMessage<K extends MessageName>(
    name: K,
    listener: MessageListener<K>,
  ): () => void;
  readonly mode: "electrobun" | "mock";
}

function createElectrobunRpc(): ManagerRpc {
  const rpc = Electroview.defineRPC({
    maxRequestTime: 60_000,
    handlers: {
      requests: {
        noop: () => undefined,
      },
      messages: {},
    },
  });
  void new Electroview({ rpc });
  void (0 as unknown as ManagerApiSchema); // keep contract import checked

  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const knownMessages: MessageName[] = [
    "operation-updated",
    "snapshot-changed",
    "health-updated",
    "catalog-status",
    "log-appended",
    "main-log",
  ];
  for (const name of knownMessages) {
    rpc.addMessageListener(name, (payload: unknown) => {
      const set = listeners.get(name);
      if (!set) return;
      for (const listener of set) listener(payload);
    });
  }

  return {
    mode: "electrobun",
    request(name, ...args) {
      // The main-side handler already resolves to RpcResult<T>.
      return rpc.request(name, args[0]) as never;
    },
    onMessage(name, listener) {
      let set = listeners.get(name);
      if (!set) {
        set = new Set();
        listeners.set(name, set);
      }
      set.add(listener as (payload: unknown) => void);
      return () => set!.delete(listener as (payload: unknown) => void);
    },
  };
}

// ---------------------------------------------------------------------------
// Mock main (browser-only dev). Provides fixture state + simulated operations.
// ---------------------------------------------------------------------------

type SnapshotListener = () => void;

function createMockRpc(): ManagerRpc {
  let snapshot: ManagerSnapshot = {
    appVersion: "0.1.0-dev",
    generatedAt: new Date().toISOString(),
    platform: "windows",
    architecture: "x64",
    settings: {
      installRoot: "C:\\Tinadec\\apps",
      coreUrl: "http://127.0.0.1:48731",
      gatewayUrl: "http://127.0.0.1:48730",
      catalogUrl: "",
      releaseChannel: "stable",
      autoCheckForUpdates: false,
      autoUpdate: false,
      operationConcurrency: 2,
      networkTimeoutSeconds: 30,
      theme: "dark",
      minimizeToTray: false,
      dashboardAutoRefresh: true,
      dashboardRefreshIntervalSeconds: 30,
    },
    catalog: {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      products: [
        {
          id: "tinadec-core",
          name: "TinadecCore",
          family: "core",
          description: "智能体编排与治理服务（mock）。",
          delivery: "dotnet-publish-dir",
          probe: "http-health",
          probeTarget: "http://127.0.0.1:48731/api/v1/health",
          expectedArtifact: "TinadecCore.Api.exe",
          allowMultipleInstances: false,
          supportsStandaloneLaunch: true,
          releases: [
            {
              id: "core-1.4.2",
              version: "1.4.2",
              channel: "stable",
              publishedAt: "2026-08-01T00:00:00.000Z",
              artifacts: [
                {
                  id: "core-1.4.2-win-x64",
                  platform: "windows",
                  architecture: "x64",
                  format: "zip",
                  url: "mock://core-1.4.2.zip",
                  sizeBytes: 96 * 1024 * 1024,
                  sha256: "a".repeat(64),
                },
              ],
              dependencies: [],
            },
            {
              id: "core-1.3.0",
              version: "1.3.0",
              channel: "stable",
              publishedAt: "2026-06-01T00:00:00.000Z",
              artifacts: [
                {
                  id: "core-1.3.0-win-x64",
                  platform: "windows",
                  architecture: "x64",
                  format: "zip",
                  url: "mock://core-1.3.0.zip",
                  sizeBytes: 90 * 1024 * 1024,
                  sha256: "b".repeat(64),
                },
              ],
              dependencies: [],
            },
          ],
        },
        {
          id: "tinadec-gateway",
          name: "TinadecGateway",
          family: "gateway",
          description: "无状态 BFF/代理（mock）。",
          delivery: "bun-script",
          probe: "http-health",
          probeTarget: "http://127.0.0.1:48730/api/v1/health",
          expectedArtifact: "src/index.ts",
          allowMultipleInstances: false,
          supportsStandaloneLaunch: true,
          releases: [
            {
              id: "gw-0.9.0",
              version: "0.9.0",
              channel: "stable",
              publishedAt: "2026-07-15T00:00:00.000Z",
              artifacts: [
                {
                  id: "gw-0.9.0-any",
                  platform: "windows",
                  architecture: "x64",
                  format: "zip",
                  url: "mock://gw-0.9.0.zip",
                  sizeBytes: 12 * 1024 * 1024,
                  sha256: "c".repeat(64),
                },
              ],
              dependencies: [
                { productId: "tinadec-core", versionRange: ">=1.0.0", optional: false },
              ],
            },
          ],
        },
        {
          id: "tinadec-office-desktop",
          name: "TinadecOffice Desktop",
          family: "app",
          description: "Electron 桌面客户端（mock）。",
          delivery: "portable-exe",
          probe: "process-name",
          probeTarget: "TinadecOffice",
          expectedArtifact: "TinadecOffice-*-portable.exe",
          allowMultipleInstances: true,
          supportsStandaloneLaunch: true,
          releases: [],
        },
      ],
    },
    catalogStatus: { state: "ok", source: "builtin" },
    installations: [
      {
        id: "tinadec-core",
        productId: "tinadec-core",
        path: "C:\\Tinadec\\apps\\tinadec-core\\versions\\1.3.0",
        registeredAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        lastKnownVersion: "1.3.0",
        activeVersion: "1.3.0",
        platform: "windows",
        architecture: "x64",
        source: "catalog",
        ownership: "manager-managed",
      },
      {
        id: "tinadec-office-desktop:9a2b41cc",
        productId: "tinadec-office-desktop",
        path: "D:\\Tools\\TinadecOffice-2026.3-portable",
        registeredAt: "2026-06-10T00:00:00.000Z",
        updatedAt: "2026-06-10T00:00:00.000Z",
        platform: "windows",
        architecture: "x64",
        source: "legacy-registry",
        ownership: "legacy-unmanaged",
      },
    ],
    health: [
      {
        installationId: "tinadec-core",
        productId: "tinadec-core",
        status: "running",
        checkedAt: new Date().toISOString(),
        message: "mock: Core 运行中。",
        version: "1.3.0",
        endpoint: "http://127.0.0.1:48731/api/v1/health",
      },
      {
        installationId: "tinadec-office-desktop:9a2b41cc",
        productId: "tinadec-office-desktop",
        status: "stopped",
        checkedAt: new Date().toISOString(),
        message: "已安装，未运行。",
      },
    ],
    operations: [],
  };

  const snapshotListeners = new Set<SnapshotListener>();
  const messageListeners = new Map<string, Set<(payload: unknown) => void>>();

  const emit = (name: MessageName, payload: unknown) => {
    const set = messageListeners.get(name);
    if (set) for (const listener of set) listener(payload);
  };
  const touch = () => {
    snapshot.generatedAt = new Date().toISOString();
    for (const listener of snapshotListeners) listener();
  };

  let opSeq = 1;
  function simulateOperation(
    kind: OperationRecord["kind"],
    productId: string,
    installationId?: string,
  ): OperationRecord {
    const record: OperationRecord = {
      id: `op-mock${opSeq++}`,
      kind,
      status: "running",
      phase: "downloading",
      productId,
      installationId,
      progress: 0,
      bytesDownloaded: 0,
      message: "下载中（mock 模拟）",
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      canCancel: true,
      canRetry: false,
    };
    snapshot.operations.unshift(record);
    touch();
    emit("operation-updated", { operation: record });
    let progress = 0;
    const phases: OperationRecord["phase"][] = [
      "downloading",
      "verifying",
      "staging",
      "installing",
      "ready",
    ];
    const timer = setInterval(() => {
      progress += 7 + Math.random() * 9;
      const phase = phases[Math.min(Math.floor(progress / 25), phases.length - 1)];
      record.progress = Math.min(progress, 100);
      record.phase = phase;
      record.bytesDownloaded = Math.round((record.totalBytes ?? 1) * (record.progress / 100));
      record.message =
        phase === "downloading"
          ? "下载中（mock 模拟）"
          : phase === "verifying"
            ? "校验 SHA-256…"
            : phase === "staging"
              ? "解包到暂存目录…"
              : phase === "installing"
                ? "切换活动版本…"
                : "完成";
      if (record.progress >= 100) {
        clearInterval(timer);
        record.status = "succeeded";
        record.phase = "ready";
        record.finishedAt = new Date().toISOString();
        record.canCancel = false;
        const installation = snapshot.installations.find(
          (r) => r.id === record.installationId,
        );
        if (installation && kind !== "uninstall") {
          installation.activeVersion = "1.4.2";
          installation.lastKnownVersion = "1.4.2";
        }
        if (kind === "uninstall" && installation) {
          snapshot.installations = snapshot.installations.filter(
            (r) => r.id !== installation.id,
          );
        }
      }
      touch();
      emit("operation-updated", { operation: { ...record } });
      if (record.progress >= 100) {
        emit("snapshot-changed", { reason: "installations" });
      }
    }, 450);
    return record;
  }

  const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

  const request = (
    name: string,
    params: unknown,
  ): Promise<RpcResult<unknown>> => {
    switch (name) {
      case "getSnapshot":
        return ok({ ...snapshot, generatedAt: new Date().toISOString() });
      case "install":
      case "update":
      case "repair": {
        const p = params as { productId: string; installationId?: string };
        return ok(simulateOperation(name, p.productId, p.installationId));
      }
      case "uninstall": {
        const p = params as { installationId: string };
        return ok(simulateOperation("uninstall", p.installationId, p.installationId));
      }
      case "batchUpdate": {
        const p = params as { installationIds: string[] };
        return ok(
          p.installationIds.map((id) => {
            const inst = snapshot.installations.find((r) => r.id === id);
            return simulateOperation("update", inst?.productId ?? id, id);
          }),
        );
      }
      case "cancelOperation": {
        const p = params as { operationId: string };
        const record = snapshot.operations.find((op) => op.id === p.operationId);
        if (record) {
          record.status = "cancelled";
          record.phase = "cleaning-up";
          record.canCancel = false;
          record.finishedAt = new Date().toISOString();
          record.message = "已取消。";
          touch();
          emit("operation-updated", { operation: { ...record } });
        }
        return ok(record ?? null);
      }
      case "start":
      case "stop":
      case "probe": {
        const p = params as { installationId: string };
        const health = snapshot.health.find((h) => h.installationId === p.installationId);
        if (health) {
          if (name === "start") health.status = "running";
          if (name === "stop") health.status = "stopped";
          health.checkedAt = new Date().toISOString();
          emit("health-updated", { health: { ...health } });
          touch();
        }
        return ok(health ?? null);
      }
      case "refreshCatalog":
        return ok({ state: "ok", source: "builtin", refreshedAt: new Date().toISOString() });
      case "injectCatalogFixture":
        return ok({ state: "ok", source: "fixture" });
      case "saveSettings":
        snapshot.settings = params as ManagerSnapshot["settings"];
        touch();
        return ok(snapshot.settings);
      case "chooseDirectory":
        return ok(["C:\\Tinadec\\apps"]);
      case "openPath":
        return ok(true);
      case "defaultInstallRoot":
        return ok("C:\\Tinadec\\apps");
      case "platform":
        return ok({ platform: "windows", architecture: "x64", appVersion: "0.1.0-dev" });
      case "logs":
        return ok([]);
      default:
        return Promise.resolve({
          ok: false as const,
          error: { code: "unknown" as const, message: `mock 未实现 ${name}` },
        });
    }
  };

  return {
    mode: "mock",
    request(name, ...args) {
      return request(name, args[0]) as never;
    },
    onMessage(name, listener) {
      let set = messageListeners.get(name);
      if (!set) {
        set = new Set();
        messageListeners.set(name, set);
      }
      set.add(listener as (payload: unknown) => void);
      return () => set!.delete(listener as (payload: unknown) => void);
    },
  };
}

// Electrobun injects this global via its preload; browser dev lacks it.
declare global {
  interface Window {
    __electrobunWebviewId?: number;
  }
}

export const managerRpc: ManagerRpc =
  typeof window !== "undefined" && window.__electrobunWebviewId !== undefined
    ? createElectrobunRpc()
    : createMockRpc();
