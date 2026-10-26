import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./buddy-app";

// A small boundary so a runtime render error shows a friendly message
// instead of a blank screen. (Module/network load failures are handled by
// the inline fallback in index.html, since a failed <script> fetch can't be
// caught by React.)
class ErrorBoundary extends Component<
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
            <h1 className="buddy-title">出错了</h1>
            <p className="text-kumo-secondary mt-2">
              应用运行时发生错误，请重试。
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

// No code-splitting: the whole app (React + voice SDK + AI SDK + UI) is
// bundled into the single entry script that index.html loads at page start.
// This maximises the chance the download completes on a fresh connection
// (which is what made the first deployment open reliably), instead of
// deferring the heavy chunk to a connection that may have gone idle/dead.
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
