/**
 * Process supervisor ported from the legacy ComponentLauncher:
 * - resolves executables (explicit → path-is-file → first non-manager .exe →
 *   extension-less apphost),
 * - launches with stdout/stderr captured into the log store,
 * - stop kills the exact process tree for children we launched; external
 *   processes are matched by name on Windows via taskkill /T.
 */

import { spawn, execFile, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  DeliveryKind,
  ProductDefinition,
  InstallationRecord,
} from "../../shared/domain";
import { ErrorCode, ManagerError } from "../../shared/errors";
import type { LogStore } from "../logs";

export interface LaunchResult {
  pid: number;
  command: string;
}

export class ProcessSupervisor {
  /** installation id → launched child */
  private launched = new Map<string, ChildProcess>();

  constructor(private readonly logs: LogStore) {}

  isRunning(installationId: string): boolean {
    const child = this.launched.get(installationId);
    return !!child && child.exitCode === null && child.signalCode === null;
  }

  async start(
    definition: ProductDefinition,
    installation: InstallationRecord,
  ): Promise<LaunchResult> {
    if (!definition.supportsStandaloneLaunch) {
      throw new ManagerError(
        ErrorCode.LaunchUnsupported,
        `${definition.name} 不支持独立启动（由 Core 作为子进程托管）。`,
      );
    }
    if (this.isRunning(installation.id)) {
      const existing = this.launched.get(installation.id)!;
      return { pid: existing.pid ?? -1, command: "already-running" };
    }

    let child: ChildProcess;
    const delivery = definition.delivery as DeliveryKind;
    if (
      delivery === "dotnet-publish-dir" ||
      delivery === "portable-exe" ||
      delivery === "native-exe"
    ) {
      const executable = resolveExecutable(installation);
      const cwd = existsSync(installation.path) && statSync(installation.path).isDirectory()
        ? installation.path
        : dirname(installation.path);
      child = spawn(executable, [], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
    } else if (delivery === "bun-script") {
      const entry = join(installation.path, "src", "index.ts");
      if (!existsSync(entry)) {
        throw new ManagerError(
          ErrorCode.ExecutableMissing,
          `未找到入口 ${entry}。`,
        );
      }
      const bun = process.platform === "win32" ? "bun.exe" : "bun";
      child = spawn(bun, ["run", entry], {
        cwd: installation.path,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
    } else {
      throw new ManagerError(
        ErrorCode.LaunchUnsupported,
        `${definition.delivery} 暂不支持启动。`,
      );
    }

    this.launched.set(installation.id, child);
    const command = `${child.spawnfile ?? ""} ${(child.spawnargs ?? []).join(" ")}`.trim();
    this.logs.append(
      "success",
      `已启动（PID ${child.pid}）：${command}`,
      { installationId: installation.id },
    );
    this.logs.append("info", "stdout/stderr 已接入日志。", {
      installationId: installation.id,
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (line.trim()) {
          this.logs.append("debug", line, { installationId: installation.id });
        }
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (line.trim()) {
          this.logs.append("warning", line, { installationId: installation.id });
        }
      }
    });
    child.on("exit", (code, signal) => {
      this.launched.delete(installation.id);
      this.logs.append(
        "info",
        `进程退出（ExitCode ${code ?? signal ?? -1}）。`,
        { installationId: installation.id },
      );
    });
    child.on("error", (error) => {
      this.launched.delete(installation.id);
      this.logs.append("error", `启动失败：${error.message}`, {
        installationId: installation.id,
      });
    });

    return { pid: child.pid ?? -1, command };
  }

  async stop(
    definition: ProductDefinition,
    installation: InstallationRecord,
  ): Promise<number> {
    this.logs.append("info", `请求停止 ${definition.name}…`, {
      installationId: installation.id,
    });
    const child = this.launched.get(installation.id);
    if (child) {
      this.launched.delete(installation.id);
      if (child.exitCode === null && child.signalCode === null) {
        await killTree(child.pid ?? -1);
        this.logs.append("success", `已停止（PID ${child.pid}）。`, {
          installationId: installation.id,
        });
        return 1;
      }
      this.logs.append("info", `进程已退出（PID ${child.pid}）。`, {
        installationId: installation.id,
      });
      return 0;
    }
    // External process: match by name (Windows) — same caveat as legacy.
    const killed = await killByName(definition.probeTarget);
    if (killed === 0) {
      this.logs.append(
        "warning",
        "未在运行（或无法定位非本程序启动的进程）。",
        { installationId: installation.id },
      );
      return 0;
    }
    this.logs.append("success", `已停止 ${killed} 个进程。`, {
      installationId: installation.id,
    });
    return killed;
  }

  stopAll(): void {
    for (const [id, child] of this.launched) {
      try {
        if (child.exitCode === null && child.signalCode === null) {
          killTree(child.pid ?? -1);
        }
      } catch {
        // ignore shutdown races
      }
      this.launched.delete(id);
    }
  }
}

export async function killTree(pid: number): Promise<void> {
  if (pid <= 0) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      execFile("taskkill", ["/PID", String(pid), "/T", "/F"], () => resolve());
    });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
  }
}

async function killByName(name: string): Promise<number> {
  if (process.platform !== "win32" || !name) return 0;
  return new Promise((resolve) => {
    execFile(
      "taskkill",
      ["/IM", `${name}*.exe`, "/T", "/F"],
      (error, stdout) => {
        if (error) return resolve(0);
        const matches = stdout.match(/PID:\s*(\d+)/g);
        resolve(matches ? matches.length : 0);
      },
    );
  });
}

/** Same resolution order as the legacy ComponentLauncher.ResolveExecutable. */
export function resolveExecutable(installation: InstallationRecord): string {
  const exe = installation.executable;
  if (exe && exe.length > 0) {
    const explicit = exe.match(/^([a-zA-Z]:|\/|\\)/)
      ? exe
      : join(installation.path, exe);
    if (existsSync(explicit)) return explicit;
    throw new ManagerError(
      ErrorCode.ExecutableMissing,
      `注册的可执行文件不存在：${explicit}`,
    );
  }
  if (existsSync(installation.path) && statSync(installation.path).isFile()) {
    return installation.path;
  }
  if (existsSync(installation.path) && statSync(installation.path).isDirectory()) {
    const entries = readdirSync(installation.path);
    const winExe = entries.find(
      (name) =>
        name.toLowerCase().endsWith(".exe") &&
        !name.toLowerCase().startsWith("tinadecmanger"),
    );
    if (winExe) return join(installation.path, winExe);
    const apphost = entries.find(
      (name) => !name.includes(".") && !name.toLowerCase().startsWith("lib"),
    );
    if (apphost) return join(installation.path, apphost);
  }
  throw new ManagerError(
    ErrorCode.ExecutableMissing,
    "无法在注册路径中定位可执行文件。",
  );
}
