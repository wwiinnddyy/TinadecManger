import { mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPaths } from "../src/main/paths";
import { migrateLegacyComponent, productIdFromLegacyId } from "../src/main/store/install-store";
import { migrateSettings, DEFAULT_SETTINGS } from "../src/main/store/settings-store";
import { writeJsonAtomic, readJsonWithBackup } from "../src/main/store/json-store";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tinadec-store-"));
});

afterEach(async () => {
  // leave temp dirs for OS cleanup; do not recurse-delete in tests
});

describe("legacy registry migration", () => {
  it("derives product id from legacy registration ids", () => {
    expect(productIdFromLegacyId("tinadec-core")).toBe("tinadec-core");
    expect(productIdFromLegacyId("tinadec-office-desktop:abcd1234")).toBe(
      "tinadec-office-desktop",
    );
  });

  it("maps legacy components to legacy-unmanaged records", () => {
    const record = migrateLegacyComponent({
      id: "tinadec-office-desktop:abcd1234",
      path: "D:\\Tools\\Office",
      executable: null,
      endpointOverride: "http://127.0.0.1:9999/health",
      registeredAtUtc: "2026-06-10T08:00:00.000Z",
      lastKnownVersion: "2026.3",
    });
    expect(record.productId).toBe("tinadec-office-desktop");
    expect(record.ownership).toBe("legacy-unmanaged");
    expect(record.source).toBe("legacy-registry");
    expect(record.endpointOverride).toBe("http://127.0.0.1:9999/health");
    expect(record.lastKnownVersion).toBe("2026.3");
    expect(record.registeredAt).toBe("2026-06-10T08:00:00.000Z");
    expect(record.id).toBe("tinadec-office-desktop:abcd1234");
  });

  it("falls back to now() when legacy timestamps are invalid", () => {
    const record = migrateLegacyComponent({
      id: "tinadec-core",
      path: "C:\\Core",
      registeredAtUtc: "not-a-date",
    });
    expect(Number.isNaN(Date.parse(record.registeredAt))).toBe(false);
  });
});

describe("settings migration", () => {
  it("keeps legacy values and fills defaults for new fields", () => {
    const settings = migrateSettings(
      {
        installRoot: "D:\\Tinadec",
        coreUrl: "http://127.0.0.1:48731",
        gatewayUrl: "http://127.0.0.1:48730",
        theme: "dark",
        dashboardAutoRefresh: false,
        dashboardRefreshIntervalSeconds: 15,
        minimizeToTray: true,
      },
      "C:\\default\\root",
    );
    expect(settings.installRoot).toBe("D:\\Tinadec");
    expect(settings.theme).toBe("dark");
    expect(settings.dashboardRefreshIntervalSeconds).toBe(15);
    expect(settings.minimizeToTray).toBe(true);
    expect(settings.catalogUrl).toBe(DEFAULT_SETTINGS.catalogUrl);
    expect(settings.operationConcurrency).toBe(DEFAULT_SETTINGS.operationConcurrency);
    expect(settings.releaseChannel).toBe("stable");
  });

  it("uses defaults for junk input and invalid themes", () => {
    const settings = migrateSettings({ theme: "banana" }, "C:\\default\\root");
    expect(settings.theme).toBe("system");
    expect(settings.installRoot).toBe("C:\\default\\root");
  });
});

describe("json store", () => {
  it("writes atomically and reads back", async () => {
    const file = path.join(dir, "data.json");
    await writeJsonAtomic(file, { hello: "world" });
    const loaded = await readJsonWithBackup<{ hello: string }>(file, () => ({ hello: "" }));
    expect(loaded.hello).toBe("world");
  });

  it("backs up corrupted files and returns fallback", async () => {
    const file = path.join(dir, "broken.json");
    await writeFile(file, "{ not json", "utf8");
    const loaded = await readJsonWithBackup<{ ok: boolean }>(file, () => ({ ok: true }));
    expect(loaded.ok).toBe(true);
    expect(existsSync(`${file}.bak`)).toBe(true);
  });

  it("rejects wrong-shape payloads via validator", async () => {
    const file = path.join(dir, "shape.json");
    await writeJsonAtomic(file, { version: 1, unexpected: true });
    const loaded = await readJsonWithBackup<{ version: number }>(
      file,
      () => ({ version: 2 }),
      (value) =>
        typeof value === "object" &&
        value !== null &&
        (value as { version?: number }).version === 2,
    );
    expect(loaded.version).toBe(2);
  });

  it("builds paths under the app data root", () => {
    const paths = buildPaths("C:\\data", "C:\\apps");
    expect(paths.registryPath).toBe(path.join("C:\\data", "registry.json"));
    expect(paths.installRoot).toBe("C:\\apps");
  });
});
