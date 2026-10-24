import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

// A tab opened before a deploy keeps running the old build: moving between
// pages (logging in included) never reloads a single-page app. So every few
// minutes, and whenever the tab regains focus, ask the server which build
// index.html points to now. If it changed, reload on the next page change —
// the user is leaving the page anyway, so nothing they typed is lost.
const CHECK_EVERY_MS = 5 * 60 * 1000;
const ENTRY_SCRIPT = /\/assets\/index-[\w-]+\.js/;

function currentEntry() {
  const src = document.querySelector('script[type="module"][src*="/assets/"]')?.getAttribute("src") ?? "";
  return src.match(ENTRY_SCRIPT)?.[0] ?? null;
}

export function useReloadOnNewVersion() {
  const { pathname } = useLocation();
  const staleRef = useRef(false);
  const firstPathRef = useRef(pathname);

  useEffect(() => {
    if (!import.meta.env.PROD) return undefined; // the dev server hot-reloads already
    const mine = currentEntry();
    if (!mine) return undefined;

    let lastCheck = 0;
    async function check() {
      if (staleRef.current || Date.now() - lastCheck < 30000) return;
      lastCheck = Date.now();
      try {
        const html = await (await fetch("/", { cache: "no-store" })).text();
        const deployed = html.match(ENTRY_SCRIPT)?.[0];
        if (deployed && deployed !== mine) staleRef.current = true;
      } catch {
        // Offline — try again later.
      }
    }
    const onVisible = () => document.visibilityState === "visible" && check();

    check();
    const id = setInterval(check, CHECK_EVERY_MS);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (pathname !== firstPathRef.current && staleRef.current) window.location.reload();
  }, [pathname]);
}
