import {
  ActivityIcon,
  AlertTriangleIcon,
  CircleDashedIcon,
  CircleXIcon,
  PlayCircleIcon,
  StopCircleIcon,
} from "lucide-react";
import type {
  HealthSnapshot,
  InstallationRecord,
  OperationRecord,
} from "shared/domain";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function HealthBadge({
  health,
  className,
}: {
  health: HealthSnapshot | undefined;
  className?: string;
}) {
  if (!health) {
    return (
      <Badge variant="secondary" className={cn("gap-1", className)}>
        <CircleDashedIcon className="size-3" /> 未探测
      </Badge>
    );
  }
  switch (health.status) {
    case "running":
      return (
        <Badge variant="success" className={cn("gap-1", className)}>
          <PlayCircleIcon className="size-3" /> 运行中
        </Badge>
      );
    case "stopped":
      return (
        <Badge variant="secondary" className={cn("gap-1", className)}>
          <StopCircleIcon className="size-3" /> 已停止
        </Badge>
      );
    case "unhealthy":
      return (
        <Badge variant="warning" className={cn("gap-1", className)}>
          <AlertTriangleIcon className="size-3" /> 异常
        </Badge>
      );
    case "not-installed":
      return (
        <Badge variant="danger" className={cn("gap-1", className)}>
          <CircleXIcon className="size-3" /> 未安装
        </Badge>
      );
    case "probing":
      return (
        <Badge variant="info" className={cn("gap-1", className)}>
          <ActivityIcon className="size-3" /> 探测中
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className={cn("gap-1", className)}>
          未知
        </Badge>
      );
  }
}

export const OPERATION_PHASE_LABEL: Record<OperationRecord["phase"], string> = {
  queued: "排队中",
  downloading: "下载中",
  verifying: "校验中",
  staging: "暂存中",
  installing: "安装中",
  ready: "就绪",
  "rolling-back": "回滚中",
  "cleaning-up": "清理中",
};

export function OperationStatusBadge({ operation }: { operation: OperationRecord }) {
  const { status } = operation;
  if (status === "succeeded")
    return (
      <Badge variant="success">
        {OPERATION_PHASE_LABEL[operation.phase]} · 成功
      </Badge>
    );
  if (status === "failed")
    return <Badge variant="danger">{OPERATION_PHASE_LABEL[operation.phase]} · 失败</Badge>;
  if (status === "cancelled")
    return <Badge variant="secondary">{OPERATION_PHASE_LABEL[operation.phase]} · 已取消</Badge>;
  if (status === "rolled-back")
    return <Badge variant="warning">{OPERATION_PHASE_LABEL[operation.phase]} · 已回滚</Badge>;
  if (status === "queued")
    return <Badge variant="outline">{OPERATION_PHASE_LABEL[operation.phase]}</Badge>;
  return (
    <Badge variant="info">
      {OPERATION_PHASE_LABEL[operation.phase]}
      {operation.progress > 0 ? ` ${Math.round(operation.progress)}%` : ""}
    </Badge>
  );
}

export function OwnershipBadge({ record }: { record: InstallationRecord }) {
  return record.ownership === "manager-managed" ? (
    <Badge variant="info">托管</Badge>
  ) : (
    <Badge variant="outline" title="旧登记：仅支持探测/启停/注销，不托管安装目录">
      旧登记
    </Badge>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-10 text-center">
      <div className="text-muted-foreground/70">{icon}</div>
      <div className="text-foreground text-sm font-medium">{title}</div>
      <div className="max-w-md text-xs leading-relaxed">{description}</div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
