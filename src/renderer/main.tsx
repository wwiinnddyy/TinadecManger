import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "@/AppShell";
import { applyTheme } from "@/pages/SettingsPage";
import { ManagerProvider, useManager } from "@/lib/store";
import "@/styles.css";

/** Global error boundary so a renderer crash shows actionable UI. */
function ErrorBoundary({ children }: { children: React.ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onUnhandled = (event: PromiseRejectionEvent) => {
      setError(String(event.reason));
    };
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => window.removeEventListener("unhandledrejection", onUnhandled);
  }, []);

  if (error) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background p-8">
        <div className="max-w-lg rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <h1 className="text-destructive text-lg font-semibold">界面发生错误</h1>
          <p className="text-muted-foreground mt-2 font-mono text-xs break-all">{error}</p>
          <button
            className="bg-primary text-primary-foreground mt-4 cursor-pointer rounded-md px-4 py-2 text-sm"
            onClick={() => location.reload()}
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }
  return children as React.ReactElement;
}

function ThemeInit() {
  const { snapshot } = useManager();
  useEffect(() => {
    if (snapshot?.settings.theme) applyTheme(snapshot.settings.theme);
  }, [snapshot?.settings.theme]);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ManagerProvider>
        <ThemeInit />
        <AppShell />
      </ManagerProvider>
    </ErrorBoundary>
  </StrictMode>,
);
