/**
 * Catalog client: remote manifest fetch with ETag caching, offline fallback,
 * manual refresh and fixture injection. Validation is fail-closed — a remote
 * manifest with any validation issue is rejected, never partially applied.
 *
 * Source precedence for the active manifest:
 *   fixture (explicit) > remote (validated, cached) > cache > built-in
 */

import { readFile, unlink, writeFile } from "node:fs/promises";
import type { CatalogManifest } from "../../shared/domain";
import { assertManifestOrThrow } from "../../shared/manifest";
import { readJsonWithBackup, writeJsonAtomic } from "../store/json-store";
import type { ManagerPaths } from "../paths";
import { builtInManifest } from "./builtin-catalog";
import type { CatalogStatusPayload } from "../../shared/rpc";

export type CatalogSource = "remote" | "cache" | "fixture" | "builtin";

export class CatalogClient {
  private fixture: CatalogManifest | null = null;
  private active: CatalogManifest = builtInManifest();
  private source: CatalogSource = "builtin";
  private refreshedAt: string | null = null;
  private state: CatalogStatusPayload["state"] = "idle";
  private message: string | null = null;
  private inflight: Promise<CatalogStatusPayload> | null = null;

  constructor(
    private readonly paths: ManagerPaths,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async initialize(): Promise<void> {
    // Warm the cache into memory so the first snapshot already has data.
    await this.loadCache();
  }

  status(): CatalogStatusPayload {
    return {
      state: this.state,
      source: this.source,
      message: this.message ?? undefined,
      refreshedAt: this.refreshedAt ?? undefined,
    };
  }

  manifest(): CatalogManifest {
    return this.active;
  }

  /** Explicitly injects a fixture manifest (tests / offline demos). */
  async injectFixture(manifest: CatalogManifest): Promise<CatalogStatusPayload> {
    const validated = assertManifestOrThrow(manifest);
    this.fixture = validated;
    this.active = validated;
    this.source = "fixture";
    this.state = "ok";
    this.refreshedAt = new Date().toISOString();
    this.message = "已注入目录 fixture";
    return this.status();
  }

  async clearFixture(): Promise<CatalogStatusPayload> {
    this.fixture = null;
    await this.refresh({ force: true });
    return this.status();
  }

  async refresh(options: { force?: boolean } = {}): Promise<CatalogStatusPayload> {
    if (this.inflight) return this.inflight;
    const task = this.doRefresh(options).finally(() => {
      this.inflight = null;
    });
    this.inflight = task;
    return task;
  }

  private async doRefresh(
    options: { force?: boolean },
  ): Promise<CatalogStatusPayload> {
    if (this.fixture) {
      this.active = this.fixture;
      this.source = "fixture";
      this.state = "ok";
      return this.status();
    }

    const url = this.catalogUrl;
    if (!url) {
      this.active = builtInManifest();
      this.source = "builtin";
      this.state = "ok";
      this.message = "未配置目录源，使用内置离线目录";
      this.refreshedAt = new Date().toISOString();
      return this.status();
    }

    this.state = "refreshing";
    try {
      const etag = options.force ? null : await this.readEtag();
      const response = await this.fetchImpl(url, {
        headers: etag ? { "If-None-Match": etag } : {},
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.status === 304) {
        const cached = await this.loadCache();
        if (cached) {
          this.active = cached;
          this.source = "cache";
          this.state = "ok";
          this.message = "目录未变化（304）";
          this.refreshedAt = new Date().toISOString();
          return this.status();
        }
      }
      if (!response.ok) {
        throw new Error(`目录服务返回 HTTP ${response.status}`);
      }
      const body = (await response.json()) as unknown;
      const manifest = assertManifestOrThrow(body);
      this.active = manifest;
      this.source = "remote";
      this.state = "ok";
      this.message = null;
      this.refreshedAt = new Date().toISOString();
      await writeJsonAtomic(this.paths.catalogCachePath, manifest);
      const newEtag = response.headers.get("ETag");
      if (newEtag) {
        await writeFile(this.paths.catalogEtagPath, newEtag, "utf8");
      } else {
        await unlink(this.paths.catalogEtagPath).catch(() => {});
      }
      return this.status();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Offline fallback chain: cached manifest, then built-in.
      const cached = await this.loadCache();
      if (cached) {
        this.active = cached;
        this.source = "cache";
        this.state = "offline";
        this.message = `远程目录不可用，已回退缓存：${message}`;
      } else {
        this.active = builtInManifest();
        this.source = "builtin";
        this.state = "offline";
        this.message = `远程目录不可用，已回退内置目录：${message}`;
      }
      this.refreshedAt = new Date().toISOString();
      return this.status();
    }
  }

  private get catalogUrl(): string | null {
    // Overridable for tests.
    return (this as unknown as { _catalogUrl?: string | null })._catalogUrl ?? null;
  }

  private get timeoutMs(): number {
    return (this as unknown as { _timeoutMs?: number })._timeoutMs ?? 30_000;
  }

  private async readEtag(): Promise<string | null> {
    try {
      const etag = await readFile(this.paths.catalogEtagPath, "utf8");
      return etag.trim() || null;
    } catch {
      return null;
    }
  }

  private async loadCache(): Promise<CatalogManifest | null> {
    const cached = await readJsonWithBackup<unknown>(
      this.paths.catalogCachePath,
      () => null,
    );
    if (cached === null) return null;
    try {
      return assertManifestOrThrow(cached);
    } catch {
      return null;
    }
  }
}

/**
 * A test/fixture-oriented catalog client that reads its URL and timeout from
 * explicit configuration instead of compiled-in defaults. The production
 * CatalogClient defaults to the built-in manifest when no catalog source is
 * configured in settings.
 */
export class ConfiguredCatalogClient extends CatalogClient {
  constructor(
    paths: ManagerPaths,
    options: { catalogUrl: string | null; timeoutMs?: number; fetchImpl?: typeof fetch },
  ) {
    super(paths, options.fetchImpl ?? fetch);
    (this as unknown as { _catalogUrl: string | null })._catalogUrl =
      options.catalogUrl;
    (this as unknown as { _timeoutMs?: number })._timeoutMs =
      options.timeoutMs ?? 30_000;
  }
}
