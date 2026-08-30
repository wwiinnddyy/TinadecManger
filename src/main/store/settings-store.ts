/**
 * Settings persistence with legacy migration. The legacy settings.json only
 * had a subset of fields; unknown/new fields fall back to defaults and the
 * legacy values are preserved on first load (idempotent migration).
 */

import type { AppSettings } from "../../shared/domain";
import { readJsonWithBackup, writeJsonAtomic } from "./json-store";
import { defaultInstallRoot, type ManagerPaths } from "../paths";

export const DEFAULT_SETTINGS: AppSettings = {
  installRoot: "",
  coreUrl: "http://127.0.0.1:48731",
  gatewayUrl: "http://127.0.0.1:48730",
  catalogUrl: "", // empty = use the built-in offline catalog
  releaseChannel: "stable",
  autoCheckForUpdates: false,
  autoUpdate: false,
  operationConcurrency: 2,
  networkTimeoutSeconds: 30,
  theme: "system",
  minimizeToTray: false,
  dashboardAutoRefresh: true,
  dashboardRefreshIntervalSeconds: 30,
};

/** Legacy camelCase settings file written by the .NET manager. */
interface LegacySettings {
  installRoot?: string;
  coreUrl?: string;
  gatewayUrl?: string;
  theme?: string;
  dashboardAutoRefresh?: boolean;
  dashboardRefreshIntervalSeconds?: number;
  minimizeToTray?: boolean;
}

function themeOf(value: string | undefined): AppSettings["theme"] {
  return value === "light" || value === "dark" ? value : "system";
}

export function migrateSettings(
  raw: unknown,
  fallbackInstallRoot: string,
): AppSettings {
  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    installRoot: fallbackInstallRoot,
  };
  if (typeof raw !== "object" || raw === null) return merged;
  const legacy = raw as LegacySettings;
  if (typeof legacy.installRoot === "string" && legacy.installRoot.length > 0) {
    merged.installRoot = legacy.installRoot;
  }
  if (typeof legacy.coreUrl === "string" && legacy.coreUrl.length > 0) {
    merged.coreUrl = legacy.coreUrl;
  }
  if (typeof legacy.gatewayUrl === "string" && legacy.gatewayUrl.length > 0) {
    merged.gatewayUrl = legacy.gatewayUrl;
  }
  merged.theme = themeOf(legacy.theme);
  if (typeof legacy.dashboardAutoRefresh === "boolean") {
    merged.dashboardAutoRefresh = legacy.dashboardAutoRefresh;
  }
  if (
    typeof legacy.dashboardRefreshIntervalSeconds === "number" &&
    legacy.dashboardRefreshIntervalSeconds > 0
  ) {
    merged.dashboardRefreshIntervalSeconds = legacy.dashboardRefreshIntervalSeconds;
  }
  if (typeof legacy.minimizeToTray === "boolean") {
    merged.minimizeToTray = legacy.minimizeToTray;
  }
  return merged;
}

export class SettingsStore {
  private cached: AppSettings | null = null;

  constructor(readonly paths: ManagerPaths) {}

  async load(): Promise<AppSettings> {
    if (this.cached) return this.cached;
    const raw = await readJsonWithBackup<unknown>(
      this.paths.settingsPath,
      () => null,
    );
    const migrated = migrateSettings(raw, defaultInstallRoot());
    await this.save(migrated);
    return migrated;
  }

  async save(settings: AppSettings): Promise<AppSettings> {
    const normalized: AppSettings = {
      ...settings,
      operationConcurrency: Math.min(Math.max(settings.operationConcurrency, 1), 8),
      networkTimeoutSeconds: Math.min(Math.max(settings.networkTimeoutSeconds, 5), 300),
      dashboardRefreshIntervalSeconds: Math.min(
        Math.max(settings.dashboardRefreshIntervalSeconds, 5),
        600,
      ),
    };
    await writeJsonAtomic(this.paths.settingsPath, normalized);
    this.cached = normalized;
    return normalized;
  }

  /** Effective install root (settings value or the platform default). */
  async installRoot(): Promise<string> {
    const settings = await this.load();
    return settings.installRoot.length > 0
      ? settings.installRoot
      : defaultInstallRoot();
  }
}
