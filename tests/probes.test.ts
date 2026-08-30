import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { artifactExists, probeWithTimeout } from "../src/main/process/probes";
import type { ProductDefinition } from "../src/shared/domain";

let dir: string;
let server: Server | null = null;
let port = 0;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tinadec-probe-"));
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
  server = null;
});

function coreDefinition(
  overrides: Partial<ProductDefinition> = {},
): ProductDefinition {
  return {
    id: "tinadec-core",
    name: "TinadecCore",
    family: "core",
    description: "",
    delivery: "dotnet-publish-dir",
    probe: "http-health",
    probeTarget: "http://127.0.0.1:48731/api/v1/health",
    expectedArtifact: "TinadecCore.Api.exe",
    allowMultipleInstances: false,
    supportsStandaloneLaunch: true,
    releases: [],
    ...overrides,
  };
}

async function startHttp(handler: (req: { url: string }, res: { statusCode: number; end: (body?: string) => void }) => void) {
  server = createServer((req, res) => {
    handler({ url: req.url ?? "" }, res);
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server!.address();
  if (typeof address === "object" && address) {
    port = address.port;
    return port;
  }
  throw new Error("no port");
}

describe("http probe", () => {
  it("reports running with version for 2xx JSON", async () => {
    const port = await startHttp((_req, res) => {
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, version: "1.4.2" }));
    });
    const health = await probeWithTimeout({
      definition: coreDefinition({ probeTarget: `http://127.0.0.1:${port}/health` }),
    });
    expect(health.status).toBe("running");
    expect(health.version).toBe("1.4.2");
  });

  it("reports stopped on 503 and on connection refused", async () => {
    const port = await startHttp((_req, res) => {
      res.statusCode = 503;
      res.end();
    });
    const health = await probeWithTimeout({
      definition: coreDefinition({ probeTarget: `http://127.0.0.1:${port}/health` }),
    });
    expect(health.status).toBe("stopped");

    const refused = await probeWithTimeout({
      definition: coreDefinition({ probeTarget: "http://127.0.0.1:1/health" }),
    });
    expect(refused.status).toBe("stopped");
  });

  it("prefers the endpoint override", async () => {
    const port = await startHttp((_req, res) => {
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, version: "9.9.9" }));
    });
    const health = await probeWithTimeout({
      definition: coreDefinition({ probeTarget: "http://127.0.0.1:1/health" }),
      installation: {
        id: "tinadec-core",
        productId: "tinadec-core",
        path: dir,
        endpointOverride: `http://127.0.0.1:${port}/health`,
        registeredAt: "",
        updatedAt: "",
        platform: "windows",
        architecture: "x64",
        source: "manual",
        ownership: "legacy-unmanaged",
      },
    });
    expect(health.status).toBe("running");
    expect(health.version).toBe("9.9.9");
    expect(health.endpoint).toContain(String(port));
  });
});

describe("process probe", () => {
  it("distinguishes stopped vs not-installed by artifact presence", async () => {
    await mkdir(path.join(dir, "core"), { recursive: true });
    await writeFile(path.join(dir, "core", "TinadecCore.Api.exe"), "bin");
    const installed = await probeWithTimeout({
      definition: coreDefinition({
        probe: "process-name",
        probeTarget: "definitely-not-running-proc",
      }),
      installation: {
        id: "tinadec-core",
        productId: "tinadec-core",
        path: path.join(dir, "core"),
        registeredAt: "",
        updatedAt: "",
        platform: "windows",
        architecture: "x64",
        source: "manual",
        ownership: "legacy-unmanaged",
      },
    });
    expect(installed.status).toBe("stopped");

    const missing = await probeWithTimeout({
      definition: coreDefinition({
        probe: "process-name",
        probeTarget: "definitely-not-running-proc",
      }),
    });
    expect(missing.status).toBe("not-installed");
  });
});

describe("file probe", () => {
  it("reports stopped when path exists and not-installed otherwise", async () => {
    const existing = path.join(dir, "app");
    await mkdir(existing);
    const present = await probeWithTimeout({
      definition: coreDefinition({ probe: "file-only" }),
      installation: {
        id: "tinadec-code",
        productId: "tinadec-code",
        path: existing,
        registeredAt: "",
        updatedAt: "",
        platform: "windows",
        architecture: "x64",
        source: "manual",
        ownership: "legacy-unmanaged",
      },
    });
    expect(present.status).toBe("stopped");

    const absent = await probeWithTimeout({
      definition: coreDefinition({ probe: "file-only" }),
      installation: {
        id: "tinadec-code",
        productId: "tinadec-code",
        path: path.join(dir, "missing"),
        registeredAt: "",
        updatedAt: "",
        platform: "windows",
        architecture: "x64",
        source: "manual",
        ownership: "legacy-unmanaged",
      },
    });
    expect(absent.status).toBe("not-installed");
  });
});

describe("artifactExists", () => {
  it("matches wildcards at the top level", async () => {
    await mkdir(path.join(dir, "office"));
    await writeFile(path.join(dir, "office", "TinadecOffice-2026.3-portable.exe"), "x");
    expect(artifactExists(path.join(dir, "office"), "TinadecOffice-*-portable.exe")).toBe(true);
    expect(artifactExists(path.join(dir, "office"), "TinadecOffice-*-missing.exe")).toBe(false);
    expect(artifactExists(path.join(dir, "office"), "")).toBe(true);
    expect(artifactExists(path.join(dir, "nothing"), "any.exe")).toBe(false);
  });
});
