import { PackageOpenIcon } from "lucide-react";
import { useState } from "react";
import { EmptyState, OwnershipBadge } from "@/components/status";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { compareVersions } from "shared/semver";
import { useManager } from "@/lib/store";

export function UpdatesPage() {
  const { snapshot, actions, runOperation } = useManager();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);

  if (!snapshot) return null;

  const updates = snapshot.installations
    .map((record) => {
      const product = snapshot.catalog.products.find((p) => p.id === record.productId);
      if (!product || product.releases.length === 0) return null;
      const channel = snapshot.settings.releaseChannel;
      const releases = product.releases.filter((r) => r.channel === channel);
      if (releases.length === 0) return null;
      const latest = releases.reduce((best, r) =>
        compareVersions(r.version, best.version) > 0 ? r : best,
      );
      const current = record.activeVersion ?? record.lastKnownVersion ?? "0.0.0";
      if (compareVersions(latest.version, current) <= 0) return null;
      return { record, product, latest, current };
    })
    .filter((u): u is NonNullable<typeof u> => u !== null);

  const allSelected = updates.length > 0 && selected.size === updates.length;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const batchUpdate = async () => {
    setBatchBusy(true);
    await runOperation(() => actions.batchUpdate([...selected]));
    setSelected(new Set());
    setBatchBusy(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">更新</h1>
          <p className="text-muted-foreground text-xs">
            集中管理可升级组件。更新采用 staging + 原子切换，失败自动回滚到上一版本。
          </p>
        </div>
        {updates.length > 0 ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setSelected(allSelected ? new Set() : new Set(updates.map((u) => u.record.id)))
              }
            >
              {allSelected ? "取消全选" : "全选"}
            </Button>
            <Button
              size="sm"
              disabled={selected.size === 0 || batchBusy}
              onClick={() => void batchUpdate()}
            >
              批量更新（{selected.size}）
            </Button>
          </div>
        ) : null}
      </div>

      {updates.length === 0 ? (
        <EmptyState
          icon={<PackageOpenIcon className="size-10" />}
          title="无可用更新"
          description="所有已托管组件都处于最新版本，或目录中没有提供新版本。"
        />
      ) : (
        <>
          {updates.some((u) => u.record.ownership !== "manager-managed") ? (
            <Alert variant="info">
              <AlertTitle>部分旧登记不支持自动更新</AlertTitle>
              <AlertDescription>
                旧登记（legacy unmanaged）只记录本地路径，请到「已安装」重新登记或从目录安装托管版本。
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="bg-card overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>产品</TableHead>
                  <TableHead>当前版本</TableHead>
                  <TableHead>可用版本</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {updates.map(({ record, product, latest, current }) => {
                  const busy = snapshot.operations.some(
                    (op) =>
                      op.installationId === record.id &&
                      (op.status === "running" || op.status === "queued"),
                  );
                  return (
                    <TableRow key={record.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selected.has(record.id)}
                          onChange={() => toggle(record.id)}
                          disabled={record.ownership !== "manager-managed"}
                          className="accent-[var(--primary)]"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {product.name}
                          </span>
                          <OwnershipBadge record={record} />
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{current}</TableCell>
                      <TableCell>
                        <Badge variant="info" className="font-mono">
                          {latest.version}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {busy ? "更新进行中…" : "待更新"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || record.ownership !== "manager-managed"}
                          onClick={() =>
                            void runOperation(() =>
                              actions.update({
                                kind: "update",
                                productId: record.productId,
                                installationId: record.id,
                              }),
                            )
                          }
                        >
                          更新
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
