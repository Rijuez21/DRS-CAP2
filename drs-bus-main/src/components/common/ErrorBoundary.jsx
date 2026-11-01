import { Component } from "react";
import { RotateCw } from "lucide-react";

// Catches an error thrown while rendering any page, so one broken screen
// shows a way out instead of turning the whole app white. Also catches a
// page whose code failed to download (a deploy replaced the old files, or
// the connection dropped mid-load) — reloading fixes both.
//
// `resetKey` (the current path in App.jsx) clears the error when the user
// navigates somewhere else.
export default class ErrorBoundary extends Component {
  state = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error) {
    return { error };
  }

  static getDerivedStateFromProps(props, state) {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  componentDidCatch(error, info) {
    console.error("Page crashed:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const chunkFailed = /dynamically imported module|Loading chunk|Importing a module script failed/i.test(String(this.state.error?.message));
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div role="alert" className="max-w-sm text-center space-y-3">
          <h1 className="font-display text-xl font-bold text-ink-900">{chunkFailed ? "This page didn't finish loading" : "Something went wrong on this page"}</h1>
          <p className="text-sm text-ink-600">
            {chunkFailed
              ? "Your connection may have dropped, or the app was just updated. Reload to get the latest version."
              : "Reload the page to try again. If it keeps happening, tell the terminal office what you were doing."}
          </p>
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 bg-brand-forest-900 hover:bg-brand-forest-800 text-white text-sm font-semibold rounded-xl px-4 py-2.5"
            >
              <RotateCw className="w-4 h-4" aria-hidden="true" /> Reload
            </button>
            <a href="/" className="inline-flex items-center text-sm font-semibold text-brand-green-600 rounded-xl px-4 py-2.5 hover:bg-brand-green-500/10">
              Go to the home page
            </a>
          </div>
        </div>
      </div>
    );
  }
}
