import { FolderOpenIcon, InfoIcon, SaveIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { AppSettings, ThemeMode } from "shared/domain";
import { useManager } from "@/lib/store";

export function SettingsPage() {
  const { snapshot, actions, runOperation, mode } = useManager();
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (snapshot?.settings && !draft) {
      setDraft({ ...snapshot.settings });
    }
  }, [snapshot, draft]);

  if (!snapshot || !draft) return null;

  const patch = (part: Partial<AppSettings>) => {
    setDraft({ ...draft, ...part });
    setSaved(false);
  };

  const save = async () => {
    const result = await runOperation(() => actions.saveSettings(draft));
    if (result.ok) {
      setSaved(true);
      applyTheme(draft.theme);
    }
  };

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">设置</h1>
          <p className="text-muted-foreground text-xs">
            安装目录、目录源、网络与界面行为。危险操作在执行时二次确认。
          </p>
        </div>
        <Button size="sm" onClick={() => void save()}>
          <SaveIcon /> {saved ? "已保存" : "保存"}
        </Button>
      </div>

      {mode === "mock" ? (
        <Alert variant="info">
          <InfoIcon />
          <AlertTitle>浏览器 mock 模式</AlertTitle>
          <AlertDescription>
            设置仅保存在页面内存中。在 Electrobun 应用内会持久化到 %APPDATA%/TinadecManger。
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="bg-card flex flex-col gap-4 rounded-lg border p-4">
        <h2 className="text-sm font-medium">安装与目录源</h2>
        <div className="flex flex-col gap-1.5">
          <Label>安装根目录</Label>
          <div className="flex gap-2">
            <Input
              value={draft.installRoot}
              onChange={(e) => patch({ installRoot: e.target.value })}
              placeholder="C:\Users\…\AppData\Local\Tinadec\apps"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={async () => {
                const result = await actions.chooseDirectory("directory");
                if (result.ok && result.value[0]) patch({ installRoot: result.value[0] });
              }}
            >
              <FolderOpenIcon />
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            托管安装以 versions/active.json 指针管理，回滚依赖上一版本目录。
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>目录源 URL（可选）</Label>
          <Input
            value={draft.catalogUrl}
            onChange={(e) => patch({ catalogUrl: e.target.value })}
            placeholder="https://catalog.example.com/manifest.json（留空使用内置离线目录）"
          />
          <div className="flex items-center gap-2 text-xs">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runOperation(() => actions.refreshCatalog(true))}
            >
              立即刷新
            </Button>
            <Badge variant="secondary">{snapshot.catalogStatus.state}</Badge>
            <span className="text-muted-foreground truncate">
              {snapshot.catalogStatus.message ?? ""}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>发布渠道</Label>
          <Select
            value={draft.releaseChannel}
            onValueChange={(v) => patch({ releaseChannel: v as AppSettings["releaseChannel"] })}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stable">stable（稳定）</SelectItem>
              <SelectItem value="canary">canary（尝鲜）</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      <section className="bg-card flex flex-col gap-4 rounded-lg border p-4">
        <h2 className="text-sm font-medium">更新策略</h2>
        <div className="flex flex-col gap-3 text-sm">
          <CheckRow
            label="启动时自动检查更新"
            checked={draft.autoCheckForUpdates}
            onChange={(v) => patch({ autoCheckForUpdates: v })}
          />
          <CheckRow
            label="自动安装更新（下载并切换活动版本）"
            checked={draft.autoUpdate}
            onChange={(v) => patch({ autoUpdate: v })}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>并发操作数</Label>
            <Input
              type="number"
              min={1}
              max={8}
              value={draft.operationConcurrency}
              onChange={(e) => patch({ operationConcurrency: Number(e.target.value) || 2 })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>网络超时（秒）</Label>
            <Input
              type="number"
              min={5}
              max={300}
              value={draft.networkTimeoutSeconds}
              onChange={(e) => patch({ networkTimeoutSeconds: Number(e.target.value) || 30 })}
            />
          </div>
        </div>
      </section>

      <section className="bg-card flex flex-col gap-4 rounded-lg border p-4">
        <h2 className="text-sm font-medium">外观与窗口</h2>
        <div className="flex flex-col gap-1.5">
          <Label>主题</Label>
          <Select
            value={draft.theme}
            onValueChange={(v) => {
              patch({ theme: v as ThemeMode });
              applyTheme(v as ThemeMode);
            }}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">跟随系统</SelectItem>
              <SelectItem value="dark">深色</SelectItem>
              <SelectItem value="light">浅色</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-3 text-sm">
          <CheckRow
            label="关闭窗口时最小化到托盘"
            checked={draft.minimizeToTray}
            onChange={(v) => patch({ minimizeToTray: v })}
          />
          <CheckRow
            label="仪表盘自动刷新"
            checked={draft.dashboardAutoRefresh}
            onChange={(v) => patch({ dashboardAutoRefresh: v })}
          />
        </div>
        {draft.dashboardAutoRefresh ? (
          <div className="flex flex-col gap-1.5">
            <Label>刷新间隔（秒）</Label>
            <Input
              type="number"
              min={5}
              max={600}
              className="w-40"
              value={draft.dashboardRefreshIntervalSeconds}
              onChange={(e) =>
                patch({
                  dashboardRefreshIntervalSeconds: Number(e.target.value) || 30,
                })
              }
            />
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label>Core / Gateway 地址</Label>
          <Input
            value={draft.coreUrl}
            onChange={(e) => patch({ coreUrl: e.target.value })}
          />
          <Separator />
          <Input
            value={draft.gatewayUrl}
            onChange={(e) => patch({ gatewayUrl: e.target.value })}
          />
        </div>
      </section>

      <p className="text-muted-foreground text-xs">
        Tinadec Manager v{snapshot.appVersion} · {snapshot.platform}/{snapshot.architecture} ·
        数据目录 %APPDATA%/TinadecManger
      </p>
    </div>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[var(--primary)]"
      />
      {label}
    </label>
  );
}

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  root.classList.remove("dark");
  const prefersDark =
    window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
  if (theme === "dark" || (theme === "system" && prefersDark)) {
    root.classList.add("dark");
  }
}
export { applyTheme };
