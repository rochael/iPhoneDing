import { useSyncExternalStore } from "react";

const routes = {
  "/stock": { tab: "stock", historyView: "analysis" },
  "/watches": { tab: "watches", historyView: "analysis" },
  "/history": { tab: "history", historyView: "analysis" },
  "/history/records": { tab: "history", historyView: "events" },
  "/history/stores": { tab: "history", historyView: "stores" },
  "/settings": { tab: "settings", historyView: "analysis" },
} as const;

type Path = keyof typeof routes;
export type HistoryView = (typeof routes)[Path]["historyView"];
export const historyPaths: Record<HistoryView, string> = {
  analysis: "#/history",
  events: "#/history/records",
  stores: "#/history/stores",
};

function currentPath(): Path {
  const path = window.location.hash.slice(1);
  return Object.hasOwn(routes, path) ? (path as Path) : "/stock";
}

function subscribe(onChange: () => void) {
  const sync = () => {
    const hash = `#${currentPath()}`;
    if (window.location.hash !== hash)
      window.history.replaceState(window.history.state, "", hash);
    onChange();
  };
  window.addEventListener("hashchange", sync);
  sync();
  return () => window.removeEventListener("hashchange", sync);
}

export function useHashRoute() {
  const path = useSyncExternalStore<Path>(
    subscribe,
    currentPath,
    () => "/stock",
  );
  return routes[path];
}
