import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPaths } from "../src/main/paths";
import { ConfiguredCatalogClient } from "../src/main/catalog/catalog-client";
import type { CatalogManifest } from "../src/shared/domain";
import {
  pickArtifact,
  readActivePointer,
  runInstallFlow,
  APP_VERSION,
} from "../src/main/ops/install-flow";
import type { OperationHandle } from "../src/main/ops/operation-queue";

let dir: string;
let server: Server | null = null;
let port = 0;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tinadec-flow-"));
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
  server = null;
});

function makeHandle() {
  const record = {
    id: `op-test${Math.random().toString(16).slice(2, 8)}`,
    kind: "install" as const,
    status: "running" as const,
    phase: "queued" as const,
    productId: "tinadec-core",
    progress: 0,
    bytesDownloaded: 0,
    message: "",
    createdAt: new Date().toISOString(),
    canCancel: true,
    canRetry: false,
  };
  const handle: OperationHandle = {
    record,
    abort: { cancelled: false },
    update: (patch) => Object.assign(record, patch),
    throwIfCancelled: () => {
      if (handle.abort.cancelled) throw new Error("cancelled");
    },
  };
  return handle;
}

function makeManifest(
  url: string,
  sha256: string,
  sizeBytes: number,
): CatalogManifest {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    products: [
      {
        id: "tinadec-core",
        name: "TinadecCore",
        family: "core",
        description: "test",
        delivery: "dotnet-publish-dir",
        probe: "http-health",
        probeTarget: "http://127.0.0.1:48731/api/v1/health",
        expectedArtifact: "TinadecCore.Api.exe",
        allowMultipleInstances: false,
        supportsStandaloneLaunch: true,
        releases: [
          {
            id: "core-1.0.0",
            version: "1.0.0",
            channel: "stable",
            publishedAt: new Date().toISOString(),
            artifacts: [
              {
                id: "core-1.0.0-win-x64",
                platform: "windows",
                architecture: "x64",
                format: "zip",
                url,
                sizeBytes,
                sha256,
              },
            ],
            dependencies: [],
          },
          {
            id: "core-1.1.0",
            version: "1.1.0",
            channel: "stable",
            publishedAt: new Date().toISOString(),
            artifacts: [
              {
                id: "core-1.1.0-win-x64",
                platform: "windows",
                architecture: "x64",
                format: "zip",
                url: url.replace("1.0.0", "1.1.0"),
                sizeBytes,
                sha256,
              },
            ],
            dependencies: [],
          },
          {
            id: "core-2.0.0",
            version: "2.0.0",
            channel: "stable",
            publishedAt: new Date().toISOString(),
            artifacts: [
              {
                id: "core-2.0.0-win-x64",
                platform: "windows",
                architecture: "x64",
                format: "zip",
                url,
                sizeBytes,
                sha256,
              },
            ],
            dependencies: [],
            minimumManagerVersion: "99.0.0",
          },
        ],
      },
    ],
  };
}

function makeZipSync(buildDir: string, artifactName: string, content: string) {
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(path.join(buildDir, artifactName), content, "utf8");
  const zip = `${buildDir}.zip`;
  execFileSync("tar", ["-a", "-cf", zip, "-C", buildDir, artifactName]);
  const data = readFileSync(zip);
  return {
    zip,
    sha256: createHash("sha256").update(data).digest("hex"),
    size: data.length,
  };
}

async function startArtifactServer(files: Map<string, Buffer>): Promise<number> {
  server = createServer((req, res) => {
    const name = decodeURIComponent(req.url ?? "").replace(/^\//, "");
    const file = files.get(name);
    if (!file) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Length": String(file.length) });
    res.end(file);
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server!.address();
  if (typeof address === "object" && address) {
    port = address.port;
    return port;
  }
  throw new Error("no port");
}

// --------------------------------------------------------------------------

describe.skipIf(process.platform !== "win32")("install flow (zip artifacts)", () => {
  it("installs, verifies, activates and records the pointer", async () => {
    const staging = path.join(dir, "staging-src");
    const { zip, sha256, size } = makeZipSync(
      path.join(staging, "payload"),
      "TinadecCore.Api.exe",
      "core binary 1.0.0",
    );
    const zipBuffer = await readFile(zip);
    const port = await startArtifactServer(new Map([["artifact.zip", zipBuffer]]));

    const manifest = makeManifest(
      `http://127.0.0.1:${port}/artifact.zip`,
      sha256,
      size,
    );
    const catalog = new ConfiguredCatalogClient(buildPaths(dir), { catalogUrl: null });
    await catalog.injectFixture(manifest);

    const installRoot = path.join(dir, "apps");
    const downloadDir = path.join(dir, "downloads");
    const handle = makeHandle();
    const logs: string[] = [];

    const result = await runInstallFlow(
      handle,
      {
        installRoot,
        downloadDir,
        catalog: () => catalog.manifest(),
        resolveActiveVersion: async () => null,
        log: (message) => logs.push(message),
        stopProduct: async () => {},
      },
      { mode: "install", productId: "tinadec-core", version: "1.0.0" },
    );

    expect(result.version).toBe("1.0.0");
    expect(handle.record.progress).toBeGreaterThan(50);
    const pointer = await readActivePointer(installRoot, "tinadec-core");
    expect(pointer?.version).toBe("1.0.0");
    expect(existsSync(path.join(result.path, "TinadecCore.Api.exe"))).toBe(true);
    expect(logs.some((l) => l.includes("SHA-256"))).toBe(true);
    // staging + download cleaned up
    expect(existsSync(path.join(installRoot, "tinadec-core", `staging-${handle.record.id}`))).toBe(false);
  });

  it("fails closed on hash mismatch and leaves no artifacts behind", async () => {
    const { zip, size } = makeZipSync(
      path.join(dir, "payload2"),
      "TinadecCore.Api.exe",
      "core binary",
    );
    const zipBuffer = await readFile(zip);
    const port = await startArtifactServer(new Map([["artifact.zip", zipBuffer]]));
    const manifest = makeManifest(
      `http://127.0.0.1:${port}/artifact.zip`,
      "0".repeat(64),
      size,
    );
    const catalog = new ConfiguredCatalogClient(buildPaths(dir), { catalogUrl: null });
    await catalog.injectFixture(manifest);

    const installRoot = path.join(dir, "apps");
    const handle = makeHandle();
    await expect(
      runInstallFlow(
        handle,
        {
          installRoot,
          downloadDir: path.join(dir, "downloads"),
          catalog: () => catalog.manifest(),
          resolveActiveVersion: async () => null,
          log: () => {},
          stopProduct: async () => {},
        },
        { mode: "install", productId: "tinadec-core", version: "1.0.0" },
      ),
    ).rejects.toThrow("SHA-256 校验失败");
    expect(await readActivePointer(installRoot, "tinadec-core")).toBeNull();
  });

  it("updates flip the pointer and refuse downgrades without pinning", async () => {
    const payloadA = makeZipSync(
      path.join(dir, "pA"),
      "TinadecCore.Api.exe",
      "core 1.0.0",
    );
    const payloadB = makeZipSync(
      path.join(dir, "pB"),
      "TinadecCore.Api.exe",
      "core 1.1.0",
    );
    const [bufA, bufB] = await Promise.all([readFile(payloadA.zip), readFile(payloadB.zip)]);
    const port = await startArtifactServer(
      new Map([
        ["a.zip", bufA],
        ["b.zip", bufB],
      ]),
    );
    const manifest = makeManifest(`http://127.0.0.1:${port}/a.zip`, payloadA.sha256, payloadA.size);
    // Patch 1.1.0 artifact to point at b.zip with its own hash.
    const core = manifest.products[0];
    const release110 = core.releases.find((r) => r.version === "1.1.0")!;
    release110.artifacts[0].url = `http://127.0.0.1:${port}/b.zip`;
    release110.artifacts[0].sha256 = payloadB.sha256;
    release110.artifacts[0].sizeBytes = payloadB.size;

    const catalog = new ConfiguredCatalogClient(buildPaths(dir), { catalogUrl: null });
    await catalog.injectFixture(manifest);
    const installRoot = path.join(dir, "apps");
    const deps = {
      installRoot,
      downloadDir: path.join(dir, "downloads"),
      catalog: () => catalog.manifest(),
      resolveActiveVersion: async () => null,
      log: () => {},
      stopProduct: async () => {},
    };

    await runInstallFlow(makeHandle(), deps, {
      mode: "install",
      productId: "tinadec-core",
      version: "1.0.0",
    });
    expect((await readActivePointer(installRoot, "tinadec-core"))?.version).toBe("1.0.0");

    // Update to 1.1.0 (pinned: un-pinned selection would pick the gated 2.0.0)
    await runInstallFlow(makeHandle(), deps, {
      mode: "update",
      productId: "tinadec-core",
      version: "1.1.0",
    });
    expect((await readActivePointer(installRoot, "tinadec-core"))?.version).toBe("1.1.0");
    // old version dir retained for rollback
    expect(existsSync(path.join(installRoot, "tinadec-core", "versions", "1.0.0"))).toBe(true);

    // Pinned downgrade refused without force
    await expect(
      runInstallFlow(makeHandle(), deps, {
        mode: "update",
        productId: "tinadec-core",
        version: "1.0.0",
      }),
    ).rejects.toThrow("不是更新");

    // Pinned reinstall of the same version is allowed (repair semantics)
    const repair = await runInstallFlow(makeHandle(), deps, {
      mode: "repair",
      productId: "tinadec-core",
      version: "1.1.0",
    });
    expect(repair.version).toBe("1.1.0");
  });
  it("gates on minimumManagerVersion", async () => {
    const { zip, sha256, size } = makeZipSync(
      path.join(dir, "pC"),
      "TinadecCore.Api.exe",
      "core",
    );
    const buf = await readFile(zip);
    const port = await startArtifactServer(new Map([["artifact.zip", buf]]));
    const manifest = makeManifest(`http://127.0.0.1:${port}/artifact.zip`, sha256, size);
    const catalog = new ConfiguredCatalogClient(buildPaths(dir), { catalogUrl: null });
    await catalog.injectFixture(manifest);

    await expect(
      runInstallFlow(
        makeHandle(),
        {
          installRoot: path.join(dir, "apps"),
          downloadDir: path.join(dir, "downloads"),
          catalog: () => catalog.manifest(),
          resolveActiveVersion: async () => null,
          log: () => {},
          stopProduct: async () => {},
        },
        { mode: "install", productId: "tinadec-core", version: "2.0.0" },
      ),
    ).rejects.toThrow(`需要管理器 ≥ 99.0.0`);
    expect(APP_VERSION).toBe("0.1.0");
  });

  it("pickArtifact prefers exact platform/arch", () => {
    const release = {
      id: "r",
      version: "1.0.0",
      channel: "stable" as const,
      publishedAt: "",
      artifacts: [
        {
          id: "a1",
          platform: "windows" as const,
          architecture: "arm64" as const,
          format: "zip" as const,
          url: "u",
          sizeBytes: 1,
          sha256: "0".repeat(64),
        },
        {
          id: "a2",
          platform: "windows" as const,
          architecture: "x64" as const,
          format: "zip" as const,
          url: "u",
          sizeBytes: 1,
          sha256: "0".repeat(64),
        },
      ],
      dependencies: [],
    };
    expect(pickArtifact(release, "windows", "x64").id).toBe("a2");
    expect(() => pickArtifact(release, "linux")).toThrow("没有适用于");
  });
});
