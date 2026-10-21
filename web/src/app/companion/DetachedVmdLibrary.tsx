"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { VmdAsset } from "@/lib/types";
import { VmdLibraryConfirmation, type LibraryRemovalSelection } from "./VmdLibraryConfirmation";

export type DetachedVmdLibraryHandle = { open: () => void };

type Props = {
  library: VmdAsset[];
  favorites: VmdAsset[];
  modelLabel: string;
  modelPath: string;
  activeAssetId: string;
  busy: boolean;
  error: string;
  message: string;
  exportBusy: boolean;
  onExport: () => void;
  isReadOnly: (asset: VmdAsset) => boolean;
  isFavorite: (asset: VmdAsset) => boolean;
  onPreview: (asset: VmdAsset) => void;
  onFavorite: (asset: VmdAsset) => void;
  canRemove: (asset: VmdAsset) => boolean;
  onRemove: (asset: VmdAsset) => Promise<boolean>;
  removableLibrary: VmdAsset[];
  onRemoveAll: (assetIds: string[]) => Promise<boolean>;
  onRemovalPrompt: () => void;
  onBlocked: () => void;
};

// 窗口只承载列表；React 状态和动作执行仍属于原 companion 页面。
export const DetachedVmdLibrary = forwardRef<DetachedVmdLibraryHandle, Props>(function DetachedVmdLibrary(props, ref) {
  const popupRef = useRef<Window | null>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"library" | "favorites">("library");
  const [removal, setRemoval] = useState<LibraryRemovalSelection | null>(null);

  useImperativeHandle(ref, () => ({
    open() {
      if (popupRef.current && !popupRef.current.closed) {
        popupRef.current.focus();
        return;
      }
      // 在点击回调内同步打开，保留浏览器用户手势；每个主页面独占自己的窗口。
      const popup = window.open("", "_blank", "popup=yes,width=560,height=760,resizable=yes,scrollbars=yes");
      if (!popup) {
        props.onBlocked();
        return;
      }
      popupRef.current = popup;
      popup.document.title = "VMD 动作列表";
      popup.document.documentElement.lang = "zh-CN";
      const root = popup.document.createElement("main");
      popup.document.body.replaceChildren(root);
      setContainer(root);
      setRemoval(null);
      popup.focus();
    },
  }));

  useEffect(() => {
    if (!container) return;
    const popup = popupRef.current;
    if (!popup) return;
    let listening = true;
    const detach = () => {
      if (!listening) return;
      listening = false;
      popup.removeEventListener("pagehide", closed);
    };
    const closed = () => {
      // pagehide 此刻仍属于原文档；必须在导航提交前同步解除监听。
      // React 的后续清理只检查标志，不再访问已经换源的 Window。
      detach();
      if (popupRef.current !== popup) return;
      popupRef.current = null;
      setContainer(null);
      setRemoval(null);
    };
    popup.addEventListener("pagehide", closed);
    return detach;
  }, [container]);

  useEffect(() => {
    const close = () => popupRef.current?.close();
    window.addEventListener("pagehide", close);
    return () => {
      window.removeEventListener("pagehide", close);
      close();
    };
  }, []);

  if (!container || popupRef.current?.closed) return null;
  const needle = query.trim().toLocaleLowerCase();
  const items = (view === "library" ? props.library : props.favorites).filter((asset) =>
    `${asset.display_name || ""}\n${asset.filename}`.toLocaleLowerCase().includes(needle),
  );

  return createPortal(
    <>
      <style>{`
        *{box-sizing:border-box}body{margin:0;background:#171923;color:#f4f3f9;font:15px/1.5 system-ui,sans-serif}
        main{padding:20px;max-width:900px;margin:auto}h1{font-size:22px;margin:0 0 8px}p{margin:8px 0}
        .model{overflow-wrap:anywhere;color:#bbb8cf}nav{display:flex;gap:8px;margin:16px 0}
        button,input{font:inherit}button{cursor:pointer;border:1px solid #625d7b;border-radius:8px;padding:9px 12px;background:#292638;color:inherit}
        button:disabled{cursor:not-allowed;opacity:.55}button[aria-selected=true],button[aria-pressed=true]{background:#514169;border-color:#b5a1d5}
        input{width:100%;background:#22212c;color:inherit;border:1px solid #625d7b;border-radius:8px;padding:10px}
        ul{padding:0;list-style:none}li{display:flex;gap:8px;align-items:center;border-bottom:1px solid #393547;padding:10px 0}
        .preview{flex:1;min-width:0;text-align:left}.preview strong,.preview small{display:block;overflow-wrap:anywhere}
        small{color:#c5bdd6;font-size:12px}.error{color:#ffb7b7}button:focus-visible,input:focus-visible{outline:2px solid #dbbfff;outline-offset:3px}
        @media(max-width:380px){main{padding:12px}li{align-items:stretch;flex-direction:column}}
      `}</style>
      <h1>VMD 动作列表</h1>
      <p className="model">当前模型：{props.modelLabel || "未选择"}<br />{props.modelPath}</p>
      <p>点击动作在原舞台预览；再次点击当前动作停止预览。</p>
      <p>从库移除仅排除动作库条目，原文件和已有模型收藏保留；内置及他人动作只读。</p>
      <button disabled={props.busy || !props.modelPath} onClick={props.onExport}>
        {props.exportBusy ? "正在打包收藏…" : "导出当前模型全部收藏 VMD（ZIP）"}
      </button>
      <p>导出全部收藏，不受搜索或动作库排除影响；不包含模型和贴图。</p>
      <nav role="tablist" aria-label="动作列表范围">
        <button role="tab" aria-selected={view === "library"} onClick={() => setView("library")}>动作库</button>
        <button role="tab" aria-selected={view === "favorites"} onClick={() => setView("favorites")}>当前模型收藏</button>
      </nav>
      <label>搜索动作名称或文件名<input type="search" aria-label="搜索动作名称或文件名" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <p role="status">{items.length} 个动作</p>
      {view === "library" ? <button disabled={props.busy || props.removableLibrary.length === 0} onClick={() => {
        props.onRemovalPrompt();
        setRemoval({ all: true, assetIds: props.removableLibrary.map((asset) => asset.asset_id), name: "全部导入库" });
      }}>全部移除（{props.removableLibrary.length}）</button> : null}
      {props.error ? <p role="alert" className="error">{props.error}</p> : <p>{props.message}</p>}
      {items.length === 0 ? <p>{needle ? "没有匹配的动作，请修改搜索内容。" : view === "favorites" ? "当前模型还没有收藏动作。" : "动作库暂无可预览动作。"}</p> : null}
      <ul aria-label="VMD 动作">
        {items.map((asset) => <li key={asset.asset_id}>
          <button className="preview" aria-pressed={props.activeAssetId === asset.asset_id} onClick={() => props.onPreview(asset)}>
            <strong>{asset.display_name || asset.filename}</strong><small>{asset.filename}</small>
            <small>{props.activeAssetId === asset.asset_id ? "当前选中 · 点击停止" : "在原舞台预览"}</small>
          </button>
          {view === "library" && props.canRemove(asset) ? <button disabled={props.busy} onClick={() => {
            props.onRemovalPrompt(); setRemoval({ all: false, assetIds: [asset.asset_id], name: asset.display_name || asset.filename });
          }}>从库移除</button> : null}
          <button disabled={props.busy || !props.modelPath || props.isReadOnly(asset)} onClick={() => props.onFavorite(asset)}
            title={props.isReadOnly(asset) ? "其他用户的动作只能预览，不能修改收藏。" : undefined}>
            {props.isReadOnly(asset) ? "只读收藏" : props.isFavorite(asset) ? "取消收藏" : "收藏"}
          </button>
        </li>)}
      </ul>
      {removal ? <VmdLibraryConfirmation selection={removal} busy={props.busy} error={props.error}
        onCancel={() => setRemoval(null)} onConfirm={async () => {
          const asset = props.library.find((item) => item.asset_id === removal.assetIds[0]);
          const success = removal.all ? await props.onRemoveAll(removal.assetIds) : asset ? await props.onRemove(asset) : false;
          if (success) setRemoval(null);
        }} /> : null}
    </>, container,
  );
});
