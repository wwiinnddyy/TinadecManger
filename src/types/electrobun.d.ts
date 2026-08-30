/**
 * Local type declarations for the Electrobun APIs this app uses.
 *
 * The published electrobun package ships .ts sources whose bundled `three`
 * and FFI modules don't typecheck cleanly, and `skipLibCheck` only applies to
 * .d.ts files. Mapping the module names here keeps the typecheck surface
 * fully under our control while Bun still resolves the real package at
 * runtime (paths mappings affect types only).
 */

declare module "electrobun" {
  /** Minimal RPC handle used by both sides. Typed loosely on purpose; the
   * application-level contract lives in src/shared/rpc.ts. */
  export interface ElectrobunRPCHandle {
    send(messageType: string, payload?: unknown): void;
    request<T = unknown>(requestType: string, params?: unknown): Promise<T>;
    addMessageListener(
      messageType: string,
      listener: (payload: unknown) => void,
    ): void;
  }

  export interface BrowserWindowOptions {
    title?: string;
    url?: string;
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    rpc?: unknown;
    hidden?: boolean;
    [key: string]: unknown;
  }

  export class BrowserWindow {
    constructor(options: BrowserWindowOptions);
    show(): void;
    hide(): void;
    close(): void;
  }

  export interface TrayOptions {
    tooltip?: string;
    onClick?: () => void;
    [key: string]: unknown;
  }

  export class Tray {
    constructor(options: TrayOptions);
  }

  export const Utils: {
    openFileDialog(options: {
      canChooseDirectories?: boolean;
      canChooseFiles?: boolean;
      startingFolder?: string;
      fileTypes?: string;
    }): Promise<{ paths: string[] } | null>;
    openPath(path: string): Promise<void>;
    showMessageBox?(options: unknown): Promise<unknown>;
  };

  export function defineElectrobunRPC(
    role: "bun" | "webview",
    options: {
      maxRequestTime?: number;
      handlers: {
        requests: Record<string, (params: never) => unknown>;
        messages?: Record<string, unknown>;
      };
    },
  ): ElectrobunRPCHandle;
}

declare module "electrobun/view" {
  export class Electroview {
    constructor(options: { rpc?: unknown });
  }

  export function defineElectrobunRPC(
    role: "bun" | "webview",
    options: {
      maxRequestTime?: number;
      handlers: {
        requests: Record<string, (params: never) => unknown>;
        messages?: Record<string, unknown>;
      };
    },
  ): {
    send(messageType: string, payload?: unknown): void;
    request<T = unknown>(requestType: string, params?: unknown): Promise<T>;
    addMessageListener(
      messageType: string,
      listener: (payload: unknown) => void,
    ): void;
  };
}
