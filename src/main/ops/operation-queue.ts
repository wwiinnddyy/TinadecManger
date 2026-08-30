/**
 * Single operation orchestrator. Guarantees:
 * - one active operation per product (mutex), global concurrency configurable,
 * - fixed status lifecycle queued → … → succeeded/failed/cancelled/rolled-back,
 * - cancel and retry hooks, updates pushed to a listener (RPC event stream).
 */

import { randomUUID } from "node:crypto";
import type {
  OperationKind,
  OperationRecord,
} from "../../shared/domain";
import { ErrorCode, ManagerError } from "../../shared/errors";

export interface OperationHandle {
  record: OperationRecord;
  /** called by the flow to request cancellation-safe aborts */
  readonly abort: { cancelled: boolean };
  update: (patch: Partial<OperationRecord>) => void;
  throwIfCancelled: () => void;
}

export interface TaskDefinition {
  kind: OperationKind;
  productId: string;
  installationId?: string;
  releaseId?: string;
  previousVersion?: string;
  message: string;
  run: (handle: OperationHandle) => Promise<void>;
}

export class OperationQueue {
  private records = new Map<string, OperationRecord>();
  private handles = new Map<string, OperationHandle>();
  private pending: string[] = [];
  private running = 0;
  private listeners = new Set<(record: OperationRecord) => void>();
  private concurrency: number;
  private tasks = new Map<string, TaskDefinition>();

  constructor(options: { concurrency?: number } = {}) {
    this.concurrency = Math.max(1, options.concurrency ?? 2);
  }

  onOperationUpdate(listener: (record: OperationRecord) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(record: OperationRecord): void {
    for (const listener of this.listeners) listener(record);
  }

  list(): OperationRecord[] {
    return [...this.records.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  get(id: string): OperationRecord | undefined {
    return this.records.get(id);
  }

  /** True when the product already has a queued/running operation. */
  isBusy(productId: string): boolean {
    for (const record of this.records.values()) {
      if (
        record.productId === productId &&
        (record.status === "queued" || record.status === "running")
      ) {
        return true;
      }
    }
    return false;
  }

  setConcurrency(value: number): void {
    this.concurrency = Math.max(1, value);
    this.pump();
  }

  enqueue(task: TaskDefinition): OperationRecord {
    if (this.isBusy(task.productId)) {
      throw new ManagerError(
        ErrorCode.OperationConflict,
        `产品 ${task.productId} 已有进行中的操作，请等待完成或取消。`,
      );
    }
    const now = new Date().toISOString();
    const record: OperationRecord = {
      id: `op-${randomUUID().slice(0, 8)}`,
      kind: task.kind,
      status: "queued",
      phase: "queued",
      productId: task.productId,
      installationId: task.installationId,
      releaseId: task.releaseId,
      progress: 0,
      bytesDownloaded: 0,
      message: task.message,
      createdAt: now,
      canCancel: true,
      canRetry: false,
      previousVersion: task.previousVersion,
    };
    const handle: OperationHandle = {
      record,
      abort: { cancelled: false },
      update: (patch) => {
        Object.assign(record, patch);
        this.emit(record);
      },
      throwIfCancelled: () => {
        if (handle.abort.cancelled) {
          throw new ManagerError(ErrorCode.Cancelled, "操作已取消。");
        }
      },
    };
    this.records.set(record.id, record);
    this.handles.set(record.id, handle);
    this.tasks.set(record.id, task);
    this.pending.push(record.id);
    this.emit(record);
    this.pump();
    return record;
  }

  cancel(id: string): OperationRecord {
    const handle = this.handles.get(id);
    const record = this.records.get(id);
    if (!handle || !record) {
      throw new ManagerError(ErrorCode.NotFound, "操作不存在。");
    }
    if (record.status === "queued") {
      this.pending = this.pending.filter((pendingId) => pendingId !== id);
      handle.update({
        status: "cancelled",
        phase: "cleaning-up",
        canCancel: false,
        finishedAt: new Date().toISOString(),
        message: "已取消（排队中）。",
      });
      return record;
    }
    if (record.status === "running") {
      handle.abort.cancelled = true;
      return record;
    }
    throw new ManagerError(ErrorCode.InvalidArgument, "该操作已结束，无法取消。");
  }

  retry(id: string, rerun: (previous: OperationRecord) => TaskDefinition): OperationRecord {
    const previous = this.records.get(id);
    if (!previous) {
      throw new ManagerError(ErrorCode.NotFound, "操作不存在。");
    }
    if (previous.status !== "failed" && previous.status !== "cancelled" && previous.status !== "rolled-back") {
      throw new ManagerError(ErrorCode.InvalidArgument, "只有失败/取消/回滚的操作可以重试。");
    }
    return this.enqueue(rerun(previous));
  }

  private pump(): void {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const id = this.pending.shift()!;
      const handle = this.handles.get(id);
      if (!handle) continue;
      this.running++;
      void this.run(handle).finally(() => {
        this.running--;
        this.pump();
      });
    }
  }

  private async run(handle: OperationHandle): Promise<void> {
    const { record } = handle;
    handle.update({
      status: "running",
      startedAt: new Date().toISOString(),
    });
    try {
      await this.runWithCleanup(handle);
    } catch (error) {
      const cancelled =
        error instanceof ManagerError && error.code === ErrorCode.Cancelled;
      const isRollingBack = record.phase === "rolling-back";
      handle.update({
        status: isRollingBack
          ? "rolled-back"
          : cancelled
            ? "cancelled"
            : "failed",
        phase: isRollingBack ? "cleaning-up" : "cleaning-up",
        canCancel: false,
        canRetry: true,
        finishedAt: new Date().toISOString(),
        error:
          error instanceof Error
            ? `${error.message}${"detail" in error && error.detail ? ` (${(error as ManagerError).detail})` : ""}`
            : String(error),
        message: cancelled ? "操作已取消。" : "操作失败，可重试。",
      });
      // Non-Manager errors are logged by the flow itself.
      if (!(error instanceof ManagerError)) {
        console.error(`operation ${record.id} crashed`, error);
      }
    } finally {
      this.handles.delete(record.id);
    }
  }

  /**
   * Flows may implement their own rollback; when the flow converts a failure
   * into a rollback it sets phase=rolling-back itself, which this wrapper
   * translates into the rolled-back terminal status.
   */
  private async runWithCleanup(handle: OperationHandle): Promise<void> {
    await this.invokeRun(handle);
    // Success path
    handle.update({
      status: "succeeded",
      phase: "ready",
      progress: 100,
      canCancel: false,
      canRetry: false,
      finishedAt: new Date().toISOString(),
    });
  }

  /** Overridable seam so tests can inject behavior; default calls task run. */
  protected async invokeRun(handle: OperationHandle): Promise<void> {
    const task = this.tasks.get(handle.record.id);
    if (!task) throw new ManagerError(ErrorCode.Unknown, "任务定义丢失。");
    await task.run(handle);
  }
}
