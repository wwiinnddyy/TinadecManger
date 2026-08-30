/**
 * Atomic JSON persistence with corrupt-safe reads (mirrors the legacy
 * InstallRegistry/SettingsStore behavior): temp file + rename, and a
 * corrupted file is preserved as `.bak` while defaults are returned.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function writeJsonAtomic(
  path: string,
  value: unknown,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const json = JSON.stringify(value, null, 2);
  await writeFile(tmp, json, "utf8");
  await rename(tmp, path);
}

export async function readJsonWithBackup<T>(
  path: string,
  fallback: () => T,
  isShapeValid: (value: unknown) => boolean = () => true,
): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return fallback();
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isShapeValid(parsed)) throw new Error("shape");
    return parsed as T;
  } catch {
    try {
      await rename(path, `${path}.bak`);
    } catch {
      // best-effort backup
    }
    return fallback();
  }
}
