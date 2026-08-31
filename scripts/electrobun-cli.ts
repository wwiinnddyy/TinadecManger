/**
 * Electrobun CLI launcher.
 *
 * The published `electrobun` bin is a Node shim that extracts its downloaded
 * native CLI with `tar -xzf "<absolute path>"`. GNU tar reads the `C:` of that
 * path as a remote host, so on Windows the first run must resolve `tar` to
 * bsdtar. The native CLI works around the same quirk internally by passing a
 * relative path; the shim does not.
 *
 * Also usable directly: `bun scripts/electrobun-cli.ts build --env=stable`.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function electrobunBinPath(): string {
  return join(
    root,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "electrobun.exe" : "electrobun",
  );
}

/** Env with Windows' System32 ahead of any GNU tar, for Electrobun's own shell-outs. */
export function electrobunEnv(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (process.platform !== "win32") return { ...base };
  const system32 = join(base.SystemRoot ?? "C:\\Windows", "System32");
  return { ...base, PATH: `${system32};${base.PATH ?? ""}` };
}

export function spawnElectrobun(
  args: string[],
  extraEnv: Record<string, string> = {},
): Bun.Subprocess {
  return Bun.spawn([electrobunBinPath(), ...args], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    env: { ...electrobunEnv(), ...extraEnv },
  });
}

export async function runElectrobun(args: string[]): Promise<number> {
  const bin = electrobunBinPath();
  if (!existsSync(bin)) {
    console.error(`[electrobun] CLI is missing at ${bin} — run \`bun install\`.`);
    return 1;
  }
  return (await spawnElectrobun(args).exited) ?? 0;
}

if (import.meta.main) {
  process.exit(await runElectrobun(process.argv.slice(2)));
}
