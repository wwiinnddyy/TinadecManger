import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPaths } from "../src/main/paths";
import { CatalogClient, ConfiguredCatalogClient } from "../src/main/catalog/catalog-client";
import { builtInManifest } from "../src/main/catalog/builtin-catalog";

let dir: string;
let server: Server | null = null;
let serverPort = 0;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tinadec-catalog-"));
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
  server = null;
});

async function startServer(
  handler: (req: { url?: string; method?: string; headers: Record<string, string | string[] | undefined> }) => {
    status: number;
    body: string | Buffer;
    headers?: Record<string, string>;
  },
): Promise<number> {
  let etagSeq = 1;
  server = createServer((req, res) => {
    const outcome = handler({
      url: req.url,
      method: req.method,
      headers: req.headers,
    });
    res.writeHead(outcome.status, outcome.headers);
    res.end(outcome.body);
    void etagSeq;
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server!.address();
  if (typeof address === "object" && address) {
    serverPort = address.port;
    return serverPort;
  }
  throw new Error("no port");
}

function clientWith(url: string): CatalogClient {
  return new ConfiguredCatalogClient(buildPaths(dir), { catalogUrl: url });
}

describe("catalog client", () => {
  it("falls back to the built-in manifest when no catalog url is set", async () => {
    const client = new CatalogClient(buildPaths(dir));
    const status = await client.refresh();
    expect(status.state).toBe("ok");
    expect(status.source).toBe("builtin");
    expect(client.manifest().products.map((p) => p.id)).toEqual(
      builtInManifest().products.map((p) => p.id),
    );
  });

  it("fetches and validates a remote manifest, caching it for offline", async () => {
    const port = await startServer(() => ({
      status: 200,
      body: JSON.stringify(builtInManifest()),
      headers: { ETag: '"v1"' },
    }));
    const client = clientWith(`http://127.0.0.1:${port}/manifest.json`);
    const status = await client.refresh();
    expect(status.state).toBe("ok");
    expect(status.source).toBe("remote");

    // New client with a dead URL: should fall back to the persisted cache.
    const offline = new ConfiguredCatalogClient(buildPaths(dir), {
      catalogUrl: "http://127.0.0.1:1/manifest.json",
    });
    const offlineStatus = await offline.refresh();
    expect(offlineStatus.state).toBe("offline");
    expect(offlineStatus.source).toBe("cache");
    expect(offline.manifest().products.length).toBeGreaterThan(0);
  });

  it("rejects invalid remote manifests and serves cache instead", async () => {
    const port = await startServer(() => ({
      status: 200,
      body: JSON.stringify({ schemaVersion: 99, products: [] }),
    }));
    const client = clientWith(`http://127.0.0.1:${port}/manifest.json`);
    const status = await client.refresh();
    expect(status.state).toBe("offline");
    expect(status.source).toBe("builtin");
    expect(status.message).toContain("目录 manifest 校验失败");
  });

  it("supports fixture injection and clearing", async () => {
    const client = new CatalogClient(buildPaths(dir));
    await client.injectFixture(builtInManifest());
    expect(client.status().source).toBe("fixture");
    const cleared = await client.clearFixture();
    expect(cleared.source).toBe("builtin");
  });

  it("uses If-None-Match and keeps cache on 304", async () => {
    let etagHeader: string | undefined;
    const port = await startServer((req) => {
      etagHeader = req.headers["if-none-match"] as string | undefined;
      if (etagHeader) {
        return { status: 304, body: "" };
      }
      return {
        status: 200,
        body: JSON.stringify(builtInManifest()),
        headers: { ETag: '"abc"' },
      };
    });
    const client = clientWith(`http://127.0.0.1:${port}/manifest.json`);
    await client.refresh();
    const second = await client.refresh({ force: false });
    expect(etagHeader).toBe('"abc"');
    expect(second.state).toBe("ok");
    expect(second.source).toBe("cache");
  });
});
