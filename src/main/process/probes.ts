/**
 * Health probes ported from the legacy ProcessProbe / HttpHealthProbe /
 * FileProbe behaviors (see docs/legacy-behavior-notes.md):
 * - HTTP: endpointOverride wins; 503/connection-refused → stopped;
 *   timeout → unhealthy; non-2xx → running (upstream may be unreachable);
 *   2xx → parse body JSON `version`; `"ok"` or version present → running.
 * - Process: enumerate by process name; artifact presence distinguishes
 *   stopped vs not-installed. Wildcard artifacts matched at top level.
 * - File: registration path existence only.
 */

import { execFile } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
  HealthSnapshot,
  InstallationRecord,
  ProbeKind,
  ProductDefinition,
} from "../../shared/domain";

const PROBE_TIMEOUT_MS = 2000;

export interface ProbeContext {
  definition: ProductDefinition;
  installation?: InstallationRecord;
}

function nowSnapshot(
  ctx: ProbeContext,
  status: HealthSnapshot["status"],
  message: string,
  extra?: Partial<HealthSnapshot>,
): HealthSnapshot {
  return {
    installationId: ctx.installation?.id ?? ctx.definition.id,
    productId: ctx.definition.id,
    status,
    checkedAt: new Date().toISOString(),
    message,
    ...extra,
  };
}

async function probeHttp(ctx: ProbeContext): Promise<HealthSnapshot> {
  const url = ctx.installation?.endpointOverride || ctx.definition.probeTarget;
  const host = safeHost(url);
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (response.status === 503) {
      return nowSnapshot(ctx, "stopped", `${host} 返回 503：服务不可用。`, {
        endpoint: url,
      });
    }
    const body = await response.text();
    if (!response.ok) {
      return nowSnapshot(
        ctx,
        "running",
        `${host} 存活（HTTP ${response.status}），上游可能不可达。`,
        { endpoint: url },
      );
    }
    const version = tryReadVersion(body);
    const running = body.includes('"ok"') || version !== null;
    return nowSnapshot(
      ctx,
      running ? "running" : "unhealthy",
      running ? `${host} 运行中，上游可达。` : `${host} 有响应但内容非预期。`,
      { endpoint: url, version: version ?? undefined },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return nowSnapshot(ctx, "unhealthy", `${host} 探测超时。`, {
        endpoint: url,
      });
    }
    return nowSnapshot(ctx, "stopped", `${host} 未运行或拒绝连接。`, {
      endpoint: url,
    });
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function tryReadVersion(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

/** Mirrors legacy ProcessProbe.ArtifactExists (wildcard-aware, top-level). */
export function artifactExists(path: string, expectedArtifact: string): boolean {
  if (expectedArtifact.trim().length === 0) {
    return existsSync(path);
  }
  if (expectedArtifact.includes("*")) {
    if (!existsSync(path) || !statSync(path).isDirectory()) return false;
    return matchWildcard(path, expectedArtifact);
  }
  return existsSync(join(path, expectedArtifact)) || existsSync(path);
}

function matchWildcard(dir: string, pattern: string): boolean {
  const re = new RegExp(
    `^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
    "i",
  );
  try {
    return readdirSync(dir).some((name) => re.test(name));
  } catch {
    return false;
  }
}

function listProcesses(name: string): Promise<string[]> {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      execFile(
        "tasklist",
        ["/FI", `IMAGENAME eq ${name}*`, "/FO", "CSV", "/NH"],
        { timeout: 3000 },
        (error, stdout) => {
          if (error) return resolve([]);
          const names = stdout
            .split("\n")
            .map((line) => line.split('","')[0]?.replace(/^"/, "").trim())
            .filter((n): n is string => !!n && n.toLowerCase().startsWith(name.toLowerCase()));
          resolve(names);
        },
      );
    } else {
      execFile("pgrep", ["-f", name], { timeout: 3000 }, (error, stdout) => {
        if (error) return resolve([]);
        resolve(stdout.split("\n").filter(Boolean));
      });
    }
  });
}

async function probeProcess(ctx: ProbeContext): Promise<HealthSnapshot> {
  const artifactPresent = ctx.installation
    ? artifactExists(ctx.installation.path, ctx.definition.expectedArtifact)
    : false;
  let running = false;
  try {
    const processes = await listProcesses(ctx.definition.probeTarget);
    running = processes.length > 0;
  } catch {
    running = false;
  }
  if (running) {
    return nowSnapshot(ctx, "running", `进程 ${ctx.definition.probeTarget} 正在运行。`);
  }
  if (artifactPresent) {
    return nowSnapshot(ctx, "stopped", "已安装，未运行。");
  }
  return nowSnapshot(ctx, "not-installed", "未找到组件文件。");
}

function probeFile(ctx: ProbeContext): HealthSnapshot {
  if (!ctx.installation) {
    return nowSnapshot(ctx, "not-installed", "未注册。");
  }
  const present =
    existsSync(ctx.installation.path) &&
    (statSync(ctx.installation.path).isDirectory() ||
      statSync(ctx.installation.path).isFile());
  return nowSnapshot(
    ctx,
    present ? "stopped" : "not-installed",
    present ? "已安装。" : "注册路径不存在。",
  );
}

export async function probe(ctx: ProbeContext): Promise<HealthSnapshot> {
  switch (ctx.definition.probe as ProbeKind) {
    case "http-health":
      return probeHttp(ctx);
    case "process-name":
      return probeProcess(ctx);
    case "file-only":
    default:
      return probeFile(ctx);
  }
}

/** Wraps a probe with the legacy 2s total timeout. */
export async function probeWithTimeout(
  ctx: ProbeContext,
): Promise<HealthSnapshot> {
  try {
    return await Promise.race([
      probe(ctx),
      new Promise<HealthSnapshot>((resolve) =>
        setTimeout(
          () =>
            resolve(
              nowSnapshot(ctx, "unhealthy", "探测超时。"),
            ),
          PROBE_TIMEOUT_MS + 500,
        ),
      ),
    ]);
  } catch {
    return nowSnapshot(ctx, "unhealthy", "探测异常。");
  }
}
