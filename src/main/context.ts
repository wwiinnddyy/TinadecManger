/**
 * ManagerContext — composition root for the main process. Owns all services,
 * builds the ManagerSnapshot served over RPC, and converts domain events into
 * RPC messages. Framework-free so it can run under Vitest.
 */

import { mkdir } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  AppSettings,
  InstallationRecord,
  ManagerSnapshot,
  OperationRequest,
  ProductDefinition,
} from "../shared/domain";
import { ErrorCode, ManagerError } from "../shared/errors";
import { newInstallationId } from "./store/install-store";
import { InstallStore } from "./store/install-store";
import { SettingsStore } from "./store/settings-store";
import { CatalogClient, ConfiguredCatalogClient } from "./catalog/catalog-client";
import { LogStore } from "./logs";
import { probeWithTimeout } from "./process/probes";
import { ProcessSupervisor } from "./process/supervisor";
import { OperationQueue, type TaskDefinition } from "./ops/operation-queue";
import {
  activeVersionOf,
  productDir,
  removeManagedProduct,
  runInstallFlow,
} from "./ops/install-flow";

export interface ContextEvents {
  onOperationUpdated?: (id: string) => void;
  onSnapshotChanged?: (reason: "installations" | "operations" | "settings" | "catalog" | "health") => void;
  onHealthUpdated?: (installationId: string) => void;
  onCatalogStatus?: () => void;
  onLogAppended?: () => void;
}

export class ManagerContext {
  readonly logs = new LogStore();
  readonly queue: OperationQueue;
  readonly supervisor: ProcessSupervisor;
  readonly settings: SettingsStore;
  readonly installs: InstallStore;
  catalog: CatalogClient;

  private healthById = new Map<string, ManagerSnapshot["health"][number]>();
  private installations: InstallationRecord[] = [];
  private events: ContextEvents;

  constructor(options: {
    paths: ConstructorParameters<typeof SettingsStore>[0];
    events?: ContextEvents;
    catalog?: CatalogClient;
  }) {
    this.settings = new SettingsStore(options.paths);
    this.installs = new InstallStore(options.paths);
    this.catalog =
      options.catalog ??
      new ConfiguredCatalogClient(options.paths, { catalogUrl: null });
    this.queue = new OperationQueue({ concurrency: 2 });
    this.supervisor = new ProcessSupervisor(this.logs);
    this.events = options.events ?? {};

    this.queue.onOperationUpdate((record) => {
      this.events.onOperationUpdated?.(record.id);
      this.events.onSnapshotChanged?.("operations");
    });
    this.logs.subscribe(() => this.events.onLogAppended?.());
  }

  async initialize(): Promise<void> {
    const settings = await this.settings.load();
    this.queue.setConcurrency(settings.operationConcurrency);
    this.installations = await this.installs.load();
    // Point the default catalog client at the configured URL.
    if (this.catalog instanceof ConfiguredCatalogClient && settings.catalogUrl) {
      (this.catalog as unknown as { _catalogUrl: string | null })._catalogUrl =
        settings.catalogUrl;
    }
    await this.catalog.initialize();
    await mkdir(productDir(await this.settings.installRoot(), ".keep"), {
      recursive: true,
    });
  }

  // ---------- snapshot ----------

  async snapshot(): Promise<ManagerSnapshot> {
    const settings = await this.settings.load();
    const health: ManagerSnapshot["health"] = [];
    for (const record of this.installations) {
      health.push(
        this.healthById.get(record.id) ?? {
          installationId: record.id,
          productId: record.productId,
          status: "unknown",
          checkedAt: new Date(0).toISOString(),
          message: "尚未探测。",
        },
      );
    }
    return {
      appVersion: "0.1.0",
      settings,
      installations: [...this.installations],
      health,
      operations: this.queue.list(),
      catalog: this.catalog.manifest(),
      catalogStatus: this.catalog.status(),
      platform:
        process.platform === "win32"
          ? "windows"
          : process.platform === "darwin"
            ? "macos"
            : "linux",
      architecture: process.arch === "arm64" ? "arm64" : "x64",
      generatedAt: new Date().toISOString(),
    };
  }

  definitionFor(productId: string): ProductDefinition | undefined {
    return this.catalog.manifest().products.find((p) => p.id === productId);
  }

  // ---------- probes / process control ----------

  async probeInstallation(installationId: string) {
    const record = this.installations.find((r) => r.id === installationId);
    const definition = record && this.definitionFor(record.productId);
    if (!record || !definition) {
      throw new ManagerError(ErrorCode.NotFound, "未找到该登记记录。");
    }
    const health = await probeWithTimeout({ definition, installation: record });
    if (health.version) {
      record.lastKnownVersion = health.version;
      record.updatedAt = new Date().toISOString();
      await this.installs.save(this.installations);
    }
    this.healthById.set(record.id, health);
    this.events.onHealthUpdated?.(record.id);
    return health;
  }

  async probeAll() {
    const results = [];
    for (const record of [...this.installations]) {
      results.push(await this.probeInstallation(record.id));
    }
    return results;
  }

  async start(installationId: string) {
    const record = this.installations.find((r) => r.id === installationId);
    const definition = record && this.definitionFor(record.productId);
    if (!record || !definition) {
      throw new ManagerError(ErrorCode.NotFound, "未找到该登记记录。");
    }
    await this.supervisor.start(definition, record);
    const health = await this.probeInstallation(record.id);
    return health;
  }

  async stopProduct(installationId: string): Promise<void> {
    const record = this.installations.find((r) => r.id === installationId);
    const definition = record && this.definitionFor(record.productId);
    if (!record || !definition) return;
    await this.supervisor.stop(definition, record);
  }

  async stop(installationId: string) {
    const record = this.installations.find((r) => r.id === installationId);
    if (!record) throw new ManagerError(ErrorCode.NotFound, "未找到该登记记录。");
    await this.stopProduct(record.id);
    return this.probeInstallation(record.id);
  }

  // ---------- registration ----------

  async register(params: {
    productId: string;
    path: string;
    endpointOverride?: string;
  }): Promise<InstallationRecord> {
    const definition = this.definitionFor(params.productId);
    if (!definition) {
      throw new ManagerError(ErrorCode.NotFound, `目录中没有产品 ${params.productId}。`);
    }
    if (!definition.allowMultipleInstances) {
      const existing = this.installations.find(
        (r) => r.productId === params.productId,
      );
      if (existing) {
        throw new ManagerError(
          ErrorCode.AlreadyInstalled,
          `${definition.name} 已登记（${existing.path}），请先注销旧记录。`,
        );
      }
    }
    const path = params.path.trim().replace(/^"(.*)"$/, "$1");
    const expected = definition.expectedArtifact;
    const artifactOk =
      definition.delivery === "bun-script"
        ? existsSync(join(path, "src", "index.ts"))
        : expected
          ? artifactMatches(path, expected)
          : existsSync(path);
    if (!artifactOk) {
      throw new ManagerError(
        ErrorCode.ExecutableMissing,
        `路径 ${path} 未找到期望的组件产物${expected ? `（${expected}）` : ""}。`,
      );
    }
    const record: InstallationRecord = {
      id: newInstallationId(params.productId, !!definition.allowMultipleInstances),
      productId: params.productId,
      path,
      endpointOverride: params.endpointOverride?.trim() || undefined,
      registeredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      platform:
        process.platform === "win32"
          ? "windows"
          : process.platform === "darwin"
            ? "macos"
            : "linux",
      architecture: process.arch === "arm64" ? "arm64" : "x64",
      source: "manual",
      ownership: "legacy-unmanaged",
    };
    this.installations.push(record);
    await this.installs.save(this.installations);
    this.events.onSnapshotChanged?.("installations");
    this.logs.append("success", `已登记 ${definition.name}：${path}`, {
      installationId: record.id,
    });
    return record;
  }

  async unregister(params: {
    installationId: string;
    confirmed: boolean;
  }): Promise<InstallationRecord> {
    const idx = this.installations.findIndex((r) => r.id === params.installationId);
    if (idx === -1) throw new ManagerError(ErrorCode.NotFound, "未找到该登记记录。");
    if (!params.confirmed) {
      throw new ManagerError(
        ErrorCode.InvalidArgument,
        "注销登记需要明确确认。",
      );
    }
    const [record] = this.installations.splice(idx, 1);
    await this.installs.save(this.installations);
    this.events.onSnapshotChanged?.("installations");
    this.logs.append("info", `已注销登记 ${record.id}（不删除磁盘文件）。`, {
      installationId: record.id,
    });
    return record;
  }

  // ---------- operations ----------

  private requireInstallation(installationId: string): InstallationRecord {
    const record = this.installations.find((r) => r.id === installationId);
    if (!record) throw new ManagerError(ErrorCode.NotFound, "未找到该登记记录。");
    return record;
  }

  private installTask(params: {
    mode: "install" | "update" | "repair";
    productId: string;
    installationId?: string;
    version?: string;
    channel?: string;
    force?: boolean;
    previousVersion?: string;
  }): TaskDefinition {
    return {
      kind: params.mode,
      productId: params.productId,
      installationId: params.installationId,
      releaseId: params.version,
      previousVersion: params.previousVersion,
      message:
        params.mode === "repair"
          ? `修复 ${params.productId}`
          : `${params.mode === "install" ? "安装" : "更新"} ${params.productId}${params.version ? ` → ${params.version}` : ""}`,
      run: async (handle) => {
        const pinnedVersion = params.version;
        const result = await runInstallFlow(handle, {
          installRoot: await this.settings.installRoot(),
          downloadDir: this.settings.paths.downloadDir,
          catalog: () => this.catalog.manifest(),
          resolveActiveVersion: async (pid) =>
            activeVersionOf(await this.settings.installRoot(), pid),
          log: (message, operationId) => this.logs.append("info", message, { operationId }),
          stopProduct: async (installationId) => this.stopProduct(installationId),
        }, {
          ...params,
          version: pinnedVersion,
          // 指定版本重装/重试时允许覆盖同版本或降级。
          force: pinnedVersion !== undefined,
        });
        handle.update({
          message: `完成：${result.version}`,
          progress: 95,
        });
        // Adopt or update the installation record.
        const settings = await this.settings.load();
        await this.adoptManagedInstallation(
          params.productId,
          result.version,
          result.path,
          params.installationId,
          settings,
        );
      },
    };
  }

  private async adoptManagedInstallation(
    productId: string,
    version: string,
    path: string,
    installationId: string | undefined,
    settings: AppSettings,
  ): Promise<void> {
    const existing = installationId
      ? this.installations.find((r) => r.id === installationId)
      : this.installations.find((r) => r.productId === productId);
    if (existing) {
      existing.lastKnownVersion = version;
      existing.activeVersion = version;
      existing.installedVersion = version;
      existing.path = path;
      existing.ownership = "manager-managed";
      existing.source = "catalog";
      existing.updatedAt = new Date().toISOString();
      await this.installs.save(this.installations);
      return;
    }
    const definition = this.definitionFor(productId);
    const record: InstallationRecord = {
      id: newInstallationId(productId, !!definition?.allowMultipleInstances),
      productId,
      path,
      registeredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastKnownVersion: version,
      platform: settings ? (process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux") : "windows",
      architecture: process.arch === "arm64" ? "arm64" : "x64",
      source: "catalog",
      ownership: "manager-managed",
    };
    this.installations.push(record);
    await this.installs.save(this.installations);
    this.events.onSnapshotChanged?.("installations");
  }

  install(params: OperationRequest) {
    return this.queue.enqueue(
      this.installTask({ mode: "install", ...params }),
    );
  }

  update(params: OperationRequest) {
    const record = params.installationId
      ? this.requireInstallation(params.installationId)
      : undefined;
    return this.queue.enqueue(
      this.installTask({
        mode: "update",
        ...params,
        previousVersion: record?.lastKnownVersion,
      }),
    );
  }

  repair(params: OperationRequest) {
    return this.queue.enqueue(this.installTask({ mode: "repair", ...params }));
  }

  async uninstall(params: {
    installationId: string;
    confirmed?: boolean;
    deleteFiles?: boolean;
  }) {
    const record = this.requireInstallation(params.installationId);
    if (!params.confirmed) {
      throw new ManagerError(
        ErrorCode.InvalidArgument,
        "卸载需要明确确认。",
      );
    }
    const definition = this.definitionFor(record.productId);
    const task: TaskDefinition = {
      kind: "uninstall",
      productId: record.productId,
      installationId: record.id,
      previousVersion: record.lastKnownVersion,
      message: `卸载 ${record.productId}`,
      run: async (handle) => {
        handle.update({ phase: "staging", message: "停止运行中的实例…" });
        await this.stopProduct(record.id);
        const installRoot = await this.settings.installRoot();
        if (params.deleteFiles && record.ownership === "manager-managed") {
          handle.update({ phase: "cleaning-up", message: "删除版本目录…" });
          await removeManagedProduct(installRoot, record.productId);
          this.logs.append("success", `已删除 ${productDir(installRoot, record.productId)}`, {
            operationId: handle.record.id,
          });
        } else if (params.deleteFiles && record.ownership !== "manager-managed") {
          throw new ManagerError(
            ErrorCode.LegacyProtected,
            "该记录为 legacy 登记，未托管安装目录，仅允许注销登记。",
          );
        }
        handle.update({ phase: "cleaning-up", message: "移除登记…" });
        this.installations = this.installations.filter((r) => r.id !== record.id);
        await this.installs.save(this.installations);
        this.healthById.delete(record.id);
        this.events.onSnapshotChanged?.("installations");
        this.logs.append("success", `卸载完成：${definition?.name ?? record.productId}`, {
          installationId: record.id,
        });
      },
    };
    return this.queue.enqueue(task);
  }

  async batchUpdate(installationIds: string[]) {
    const records = installationIds.map((id) => this.requireInstallation(id));
    return records.map((record) =>
      this.queue.enqueue(
        this.installTask({
          mode: "update",
          productId: record.productId,
          installationId: record.id,
          previousVersion: record.lastKnownVersion,
        }),
      ),
    );
  }

  /** Re-dispatches a failed/cancelled/rolled-back operation as a new one. */
  retryOperation(operationId: string) {
    const previous = this.queue.get(operationId);
    if (!previous) throw new ManagerError(ErrorCode.NotFound, "操作不存在。");
    switch (previous.kind) {
      case "install":
        return this.install({
          kind: "install",
          productId: previous.productId,
          installationId: previous.installationId,
          version: previous.releaseId,
        });
      case "update":
        return this.update({
          kind: "update",
          productId: previous.productId,
          installationId: previous.installationId,
          version: previous.releaseId,
        });
      case "repair":
        return this.repair({
          kind: "repair",
          productId: previous.productId,
          installationId: previous.installationId,
        });
      case "uninstall":
        return this.uninstall({
          installationId: previous.installationId ?? "",
          confirmed: true,
          deleteFiles: false,
        });
      default:
        throw new ManagerError(
          ErrorCode.InvalidArgument,
          `不支持重试的操作类型 ${previous.kind}。`,
        );
    }
  }

  async applySettings(settings: AppSettings): Promise<AppSettings> {
    const saved = await this.settings.save(settings);
    this.queue.setConcurrency(saved.operationConcurrency);
    if (this.catalog instanceof ConfiguredCatalogClient) {
      (this.catalog as unknown as { _catalogUrl: string | null })._catalogUrl =
        saved.catalogUrl || null;
    }
    this.events.onSnapshotChanged?.("settings");
    return saved;
  }

  async activeVersion(installationId: string): Promise<string | null> {
    const record = this.requireInstallation(installationId);
    return activeVersionOf(await this.settings.installRoot(), record.productId);
  }
}

/** Wildcard-aware artifact existence (same rules as probes). */
function artifactMatches(path: string, expected: string): boolean {
  if (expected.includes("*")) {
    const re = new RegExp(
      `^${expected.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
      "i",
    );
    try {
      return readdirSync(path).some((n) => re.test(n));
    } catch {
      return false;
    }
  }
  return existsSync(join(path, expected)) || existsSync(path);
}
