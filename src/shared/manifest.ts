/**
 * Catalog manifest v1 validation. Everything unknown, malformed, or unsafe
 * fails closed: the validator returns a list of rejection reasons and the
 * caller must refuse to serve the manifest unless it is empty.
 */

import type {
  Artifact,
  CatalogManifest,
  ProductDefinition,
  Release,
} from "./domain";
import { ErrorCode, ManagerError } from "./errors";
import { isValidVersion, parseRange } from "./semver";

export interface ValidationIssue {
  path: string;
  message: string;
}

const ID_RE = /^[a-z0-9][a-z0-9-._]{1,63}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const URL_RE = /^https?:\/\//i;
const VALID_FAMILIES = new Set(["core", "gateway", "tools", "app"]);
const VALID_DELIVERY = new Set([
  "dotnet-publish-dir",
  "native-exe",
  "bun-script",
  "portable-exe",
  "yui-app",
]);
const VALID_PROBE = new Set(["http-health", "process-name", "file-only"]);
const VALID_PLATFORMS = new Set(["windows", "macos", "linux"]);
const VALID_ARCH = new Set(["x64", "arm64"]);
const VALID_FORMATS = new Set(["zip", "tar-gz", "directory", "executable"]);
const VALID_CHANNELS = new Set(["stable", "canary"]);

export function validateManifest(input: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (path: string, message: string) => issues.push({ path, message });

  if (typeof input !== "object" || input === null) {
    push("$", "manifest 必须是对象");
    return issues;
  }
  const m = input as Partial<CatalogManifest> & Record<string, unknown>;
  if (m.schemaVersion !== 1) {
    push("$.schemaVersion", `不支持的目录 schema 版本：${String(m.schemaVersion)}`);
  }
  if (typeof m.generatedAt !== "string" || Number.isNaN(Date.parse(m.generatedAt))) {
    push("$.generatedAt", "生成时间缺失或非法");
  }
  if (!Array.isArray(m.products)) {
    push("$.products", "产品列表缺失");
    return issues;
  }

  const seenProductIds = new Set<string>();
  m.products.forEach((p, pi) => {
    const base = `$.products[${pi}]`;
    if (typeof p !== "object" || p === null) {
      push(base, "产品必须是对象");
      return;
    }
    const product = p as Partial<ProductDefinition> & Record<string, unknown>;
    const productRef = `${product.id ?? pi}`;
    if (typeof product.id !== "string" || !ID_RE.test(product.id)) {
      push(`${base}.id`, `产品 ID 非法：${String(product.id)}`);
    } else if (seenProductIds.has(product.id)) {
      push(`${base}.id`, `重复的产品 ID：${product.id}`);
    }
    if (typeof product.id === "string") seenProductIds.add(product.id);
    if (typeof product.name !== "string" || product.name.trim().length === 0) {
      push(`${base}.name`, `产品 ${productRef} 名称缺失`);
    }
    if (
      typeof product.family !== "string" ||
      !VALID_FAMILIES.has(product.family)
    ) {
      push(`${base}.family`, `产品 ${productRef} 的 family 非法：${String(product.family)}`);
    }
    if (
      typeof product.delivery !== "string" ||
      !VALID_DELIVERY.has(product.delivery)
    ) {
      push(`${base}.delivery`, `产品 ${productRef} 的 delivery 非法`);
    }
    if (typeof product.probe !== "string" || !VALID_PROBE.has(product.probe)) {
      push(`${base}.probe`, `产品 ${productRef} 的 probe 非法`);
    }
    if (
      product.probe === "http-health" &&
      (typeof product.probeTarget !== "string" || !URL_RE.test(product.probeTarget))
    ) {
      push(`${base}.probeTarget`, `产品 ${productRef} 的 HTTP 探测目标缺失或非法`);
    }

    if (!Array.isArray(product.releases)) {
      push(`${base}.releases`, `产品 ${productRef} 版本列表缺失`);
      return;
    }
    const seenReleaseVersions = new Set<string>();
    product.releases.forEach((r, ri) => {
      const rbase = `${base}.releases[${ri}]`;
      if (typeof r !== "object" || r === null) {
        push(rbase, "release 必须是对象");
        return;
      }
      const release = r as Partial<Release> & Record<string, unknown>;
      const releaseRef = `${productRef}@${release.version ?? ri}`;
      if (typeof release.id !== "string" || release.id.length === 0) {
        push(`${rbase}.id`, `release ${releaseRef} 的 id 缺失`);
      }
      if (
        typeof release.version !== "string" ||
        !isValidVersion(release.version)
      ) {
        push(`${rbase}.version`, `release ${releaseRef} 的版本号不是合法 SemVer`);
      } else if (seenReleaseVersions.has(release.version)) {
        push(`${rbase}.version`, `产品 ${productRef} 存在重复版本 ${release.version}`);
      }
      if (typeof release.version === "string")
        seenReleaseVersions.add(release.version);
      if (
        typeof release.channel !== "string" ||
        !VALID_CHANNELS.has(release.channel)
      ) {
        push(`${rbase}.channel`, `release ${releaseRef} 的渠道非法`);
      }
      if (
        typeof release.publishedAt !== "string" ||
        Number.isNaN(Date.parse(release.publishedAt))
      ) {
        push(`${rbase}.publishedAt`, `release ${releaseRef} 的发布时间非法`);
      }
      if (!Array.isArray(release.artifacts)) {
        push(`${rbase}.artifacts`, `release ${releaseRef} 缺少制品`);
        return;
      }
      if (release.artifacts.length === 0) {
        push(`${rbase}.artifacts`, `release ${releaseRef} 至少需要一个制品`);
      }
      release.artifacts.forEach((a, ai) => {
        validateArtifact(a, `${rbase}.artifacts[${ai}]`, push);
      });
      validateDependencies(release.dependencies, rbase, push);
    });
  });

  return issues;
}

function validateArtifact(
  a: unknown,
  base: string,
  push: (path: string, message: string) => void,
): void {
  if (typeof a !== "object" || a === null) {
    push(base, "artifact 必须是对象");
    return;
  }
  const artifact = a as Partial<Artifact> & Record<string, unknown>;
  const ref = `${artifact.id ?? "?"}`;
  if (typeof artifact.id !== "string" || artifact.id.length === 0) {
    push(`${base}.id`, `artifact ${ref} 的 id 缺失`);
  }
  if (
    typeof artifact.platform !== "string" ||
    !VALID_PLATFORMS.has(artifact.platform)
  ) {
    push(`${base}.platform`, `artifact ${ref} 平台非法：${String(artifact.platform)}`);
  }
  if (
    typeof artifact.architecture !== "string" ||
    !VALID_ARCH.has(artifact.architecture)
  ) {
    push(`${base}.architecture`, `artifact ${ref} 架构非法`);
  }
  if (
    typeof artifact.format !== "string" ||
    !VALID_FORMATS.has(artifact.format)
  ) {
    push(`${base}.format`, `artifact ${ref} 交付格式非法`);
  }
  if (
    typeof artifact.url !== "string" ||
    (!URL_RE.test(artifact.url) && !artifact.url.startsWith("file://"))
  ) {
    push(`${base}.url`, `artifact ${ref} 的下载 URL 非法`);
  }
  if (
    typeof artifact.sizeBytes !== "number" ||
    !Number.isFinite(artifact.sizeBytes) ||
    artifact.sizeBytes <= 0
  ) {
    push(`${base}.sizeBytes`, `artifact ${ref} 的大小非法`);
  }
  if (typeof artifact.sha256 !== "string" || !HASH_RE.test(artifact.sha256)) {
    push(`${base}.sha256`, `artifact ${ref} 的 SHA-256 缺失或格式非法`);
  }
}

function validateDependencies(
  deps: unknown,
  base: string,
  push: (path: string, message: string) => void,
): void {
  if (deps === undefined) return;
  if (!Array.isArray(deps)) {
    push(`${base}.dependencies`, "依赖列表必须是数组");
    return;
  }
  deps.forEach((d, di) => {
    if (typeof d !== "object" || d === null) {
      push(`${base}.dependencies[${di}]`, "依赖必须是对象");
      return;
    }
    const dep = d as Record<string, unknown>;
    if (typeof dep.productId !== "string" || dep.productId.length === 0) {
      push(`${base}.dependencies[${di}].productId`, "依赖产品 ID 缺失");
    }
    if (
      typeof dep.versionRange !== "string" ||
      parseRange(dep.versionRange) === null
    ) {
      push(`${base}.dependencies[${di}].versionRange`, "依赖版本范围缺失或非法");
    }
    if (typeof dep.optional !== "boolean") {
      push(`${base}.dependencies[${di}].optional`, "依赖的 optional 标记缺失");
    }
  });
}

export function assertManifestOrThrow(input: unknown): CatalogManifest {
  const issues = validateManifest(input);
  if (issues.length > 0) {
    const summary = issues
      .slice(0, 5)
      .map((i) => `${i.path}: ${i.message}`)
      .join("; ");
    throw new ManagerError(
      ErrorCode.CatalogInvalid,
      `目录 manifest 校验失败（${issues.length} 处）`,
      summary,
    );
  }
  return input as CatalogManifest;
}
