import {
  ActivityIcon,
  ArrowRightIcon,
  BoxesIcon,
  DownloadIcon,
  PlayCircleIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { HealthBadge, OperationStatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { PageKey } from "@/AppShell";
import { useManager } from "@/lib/store";
import { compareVersions } from "shared/semver";
import { formatTime } from "@/lib/utils";

export function OverviewPage({
  onNavigate,
}: {
  onNavigate: (page: PageKey) => void;
}) {
  const { snapshot, healthById, actions } = useManager();
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (snapshot && snapshot.health.every((h) => h.checkedAt.startsWith("1970"))) {
      setProbing(true);
      void actions.probeAll().finally(() => {
        if (!cancelled) setProbing(false);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [snapshot, actions]);

  if (!snapshot) return null;

  const managed = snapshot.installations.filter(
    (r) => r.ownership === "manager-managed",
  ).length;
  const legacy = snapshot.installations.length - managed;
  const updatable = countUpdatable(snapshot);
  const running = snapshot.installations.filter(
    (r) => healthById.get(r.id)?.status === "running",
  ).length;
  const unhealthy = snapshot.installations.filter((r) => {
    const status = healthById.get(r.id)?.status;
    return status === "unhealthy" || status === "not-installed";
  }).length;
  const recentOps = snapshot.operations.slice(0, 5);
  const activeOp = snapshot.operations.find(
    (op) => op.status === "running" || op.status === "queued",
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">概览</h1>
          <p className="text-muted-foreground text-xs">
            Tinadec 生态组件的安装、更新与健康状态一览。
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={probing}
          onClick={async () => {
            setProbing(true);
            await actions.probeAll();
            setProbing(false);
          }}
        >
          <RefreshCwIcon className={probing ? "animate-spin" : ""} />
          全部重新探测
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          label="已安装"
          value={`${snapshot.installations.length}`}
          hint={`托管 ${managed} · 旧登记 ${legacy}`}
          icon={<BoxesIcon className="size-4" />}
          onClick={() => onNavigate("installed")}
        />
        <StatCard
          label="可更新"
          value={`${updatable}`}
          hint={updatable > 0 ? "有新版本可用" : "暂无更新"}
          icon={<DownloadIcon className="size-4" />}
          onClick={() => onNavigate("updates")}
        />
        <StatCard
          label="运行中"
          value={`${running}`}
          hint={unhealthy > 0 ? `${unhealthy} 项异常/未安装` : "全部健康"}
          icon={<PlayCircleIcon className="size-4" />}
          onClick={() => onNavigate("installed")}
        />
        <StatCard
          label="进行中操作"
          value={`${snapshot.operations.filter((o) => o.status === "running" || o.status === "queued").length}`}
          hint={activeOp ? activeOp.message : "队列空闲"}
          icon={<ActivityIcon className="size-4" />}
          onClick={() => onNavigate("activity")}
        />
      </div>

      {activeOp ? (
        <div className="bg-card rounded-lg border p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <OperationStatusBadge operation={activeOp} />
              <span>{activeOp.message}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onNavigate("activity")}>
              活动记录
              <ArrowRightIcon />
            </Button>
          </div>
          <Progress value={activeOp.progress} />
          <div className="text-muted-foreground mt-1.5 text-xs">
            {activeOp.productId}
            {activeOp.totalBytes
              ? ` · 已下载 ${formatBytes(activeOp.bytesDownloaded)} / ${formatBytes(activeOp.totalBytes)}`
              : ""}
          </div>
        </div>
      ) : null}

      <div className="bg-card overflow-hidden rounded-lg border">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-medium">最近操作</span>
          <Button variant="ghost" size="sm" onClick={() => onNavigate("activity")}>
            查看全部
            <ArrowRightIcon />
          </Button>
        </div>
        {recentOps.length === 0 ? (
          <div className="text-muted-foreground px-4 py-8 text-center text-xs">
            暂无操作记录。到「产品目录」开始安装第一个组件。
          </div>
        ) : (
          <ul className="divide-y">
            {recentOps.map((op) => (
              <li key={op.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <OperationStatusBadge operation={op} />
                <span className="min-w-0 flex-1 truncate">{op.message}</span>
                <span className="text-muted-foreground text-xs">
                  {formatTime(op.finishedAt ?? op.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-card overflow-hidden rounded-lg border">
        <div className="border-b px-4 py-3 text-sm font-medium">组件状态</div>
        <ul className="divide-y">
          {snapshot.installations.map((record) => {
            const health = healthById.get(record.id);
            return (
              <li
                key={record.id}
                className="flex items-center gap-3 px-4 py-2.5 text-sm"
              >
                <HealthBadge health={health} />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {record.productId}
                  {record.activeVersion ? (
                    <Badge variant="outline" className="ml-2">
                      {record.activeVersion}
                    </Badge>
                  ) : null}
                </span>
                <span className="text-muted-foreground hidden truncate text-xs md:block">
                  {health?.message}
                </span>
              </li>
            );
          })}
          {snapshot.installations.length === 0 ? (
            <li className="text-muted-foreground px-4 py-8 text-center text-xs">
              尚未登记任何组件。
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  icon,
  onClick,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="bg-card hover:border-ring/40 flex cursor-pointer flex-col gap-1 rounded-lg border p-4 text-left transition-colors"
    >
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-muted-foreground truncate text-xs">{hint}</div>
    </button>
  );
}

function countUpdatable(snapshot: NonNullable<ReturnType<typeof useManager>["snapshot"]>): number {
  let count = 0;
  for (const record of snapshot.installations) {
    const product = snapshot.catalog.products.find((p) => p.id === record.productId);
    if (!product || product.releases.length === 0) continue;
    const latest = product.releases
      .filter((r) => r.channel === snapshot.settings.releaseChannel)
      .map((r) => r.version)
      .reduce((best, v) => (compareVersions(v, best) > 0 ? v : best), "0.0.0");
    if (compareVersions(latest, record.activeVersion ?? "0.0.0") > 0) count++;
  }
  return count;
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
