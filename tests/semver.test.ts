import { describe, expect, it } from "vitest";
import {
  compareVersions,
  highestVersion,
  isValidVersion,
  parseRange,
  parseVersion,
  satisfiesRange,
} from "../src/shared/semver";

describe("semver", () => {
  it("parses valid versions and rejects invalid", () => {
    expect(parseVersion("1.2.3")).toMatchObject({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion("1.2.3-beta.1")).toMatchObject({
      prerelease: ["beta", "1"],
    });
    expect(isValidVersion("1.2")).toBe(false);
    expect(isValidVersion("v1.2.3")).toBe(false);
    expect(isValidVersion("01.2.3")).toBe(false);
  });

  it("orders versions by precedence", () => {
    expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
    expect(compareVersions("1.0.0-alpha", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
    expect(compareVersions("1.0.0-alpha.1", "1.0.0-alpha")).toBe(1);
    expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBe(-1);
  });

  it("evaluates range comparators", () => {
    expect(satisfiesRange("1.4.2", ">=1.0.0")).toBe(true);
    expect(satisfiesRange("0.9.0", ">=1.0.0")).toBe(false);
    expect(satisfiesRange("1.2.3", ">=1.0.0 <2.0.0")).toBe(true);
    expect(satisfiesRange("2.0.0", ">=1.0.0 <2.0.0")).toBe(false);
    expect(satisfiesRange("1.3.0", "^1.2.3")).toBe(true);
    expect(satisfiesRange("2.0.0", "^1.2.3")).toBe(false);
    expect(satisfiesRange("1.2.9", "~1.2.3")).toBe(true);
    expect(satisfiesRange("1.3.0", "~1.2.3")).toBe(false);
    expect(satisfiesRange("1.2.3", "1.2.3")).toBe(true);
  });

  it("fails closed on unparsable ranges or versions", () => {
    expect(parseRange("banana")).toBeNull();
    expect(satisfiesRange("1.2.3", "banana")).toBe(false);
    expect(satisfiesRange("not-a-version", ">=1.0.0")).toBe(false);
  });

  it("picks the highest valid version", () => {
    expect(highestVersion(["1.2.0", "1.10.0", "0.9.0"])).toBe("1.10.0");
    expect(highestVersion(["1.0.0-beta", "1.0.0"])).toBe("1.0.0");
    expect(highestVersion(["nope", "1.0.0"])).toBe("1.0.0");
    expect(highestVersion([])).toBeNull();
  });
});
