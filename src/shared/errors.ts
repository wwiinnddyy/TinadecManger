/**
 * Structured error codes shared across the RPC boundary.
 * The main process always returns `RpcResult<T>` objects instead of throwing
 * across the wire, so the renderer can render failures without parsing text.
 */

export const ErrorCode = {
  Unknown: "unknown",
  NotFound: "not-found",
  InvalidArgument: "invalid-argument",
  UnsupportedPlatform: "unsupported-platform",
  NotInstalled: "not-installed",
  AlreadyInstalled: "already-installed",
  OperationConflict: "operation-conflict",
  CatalogUnavailable: "catalog-unavailable",
  CatalogInvalid: "catalog-invalid",
  ManifestRejected: "manifest-rejected",
  DownloadFailed: "download-failed",
  ChecksumMismatch: "checksum-mismatch",
  SignatureRequired: "signature-required",
  SignatureMismatch: "signature-mismatch",
  ArchiveInvalid: "archive-invalid",
  PathTraversal: "path-traversal",
  DiskFull: "disk-full",
  ArtifactLocked: "artifact-locked",
  VerificationFailed: "verification-failed",
  ProbeFailed: "probe-failed",
  Cancelled: "cancelled",
  LegacyProtected: "legacy-protected",
  LaunchUnsupported: "launch-unsupported",
  ExecutableMissing: "executable-missing",
  DependencyUnsatisfied: "dependency-unsatisfied",
  MinimumManagerVersion: "minimum-manager-version",
  IoError: "io-error",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Domain error carrying a stable code; thrown inside main, converted at RPC edge. */
export class ManagerError extends Error {
  readonly code: ErrorCode;
  readonly detail?: string;

  constructor(code: ErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "ManagerError";
    this.code = code;
    this.detail = detail;
  }

  toRpc(): RpcError {
    return { code: this.code, message: this.message, detail: this.detail };
  }

  static from(err: unknown): RpcError {
    if (err instanceof ManagerError) return err.toRpc();
    if (err instanceof Error) {
      return { code: ErrorCode.Unknown, message: err.message };
    }
    return { code: ErrorCode.Unknown, message: String(err) };
  }
}

export interface RpcError {
  code: ErrorCode;
  message: string;
  detail?: string;
}

export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: RpcError };

export const ok = <T>(value: T): RpcResult<T> => ({ ok: true, value });
export const fail = (error: RpcError): RpcResult<never> => ({ ok: false, error });
