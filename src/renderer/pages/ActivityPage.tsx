import { ActivityIcon, BanIcon, RotateCcwIcon } from "lucide-react";
import { EmptyState, OperationStatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useManager } from "@/lib/store";
import { formatBytes, formatTime, speedOf } from "@/lib/utils";

export function ActivityPage() {
  const { snapshot, actions, runOperation } = useManager();

  if (!snapshot) return null;

  const operations = snapshot.operations;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">活动记录</h1>
        <p className="text-muted-foreground text-xs">
          队列、阶段进度、下载速度与失败诊断。应用重启后仍可查看历史记录。
        </p>
      </div>

      {operations.length === 0 ? (
        <EmptyState
          icon={<ActivityIcon className="size-10" />}
          title="队列为空"
          description="安装、更新、修复与卸载操作会显示在这里，包括取消、重试与回滚状态。"
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {operations.map((op) => {
            const active = op.status === "running" || op.status === "queued";
            return (
              <li key={op.id} className="bg-card rounded-lg border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <OperationStatusBadge operation={op} />
                  <span className="text-sm font-medium">{op.message}</span>
                  <Badge variant="outline" className="font-mono text-[11px]">
                    {op.kind}
                  </Badge>
                  {op.previousVersion ? (
                    <span className="text-muted-foreground text-xs">
                      {op.previousVersion} → {op.releaseId ?? "…"}
                    </span>
                  ) : null}
                  <span className="text-muted-foreground ml-auto text-xs">
                    {formatTime(op.startedAt ?? op.createdAt)}
                    {op.finishedAt ? ` → ${formatTime(op.finishedAt)}` : ""}
                  </span>
                </div>

                {op.status === "running" ? (
                  <div className="mt-3">
                    <Progress value={op.progress} />
                    <div className="text-muted-foreground mt-1.5 flex flex-wrap gap-x-4 text-xs">
                      <span>{Math.round(op.progress)}%</span>
                      {op.totalBytes ? (
                        <span>
                          {formatBytes(op.bytesDownloaded)} / {formatBytes(op.totalBytes)}
                        </span>
                      ) : op.bytesDownloaded > 0 ? (
                        <span>{formatBytes(op.bytesDownloaded)}</span>
                      ) : null}
                      {op.status === "running" && op.bytesDownloaded > 0 ? (
                        <span>{speedOf(op.bytesDownloaded, op.startedAt ?? op.createdAt)}</span>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {op.error ? (
                  <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
                    <div className="font-medium">失败原因</div>
                    <div className="mt-0.5 break-all">{op.error}</div>
                  </div>
                ) : null}

                <div className="mt-3 flex gap-2">
                  {active && op.canCancel ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void runOperation(() => actions.cancel(op.id))}
                    >
                      <BanIcon /> 取消
                    </Button>
                  ) : null}
                  {op.canRetry ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void runOperation(() => actions.retry(op.id))}
                    >
                      <RotateCcwIcon /> 重试
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
