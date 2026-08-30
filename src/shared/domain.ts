/**
 * Serializable domain values shared by the Electrobun main process and renderer.
 * Keep this module free of runtime, filesystem, and platform imports.
 */

export type IsoDateTime = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const ProductFamily = {
  Core: "core",
  Gateway: "gateway",
  Tools: "tools",
  App: "app",
} as const;
export type ProductFamily = (typeof ProductFamily)[keyof typeof ProductFamily];

/** Compatibility name for code migrated from the legacy manager. */
export const ComponentFamily = ProductFamily;
export type ComponentFamily = ProductFamily;

export const DeliveryKind = {
  DotNetPublishDir: "dotnet-publish-dir",
  NativeExe: "native-exe",
  BunScript: "bun-script",
  PortableExe: "portable-exe",
  YuiApp: "yui-app",
} as const;
export type DeliveryKind = (typeof DeliveryKind)[keyof typeof DeliveryKind];

export const ProbeKind = {
  HttpHealth: "http-health",
  ProcessName: "process-name",
  FileOnly: "file-only",
} as const;
export type ProbeKind = (typeof ProbeKind)[keyof typeof ProbeKind];

export const Platform = {
  Windows: "windows",
  MacOS: "macos",
  Linux: "linux",
} as const;
export type Platform = (typeof Platform)[keyof typeof Platform];

export const Architecture = {
  X64: "x64",
  Arm64: "arm64",
} as const;
export type Architecture = (typeof Architecture)[keyof typeof Architecture];

export const ReleaseChannel = {
  Stable: "stable",
  Canary: "canary",
} as const;
export type ReleaseChannel = (typeof ReleaseChannel)[keyof typeof ReleaseChannel];

export const ArtifactFormat = {
  Zip: "zip",
  TarGz: "tar-gz",
  Directory: "directory",
  Executable: "executable",
} as const;
export type ArtifactFormat = (typeof ArtifactFormat)[keyof typeof ArtifactFormat];

export const InstallationSource = {
  Catalog: "catalog",
  LegacyRegistry: "legacy-registry",
  Manual: "manual",
  Fixture: "fixture",
} as const;
export type InstallationSource =
  (typeof InstallationSource)[keyof typeof InstallationSource];

export const InstallationOwnership = {
  Managed: "manager-managed",
  LegacyUnmanaged: "legacy-unmanaged",
} as const;
export type InstallationOwnership =
  (typeof InstallationOwnership)[keyof typeof InstallationOwnership];

export const HealthStatus = {
  Probing: "probing",
  Running: "running",
  Stopped: "stopped",
  Unhealthy: "unhealthy",
  NotInstalled: "not-installed",
  Unknown: "unknown",
} as const;
export type HealthStatus = (typeof HealthStatus)[keyof typeof HealthStatus];

/** Compatibility name for the legacy component probe result. */
export const ComponentStatus = HealthStatus;
export type ComponentStatus = HealthStatus;

export const OperationKind = {
  Install: "install",
  Update: "update",
  Repair: "repair",
  Uninstall: "uninstall",
  Register: "register",
  Unregister: "unregister",
  Start: "start",
  Stop: "stop",
  Probe: "probe",
} as const;
export type OperationKind = (typeof OperationKind)[keyof typeof OperationKind];

export const OperationStatus = {
  Queued: "queued",
  Running: "running",
  Succeeded: "succeeded",
  Failed: "failed",
  Cancelled: "cancelled",
  RolledBack: "rolled-back",
} as const;
export type OperationStatus =
  (typeof OperationStatus)[keyof typeof OperationStatus];

export const OperationPhase = {
  Queued: "queued",
  Downloading: "downloading",
  Verifying: "verifying",
  Staging: "staging",
  Installing: "installing",
  Ready: "ready",
  RollingBack: "rolling-back",
  CleaningUp: "cleaning-up",
} as const;
export type OperationPhase = (typeof OperationPhase)[keyof typeof OperationPhase];

export const LogLevel = {
  Debug: "debug",
  Info: "info",
  Success: "success",
  Warning: "warning",
  Error: "error",
} as const;
export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

export const ThemeMode = {
  System: "system",
  Light: "light",
  Dark: "dark",
} as const;
export type ThemeMode = (typeof ThemeMode)[keyof typeof ThemeMode];

export interface ProductDependency {
  productId: string;
  versionRange: string;
  optional: boolean;
}

export interface ArtifactSignature {
  algorithm: "ed25519";
  publicKeyId: string;
  value: string;
}

export interface Artifact {
  id: string;
  platform: Platform;
  architecture: Architecture;
  format: ArtifactFormat;
  url: string;
  sizeBytes: number;
  sha256: string;
  signature?: ArtifactSignature;
}

export interface Release {
  id: string;
  version: string;
  channel: ReleaseChannel;
  publishedAt: IsoDateTime;
  artifacts: Artifact[];
  dependencies: ProductDependency[];
  minimumManagerVersion?: string;
  releaseNotes?: string;
}

/** A known Tinadec product, independent of any local installation. */
export interface ProductDefinition {
  id: string;
  name: string;
  family: ProductFamily;
  description: string;
  delivery: DeliveryKind;
  probe: ProbeKind;
  probeTarget: string;
  expectedArtifact: string;
  allowMultipleInstances: boolean;
  supportsStandaloneLaunch: boolean;
  releases: Release[];
}

export interface CatalogManifest {
  schemaVersion: 1;
  generatedAt: IsoDateTime;
  managerMinimumVersion?: string;
  products: ProductDefinition[];
  signature?: ArtifactSignature;
}

/** One local registration, either migrated legacy data or manager-owned data. */
export interface InstallationRecord {
  id: string;
  productId: string;
  path: string;
  executable?: string;
  endpointOverride?: string;
  registeredAt: IsoDateTime;
  updatedAt: IsoDateTime;
  installedVersion?: string;
  activeVersion?: string;
  releaseId?: string;
  channel?: ReleaseChannel;
  platform: Platform;
  architecture: Architecture;
  source: InstallationSource;
  ownership: InstallationOwnership;
  lastKnownVersion?: string;
}

export interface HealthSnapshot {
  installationId: string;
  productId: string;
  status: HealthStatus;
  checkedAt: IsoDateTime;
  message: string;
  version?: string;
  endpoint?: string;
  processId?: number;
  latencyMs?: number;
}

export interface OperationRecord {
  id: string;
  kind: OperationKind;
  status: OperationStatus;
  phase: OperationPhase;
  productId: string;
  installationId?: string;
  releaseId?: string;
  progress: number;
  bytesDownloaded: number;
  totalBytes?: number;
  message: string;
  error?: string;
  createdAt: IsoDateTime;
  startedAt?: IsoDateTime;
  finishedAt?: IsoDateTime;
  canCancel: boolean;
  canRetry: boolean;
  previousVersion?: string;
}

export interface LogEntry {
  id: string;
  timestamp: IsoDateTime;
  level: LogLevel;
  message: string;
  installationId?: string;
  operationId?: string;
}

export interface AppSettings {
  installRoot: string;
  coreUrl: string;
  gatewayUrl: string;
  catalogUrl: string;
  releaseChannel: ReleaseChannel;
  autoCheckForUpdates: boolean;
  autoUpdate: boolean;
  operationConcurrency: number;
  networkTimeoutSeconds: number;
  theme: ThemeMode;
  minimizeToTray: boolean;
  dashboardAutoRefresh: boolean;
  dashboardRefreshIntervalSeconds: number;
}

import type { CatalogStatusPayload } from "./rpc";

/** Complete state returned during renderer bootstrap and after mutations. */
export interface ManagerSnapshot {
  appVersion: string;
  catalog: CatalogManifest;
  catalogStatus: CatalogStatusPayload;
  installations: InstallationRecord[];
  health: HealthSnapshot[];
  operations: OperationRecord[];
  settings: AppSettings;
  platform: Platform;
  architecture: Architecture;
  generatedAt: IsoDateTime;
}

export interface CatalogQuery {
  search?: string;
  family?: ProductFamily;
  platform?: Platform;
  channel?: ReleaseChannel;
}

export interface OperationRequest {
  kind: OperationKind;
  productId: string;
  installationId?: string;
  releaseId?: string;
  version?: string;
  path?: string;
  endpointOverride?: string;
}
