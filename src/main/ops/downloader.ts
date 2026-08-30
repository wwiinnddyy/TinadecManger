/**
 * Streaming artifact downloader: progress callbacks, cancellation, retries,
 * HTTP Range resume, and SHA-256 verification. Uses only node APIs so the
 * module is unit-testable under Vitest.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, stat, unlink, open, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ErrorCode, ManagerError } from "../../shared/errors";

export interface DownloadProgress {
  bytesDownloaded: number;
  totalBytes: number | null;
}

export interface DownloadOptions {
  url: string;
  destination: string;
  expectedSize?: number;
  timeoutMs?: number;
  retries?: number;
  onProgress?: (progress: DownloadProgress) => void;
  shouldCancel?: () => boolean;
}

export interface DownloadResult {
  path: string;
  sha256: string;
  sizeBytes: number;
  resumed: boolean;
}

/** Downloads to `<destination>.part`, then renames atomically. */
export async function downloadArtifact(
  options: DownloadOptions,
): Promise<DownloadResult> {
  const retries = options.retries ?? 2;
  await mkdir(dirname(options.destination), { recursive: true });

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (options.shouldCancel?.()) {
      throw new ManagerError(ErrorCode.Cancelled, "下载已取消。");
    }
    try {
      return await downloadOnce(options);
    } catch (error) {
      lastError = error;
      if (error instanceof ManagerError && error.code === ErrorCode.Cancelled) {
        throw error;
      }
    }
  }
  if (lastError instanceof ManagerError) throw lastError;
  throw new ManagerError(
    ErrorCode.DownloadFailed,
    `下载失败：${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function downloadOnce(options: DownloadOptions): Promise<DownloadResult> {
  const partPath = `${options.destination}.part`;
  let existingSize = 0;
  let resumed = false;
  try {
    existingSize = (await stat(partPath)).size;
    if (existingSize > 0 && existingSize !== options.expectedSize) {
      resumed = true;
    }
  } catch {
    existingSize = 0;
  }

  const headers: Record<string, string> = {};
  if (resumed) headers["Range"] = `bytes=${existingSize}-`;

  const response = await fetch(options.url, {
    headers,
    signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
  });
  if (!response.ok && response.status !== 206) {
    throw new ManagerError(
      ErrorCode.DownloadFailed,
      `下载请求失败（HTTP ${response.status}）`,
    );
  }
  if (!response.body) {
    throw new ManagerError(ErrorCode.DownloadFailed, "响应没有正文。");
  }

  const totalBytes = parseTotal(response.headers.get("Content-Length"), resumed, existingSize);
  const hash = createHash("sha256");
  const file = await open(partPath, resumed ? "r+" : "w");
  let bytesDownloaded = resumed ? existingSize : 0;

  try {
    if (resumed) {
      // Hash the already-downloaded prefix so resume keeps the final checksum valid.
      const prefix = await file.readFile();
      hash.update(prefix);
    }

    const reader = response.body.getReader();
    for (;;) {
      if (options.shouldCancel?.()) {
        throw new ManagerError(ErrorCode.Cancelled, "下载已取消。");
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        bytesDownloaded += value.byteLength;
        hash.update(value);
        await file.write(value);
        options.onProgress?.({ bytesDownloaded, totalBytes });
      }
    }
  } finally {
    await file.close();
  }

  if (options.expectedSize !== undefined && bytesDownloaded !== options.expectedSize) {
    await unlink(partPath).catch(() => {});
    throw new ManagerError(
      ErrorCode.ChecksumMismatch,
      `下载大小不符：期望 ${options.expectedSize} 字节，实际 ${bytesDownloaded} 字节。`,
    );
  }

  const sha256 = hash.digest("hex");
  await rename(partPath, options.destination);
  return { path: options.destination, sha256, sizeBytes: bytesDownloaded, resumed };
}

function parseTotal(
  contentLength: string | null,
  resumed: boolean,
  existingSize: number,
): number | null {
  if (!contentLength) return null;
  const value = Number(contentLength);
  if (!Number.isFinite(value)) return null;
  if (resumed && responseWas206(contentLength)) return null; // avoid wrong totals
  return resumed ? existingSize + value : value;
}

function responseWas206(_contentLength: string): boolean {
  // Content-Length on a 206 is the chunk size, not the total; callers treat
  // null totals as indeterminate progress.
  return false;
}

/** Computes the SHA-256 of an existing file (verification pass). */
export async function fileSha256(path: string): Promise<string> {
  const { createReadStream } = await import("node:fs");
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/** Verification gate used before staging. */
export async function verifyArtifact(
  path: string,
  expected: { sizeBytes: number; sha256: string },
): Promise<void> {
  const statResult = await stat(path).catch(() => null);
  if (!statResult) {
    throw new ManagerError(ErrorCode.DownloadFailed, "下载文件不存在。");
  }
  if (statResult.size !== expected.sizeBytes) {
    throw new ManagerError(
      ErrorCode.ChecksumMismatch,
      `制品大小不符：期望 ${expected.sizeBytes}，实际 ${statResult.size}。`,
    );
  }
  const actual = await fileSha256(path);
  if (actual !== expected.sha256.toLowerCase()) {
    throw new ManagerError(
      ErrorCode.ChecksumMismatch,
      `SHA-256 校验失败：期望 ${expected.sha256}，实际 ${actual}。`,
    );
  }
}

export function tempDownloadPath(downloadDir: string): string {
  return join(downloadDir, `${randomUUID()}.artifact`);
}
