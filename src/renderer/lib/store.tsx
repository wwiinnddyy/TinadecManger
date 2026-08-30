/**
 * Global manager state: snapshot polling + RPC event stream subscription,
 * plus typed action helpers the pages call.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AppSettings,
  HealthSnapshot,
  InstallationRecord,
  LogEntry,
  ManagerSnapshot,
  OperationRecord,
  OperationRequest,
} from "shared/domain";
import type { RpcError, RpcResult } from "shared/errors";
import { managerRpc } from "./rpc-client";

interface ManagerStore {
  snapshot: ManagerSnapshot | null;
  healthById: Map<string, HealthSnapshot>;
  loading: boolean;
  lastError: RpcError | null;
  mode: "electrobun" | "mock";
  refresh: () => Promise<void>;
  runOperation: <T>(
    fn: () => Promise<RpcResult<T>>,
  ) => Promise<RpcResult<T>>;
  actions: {
    install: (req: OperationRequest) => Promise<RpcResult<OperationRecord>>;
    update: (req: OperationRequest) => Promise<RpcResult<OperationRecord>>;
    repair: (req: OperationRequest) => Promise<RpcResult<OperationRecord>>;
    uninstall: (req: {
      installationId: string;
      confirmed: boolean;
      deleteFiles: boolean;
    }) => Promise<RpcResult<OperationRecord>>;
    register: (req: {
      productId: string;
      path: string;
      endpointOverride?: string;
    }) => Promise<RpcResult<InstallationRecord>>;
    unregister: (req: {
      installationId: string;
      confirmed: boolean;
    }) => Promise<RpcResult<InstallationRecord>>;
    batchUpdate: (ids: string[]) => Promise<RpcResult<OperationRecord[]>>;
    start: (id: string) => Promise<RpcResult<HealthSnapshot>>;
    stop: (id: string) => Promise<RpcResult<HealthSnapshot>>;
    probe: (id: string) => Promise<RpcResult<HealthSnapshot>>;
    probeAll: () => Promise<RpcResult<HealthSnapshot[]>>;
    cancel: (opId: string) => Promise<RpcResult<OperationRecord>>;
    retry: (opId: string) => Promise<RpcResult<OperationRecord>>;
    refreshCatalog: (force?: boolean) => Promise<RpcResult<unknown>>;
    saveSettings: (settings: AppSettings) => Promise<RpcResult<AppSettings>>;
    chooseDirectory: (
      kind: "directory" | "file",
    ) => Promise<RpcResult<string[]>>;
    openPath: (path: string, mode: "directory" | "item") => Promise<RpcResult<true>>;
    logs: (req: {
      installationId?: string;
      tail?: number;
    }) => Promise<RpcResult<LogEntry[]>>;
  };
}

const StoreContext = createContext<ManagerStore | null>(null);

export function ManagerProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ManagerSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastError, setLastError] = useState<RpcError | null>(null);
  const snapshotRef = useRef<ManagerSnapshot | null>(null);

  const applySnapshot = useCallback((next: ManagerSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const refresh = useCallback(async () => {
    const result = await managerRpc.request("getSnapshot");
    if (result.ok) {
      setLastError(null);
      applySnapshot(result.value);
    } else {
      setLastError(result.error);
    }
    setLoading(false);
  }, [applySnapshot]);

  useEffect(() => {
    void refresh();
    const offSnapshot = managerRpc.onMessage("snapshot-changed", (payload) => {
      void payload;
      void refresh();
    });
    const offOperation = managerRpc.onMessage("operation-updated", (payload) => {
      const current = snapshotRef.current;
      if (!current) return;
      const operations = [
        payload.operation,
        ...current.operations.filter((op) => op.id !== payload.operation.id),
      ];
      applySnapshot({ ...current, operations });
    });
    const offHealth = managerRpc.onMessage("health-updated", (payload) => {
      const current = snapshotRef.current;
      if (!current) return;
      const health = [
        ...current.health.filter(
          (h) => h.installationId !== payload.health.installationId,
        ),
        payload.health,
      ];
      applySnapshot({ ...current, health });
    });
    return () => {
      offSnapshot();
      offOperation();
      offHealth();
    };
  }, [refresh, applySnapshot]);

  const healthById = useMemo(() => {
    const map = new Map<string, HealthSnapshot>();
    for (const health of snapshot?.health ?? []) {
      map.set(health.installationId, health);
    }
    return map;
  }, [snapshot]);

  const actions = useMemo<ManagerStore["actions"]>(
    () => ({
      install: (req) => managerRpc.request("install", req),
      update: (req) => managerRpc.request("update", req),
      repair: (req) => managerRpc.request("repair", req),
      uninstall: (req) => managerRpc.request("uninstall", req),
      register: (req) => managerRpc.request("register", req),
      unregister: (req) => managerRpc.request("unregister", req),
      batchUpdate: (ids) => managerRpc.request("batchUpdate", { installationIds: ids }),
      start: (id) => managerRpc.request("start", { installationId: id }),
      stop: (id) => managerRpc.request("stop", { installationId: id }),
      probe: (id) => managerRpc.request("probe", { installationId: id }),
      probeAll: () => managerRpc.request("probeAll"),
      cancel: (opId) => managerRpc.request("cancelOperation", { operationId: opId }),
      retry: (opId) => managerRpc.request("retryOperation", { operationId: opId }),
      refreshCatalog: (force) =>
        managerRpc.request("refreshCatalog", { force: force ?? false }),
      saveSettings: (settings) => managerRpc.request("saveSettings", settings),
      chooseDirectory: (kind) =>
        managerRpc.request("chooseDirectory", { kind }),
      openPath: (path, mode) => managerRpc.request("openPath", { path, mode }),
      logs: (req) => managerRpc.request("logs", req),
    }),
    [],
  );

  const runOperation = useCallback(
    async <T,>(fn: () => Promise<RpcResult<T>>): Promise<RpcResult<T>> => {
      const result = await fn();
      if (!result.ok) setLastError(result.error);
      return result;
    },
    [],
  );

  const value = useMemo<ManagerStore>(
    () => ({
      snapshot,
      healthById,
      loading,
      lastError,
      mode: managerRpc.mode,
      refresh,
      runOperation,
      actions,
    }),
    [snapshot, healthById, loading, lastError, refresh, runOperation, actions],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useManager(): ManagerStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useManager 必须在 ManagerProvider 内使用。");
  return store;
}

/** Convenience hooks for derived lists. */
export function useInstallations(): InstallationRecord[] {
  return useManager().snapshot?.installations ?? [];
}

export function useOperations(): OperationRecord[] {
  return useManager().snapshot?.operations ?? [];
}
