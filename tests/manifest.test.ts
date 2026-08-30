import { describe, expect, it } from "vitest";
import fixture from "../src/fixtures/catalog-fixture.json";
import { assertManifestOrThrow, validateManifest } from "../src/shared/manifest";
import { isSafeRelativePath, joinUnderRoot, PathTraversalError } from "../src/shared/path-safety";

function clone(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

describe("manifest validation (fail closed)", () => {
  it("accepts the shipped fixture", () => {
    expect(validateManifest(fixture)).toEqual([]);
    expect(() => assertManifestOrThrow(fixture)).not.toThrow();
  });

  it("rejects unknown schema versions", () => {
    const manifest = clone(fixture);
    manifest.schemaVersion = 2;
    const issues = validateManifest(manifest);
    expect(issues.some((i) => i.path === "$.schemaVersion")).toBe(true);
  });

  it("rejects duplicate product ids and duplicate release versions", () => {
    const manifest = clone(fixture);
    const products = manifest.products as Record<string, unknown>[];
    products.push(JSON.parse(JSON.stringify(products[0])));
    const release = (
      products[0].releases as Record<string, unknown>[]
    );
    release.push(JSON.parse(JSON.stringify(release[0])));
    const issues = validateManifest(manifest);
    expect(issues.some((i) => i.message.includes("重复的产品 ID"))).toBe(true);
    expect(issues.some((i) => i.message.includes("存在重复版本"))).toBe(true);
  });

  it("rejects invalid semver release versions", () => {
    const manifest = clone(fixture);
    const release = (
      (manifest.products as Record<string, unknown>[])[0]
        .releases as Record<string, unknown>[]
    )[0];
    release.version = "1.4";
    expect(
      validateManifest(manifest).some((i) => i.message.includes("SemVer")),
    ).toBe(true);
  });

  it("rejects artifacts with bad url, hash or size", () => {
    const manifest = clone(fixture);
    const artifact = (
      (
        (manifest.products as Record<string, unknown>[])[0]
          .releases as Record<string, unknown>[]
      )[0].artifacts as Record<string, unknown>[]
    )[0];
    artifact.url = "ftp://nope";
    artifact.sha256 = "xyz";
    artifact.sizeBytes = -5;
    const issues = validateManifest(manifest);
    expect(issues.filter((i) => i.path.includes("artifacts[0]")).length).toBeGreaterThanOrEqual(3);
  });

  it("rejects bad probe targets for http-health products", () => {
    const manifest = clone(fixture);
    const product = (manifest.products as Record<string, unknown>[])[0];
    product.probeTarget = "not-a-url";
    expect(
      validateManifest(manifest).some((i) => i.message.includes("HTTP 探测目标")),
    ).toBe(true);
  });

  it("rejects malformed dependency entries", () => {
    const manifest = clone(fixture);
    const release = (
      (manifest.products as Record<string, unknown>[])[1]
        .releases as Record<string, unknown>[]
    )[0];
    release.dependencies = [{ productId: "tinadec-core", versionRange: "bad range" }];
    const issues = validateManifest(manifest);
    expect(issues.some((i) => i.message.includes("版本范围"))).toBe(true);
    expect(issues.some((i) => i.message.includes("optional"))).toBe(true);
  });

  it("aggregates issues instead of throwing in validateManifest", () => {
    const issues = validateManifest(null);
    expect(issues).toHaveLength(1);
  });
});

describe("path safety", () => {
  it("accepts normal relative entries", () => {
    expect(isSafeRelativePath("a/b/c.txt")).toBe(true);
    expect(isSafeRelativePath("src\\index.ts")).toBe(true);
    expect(isSafeRelativePath("TinadecCore.Api.exe")).toBe(true);
  });

  it("rejects traversal, absolute paths and reserved names", () => {
    expect(isSafeRelativePath("../evil")).toBe(false);
    expect(isSafeRelativePath("a/../../evil")).toBe(false);
    expect(isSafeRelativePath("/abs")).toBe(false);
    expect(isSafeRelativePath("C:\\abs")).toBe(false);
    expect(isSafeRelativePath("\\\\server\\share")).toBe(false);
    expect(isSafeRelativePath("NUL")).toBe(false);
    expect(isSafeRelativePath("com1")).toBe(false);
    expect(isSafeRelativePath("")).toBe(false);
  });

  it("joinUnderRoot throws on escaping entries", () => {
    expect(() => joinUnderRoot("/tmp/stage", "../evil")).toThrow(PathTraversalError);
    expect(joinUnderRoot("/tmp/stage", "sub/file.txt").replace(/\\/g, "/")).toContain(
      "/tmp/stage",
    );
  });
});
