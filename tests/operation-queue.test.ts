import { describe, expect, it, vi } from "vitest";
import { ErrorCode, ManagerError } from "../src/shared/errors";
import { OperationQueue, type TaskDefinition } from "../src/main/ops/operation-queue";

function makeTask(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    kind: "install",
    productId: "p1",
    message: "install p1",
    run: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
    ...overrides,
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timeout waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("operation queue", () => {
  it("runs operations to success with concurrency limit", async () => {
    const queue = new OperationQueue({ concurrency: 2 });
    let running = 0;
    let peak = 0;
    const listener = queue.onOperationUpdate(() => {});
    for (let i = 0; i < 5; i++) {
      queue.enqueue(
        makeTask({
          productId: `p${i}`,
          run: async () => {
            running++;
            peak = Math.max(peak, running);
            await new Promise((resolve) => setTimeout(resolve, 30));
            running--;
          },
        }),
      );
    }
    await waitFor(() => queue.list().every((op) => op.status === "succeeded"));
    expect(peak).toBeLessThanOrEqual(2);
    listener();
  });

  it("enforces a per-product mutex", async () => {
    const queue = new OperationQueue({ concurrency: 4 });
    queue.enqueue(makeTask({ productId: "same" }));
    try {
      queue.enqueue(makeTask({ productId: "same" }));
      expect.unreachable("应当拒绝同产品并发操作");
    } catch (error) {
      expect(error).toBeInstanceOf(ManagerError);
      expect((error as ManagerError).code).toBe(ErrorCode.OperationConflict);
    }
    await waitFor(() => !queue.isBusy("same"));
    // after completion, enqueue works again (pump may start it immediately)
    const second = queue.enqueue(makeTask({ productId: "same" }));
    expect(["queued", "running"]).toContain(second.status);
  });

  it("cancels queued operations immediately", async () => {
    const queue = new OperationQueue({ concurrency: 1 });
    queue.enqueue(makeTask({ productId: "blocker", run: async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    } }));
    const queued = queue.enqueue(makeTask({ productId: "victim" }));
    const cancelled = queue.cancel(queued.id);
    expect(cancelled.status).toBe("cancelled");
    await waitFor(() => queue.get(queued.id)!.status === "cancelled");
  });

  it("marks running operations cancelled through abort flag", async () => {
    const queue = new OperationQueue({ concurrency: 1 });
    const op = queue.enqueue(
      makeTask({
        productId: "cancellable",
        run: async (handle) => {
          await waitFor(() => handle.abort.cancelled);
          handle.throwIfCancelled();
        },
      }),
    );
    await waitFor(() => op.status === "running");
    queue.cancel(op.id);
    await waitFor(() => queue.get(op.id)!.status === "cancelled");
    expect(queue.get(op.id)!.canRetry).toBe(true);
  });

  it("captures failures and allows retry re-dispatch", async () => {
    const queue = new OperationQueue({ concurrency: 1 });
    const op = queue.enqueue(
      makeTask({
        productId: "doomed",
        run: async () => {
          throw new ManagerError(ErrorCode.ChecksumMismatch, "哈希不符");
        },
      }),
    );
    await waitFor(() => queue.get(op.id)!.status === "failed");
    expect(queue.get(op.id)!.error).toContain("哈希不符");
    expect(() => queue.retry(op.id, () => makeTask())).not.toThrow();
  });

  it("emits updates to listeners", async () => {
    const queue = new OperationQueue({ concurrency: 1 });
    const seen: string[] = [];
    const off = queue.onOperationUpdate((record) => seen.push(`${record.id}:${record.status}`));
    const op = queue.enqueue(makeTask({ productId: "emit" }));
    await waitFor(() => queue.get(op.id)!.status === "succeeded");
    expect(seen.some((entry) => entry.endsWith("queued"))).toBe(true);
    expect(seen.some((entry) => entry.endsWith("succeeded"))).toBe(true);
    off();
    void vi;
  });
});
