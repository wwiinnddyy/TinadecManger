import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  readActivePointer,
  removeManagedProduct,
  writeActivePointer,
} from "../src/main/ops/install-flow";
import { ErrorCode } from "../src/shared/errors";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tinadec-uninst-"));
});

describe("managed product removal", () => {
  it("deletes when an active.json pointer proves ownership", async () => {
    const productDir = path.join(dir, "tinadec-core");
    await mkdir(path.join(productDir, "versions", "1.0.0"), { recursive: true });
    await writeFile(path.join(productDir, "versions", "1.0.0", "core.exe"), "bin");
    await writeActivePointer(dir, "tinadec-core", {
      version: "1.0.0",
      path: path.join(productDir, "versions", "1.0.0"),
      updatedAt: new Date().toISOString(),
    });
    expect(await readActivePointer(dir, "tinadec-core")).not.toBeNull();
    await removeManagedProduct(dir, "tinadec-core");
    expect(existsSync(productDir)).toBe(false);
  });

  it("refuses to delete directories without a pointer (legacy guard)", async () => {
    const userDir = path.join(dir, "some-user-directory");
    await mkdir(userDir, { recursive: true });
    await writeFile(path.join(userDir, "important.txt"), "keep me");
    await expect(removeManagedProduct(dir, "some-user-directory")).rejects.toMatchObject({
      code: ErrorCode.LegacyProtected,
    });
    expect(existsSync(path.join(userDir, "important.txt"))).toBe(true);
  });

  it("is a no-op for unknown products", async () => {
    await expect(removeManagedProduct(dir, "never-installed")).resolves.toBeUndefined();
  });
});
