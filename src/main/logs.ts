/**
 * In-memory log store with an optional persistence cap. Component stdout/stderr,
 * probe results, and operation diagnostics all flow through here.
 */

import type { LogEntry, LogLevel } from "../shared/domain";

const MAX_ENTRIES = 2000;

let nextId = 1;

export class LogStore {
  private entries: LogEntry[] = [];
  private listeners = new Set<(entry: LogEntry) => void>();

  append(
    level: LogLevel,
    message: string,
    context?: { installationId?: string; operationId?: string },
  ): LogEntry {
    const entry: LogEntry = {
      id: `log-${nextId++}`,
      timestamp: new Date().toISOString(),
      level,
      message,
      installationId: context?.installationId,
      operationId: context?.operationId,
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
    for (const listener of this.listeners) listener(entry);
    return entry;
  }

  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  query(options: { installationId?: string; tail?: number } = {}): LogEntry[] {
    let filtered = this.entries;
    if (options.installationId) {
      filtered = filtered.filter(
        (e) => e.installationId === options.installationId,
      );
    }
    return options.tail && options.tail > 0
      ? filtered.slice(-options.tail)
      : [...filtered];
  }
}
