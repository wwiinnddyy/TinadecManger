import {
  ActivityIcon,
  BoxesIcon,
  DownloadIcon,
  LayoutDashboardIcon,
  PackageSearchIcon,
  SettingsIcon,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useManager } from "@/lib/store";
import { cn } from "@/lib/utils";
import { OverviewPage } from "@/pages/OverviewPage";
import { CatalogPage } from "@/pages/CatalogPage";
import { InstalledPage } from "@/pages/InstalledPage";
import { UpdatesPage } from "@/pages/UpdatesPage";
import { ActivityPage } from "@/pages/ActivityPage";
import { SettingsPage } from "@/pages/SettingsPage";

export type PageKey =
  | "overview"
  | "catalog"
  | "installed"
  | "updates"
  | "activity"
  | "settings";

const NAV_ITEMS: { key: PageKey; label: string; icon: React.ReactNode }[] = [
  { key: "overview", label: "概览", icon: <LayoutDashboardIcon className="size-4" /> },
  { key: "catalog", label: "产品目录", icon: <PackageSearchIcon className="size-4" /> },
  { key: "installed", label: "已安装", icon: <BoxesIcon className="size-4" /> },
  { key: "updates", label: "更新", icon: <DownloadIcon className="size-4" /> },
  { key: "activity", label: "活动记录", icon: <ActivityIcon className="size-4" /> },
  { key: "settings", label: "设置", icon: <SettingsIcon className="size-4" /> },
];

export function AppShell() {
  const [page, setPage] = useState<PageKey>(() => {
    const stored = sessionStorage.getItem("tinadec.page");
    return (NAV_ITEMS.some((i) => i.key === stored) ? stored : "overview") as PageKey;
  });
  const { snapshot, loading, mode } = useManager();

  const navigate = (key: PageKey) => {
    setPage(key);
    sessionStorage.setItem("tinadec.page", key);
  };

  const catalogStatus = snapshot?.catalogStatus;
  const activeOps = (snapshot?.operations ?? []).filter(
    (op) => op.status === "running" || op.status === "queued",
  ).length;

  return (
    <div className="bg-background text-foreground flex h-screen w-screen overflow-hidden">
      {/* 侧边导航 */}
      <aside className="bg-sidebar flex w-14 flex-col items-center gap-1 border-r py-3 lg:w-52 lg:items-stretch lg:px-3">
        <div className="mb-3 flex items-center gap-2 px-1.5">
          <img
            src="../../../assets/tinadec-logo.png"
            alt="Tinadec"
            className="size-7 rounded-md object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <span className="hidden text-sm font-semibold lg:block">Tinadec 管理器</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              onClick={() => navigate(item.key)}
              className={cn(
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground text-sidebar-foreground/80 relative flex cursor-pointer items-center justify-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors lg:justify-start",
                page === item.key &&
                  "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
              )}
              title={item.label}
            >
              {item.icon}
              <span className="hidden lg:block">{item.label}</span>
              {item.key === "updates" && countUpdatable(snapshot) > 0 ? (
                <Badge variant="info" className="ml-auto hidden px-1.5 lg:flex">
                  {countUpdatable(snapshot)}
                </Badge>
              ) : null}
              {item.key === "activity" && activeOps > 0 ? (
                <span className="absolute top-1.5 right-1.5 hidden size-2 animate-pulse rounded-full bg-sky-500 lg:block" />
              ) : null}
            </button>
          ))}
        </nav>
        <Separator className="mb-2 hidden lg:block" />
        <div className="text-muted-foreground hidden flex-col gap-0.5 px-2 pb-1 text-[11px] leading-tight lg:flex">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "size-1.5 rounded-full",
                catalogStatus?.state === "ok"
                  ? "bg-emerald-500"
                  : catalogStatus?.state === "offline"
                    ? "bg-amber-500"
                    : "bg-zinc-500",
              )}
            />
            <span className="truncate">
              目录：
              {{
                remote: "远程",
                cache: "缓存",
                fixture: "fixture",
                builtin: "内置",
              }[catalogStatus?.source ?? "builtin"] ?? "—"}
            </span>
          </div>
          <div>
            {mode === "mock" ? "浏览器 mock · " : ""}v{snapshot?.appVersion ?? "…"}
            {loading ? " · 同步中" : ""}
          </div>
        </div>
      </aside>

      {/* 主内容 */}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-4 py-4 lg:px-6">
            {page === "overview" && <OverviewPage onNavigate={navigate} />}
            {page === "catalog" && <CatalogPage />}
            {page === "installed" && <InstalledPage />}
            {page === "updates" && <UpdatesPage />}
            {page === "activity" && <ActivityPage />}
            {page === "settings" && <SettingsPage />}
          </div>
        </div>
      </main>
    </div>
  );
}

function countUpdatable(snapshot: ReturnType<typeof useManager>["snapshot"]): number {
  if (!snapshot) return 0;
  let count = 0;
  for (const record of snapshot.installations) {
    const product = snapshot.catalog.products.find((p) => p.id === record.productId);
    if (!product || product.releases.length === 0) continue;
    const latest = product.releases
      .filter((r) => r.channel === (snapshot.settings.releaseChannel ?? "stable"))
      .map((r) => r.version)
      .sort()
      .at(-1);
    if (latest && latest !== record.activeVersion) count++;
  }
  return count;
}

export { Button };
