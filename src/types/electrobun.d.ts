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

  /** Size and position go through `frame`; there is no minimum-size option. */
  export interface BrowserWindowOptions {
    title?: string;
    /** Accepts a `views://<view>/<file>` URL, an absolute URL, or a file path. */
    url?: string;
    frame?: { x?: number; y?: number; width?: number; height?: number };
    renderer?: "native" | "cef";
    titleBarStyle?: "default" | "hidden" | "hiddenInset";
    transparent?: boolean;
    passthrough?: boolean;
    hidden?: boolean;
    rpc?: unknown;
  }

  export class BrowserWindow {
    constructor(options: BrowserWindowOptions);
    show(): void;
    hide(): void;
    close(): void;
    setSize(width: number, height: number): unknown;
    setFrame(x: number, y: number, width: number, height: number): unknown;
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

  /**
   * Shape of `electrobun.config.ts`. Mirrors what the 1.16.0 CLI actually reads;
   * the published tarball does not ship this type. Every field is optional
   * because the CLI shallow-merges the file over its own defaults.
   */
  export interface ElectrobunConfig {
    app?: {
      name?: string;
      identifier?: string;
      version?: string;
      description?: string;
      urlSchemes?: string[];
    };
    build?: {
      bun?: { entrypoint?: string };
      /** key: repo-root-relative source; value: path under `<bundle>/Resources/app/`. */
      copy?: Record<string, string>;
      views?: Record<string, { entrypoint: string; [key: string]: unknown }>;
      buildFolder?: string;
      artifactFolder?: string;
      /** Only honoured by `dev --watch` on POSIX; the CLI's ignore matching is `/`-only. */
      watchIgnore?: string[];
      watch?: string[];
      useAsar?: boolean;
      cefVersion?: string;
      bunVersion?: string;
      mac?: {
        bundleCEF?: boolean;
        bundleWGPU?: boolean;
        defaultRenderer?: "native" | "cef";
        chromiumFlags?: Record<string, string | boolean>;
        entitlements?: Record<string, boolean | string | string[]>;
        codesign?: boolean;
        notarize?: boolean;
        createDmg?: boolean;
        /** Path to a `.iconset` directory; consumed by `iconutil`, macOS hosts only. */
        icons?: string;
      };
      win?: {
        bundleCEF?: boolean;
        bundleWGPU?: boolean;
        defaultRenderer?: "native" | "cef";
        chromiumFlags?: Record<string, string | boolean>;
        /** `.ico` preferred; a `.png` is converted single-size by `png-to-ico`. */
        icon?: string;
      };
      linux?: {
        bundleCEF?: boolean;
        bundleWGPU?: boolean;
        defaultRenderer?: "native" | "cef";
        chromiumFlags?: Record<string, string | boolean>;
        /** PNG, >=256px. Also the switch that makes the CLI emit a `.desktop` file. */
        icon?: string;
      };
    };
    release?: {
      baseUrl?: string;
      generatePatch?: boolean;
    };
    runtime?: Record<string, unknown>;
    scripts?: {
      preBuild?: string;
      postBuild?: string;
      postWrap?: string;
      postPackage?: string;
    };
  }
}

declare module "electrobun/view" {
  export class Electroview {
    constructor(options: { rpc?: unknown });
    static defineRPC(options: {
      maxRequestTime?: number;
      handlers: {
        requests: Record<string, (params: never) => unknown>;
        messages?: Record<string, unknown>;
      };
    }): {
      send(messageType: string, payload?: unknown): void;
      request<T = unknown>(requestType: string, params?: unknown): Promise<T>;
      addMessageListener(
        messageType: string,
        listener: (payload: unknown) => void,
      ): void;
    };
  }
}
