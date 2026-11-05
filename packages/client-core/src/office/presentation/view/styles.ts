/**
 * Styles for the presentation views, injected once per document so the view core works in any
 * host (the web app, the mobile webview) without a build step for CSS. Colors come from CSS
 * variables hosts can override (`--pp-accent`, `--pp-canvas-bg`, …).
 */
const CSS = `
.pp-canvas{position:relative;width:100%;height:100%;outline:none;overflow:hidden;background:var(--pp-canvas-bg,#e8e8ea);touch-action:none;user-select:none;-webkit-user-select:none}
.pp-canvas-viewport{position:absolute;inset:0;overflow:auto;display:flex;padding:24px;box-sizing:border-box}
.pp-canvas-stage{position:relative;margin:auto;flex:none;box-shadow:0 1px 4px rgba(0,0,0,.18),0 0 0 1px rgba(0,0,0,.06)}
.pp-canvas-host{position:absolute;left:0;top:0;transform-origin:0 0}
.pp-canvas-slide,.pp-canvas-editor{position:absolute;left:0;top:0}
.pp-canvas-slide .pp-slide>[data-key]{cursor:move}
.pp-canvas-overlay{position:absolute;inset:0;pointer-events:none}
.pp-selection{position:absolute;box-sizing:border-box;outline:1.5px solid var(--pp-accent,#2f6fed);outline-offset:0;pointer-events:none;transform-origin:center}
.pp-selection-editing{outline-style:dashed}
.pp-handle{position:absolute;width:9px;height:9px;margin:-5px 0 0 -5px;background:#fff;border:1.5px solid var(--pp-accent,#2f6fed);border-radius:2px;pointer-events:auto;box-sizing:border-box;touch-action:none}
.pp-handle-nw{left:0;top:0;cursor:nwse-resize}.pp-handle-n{left:50%;top:0;cursor:ns-resize}.pp-handle-ne{left:100%;top:0;cursor:nesw-resize}
.pp-handle-e{left:100%;top:50%;cursor:ew-resize}.pp-handle-se{left:100%;top:100%;cursor:nwse-resize}.pp-handle-s{left:50%;top:100%;cursor:ns-resize}
.pp-handle-sw{left:0;top:100%;cursor:nesw-resize}.pp-handle-w{left:0;top:50%;cursor:ew-resize}
.pp-handle-rotate{left:50%;top:-24px;border-radius:50%;cursor:grab;width:12px;height:12px;margin:-6px 0 0 -6px}
@media (pointer:coarse){.pp-handle{width:18px;height:18px;margin:-9px 0 0 -9px}.pp-handle-rotate{width:20px;height:20px;margin:-10px 0 0 -10px;top:-32px}}
.pp-remote{position:absolute;box-sizing:border-box;outline:2px solid var(--pp-remote);transform-origin:center}
.pp-remote-name{position:absolute;left:-2px;top:-20px;padding:1px 6px;font:600 11px/16px system-ui,sans-serif;color:#fff;background:var(--pp-remote);border-radius:4px 4px 4px 0;white-space:nowrap}
.pp-marquee{position:absolute;border:1px solid var(--pp-accent,#2f6fed);background:color-mix(in srgb,var(--pp-accent,#2f6fed) 12%,transparent)}
.pp-guide{position:absolute;background:#e5398f}.pp-guide-v{top:0;bottom:0;width:1px}.pp-guide-h{left:0;right:0;height:1px}
.pp-editor-frame{position:absolute;transform-origin:center}
.pp-editor-text .pp-text-editor{outline:none;white-space:inherit;cursor:text;user-select:text;-webkit-user-select:text}
.pp-editor-inner .pp-text-editor:has(> .pp-p:only-child > span:empty)::before,.pp-editor-inner[data-placeholder]:not([data-placeholder=""]) .pp-text-editor:has(> .pp-p:only-child .ProseMirror-trailingBreak:only-child)::before{content:attr(data-placeholder);position:absolute;opacity:.5;pointer-events:none}
.pp-text-editor .pp-p{margin:0}
.ProseMirror-yjs-cursor{position:relative;margin-left:-1px;margin-right:-1px;border-left:1px solid black;border-right:1px solid black;word-break:normal;pointer-events:none}
.ProseMirror-yjs-cursor>div{position:absolute;top:-1.05em;left:-1px;font:600 11px/normal system-ui,sans-serif;user-select:none;color:#fff;padding:0 3px;white-space:nowrap}
.pp-slide p,.pp-slide .pp-p{margin:0}
.pp-thumbs{display:flex;flex-direction:column;gap:6px;padding:8px;overflow:auto;height:100%;box-sizing:border-box;outline:none}
.pp-thumb{display:flex;gap:6px;align-items:flex-start;cursor:pointer;touch-action:pan-y}
.pp-thumb-number{width:18px;flex:none;text-align:right;font:12px/1.4 system-ui,sans-serif;color:var(--pp-muted,#6b6b6b);padding-top:2px}
.pp-thumb-frame{position:relative;flex:1;overflow:hidden;border-radius:4px;box-shadow:0 0 0 1px rgba(0,0,0,.12);background:#fff}
.pp-thumb[aria-selected=true] .pp-thumb-frame{box-shadow:0 0 0 2px var(--pp-accent,#2f6fed)}
.pp-thumb-hidden .pp-thumb-frame{opacity:.45}
.pp-thumb-hidden .pp-thumb-number{text-decoration:line-through}
.pp-thumb-content{position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none}
.pp-thumb-drop{height:3px;border-radius:2px;background:var(--pp-accent,#2f6fed);margin:-4px 0 -3px 24px}
.pp-thumb-presence{position:absolute;right:4px;bottom:4px;display:flex;gap:2px}
.pp-thumb-presence span{width:8px;height:8px;border-radius:50%;box-shadow:0 0 0 1.5px #fff}
.pp-section{font:600 12px/1.4 system-ui,sans-serif;color:var(--pp-muted,#6b6b6b);padding:6px 0 0 24px}
.pp-sorter{display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--pp-sorter-size,200px),1fr));gap:16px;padding:16px;overflow:auto;height:100%;box-sizing:border-box;align-content:start;outline:none}
.pp-sorter .pp-thumb{flex-direction:column}
.pp-sorter .pp-thumb-number{width:auto;text-align:left}
.pp-sorter .pp-thumb-frame{width:100%}
.pp-present{position:fixed;inset:0;z-index:2147483000;background:#000;display:flex;align-items:center;justify-content:center;outline:none;user-select:none;-webkit-user-select:none;touch-action:none}
.pp-present-stage{position:relative;overflow:hidden}
.pp-present-content{position:absolute;left:0;top:0;transform-origin:0 0}
.pp-present-end{color:#ddd;font:16px system-ui,sans-serif}
.pp-presenter{position:fixed;inset:0;z-index:2147483000;background:#1d1d1f;color:#f2f2f2;display:grid;grid-template-columns:3fr 2fr;grid-template-rows:auto 1fr;gap:16px;padding:16px;box-sizing:border-box;font:14px/1.5 system-ui,sans-serif;outline:none}
.pp-presenter-bar{grid-column:1/3;display:flex;gap:16px;align-items:center}
.pp-presenter-current,.pp-presenter-next{position:relative;overflow:hidden;background:#000}
.pp-presenter-side{display:flex;flex-direction:column;gap:12px;min-height:0}
.pp-presenter-notes{flex:1;overflow:auto;white-space:pre-wrap;font-size:18px;line-height:1.5;background:#2a2a2d;border-radius:8px;padding:12px}
.pp-notes .pp-text-editor{outline:none;min-height:100%;white-space:pre-wrap;padding:8px 12px;font:14px/1.5 system-ui,sans-serif;user-select:text;-webkit-user-select:text}
.pp-notes{height:100%;overflow:auto;position:relative}
.pp-notes .pp-p{color:inherit!important;font-family:inherit!important}
.pp-notes-empty::before{content:attr(data-placeholder);position:absolute;left:12px;top:8px;opacity:.5;pointer-events:none;font:14px/1.5 system-ui,sans-serif}
.pp-media-player{background:#000;max-width:none}
@media print{.pp-print-page{page-break-after:always;break-after:page}}
`

export function ensureStyles(document: Document): void {
  if (document.getElementById('pulpo-presentation-styles')) return
  const style = document.createElement('style')
  style.id = 'pulpo-presentation-styles'
  style.textContent = CSS
  document.head.append(style)
}
