import {
  FolderOpenIcon,
  HammerIcon,
  PlayIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  SquareIcon,
  Trash2Icon,
  UnplugIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { HealthBadge, EmptyState, OwnershipBadge } from "@/components/status";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { InstallationRecord, LogEntry } from "shared/domain";
import { useManager } from "@/lib/store";
import { formatTime } from "@/lib/utils";

export function InstalledPage() {
  const { snapshot, healthById, actions, runOperation } = useManager();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerPath, setRegisterPath] = useState("");
  const [registerEndpoint, setRegisterEndpoint] = useState("");
  const [registerProduct, setRegisterProduct] = useState("");
  const [uninstallTarget, setUninstallTarget] = useState<InstallationRecord | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      setUninstallTarget((event as CustomEvent<InstallationRecord>).detail);
    };
    window.addEventListener("tinadec:request-uninstall", handler);
    return () => window.removeEventListener("tinadec:request-uninstall", handler);
  }, []);

  const installations = snapshot?.installations ?? [];
  const selected = installations.find((r) => r.id === selectedId) ?? installations[0];

  if (!snapshot) return null;

  const busyIds = new Set(
    snapshot.operations
      .filter((op) => op.status === "running" || op.status === "queued")
      .map((op) => op.installationId ?? op.productId),
  );

  const confirmUninstall = async () => {
    if (!uninstallTarget) return;
    await runOperation(() =>
      actions.uninstall({
        installationId: uninstallTarget.id,
        confirmed: true,
        deleteFiles: uninstallTarget.ownership === "manager-managed",
      }),
    );
    setUninstallTarget(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">已安装</h1>
          <p className="text-muted-foreground text-xs">
            本机登记的 Tinadec 组件。旧登记仅支持探测、启停与注销。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setRegisterOpen(true)}>
          <UnplugIcon />
          登记本地组件
        </Button>
      </div>

      {installations.length === 0 ? (
        <EmptyState
          icon={<ScrollTextIcon className="size-10" />}
          title="尚未安装任何组件"
          description="从产品目录安装，或在此登记磁盘上已有的 Tinadec 组件。"
          action={<Button onClick={() => setRegisterOpen(true)}>登记本地组件</Button>}
        />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(320px,5fr)_minmax(360px,7fr)]">
          <ul className="bg-card min-h-0 divide-y overflow-y-auto rounded-lg border">
            {installations.map((record) => {
              const health = healthById.get(record.id);
              const isBusy = busyIds.has(record.id);
              return (
                <li
                  key={record.id}
                  onClick={() => setSelectedId(record.id)}
                  className={
                    "flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors " +
                    (selected?.id === record.id ? "bg-accent" : "hover:bg-muted/50")
                  }
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {snapshot.catalog.products.find((p) => p.id === record.productId)
                          ?.name ?? record.productId}
                      </span>
                      <OwnershipBadge record={record} />
                      {isBusy ? <Badge variant="info">操作中</Badge> : null}
                    </div>
                    <div className="text-muted-foreground mt-0.5 truncate text-xs">
                      {record.activeVersion ?? record.lastKnownVersion ?? "未知版本"}
                      {" · "}
                      {record.path}
                    </div>
                  </div>
                  <HealthBadge health={health} />
                </li>
              );
            })}
          </ul>

          {selected ? (
            <InstalledDetail
              record={selected}
              busy={busyIds.has(selected.id)}
            />
          ) : null}
        </div>
      )}

      {/* 卸载确认 */}
      <AlertDialog open={!!uninstallTarget} onOpenChange={(o) => !o && setUninstallTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认卸载 {uninstallTarget?.productId}？</AlertDialogTitle>
            <AlertDialogDescription>
              {uninstallTarget?.ownership === "manager-managed"
                ? "将停止运行中的实例、删除托管版本目录并移除登记。该操作不可撤销。"
                : "该记录为旧登记（legacy unmanaged），不会删除磁盘文件，仅移除登记信息。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void confirmUninstall()}
            >
              确认卸载
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 登记本地组件 */}
      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>登记本地组件</DialogTitle>
            <DialogDescription>
              登记磁盘上已有的组件目录。bun-script 需要 src/index.ts，其余按期望产物校验。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>产品</Label>
              <select
                value={registerProduct}
                onChange={(e) => setRegisterProduct(e.target.value)}
                className="border-input bg-background h-9 rounded-md border px-3 text-sm"
              >
                <option value="">选择产品…</option>
                {snapshot.catalog.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>安装目录</Label>
              <div className="flex gap-2">
                <Input
                  value={registerPath}
                  onChange={(e) => setRegisterPath(e.target.value)}
                  placeholder="C:\\path\\to\\component"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={async () => {
                    const result = await actions.chooseDirectory("directory");
                    if (result.ok && result.value[0]) setRegisterPath(result.value[0]);
                  }}
                >
                  <FolderOpenIcon />
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>HTTP 探测地址覆盖（可选）</Label>
              <Input
                value={registerEndpoint}
                onChange={(e) => setRegisterEndpoint(e.target.value)}
                placeholder="http://127.0.0.1:48731/api/v1/health"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegisterOpen(false)}>
              取消
            </Button>
            <Button
              disabled={!registerProduct || !registerPath}
              onClick={async () => {
                const result = await runOperation(() =>
                  actions.register({
                    productId: registerProduct,
                    path: registerPath,
                    endpointOverride: registerEndpoint || undefined,
                  }),
                );
                if (result.ok) {
                  setRegisterOpen(false);
                  setRegisterPath("");
                  setRegisterEndpoint("");
                  setRegisterProduct("");
                }
              }}
            >
              登记
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InstalledDetail({
  record,
  busy,
}: {
  record: InstallationRecord;
  busy: boolean;
}) {
  const { snapshot, healthById, actions, runOperation } = useManager();
  const [logsOpen, setLogsOpen] = useState(false);
  const health = healthById.get(record.id);
  const product = snapshot?.catalog.products.find((p) => p.id === record.productId);
  const canLaunch = product?.supportsStandaloneLaunch ?? true;

  return (
    <div className="bg-card flex min-h-0 flex-col gap-3 overflow-y-auto rounded-lg border p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">
            {product?.name ?? record.productId}
          </div>
          <div className="text-muted-foreground mt-0.5 text-xs">
            {record.id} · {record.source}
          </div>
        </div>
        <HealthBadge health={health} />
      </div>

      <Separator />

      <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">版本</dt>
        <dd>{record.activeVersion ?? record.lastKnownVersion ?? "—"}</dd>
        <dt className="text-muted-foreground">路径</dt>
        <dd className="truncate" title={record.path}>{record.path}</dd>
        <dt className="text-muted-foreground">探测</dt>
        <dd className="truncate">
          {product?.probe === "http-health"
            ? record.endpointOverride ?? product.probeTarget
            : product?.probe ?? "—"}
        </dd>
        <dt className="text-muted-foreground">登记时间</dt>
        <dd>{formatTime(record.registeredAt)}</dd>
        <dt className="text-muted-foreground">最近检查</dt>
        <dd>{formatTime(health?.checkedAt)}</dd>
      </dl>
      {health?.message ? (
        <div className="text-muted-foreground rounded-md bg-muted/50 px-3 py-2 text-xs">
          {health.message}
        </div>
      ) : null}

      <Separator />

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy || !canLaunch || health?.status === "running"}
          title={canLaunch ? undefined : "该组件由 Core 托管，不支持独立启动"}
          onClick={() => void runOperation(() => actions.start(record.id))}
        >
          <PlayIcon /> 启动
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || health?.status !== "running"}
          onClick={() => void runOperation(() => actions.stop(record.id))}
        >
          <SquareIcon /> 停止
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void runOperation(() => actions.probe(record.id))}
        >
          <RefreshCwIcon /> 重新探测
        </Button>
        {record.ownership === "manager-managed" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void runOperation(() =>
                actions.repair({
                  kind: "repair",
                  productId: record.productId,
                  installationId: record.id,
                }),
              )
            }
          >
            <HammerIcon /> 修复
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          onClick={() => void runOperation(() => actions.openPath(record.path, "directory"))}
        >
          <FolderOpenIcon /> 打开目录
        </Button>
        <Button size="sm" variant="outline" onClick={() => setLogsOpen(true)}>
          <ScrollTextIcon /> 实时日志
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={busy}
          className="ml-auto"
          onClick={() => {
            // 触发父级确认弹窗：通过自定义事件避开 prop drilling
            window.dispatchEvent(
              new CustomEvent("tinadec:request-uninstall", { detail: record }),
            );
          }}
        >
          <Trash2Icon /> 卸载
        </Button>
      </div>

      <LogsDialog
        open={logsOpen}
        onOpenChange={setLogsOpen}
        installationId={record.id}
      />
    </div>
  );
}

function LogsDialog({
  open,
  onOpenChange,
  installationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  installationId: string;
}) {
  const { actions } = useManager();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const poll = async () => {
      const result = await actions.logs({ installationId, tail: 200 });
      if (alive && result.ok) setEntries(result.value);
    };
    void poll();
    const timer = setInterval(poll, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [open, installationId, actions]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [entries]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>组件日志</DialogTitle>
          <DialogDescription>stdout/stderr 与探测输出（每秒刷新）。</DialogDescription>
        </DialogHeader>
        <div className="bg-muted/40 h-80 overflow-y-auto rounded-md p-3 font-mono text-xs leading-relaxed">
          {entries.length === 0 ? (
            <div className="text-muted-foreground">暂无日志。</div>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="whitespace-pre-wrap break-all">
                <span className="text-muted-foreground">
                  {formatTime(entry.timestamp)} [{entry.level}]
                </span>{" "}
                {entry.message}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
