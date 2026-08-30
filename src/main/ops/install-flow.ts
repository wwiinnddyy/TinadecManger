/**
 * Install/update/repair/uninstall flow.
 *
 * Layout under the install root:
 *   <installRoot>/<productId>/
 *     versions/<version>/   ← extracted content, one dir per version
 *     active.json           ← atomic pointer { version, path, updatedAt }
 *     staging-<opId>/       ← transient, removed after activation
 *
 * Update = download new version into versions/, flip active.json. The old
 * version directory is kept, so any failure after activation restores the
 * previous pointer (rollback) instead of deleting content.
 */

import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  Artifact,
  CatalogManifest,
  Release,
} from "../../shared/domain";
import {
  ErrorCode,
  ManagerError,
} from "../../shared/errors";
import { currentArchitecture, currentPlatform } from "../../shared/path-safety";
import { compareVersions } from "../../shared/semver";
import type { OperationHandle } from "./operation-queue";
import { downloadArtifact, verifyArtifact } from "./downloader";
import { artifactNeedsExtraction, extractArchive } from "./archives";

export interface ActivePointer {
  version: string;
  path: string;
  releaseId?: string;
  updatedAt: string;
}

export function productDir(installRoot: string, productId: string): string {
  return join(installRoot, productId);
}

export function versionsDir(installRoot: string, productId: string): string {
  return join(productDir(installRoot, productId), "versions");
}

export async function readActivePointer(
  installRoot: string,
  productId: string,
): Promise<ActivePointer | null> {
  const pointerPath = join(productDir(installRoot, productId), "active.json");
  try {
    const raw = await readFile(pointerPath, "utf8");
    return JSON.parse(raw) as ActivePointer;
  } catch {
    return null;
  }
}

export async function writeActivePointer(
  installRoot: string,
  productId: string,
  pointer: ActivePointer,
): Promise<void> {
  const pointerPath = join(productDir(installRoot, productId), "active.json");
  const tmp = `${pointerPath}.tmp`;
  await writeFile(tmp, JSON.stringify(pointer, null, 2), "utf8");
  await rename(tmp, pointerPath);
}

export function pickArtifact(
  release: Release,
  platform = currentPlatform(),
  architecture = currentArchitecture(),
): Artifact {
  const exact = release.artifacts.find(
    (a) => a.platform === platform && a.architecture === architecture,
  );
  if (exact) return exact;
  const anyArch = release.artifacts.find(
    (a) => a.platform === platform && a.architecture === "x64",
  );
  if (anyArch) return anyArch;
  throw new ManagerError(
    ErrorCode.UnsupportedPlatform,
    `版本 ${release.version} 没有适用于 ${platform}/${architecture} 的制品。`,
  );
}

/** Manager app version, used for minimumManagerVersion gates. */
export const APP_VERSION = "0.1.0";

export function findRelease(
  manifest: CatalogManifest,
  productId: string,
  version?: string,
  channel?: string,
): { product: CatalogManifest["products"][number]; release: Release } {
  const product = manifest.products.find((p) => p.id === productId);
  if (!product) {
    throw new ManagerError(ErrorCode.NotFound, `目录中没有产品 ${productId}。`);
  }
  const candidates = product.releases.filter(
    (r) => !channel || r.channel === channel,
  );
  if (candidates.length === 0) {
    throw new ManagerError(
      ErrorCode.NotFound,
      `产品 ${productId} 在 ${channel ?? "任意"} 渠道没有可用版本。`,
    );
  }
  let release: Release;
  if (version) {
    const found = candidates.find((r) => r.version === version);
    if (!found) {
      throw new ManagerError(
        ErrorCode.NotFound,
        `产品 ${productId} 没有版本 ${version}。`,
      );
    }
    release = found;
  } else {
    release = candidates.reduce((best, r) =>
      compareVersions(r.version, best.version) > 0 ? r : best,
    );
  }
  if (
    release.minimumManagerVersion &&
    compareVersions(release.minimumManagerVersion, APP_VERSION) > 0
  ) {
    throw new ManagerError(
      ErrorCode.MinimumManagerVersion,
      `版本 ${release.version} 需要管理器 ≥ ${release.minimumManagerVersion}，当前 ${APP_VERSION}。`,
    );
  }
  return { product, release };
}

/** Checks catalog dependencies are satisfied by installed/active versions. */
export async function assertDependencies(
  manifest: CatalogManifest,
  release: Release,
  resolveActiveVersion: (productId: string) => Promise<string | null>,
): Promise<void> {
  for (const dep of release.dependencies ?? []) {
    const active = await resolveActiveVersion(dep.productId);
    if (!active) {
      throw new ManagerError(
        ErrorCode.DependencyUnsatisfied,
        `缺少依赖 ${dep.productId}（要求 ${dep.versionRange}），请先安装。`,
      );
    }
    const { satisfiesRange } = await import("../../shared/semver");
    if (!satisfiesRange(active, dep.versionRange)) {
      throw new ManagerError(
        ErrorCode.DependencyUnsatisfied,
        `依赖 ${dep.productId} 当前 ${active}，不满足 ${dep.versionRange}。`,
      );
    }
  }
  void manifest;
}

export interface InstallFlowDeps {
  installRoot: string;
  downloadDir: string;
  catalog: () => CatalogManifest;
  resolveActiveVersion: (productId: string) => Promise<string | null>;
  log: (message: string, operationId: string) => void;
  /** stop running processes before activation (injected to avoid cycles) */
  stopProduct: (installationId: string) => Promise<void>;
}

/**
 * Runs a full install/update/repair. `mode` decides pointer semantics:
 * - install/update: refuse downgrade unless force; keep previous pointer on failure
 * - repair: re-activate the same version (re-extract) without version checks
 */
export async function runInstallFlow(
  handle: OperationHandle,
  deps: InstallFlowDeps,
  params: {
    mode: "install" | "update" | "repair";
    productId: string;
    installationId?: string;
    version?: string;
    channel?: string;
    force?: boolean;
  },
): Promise<{ version: string; path: string }> {
  const { record, update, throwIfCancelled } = handle;
  const manifest = deps.catalog();
  const { product, release } = findRelease(
    manifest,
    params.productId,
    params.version,
    params.channel,
  );
  const artifact = pickArtifact(release);

  // Dependency gate (fail closed).
  await assertDependencies(manifest, release, deps.resolveActiveVersion);

  const previous = await readActivePointer(deps.installRoot, params.productId);
  if (
    params.mode !== "repair" &&
    previous &&
    compareVersions(release.version, previous.version) <= 0 &&
    !params.force
  ) {
    throw new ManagerError(
      ErrorCode.AlreadyInstalled,
      `已安装 ${previous.version}，目标 ${release.version} 不是更新。`,
    );
  }

  const pdir = productDir(deps.installRoot, params.productId);
  const staging = join(pdir, `staging-${record.id}`);
  const targetVersionDir = join(versionsDir(deps.installRoot, params.productId), release.version);

  try {
    // ---- download ----
    update({ phase: "downloading", message: `下载 ${artifact.url}` });
    const downloadPath = join(deps.downloadDir, `${record.id}.artifact`);
    const result = await downloadArtifact({
      url: artifact.url,
      destination: downloadPath,
      expectedSize: artifact.sizeBytes,
      onProgress: (progress) => {
        update({
          bytesDownloaded: progress.bytesDownloaded,
          totalBytes: progress.totalBytes ?? undefined,
          progress:
            progress.totalBytes && progress.totalBytes > 0
              ? Math.min(49, Math.round((progress.bytesDownloaded / progress.totalBytes) * 49))
              : 25,
        });
      },
      shouldCancel: () => handle.abort.cancelled,
    });
    throwIfCancelled();
    deps.log(`下载完成（${result.sizeBytes} 字节${result.resumed ? "，断点续传" : ""}）。`, record.id);

    // ---- verify ----
    update({ phase: "verifying", message: "校验大小与 SHA-256…", progress: 55 });
    await verifyArtifact(downloadPath, {
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
    });
    deps.log("SHA-256 校验通过。", record.id);

    // ---- stage ----
    update({ phase: "staging", message: "解包到暂存目录…", progress: 65 });
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    if (artifactNeedsExtraction(artifact.format)) {
      await extractArchive(downloadPath, staging);
    } else {
      await cp(downloadPath, join(staging, artifact.id), {});
      deps.log("制品为单文件交付，已复制到暂存目录。", record.id);
    }
    throwIfCancelled();

    // Expected artifact must exist post-extract (verification pass).
    if (
      product.expectedArtifact &&
      product.expectedArtifact.length > 0 &&
      !existsSync(join(staging, product.expectedArtifact)) &&
      !expectedArtifactWildcardMatches(staging, product.expectedArtifact)
    ) {
      throw new ManagerError(
        ErrorCode.VerificationFailed,
        `暂存目录缺少期望产物 ${product.expectedArtifact}。`,
      );
    }
    update({ phase: "staging", message: "暂存完成。", progress: 75 });

    // ---- stop running instances before switching ----
    if (params.installationId) {
      update({ message: "停止运行中的实例…" });
      await deps.stopProduct(params.installationId);
    }

    // ---- activate ----
    update({ phase: "installing", message: "写入版本并切换活动版本…", progress: 85 });
    await mkdir(versionsDir(deps.installRoot, params.productId), { recursive: true });
    await rm(targetVersionDir, { recursive: true, force: true });
    await rename(staging, targetVersionDir);
    const previousPointer = previous;
    try {
      await writeActivePointer(deps.installRoot, params.productId, {
        version: release.version,
        path: targetVersionDir,
        releaseId: release.id,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      // Rollback: restore previous pointer if the flip failed.
      update({ phase: "rolling-back", message: "切换失败，恢复上一版本…" });
      if (previousPointer) {
        await writeActivePointer(deps.installRoot, params.productId, previousPointer);
      }
      throw error;
    }
    deps.log(`活动版本已切换到 ${release.version}。`, record.id);
    return { version: release.version, path: targetVersionDir };
  } finally {
    // Best-effort cleanup of staging + download.
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    await rm(join(deps.downloadDir, `${record.id}.artifact`), { force: true }).catch(() => {});
  }
}

function expectedArtifactWildcardMatches(dir: string, pattern: string): boolean {
  if (!pattern.includes("*")) return false;
  const re = new RegExp(
    `^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
    "i",
  );
  try {
    return (
      existsSync(dir) && readdirSync(dir).some((n) => re.test(n))
    );
  } catch {
    return false;
  }
}

/** Ensures the install tree exists and the disk has headroom (best-effort). */
export async function assertDiskSpace(
  downloadDir: string,
  requiredBytes: number,
): Promise<void> {
  try {
    const { statfs } = await import("node:fs/promises");
    const fsStat = await statfs(downloadDir);
    const free = fsStat.bsize * fsStat.bavail;
    if (free < requiredBytes) {
      throw new ManagerError(
        ErrorCode.DiskFull,
        `磁盘空间不足：需要 ${requiredBytes} 字节，仅剩 ${free} 字节。`,
      );
    }
  } catch (error) {
    if (error instanceof ManagerError) throw error;
    // statfs unavailable on this platform — skip the check.
  }
}

export async function activeVersionOf(
  installRoot: string,
  productId: string,
): Promise<string | null> {
  const pointer = await readActivePointer(installRoot, productId);
  return pointer?.version ?? null;
}

/** Removes a manager-owned version tree (never legacy user directories). */
export async function removeManagedProduct(
  installRoot: string,
  productId: string,
): Promise<void> {
  const dir = productDir(installRoot, productId);
  const pointer = await readActivePointer(installRoot, productId);
  // Safety gate: only delete when an active.json pointer proves ownership.
  if (!pointer && !existsSync(join(dir, "active.json"))) {
    const statResult = await stat(dir).catch(() => null);
    if (statResult) {
      throw new ManagerError(
        ErrorCode.LegacyProtected,
        `目录 ${dir} 缺少 active.json，无法确认归属，拒绝删除。`,
      );
    }
  }
  await rm(dir, { recursive: true, force: true });
}
