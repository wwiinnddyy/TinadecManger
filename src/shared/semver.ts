/**
 * Minimal, dependency-free SemVer 2.0.0 comparison used for catalog versions,
 * dependency ranges, and minimum-manager-version gates. Pure functions only.
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
  raw: string;
}

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function parseVersion(input: string): ParsedVersion | null {
  const match = SEMVER_RE.exec(input.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
    raw: input.trim(),
  };
}

export function isValidVersion(input: string): boolean {
  return parseVersion(input) !== null;
}

function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  // A version without a prerelease outranks one with a prerelease.
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i];
    const bv = b[i];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    const an = /^\d+$/.test(av);
    const bn = /^\d+$/.test(bv);
    if (an && bn) {
      const diff = Number(av) - Number(bv);
      if (diff !== 0) return diff;
    } else if (an !== bn) {
      return an ? -1 : 1; // numeric identifiers always have lower precedence
    } else if (av !== bv) {
      return av < bv ? -1 : 1;
    }
  }
  return 0;
}

/** -1 if a < b, 0 if equal, 1 if a > b. Invalid versions compare last. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

export type VersionRange = {
  operator: ">=" | ">" | "<=" | "<" | "=" | "^" | "~";
  version: ParsedVersion;
};

/**
 * Parses a simple range: a comma/space separated list of comparators
 * (">=1.2.0", "<2.0.0", "^1.2.3", "~1.2.3", "1.2.3"). Anything unparsable
 * makes the range unsatisfiable (fail closed).
 */
export function parseRange(range: string): VersionRange[] | null {
  const parts = range
    .trim()
    .split(/[,\s]+/)
    .filter(Boolean);
  if (parts.length === 0) return [];
  const out: VersionRange[] = [];
  for (const part of parts) {
    const match = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(part);
    if (!match) return null;
    const operator = (match[1] ?? "=") as VersionRange["operator"];
    const version = parseVersion(match[2]);
    if (!version) return null;
    out.push({ operator, version });
  }
  return out;
}

export function satisfiesRange(version: string, range: string): boolean {
  const parsed = parseVersion(version);
  const comparators = parseRange(range);
  if (!parsed || comparators === null) return false;
  if (comparators.length === 0) return true;
  return comparators.every(({ operator, version: base }) => {
    switch (operator) {
      case "=":
      case ">":
      case ">=": {
        const cmp = comparePrereleaseAndCore(parsed, base);
        if (operator === "=") return cmp === 0;
        if (operator === ">") return cmp > 0;
        return cmp >= 0;
      }
      case "<":
        return comparePrereleaseAndCore(parsed, base) < 0;
      case "<=":
        return comparePrereleaseAndCore(parsed, base) <= 0;
      case "^": {
        if (comparePrereleaseAndCore(parsed, base) < 0) return false;
        if (base.major > 0) return parsed.major === base.major;
        if (base.minor > 0) {
          return parsed.major === 0 && parsed.minor === base.minor;
        }
        return parsed.major === 0 && parsed.minor === 0;
      }
      case "~": {
        if (comparePrereleaseAndCore(parsed, base) < 0) return false;
        return parsed.major === base.major && parsed.minor === base.minor;
      }
      default:
        return false;
    }
  });
}

function comparePrereleaseAndCore(
  a: ParsedVersion,
  b: ParsedVersion,
): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

/** Picks the highest version from a list; prereleases of the same base lose to stable. */
export function highestVersion(versions: string[]): string | null {
  let best: string | null = null;
  for (const version of versions) {
    if (!isValidVersion(version)) continue;
    if (best === null || compareVersions(version, best) > 0) best = version;
  }
  return best;
}
