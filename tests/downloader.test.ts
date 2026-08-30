import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  downloadArtifact,
  fileSha256,
  verifyArtifact,
} from "../src/main/ops/downloader";

let dir: string;
let server: Server | null = null;
let port = 0;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tinadec-dl-"));
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
  server = null;
});

async function startByteServer(
  payload: Buffer,
  options: { delayMs?: number; abortAfter?: number } = {},
): Promise<number> {
  server = createServer((req, res) => {
    const range = req.headers.range;
    if (range) {
      const start = Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0);
      res.writeHead(206, {
        "Content-Length": String(payload.length - start),
        "Content-Range": `bytes ${start}-${payload.length - 1}/${payload.length}`,
      });
      res.end(payload.subarray(start));
      return;
    }
    res.writeHead(200, { "Content-Length": String(payload.length) });
    if (options.delayMs) {
      let sent = 0;
      const chunkSize = Math.max(1, Math.floor(payload.length / 8));
      const timer = setInterval(() => {
        sent += chunkSize;
        if (sent >= payload.length) {
          clearInterval(timer);
          res.end(payload);
          return;
        }
        res.write(payload.subarray(0, sent));
      }, options.delayMs);
      return;
    }
    res.end(payload);
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server!.address();
  if (typeof address === "object" && address) {
    port = address.port;
    return port;
  }
  throw new Error("no port");
}

describe("downloader", () => {
  it("downloads, hashes and verifies content", async () => {
    const payload = Buffer.from("hello tinadec artifact");
    const port = await startByteServer(payload);
    const destination = path.join(dir, "artifact.bin");
    const result = await downloadArtifact({
      url: `http://127.0.0.1:${port}/artifact.bin`,
      destination,
      expectedSize: payload.length,
    });
    expect(result.sizeBytes).toBe(payload.length);
    expect(result.sha256).toBe(
      createHash("sha256").update(payload).digest("hex"),
    );
    expect(existsSync(destination)).toBe(true);
    expect(existsSync(`${destination}.part`)).toBe(false);
    await expect(
      verifyArtifact(destination, { sizeBytes: payload.length, sha256: result.sha256 }),
    ).resolves.toBeUndefined();
  });

  it("fails on size mismatch", async () => {
    const payload = Buffer.from("abc");
    const port = await startByteServer(payload);
    await expect(
      downloadArtifact({
        url: `http://127.0.0.1:${port}/artifact.bin`,
        destination: path.join(dir, "artifact.bin"),
        expectedSize: payload.length + 10,
        retries: 0,
      }),
    ).rejects.toThrow("下载大小不符");
  });

  it("supports cancellation via shouldCancel", async () => {
    const payload = Buffer.alloc(1024 * 64, 7);
    const port = await startByteServer(payload, { delayMs: 5 });
    await expect(
      downloadArtifact({
        url: `http://127.0.0.1:${port}/artifact.bin`,
        destination: path.join(dir, "artifact.bin"),
        retries: 0,
        shouldCancel: () => true,
      }),
    ).rejects.toThrow("下载已取消");
  });

  it("reports progress with known totals", async () => {
    const payload = Buffer.alloc(1024 * 128, 3);
    const port = await startByteServer(payload);
    const progress: { bytes: number; total: number | null }[] = [];
    await downloadArtifact({
      url: `http://127.0.0.1:${port}/artifact.bin`,
      destination: path.join(dir, "artifact.bin"),
      expectedSize: payload.length,
      onProgress: (p) => progress.push({ bytes: p.bytesDownloaded, total: p.totalBytes }),
    });
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)?.bytes).toBe(payload.length);
    expect(progress.at(-1)?.total).toBe(payload.length);
  });

  it("fileSha256 matches node crypto", async () => {
    const payload = Buffer.from("checksum me");
    const port = await startByteServer(payload);
    const destination = path.join(dir, "artifact.bin");
    await downloadArtifact({
      url: `http://127.0.0.1:${port}/artifact.bin`,
      destination,
    });
    expect(await fileSha256(destination)).toBe(
      createHash("sha256").update(payload).digest("hex"),
    );
  });

  it("verifyArtifact rejects mismatched hashes", async () => {
    const payload = Buffer.from("data");
    const port = await startByteServer(payload);
    const destination = path.join(dir, "artifact.bin");
    await downloadArtifact({
      url: `http://127.0.0.1:${port}/artifact.bin`,
      destination,
    });
    await expect(
      verifyArtifact(destination, {
        sizeBytes: payload.length,
        sha256: "0".repeat(64),
      }),
    ).rejects.toThrow("SHA-256 校验失败");
  });
});
