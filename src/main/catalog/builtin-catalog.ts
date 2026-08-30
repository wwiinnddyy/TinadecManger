/**
 * Built-in offline catalog. Mirrors the legacy BuiltInCatalog so the manager
 * can always describe the ecosystem even with no remote feed available.
 * Releases are intentionally empty: discovery works, installation requires a
 * remote catalog or an injected fixture.
 */

import type { CatalogManifest, ProductDefinition } from "../../shared/domain";

const base = {
  allowMultipleInstances: false,
  supportsStandaloneLaunch: true,
  releases: [],
} satisfies Partial<ProductDefinition>;

export const BUILT_IN_PRODUCTS: ProductDefinition[] = [
  {
    ...base,
    id: "tinadec-core",
    name: "TinadecCore",
    family: "core",
    description: "智能体编排与治理服务，生态的状态权威（端口 48731）。",
    delivery: "dotnet-publish-dir",
    probe: "http-health",
    probeTarget: "http://127.0.0.1:48731/api/v1/health",
    expectedArtifact: "TinadecCore.Api.exe",
  },
  {
    ...base,
    id: "tinadec-gateway",
    name: "TinadecGateway",
    family: "gateway",
    description: "无状态 BFF/代理，Desktop 与 Core 之间的门面（端口 48730）。",
    delivery: "bun-script",
    probe: "http-health",
    probeTarget: "http://127.0.0.1:48730/api/v1/health",
    expectedArtifact: "src/index.ts",
  },
  {
    ...base,
    id: "tinadec-tools",
    name: "TinadecTools",
    family: "tools",
    description: "审批感知工具宿主，由 Core 作为子进程托管。",
    delivery: "native-exe",
    probe: "process-name",
    probeTarget: "TinadecTools",
    expectedArtifact: "TinadecTools.exe",
    supportsStandaloneLaunch: false,
  },
  {
    ...base,
    id: "tinadec-office-desktop",
    name: "TinadecOffice Desktop",
    family: "app",
    description: "Electron 桌面客户端（TinadecOfficeDesktop）。",
    delivery: "portable-exe",
    probe: "process-name",
    probeTarget: "TinadecOffice",
    expectedArtifact: "TinadecOffice-*-portable.exe",
    allowMultipleInstances: true,
  },
  {
    ...base,
    id: "tinadec-code",
    name: "TinadecCode",
    family: "app",
    description: "yui 形态的代码智能体客户端。",
    delivery: "yui-app",
    probe: "file-only",
    probeTarget: "",
    expectedArtifact: "",
    allowMultipleInstances: true,
    supportsStandaloneLaunch: false,
  },
];

export function builtInManifest(): CatalogManifest {
  return {
    schemaVersion: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    products: BUILT_IN_PRODUCTS.map((p) => ({ ...p })),
  };
}
