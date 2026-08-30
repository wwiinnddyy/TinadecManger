import {
  CircleAlertIcon,
  FolderOpenIcon,
  PackageOpenIcon,
  SearchIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/status";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProductFamily, ReleaseChannel } from "shared/domain";
import { satisfiesRange } from "shared/semver";
import { useManager } from "@/lib/store";
import { formatBytes, formatTime } from "@/lib/utils";

const FAMILY_LABEL: Record<ProductFamily, string> = {
  core: "核心",
  gateway: "网关",
  tools: "工具",
  app: "应用",
};

export function CatalogPage() {
  const { snapshot, actions, runOperation } = useManager();
  const [search, setSearch] = useState("");
  const [family, setFamily] = useState<ProductFamily | "all">("all");
  const [channel, setChannel] = useState<ReleaseChannel>("stable");
  const [installing, setInstalling] = useState<string | null>(null);
  const [wizard, setWizard] = useState<{
    productId: string;
    version: string;
    dependencyWarning?: string;
  } | null>(null);
  const [installRoot, setInstallRoot] = useState("");
  const [autoDetect, setAutoDetect] = useState(true);

  const products = useMemo(() => {
    const list = snapshot?.catalog.products ?? [];
    return list.filter((p) => {
      if (family !== "all" && p.family !== family) return false;
      if (search && !`${p.name} ${p.id} ${p.description}`.toLowerCase().includes(search.toLowerCase()))
        return false;
      return true;
    });
  }, [snapshot, search, family]);

  if (!snapshot) return null;

  const latestOf = (productId: string) => {
    const product = snapshot.catalog.products.find((p) => p.id === productId);
    const releases = (product?.releases ?? []).filter((r) => r.channel === channel);
    return releases.length > 0
      ? releases.reduce((best, r) => (r.version > best.version ? r : best))
      : null;
  };

  const openWizard = (productId: string) => {
    const release = latestOf(productId);
    if (!release) return;
    const missing = (release.dependencies ?? []).filter((dep) => {
      if (dep.optional) return false;
      const depRecord = snapshot.installations.find((r) => r.productId === dep.productId);
      const active = depRecord?.activeVersion ?? depRecord?.lastKnownVersion;
      return !active || !satisfiesRange(active, dep.versionRange);
    });
    setWizard({
      productId,
      version: release.version,
      dependencyWarning: missing.length
        ? `需要先安装依赖：${missing.map((d) => `${d.productId}（${d.versionRange}）`).join("、")}`
        : undefined,
    });
    setInstallRoot(snapshot.settings.installRoot || "");
    setAutoDetect(true);
  };

  const confirmInstall = async () => {
    if (!wizard) return;
    setInstalling(wizard.productId);
    const result = await runOperation(() =>
      actions.install({
        kind: "install",
        productId: wizard.productId,
        version: wizard.version,
      }),
    );
    setInstalling(null);
    if (result.ok) setWizard(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">产品目录</h1>
        <p className="text-muted-foreground text-xs">
          发现 Tinadec 生态产品，选择版本进行安装。目录源：{" "}
          {snapshot.catalogStatus.source ?? "builtin"}
          {snapshot.catalogStatus.message ? ` · ${snapshot.catalogStatus.message}` : ""}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <SearchIcon className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索产品…"
            className="pl-8"
          />
        </div>
        <Select value={family} onValueChange={(v) => setFamily(v as ProductFamily | "all")}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            {(Object.keys(FAMILY_LABEL) as ProductFamily[]).map((f) => (
              <SelectItem key={f} value={f}>
                {FAMILY_LABEL[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={channel} onValueChange={(v) => setChannel(v as ReleaseChannel)}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="stable">stable</SelectItem>
            <SelectItem value="canary">canary</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void runOperation(() => actions.refreshCatalog(true))}
        >
          刷新目录
        </Button>
      </div>

      {products.length === 0 ? (
        <EmptyState
          icon={<PackageOpenIcon className="size-10" />}
          title="没有匹配的产品"
          description="调整搜索词或筛选条件，或在设置中配置目录源后刷新。"
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {products.map((product) => {
            const release = latestOf(product.id);
            const installed = snapshot.installations.filter(
              (r) => r.productId === product.id,
            );
            const busy = installing === product.id;
            return (
              <li key={product.id} className="bg-card flex flex-col gap-2 rounded-lg border p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{product.name}</span>
                      <Badge variant="secondary">{FAMILY_LABEL[product.family]}</Badge>
                      {installed.length > 0 ? (
                        <Badge variant="success">已安装 ×{installed.length}</Badge>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-relaxed">
                      {product.description}
                    </p>
                  </div>
                </div>
                <div className="text-muted-foreground mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  {release ? (
                    <>
                      <span>
                        最新 <span className="text-foreground font-medium">{release.version}</span>
                        {release.artifacts[0] ? ` · ${formatBytes(release.artifacts[0].sizeBytes)}` : ""}
                      </span>
                      <span>发布于 {formatTime(release.publishedAt)}</span>
                    </>
                  ) : (
                    <span>当前渠道暂无版本（可本地登记）</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={!release || busy}
                    onClick={() => openWizard(product.id)}
                  >
                    {busy ? "已加入队列…" : release ? `安装 ${release.version}` : "无可用版本"}
                  </Button>
                  {product.allowMultipleInstances ? (
                    <Badge variant="outline" className="self-center">
                      支持多实例
                    </Badge>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={!!wizard} onOpenChange={(open) => !open && setWizard(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              安装 {wizard ? snapshot.catalog.products.find((p) => p.id === wizard.productId)?.name : ""}
            </DialogTitle>
            <DialogDescription>
              版本 {wizard?.version} · 安装到托管目录（versions/active.json 指针管理）
            </DialogDescription>
          </DialogHeader>
          {wizard?.dependencyWarning ? (
            <Alert variant="warning">
              <CircleAlertIcon />
              <AlertTitle>依赖未满足</AlertTitle>
              <AlertDescription>{wizard.dependencyWarning}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex items-center gap-2">
            <Input
              value={installRoot}
              onChange={(e) => {
                setInstallRoot(e.target.value);
                setAutoDetect(false);
              }}
              placeholder="安装根目录"
              disabled={autoDetect}
            />
            <Button
              variant="outline"
              size="icon"
              disabled={autoDetect}
              onClick={async () => {
                const result = await actions.chooseDirectory("directory");
                if (result.ok && result.value[0]) setInstallRoot(result.value[0]);
              }}
            >
              <FolderOpenIcon />
            </Button>
          </div>
          <label className="text-muted-foreground flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={autoDetect}
              onChange={(e) => setAutoDetect(e.target.checked)}
              className="accent-[var(--primary)]"
            />
            使用默认安装根目录（C:\…\Tinadec\apps）
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWizard(null)}>
              取消
            </Button>
            <Button onClick={() => void confirmInstall()} disabled={installing !== null}>
              {installing ? "加入队列…" : "开始安装"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
