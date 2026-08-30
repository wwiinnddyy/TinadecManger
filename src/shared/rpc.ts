/**
 * Typed RPC contract between the Electrobun main process (bun) and the
 * React renderer (webview). Requests are command/response; long-running
 * work streams progress through messages.
 *
 * Layout matches Electrobun's ElectrobunRPCSchema: { bun, webview } where
 * `bun.requests` are requests the *bun* side answers and `bun.messages` are
 * messages the *bun* side sends.
 */

import type { RpcResult } from "./errors";
import type {
  AppSettings,
  CatalogManifest,
  HealthSnapshot,
  InstallationRecord,
  LogEntry,
  ManagerSnapshot,
  OperationRecord,
  OperationRequest,
  Platform,
  Architecture,
} from "./domain";

// ---- bun → webview messages (event stream) ----

export interface OperationUpdatedPayload {
  operation: OperationRecord;
}

export interface SnapshotChangedPayload {
  reason:
    | "installations"
    | "operations"
    | "settings"
    | "catalog"
    | "health";
}

export interface HealthUpdatedPayload {
  health: HealthSnapshot;
}

export interface CatalogStatusPayload {
  state: "idle" | "refreshing" | "ok" | "offline" | "invalid";
  source?: "remote" | "cache" | "fixture" | "builtin";
  message?: string;
  refreshedAt?: string;
}

export interface LogAppendedPayload {
  entry: LogEntry;
}

export interface MainLogPayload {
  level: "info" | "warn" | "error";
  message: string;
}

// ---- webview → bun requests ----

export interface ChooseDirectoryRequest {
  kind: "directory" | "file";
  startingFolder?: string;
  fileTypes?: string;
}

export interface UninstallRequest {
  installationId: string;
  /** legacy records require explicit confirmation to remove registration only */
  confirmed?: boolean;
  deleteFiles?: boolean;
}

export interface BatchUpdateRequest {
  installationIds: string[];
}

export interface RegisterRequest {
  productId: string;
  path: string;
  endpointOverride?: string;
}

export interface DiagnosticsRequest {
  installationId?: string;
  tail?: number;
}

export interface OpenPathRequest {
  path: string;
  mode: "directory" | "item";
}

export interface InstallerTargets {
  files: string[];
  directories: string[];
}

/**
 * Requests the renderer may invoke on the main process.
 * Every handler returns RpcResult<T> so failures travel as data.
 */
export interface BunRequests {
  getSnapshot: { params: undefined; response: RpcResult<ManagerSnapshot> };

  saveSettings: { params: AppSettings; response: RpcResult<AppSettings> };
  refreshCatalog: {
    params: { force?: boolean };
    response: RpcResult<CatalogStatusPayload>;
  };
  injectCatalogFixture: {
    params: { manifest: CatalogManifest } | { clear: true };
    response: RpcResult<CatalogStatusPayload>;
  };

  install: {
    params: OperationRequest;
    response: RpcResult<OperationRecord>;
  };
  update: {
    params: OperationRequest;
    response: RpcResult<OperationRecord>;
  };
  batchUpdate: {
    params: BatchUpdateRequest;
    response: RpcResult<OperationRecord[]>;
  };
  repair: { params: OperationRequest; response: RpcResult<OperationRecord> };
  uninstall: { params: UninstallRequest; response: RpcResult<OperationRecord> };
  register: {
    params: RegisterRequest;
    response: RpcResult<InstallationRecord>;
  };
  unregister: {
    params: { installationId: string; confirmed: boolean };
    response: RpcResult<InstallationRecord>;
  };
  cancelOperation: {
    params: { operationId: string };
    response: RpcResult<OperationRecord>;
  };
  retryOperation: {
    params: { operationId: string };
    response: RpcResult<OperationRecord>;
  };

  start: {
    params: { installationId: string };
    response: RpcResult<HealthSnapshot>;
  };
  stop: {
    params: { installationId: string };
    response: RpcResult<HealthSnapshot>;
  };
  probe: {
    params: { installationId: string };
    response: RpcResult<HealthSnapshot>;
  };
  probeAll: {
    params: undefined;
    response: RpcResult<HealthSnapshot[]>;
  };

  chooseDirectory: {
    params: ChooseDirectoryRequest;
    response: RpcResult<string[]>;
  };
  openPath: { params: OpenPathRequest; response: RpcResult<true> };
  defaultInstallRoot: {
    params: undefined;
    response: RpcResult<string>;
  };
  platform: {
    params: undefined;
    response: RpcResult<{ platform: Platform; architecture: Architecture; appVersion: string }>;
  };
  logs: {
    params: DiagnosticsRequest;
    response: RpcResult<LogEntry[]>;
  };
}

/** Requests the *bun* side may invoke on the webview (reserved; currently unused). */
export interface WebviewRequests {
  noop: { params: undefined; response: void };
}

/**
 * Messages the bun side sends: `bun.messages`.
 * The webview subscribes via rpc.addMessageListener.
 */
export interface BunMessages {
  "operation-updated": OperationUpdatedPayload;
  "snapshot-changed": SnapshotChangedPayload;
  "health-updated": HealthUpdatedPayload;
  "catalog-status": CatalogStatusPayload;
  "log-appended": LogAppendedPayload;
  "main-log": MainLogPayload;
}

/** Messages the webview sends to bun (reserved; currently unused). */
export interface WebviewMessages {
  "renderer-ready": undefined;
}

export interface ManagerApiSchema {
  bun: {
    requests: BunRequests;
    messages: BunMessages;
  };
  webview: {
    requests: WebviewRequests;
    messages: WebviewMessages;
  };
}
