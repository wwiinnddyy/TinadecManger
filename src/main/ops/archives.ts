/**
 * Archive extraction using the platform `tar` binary (Windows ships bsdtar at
 * C:\Windows\System32\tar.exe, which understands both zip and tar.gz).
 * Entries are listed and validated against path-traversal rules *before*
 * extraction, and extraction happens into a dedicated staging directory.
 */

import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { ErrorCode, ManagerError } from "../../shared/errors";
import { isSafeRelativePath } from "../../shared/path-safety";

function runTar(args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("tar", args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(
          new ManagerError(
            ErrorCode.ArchiveInvalid,
            `解包失败：${stderr?.trim() || error.message}`,
          ),
        );
        return;
      }
      resolve(stdout);
    });
  });
}

export function artifactNeedsExtraction(format: string): boolean {
  return format === "zip" || format === "tar-gz";
}

/** Lists archive entries and rejects any that would escape the staging root. */
export async function listArchiveEntries(
  archivePath: string,
): Promise<string[]> {
  const stdout = await runTar(["-tf", archivePath]);
  const entries = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const entry of entries) {
    if (!isSafeRelativePath(entry)) {
      throw new ManagerError(
        ErrorCode.PathTraversal,
        `归档包含越界条目：${entry}`,
      );
    }
  }
  return entries;
}

export async function extractArchive(
  archivePath: string,
  stagingDir: string,
): Promise<void> {
  await listArchiveEntries(archivePath);
  await mkdir(stagingDir, { recursive: true });
  await runTar(["-xf", archivePath, "-C", stagingDir]);
}
