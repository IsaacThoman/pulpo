// Written documents replace this one and drop its listeners, so HTML previews carry their own reporter.
// It also reports the page's height, so frames that fit their content (notebook outputs) can size to it.
function errorReporter(parentOrigin: string): string {
  return `<script>(function(){var p=parent,o=${JSON.stringify(parentOrigin)};function s(m){try{p.postMessage({type:'pulpo-sandbox:error',message:String(m)},o)}catch(e){}}addEventListener('error',function(e){s(e.message||'Script error')});addEventListener('unhandledrejection',function(e){var r=e.reason;s(r&&r.message||r)});var h=-1;function z(){var d=document.documentElement,b=document.body,n=Math.ceil(Math.max(d?d.scrollHeight:0,b?b.scrollHeight:0));if(n!==h){h=n;try{p.postMessage({type:'pulpo-sandbox:size',height:n},o)}catch(e){}}}addEventListener('load',z);addEventListener('DOMContentLoaded',function(){z();if(typeof ResizeObserver==='function'){var r=new ResizeObserver(z);r.observe(document.documentElement);if(document.body)r.observe(document.body)}})})()</script>`
}

export function withErrorReporter(html: string, parentOrigin: string): string {
  const reporter = errorReporter(parentOrigin)
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  if (!doctype) return reporter + html
  return doctype[0] + reporter + html.slice(doctype[0].length)
}

export function svgDocument(svg: string): string {
  const body = svg.replace(/^\s*<\?xml[^>]*>/i, '')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}body{display:grid;place-items:center;background:#fff}body>svg{max-width:100%;max-height:100vh;height:auto}</style></head><body>${body}</body></html>`
}
