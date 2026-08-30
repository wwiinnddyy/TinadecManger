/**
 * Installation registry persistence with idempotent legacy migration.
 *
 * - v1 (legacy): { version: 1, components: [{ id, path, executable?,
 *   endpointOverride?, registeredAtUtc, lastKnownVersion? }] }
 * - v2 (manager): { version: 2, installations: InstallationRecord[] }
 *
 * Legacy records become `legacy-unmanaged` registrations: they keep probe,
 * start/stop, and safe-unregister abilities but never allow destructive
 * filesystem operations without explicit confirmation.
 */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { InstallationRecord } from "../../shared/domain";
import { readJsonWithBackup, writeJsonAtomic } from "./json-store";
import type { ManagerPaths } from "../paths";

interface LegacyComponent {
  id: string;
  path: string;
  executable?: string | null;
  endpointOverride?: string | null;
  registeredAtUtc?: string;
  lastKnownVersion?: string | null;
}

interface RegistryFileV1 {
  version?: number;
  components?: LegacyComponent[];
}

interface RegistryFileV2 {
  version: number;
  installations: InstallationRecord[];
}

function isV2(value: unknown): value is RegistryFileV2 {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as RegistryFileV2).version === 2 &&
    Array.isArray((value as RegistryFileV2).installations)
  );
}

/**
 * Derives the product id from a legacy registration id
 * (`tinadec-core` → `tinadec-core`, `tinadec-office-desktop:abcd1234` →
 * `tinadec-office-desktop`).
 */
export function productIdFromLegacyId(legacyId: string): string {
  const idx = legacyId.indexOf(":");
  return idx === -1 ? legacyId : legacyId.slice(0, idx);
}

export function migrateLegacyComponent(
  component: LegacyComponent,
): InstallationRecord {
  const now = new Date().toISOString();
  const registeredAt =
    typeof component.registeredAtUtc === "string" &&
    !Number.isNaN(Date.parse(component.registeredAtUtc))
      ? component.registeredAtUtc
      : now;
  return {
    id: component.id,
    productId: productIdFromLegacyId(component.id),
    path: component.path,
    executable: component.executable ?? undefined,
    endpointOverride: component.endpointOverride ?? undefined,
    registeredAt,
    updatedAt: registeredAt,
    lastKnownVersion: component.lastKnownVersion ?? undefined,
    platform: process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux",
    architecture: process.arch === "arm64" ? "arm64" : "x64",
    source: "legacy-registry",
    ownership: "legacy-unmanaged",
  };
}

export function emptyRegistry(): RegistryFileV2 {
  return { version: 2, installations: [] };
}

export function normalizeRecord(record: InstallationRecord): InstallationRecord {
  return {
    ...record,
    source: record.source ?? "manual",
    ownership: record.ownership ?? "legacy-unmanaged",
  };
}

export class InstallStore {
  constructor(private readonly paths: ManagerPaths) {}

  async load(): Promise<InstallationRecord[]> {
    const raw = await readJsonWithBackup<unknown>(
      this.paths.registryPath,
      () => emptyRegistry(),
      isV2,
    );
    if (isV2(raw)) {
      return raw.installations.map(normalizeRecord);
    }
    // Legacy v1 file: migrate in place (idempotent; original kept as .bak
    // automatically only if unreadable, so write the migrated copy explicitly).
    const legacy = raw as RegistryFileV1;
    const installations = (legacy.components ?? []).map(migrateLegacyComponent);
    const migrated = { version: 2, installations };
    await this.writeRegistry(migrated);
    return installations;
  }

  async save(installations: InstallationRecord[]): Promise<void> {
    await this.writeRegistry({ version: 2, installations });
  }

  private async writeRegistry(file: RegistryFileV2): Promise<void> {
    await mkdir(dirname(this.paths.registryPath), { recursive: true });
    await writeJsonAtomic(this.paths.registryPath, file);
  }
}

/** Registration id for a fresh managed installation (multi-instance aware). */
export function newInstallationId(
  productId: string,
  allowMultipleInstances: boolean,
): string {
  return allowMultipleInstances
    ? `${productId}:${randomUUID().replace(/-/g, "").slice(0, 8)}`
    : productId;
}
