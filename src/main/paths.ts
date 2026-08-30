/**
 * Filesystem layout for the manager (main process only).
 * Keep %APPDATA%/TinadecManger as the data directory for compatibility with
 * the legacy .NET manager so registry.json / settings.json migrate in place.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export function appDataRoot(): string {
  const appData =
    process.env["APPDATA"] ??
    process.env["XDG_CONFIG_HOME"] ??
    join(homedir(), "AppData", "Roaming");
  return join(appData, "TinadecManger");
}

export function defaultInstallRoot(): string {
  const localAppData =
    process.env["LOCALAPPDATA"] ??
    join(homedir(), "AppData", "Local");
  return join(localAppData, "Tinadec", "apps");
}

export interface ManagerPaths {
  dataDir: string;
  registryPath: string;
  settingsPath: string;
  catalogCachePath: string;
  catalogEtagPath: string;
  downloadDir: string;
  installRoot: string;
}

export function buildPaths(
  dataDir = appDataRoot(),
  installRoot = defaultInstallRoot(),
): ManagerPaths {
  return {
    dataDir,
    registryPath: join(dataDir, "registry.json"),
    settingsPath: join(dataDir, "settings.json"),
    catalogCachePath: join(dataDir, "catalog-cache.json"),
    catalogEtagPath: join(dataDir, "catalog-etag.txt"),
    downloadDir: join(dataDir, "downloads"),
    installRoot,
  };
}
