/**
 * `bun run dev` — native Electrobun window backed by the Vite dev server.
 *
 * Renderer edits hot-reload through Vite. Edits under src/main or src/shared
 * restart the main process here rather than through `electrobun dev --watch`,
 * because that watcher's kill path only terminates launcher.exe and leaves the
 * bun.exe hosting the app alive, so the next build fails on locked files.
 *
 * Neither path refreshes dist/, so restart to re-check the packaged `views://`
 * renderer.
 */

import { existsSync, watch, type FSWatcher } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ElectrobunConfig } from "electrobun";
import { electrobunBinPath, spawnElectrobun } from "./electrobun-cli";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 5173;
const rendererUrl = `http://127.0.0.1:${port}`;
const viteEntry = join(root, "node_modules", "vite", "bin", "vite.js");
const mainSources = ["src/main", "src/shared"];

function fail(message: string): never {
  console.error(`\n[dev] ${message}\n`);
  process.exit(1);
}

/**
 * `electrobun dev --watch` survives a failed build and keeps waiting for file
 * changes, so a broken config looks like a hang with no window. Catch it here.
 */
async function preflight(): Promise<void> {
  if (!existsSync(viteEntry)) fail("vite is missing — run `bun install`.");
  if (!existsSync(electrobunBinPath())) {
    fail(`electrobun CLI is missing at ${electrobunBinPath()} — run \`bun install\`.`);
  }
  const configModule = await import("../electrobun.config");
  const entrypoint = (configModule.default as ElectrobunConfig).build?.bun?.entrypoint;
  if (!entrypoint) {
    fail(
      "electrobun.config.ts must set build.bun.entrypoint — the CLI otherwise " +
        "defaults to src/bun/index.ts and throws.",
    );
  }
  if (!existsSync(join(root, entrypoint))) {
    fail(`build.bun.entrypoint points at a missing file: ${entrypoint}`);
  }
}

/**
 * The CLI only console.errors on a missing `build.copy` source, which would
 * otherwise surface as a blank window, so dist/ has to exist before it runs.
 */
async function ensureRendererSnapshot(): Promise<void> {
  if (existsSync(join(root, "dist", "index.html"))) return;
  console.log("[dev] dist/index.html is missing — building the renderer once.");
  const code = await Bun.spawn([process.execPath, viteEntry, "build"], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  }).exited;
  if (code !== 0) fail("vite build failed.");
}

async function serveIsUp(): Promise<boolean> {
  try {
    const response = await fetch(`${rendererUrl}/`, {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * launcher.exe spawns a bun.exe that hosts the app, and its WebView2 processes
 * hang below that, so a direct kill orphans the window and keeps the build
 * output locked. Windows has no process groups, so walk the tree.
 */
function killTree(child: Bun.Subprocess): void {
  if (process.platform === "win32") {
    Bun.spawnSync(["taskkill", "/PID", String(child.pid), "/T", "/F"]);
    return;
  }
  try {
    child.kill("SIGINT");
  } catch {}
}

type Running = { child: Bun.Subprocess; replaced: boolean };

async function main(): Promise<void> {
  await preflight();
  await ensureRendererSnapshot();

  const vite = Bun.spawn(
    [process.execPath, viteEntry, "--host", "127.0.0.1", `--port=${port}`, "--strictPort"],
    { cwd: root, stdout: "inherit", stderr: "inherit" },
  );

  // strictPort makes a busy port fail fast rather than silently move the port
  // out from under rendererUrl. The exit check has to lead: if another server
  // already answers on 5173, our Vite dies on bind while the probe succeeds.
  let viteExited = false;
  void vite.exited.then(() => {
    viteExited = true;
  });
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (viteExited) {
      fail("the Vite dev server exited before it served. Is port 5173 busy?");
    }
    if (await serveIsUp()) break;
    if (Date.now() > deadline) fail(`Vite did not serve ${rendererUrl} within 30s.`);
    await Bun.sleep(150);
  }

  let closing = false;
  let app: Running | null = null;
  const watchers: FSWatcher[] = [];

  const shutdown = (code: number, reason: string): void => {
    if (closing) return;
    closing = true;
    for (const watcher of watchers) watcher.close();
    if (app) killTree(app.child);
    killTree(vite);
    console.log(`[dev] ${reason}.`);
    void Promise.allSettled([app?.child.exited, vite.exited]).then(() => {
      process.exit(code);
    });
  };

  const startApp = () => {
    const current: Running = {
      child: spawnElectrobun(["dev"], { TINADEC_RENDERER_URL: rendererUrl }),
      replaced: false,
    };
    app = current;
    void current.child.exited.then((code) => {
      if (closing || current.replaced) return;
      app = null;
      if ((code ?? 0) === 0) shutdown(0, "the app window closed");
      else {
        console.error(
          `\n[dev] the main process exited with code ${code}; the window is down. ` +
            `Edit a file under ${mainSources.join(" or ")} to retry, or Ctrl+C to stop.\n`,
        );
      }
    });
  };

  let debounce: ReturnType<typeof setTimeout> | null = null;
  // Restarting takes time to observe the old process dying, during which
  // `app` is deliberately empty. Chaining keeps a second change from starting
  // a replacement before the first restart finishes, which would yield
  // two windows.
  let restartChain: Promise<void> = Promise.resolve();
  const restartApp = async (reason: string): Promise<void> => {
    const previous = app;
    if (previous) {
      previous.replaced = true;
      app = null;
      killTree(previous.child);
      await previous.child.exited;
      // taskkill returns before Windows always releases the .exe handles that
      // runBuild's rmSync is about to clear.
      await Bun.sleep(400);
    }
    console.log(`[dev] rebuilding the main process after ${reason}.`);
    startApp();
  };
  const scheduleRestart = (reason: string): void => {
    restartChain = restartChain
      .then(() => restartApp(reason), () => restartApp(reason));
  };

  for (const dir of mainSources) {
    watchers.push(
      watch(join(root, dir), { recursive: true }, (_event, changed) => {
        if (closing || !changed) return;
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          scheduleRestart(`a change to ${dir}/${changed.toString()}`);
        }, 250);
      }),
    );
  }

  void vite.exited.then((code) => shutdown(code ?? 0, "the Vite dev server exited"));
  process.on("SIGINT", () => shutdown(0, "interrupted"));
  process.on("SIGTERM", () => shutdown(0, "terminated"));

  startApp();
}

await main();
