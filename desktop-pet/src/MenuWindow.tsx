import { useCallback, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";

import {
  enterContextMenuSubmenu,
  leaveContextMenuSubmenu,
} from "./menu/contextMenuState";

type MenuAction =
  | { type: "select-workspace" }
  | { type: "switch-workspace"; workspacePath: string }
  | { type: "workspace-selected"; workspacePath: string }
  | { type: "new-session" }
  | { type: "send-prompt" }
  | { type: "prompt-sent"; source?: "terminal" }
  | { type: "restore-session"; petSessionId: string }
  | { type: "focus-active-session"; petSessionId: string }
  | { type: "more-sessions" }
  | { type: "interaction-mode"; mode: "window-drag" | "camera-adjust" }
  | { type: "notification-detail"; profile: "low" | "medium" | "high" }
  | { type: "menu-language"; language: "en" | "zh-CN" }
  | { type: "agent"; agent: "codex" | "claude" }
  | { type: "codex-env"; envMode: "win" | "wsl" }
  | { type: "always-on-top"; enabled: boolean }
  | { type: "focus-vscode" }
  | { type: "sync-main-site" }
  | { type: "close" };

type MenuItem = {
  id: string;
  label?: string;
  type?: "normal" | "separator" | "radio" | "checkbox";
  checked?: boolean;
  enabled?: boolean;
  action?: MenuAction;
  submenu?: MenuItem[];
};

type MenuPayload = {
  items: MenuItem[];
  position: { x: number; y: number };
  openedAtMs: number;
};

export function MenuWindow() {
  const [payload, setPayload] = useState<MenuPayload | null>(null);
  const [path, setPath] = useState<string[]>([]);

  useEffect(() => {
    return window.desktopPet?.menu?.onShow((nextPayload) => {
      window.desktopPet?.menu?.reportReceived(nextPayload.openedAtMs);
      flushSync(() => {
        setPayload(nextPayload as MenuPayload);
        setPath([]);
      });
      window.desktopPet?.menu?.reportCommitted(nextPayload.openedAtMs);
    });
  }, []);

  const close = useCallback(() => {
    setPayload(null);
    setPath([]);
    window.desktopPet?.menu?.close();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close]);

  const level = useMemo(() => {
    let items = payload?.items ?? [];
    const labels: string[] = [];
    for (const itemId of path) {
      const item = items.find((candidate) => candidate.id === itemId);
      if (!item?.submenu) break;
      labels.push(item.label || "");
      items = item.submenu;
    }
    return { items, labels };
  }, [path, payload]);

  const execute = useCallback((action: MenuAction) => {
    setPayload(null);
    setPath([]);
    window.desktopPet?.menu?.execute(action).catch(() => {});
  }, []);

  if (!payload) {
    return <main className="pet-menu-window" aria-label="Blank context menu diagnostic" />;
  }

  return (
    <main className="pet-menu-window">
      <header className="pet-menu-window-header">
        {path.length > 0 ? (
          <button
            type="button"
            className="pet-menu-window-back"
            onClick={() => setPath((current) => leaveContextMenuSubmenu(current))}
          >
            <span aria-hidden="true">‹</span>
            <span>{level.labels.at(-1)}</span>
          </button>
        ) : (
          <span className="pet-menu-window-title">Pet</span>
        )}
        <button type="button" className="pet-menu-window-close" aria-label="Close menu" onClick={close}>
          ×
        </button>
      </header>
      <section className="pet-menu-window-list" role="menu">
        {level.items.map((item) =>
          item.type === "separator" ? (
            <div key={item.id} className="pet-menu-window-separator" role="separator" />
          ) : (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="pet-menu-window-item"
              disabled={item.enabled === false}
              onClick={() => {
                if (item.submenu) {
                  setPath((current) => enterContextMenuSubmenu(current, item.id));
                } else if (item.action) {
                  execute(item.action);
                }
              }}
            >
              <span className="pet-menu-window-check" aria-hidden="true">
                {item.type === "radio"
                  ? item.checked
                    ? "●"
                    : "○"
                  : item.type === "checkbox" && item.checked
                    ? "✓"
                    : ""}
              </span>
              <span className="pet-menu-window-label">{item.label}</span>
              {item.submenu ? <span className="pet-menu-window-arrow" aria-hidden="true">›</span> : null}
            </button>
          ),
        )}
      </section>
    </main>
  );
}
