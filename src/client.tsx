import { lazy, Suspense, Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

// --- Lazy-load the heavy voice module -------------------------------------
// The full app (React + voice SDK + AI SDK + UI) is ~150KB gzipped. On
// unstable connections to Cloudflare (e.g. from some regions) a large static
// asset can fail to download completely and, with no range/resume support,
// the page would stay blank. By loading the heavy part lazily behind a tiny
// shell, the page renders immediately and any download failure is caught and
// offered a retry instead of a blank screen.
const BuddyApp = lazy(() => import("./buddy-app"));

function LoadingShell() {
  return (
    <div className="buddy-app min-h-full flex items-center justify-center p-6">
      <div className="buddy-card max-w-md text-center">
        <h1 className="buddy-title">Buddy 英语老师</h1>
        <p className="text-kumo-secondary mt-2">正在加载…</p>
        <div className="mt-4 flex items-center justify-center gap-2 text-kumo-secondary">
          <span className="inline-block h-2 w-2 rounded-full bg-kumo-brand animate-pulse" />
          请稍候
        </div>
      </div>
    </div>
  );
}

// Catches a failed lazy load (network drop) and shows a retry instead of a
// blank page. A full reload re-attempts the download.
class ChunkErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="buddy-app min-h-full flex items-center justify-center p-6">
          <div className="buddy-card max-w-md text-center">
            <h1 className="buddy-title">加载失败</h1>
            <p className="text-kumo-secondary mt-2">
              语音模块没能完整下载，可能是网络不太稳定。
            </p>
            <button
              className="buddy-big-btn mt-4"
              onClick={() => window.location.reload()}
            >
              点击重试
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <ChunkErrorBoundary>
    <Suspense fallback={<LoadingShell />}>
      <BuddyApp />
    </Suspense>
  </ChunkErrorBoundary>
);
