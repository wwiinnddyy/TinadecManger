/**
 * Path safety helpers (pure). Used to reject archive entries that escape the
 * extraction root and user paths that would traverse outside an install root.
 * Only the main process and tests import the resolve-based helpers; the
 * renderer never bundles this module.
 */

import { resolve, sep } from "node:path";

/** Normalizes a relative path and rejects absolute paths, drive letters, and traversal. */
export function isSafeRelativePath(input: string): boolean {
  if (input.length === 0) return false;
  // Windows drive letters and UNC paths.
  if (/^[a-zA-Z]:[\\/]/.test(input) || input.startsWith("\\\\")) return false;
  if (input.startsWith("/") || input.startsWith("\\")) return false;
  const parts = input.split(/[\\/]/);
  for (const part of parts) {
    if (part === "..") return false;
    if (part === "") continue; // trailing/duplicated separators are tolerated
    if (/^(?:com|prn|aux|nul|con|lpt[1-9]|com[1-9])$/i.test(part)) return false;
  }
  return parts.some((p) => p !== "");
}

/**
 * Joins a base directory and a relative entry, asserting the result stays
 * inside the base. Throws `PathTraversalError` otherwise.
 */
export function joinUnderRoot(root: string, relative: string): string {
  if (!isSafeRelativePath(relative)) {
    throw new PathTraversalError(relative);
  }
  const resolvedRoot = resolve(root);
  const joined = resolve(resolvedRoot, relative);
  if (!joined.startsWith(resolvedRoot + sep) && joined !== resolvedRoot) {
    throw new PathTraversalError(relative);
  }
  return joined;
}

export class PathTraversalError extends Error {
  readonly entry: string;
  constructor(entry: string) {
    super(`归档条目越界：${entry}`);
    this.name = "PathTraversalError";
    this.entry = entry;
  }
}

/** Picks platform/arch keys for catalog filtering. */
export function currentPlatform(): "windows" | "macos" | "linux" {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    default:
      throw new Error(`不支持的平台：${process.platform}`);
  }
}

export function currentArchitecture(): "x64" | "arm64" {
  return process.arch === "arm64" ? "arm64" : "x64";
}
