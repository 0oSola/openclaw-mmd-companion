"use client";

import { useEffect, useId, useRef } from "react";

export type LibraryRemovalSelection = { all: boolean; assetIds: string[]; name: string };

// 普通HTML确认放在发起窗口，不依赖宿主是否允许window.confirm或原生模态框。
export function VmdLibraryConfirmation({ selection, busy, error, onConfirm, onCancel }: {
  selection: LibraryRemovalSelection;
  busy: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const headingId = useId();
  const box = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const doc = box.current?.ownerDocument;
    const originalFocus = doc?.activeElement as HTMLElement | null;
    cancel.current?.focus();
    return () => originalFocus?.focus();
  }, []);
  return <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
    <div ref={box} role="dialog" aria-modal="true" aria-labelledby={headingId}
      style={{ width: "100%", maxWidth: 460, maxHeight: "85vh", overflowY: "auto", background: "#222331", color: "#f4f3f9", border: "1px solid #9380b4", borderRadius: 12, padding: 22, font: "15px/1.6 system-ui,sans-serif" }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) { event.preventDefault(); onCancel(); }
        if (event.key === "Tab") {
          const buttons = Array.from(box.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || []);
          const active = box.current?.ownerDocument.activeElement;
          if (buttons.length && ((!event.shiftKey && active === buttons.at(-1)) || (event.shiftKey && active === buttons[0]))) {
            event.preventDefault(); (event.shiftKey ? buttons.at(-1) : buttons[0])?.focus();
          }
        }
      }}>
      <h2 id={headingId} style={{ margin: "0 0 14px", fontSize: 20 }}>确认从库移除</h2>
      <p>{selection.all ? `将移除当前用户导入库的全部 ${selection.assetIds.length} 个动作，不受搜索影响。` : `将从动作库移除「${selection.name}」。`}</p>
      <p>刷新后仍会排除；原文件和所有模型已有收藏保留，收藏仍可预览和导出。内置及他人动作不会移除。</p>
      {error ? <p role="alert" style={{ color: "#ffb7b7", overflowWrap: "anywhere" }}>{error}</p> : null}
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
        <button ref={cancel} type="button" disabled={busy} onClick={onCancel} style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #9380b4", background: "#333244", color: "inherit" }}>取消</button>
        <button type="button" disabled={busy} onClick={onConfirm} style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #d3a5a5", background: "#633b4c", color: "inherit" }}>{busy ? "正在保存…" : selection.all ? "确认全部移除" : "确认移除"}</button>
      </div>
    </div>
  </div>;
}
