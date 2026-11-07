import { PACKET_VIEWER_SCRIPT } from "../packet-viewer.js";

import {
  escapeXmlAttribute as attr,
  escapeXmlText as xml,
} from "../svg/escape.js";

import type { RenderedSheet, PaperPage } from "./types.js";
import { n } from "./svg.js";
import { sheetLabel } from "./page.js";

export function printPacketHtml(
  sheets: readonly RenderedSheet[],
  page: PaperPage,
  title: string,
): string {
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${xml(title)}</title><style>
@page{size:${n(page.widthMm)}mm ${n(page.heightMm)}mm;margin:0}*{box-sizing:border-box}body{margin:0;background:#e5e7eb;color:#18212b;font:14px system-ui,sans-serif}header{max-width:1100px;margin:auto;padding:24px 20px 8px}header h1{font-size:20px;margin:0 0 8px}header p{line-height:1.5;margin:0}main{display:flex;flex-direction:column;align-items:center;gap:24px;padding:20px}section{width:100%;max-width:${n(page.widthMm)}mm;background:white;box-shadow:0 2px 12px #0002;break-after:page}section:last-child{break-after:auto}section[hidden]{display:none}.toolbar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:14px 0}.toolbar input[type=search]{min-width:220px}.toolbar input,.toolbar select,.toolbar button{font:inherit;padding:8px;border:1px solid #aab2bd;border-radius:5px;background:white}main.actual-size{align-items:flex-start}main.actual-size section{width:${n(page.widthMm)}mm;max-width:none;flex-shrink:0}section{scroll-margin-top:12px}section:focus{outline:2px solid #2563eb}#packet-status{font-size:13px;color:#475569}section>svg{display:block;width:100%;height:auto}@media print{section[hidden]{display:block!important}section:focus{outline:none}body{background:white}header{display:none}main{display:block;padding:0}section{width:${n(page.widthMm)}mm;max-width:none;height:${n(page.heightMm)}mm;box-shadow:none;margin:0}section>svg{width:100%;height:100%}}</style></head><body><header><h1>${xml(title)}</h1><p>${sheets.length} sheets · ${page.size.toUpperCase()} ${page.orientation}. Print at 100% on matching paper; disable browser headers and footers. Each sheet is a vector SVG.</p><div class="toolbar"><label>Find device <input id="packet-search" type="search" placeholder="Designation, e.g. PLC1" autocomplete="off"></label><label>Go to <select id="packet-sheet">${sheets.map((s) => `<option value="sheet-${s.number}">${s.number} - ${xml(sheetLabel(s.view))}</option>`).join("")}</select></label><label><input id="packet-size" type="checkbox"> Actual size</label><button id="packet-print" type="button">Print packet</button></div><p id="packet-status" role="status" aria-live="polite"></p></header><main>${sheets.map((sheet) => `<section id="sheet-${sheet.number}" tabindex="-1" data-search="${attr(`${sheetLabel(sheet.view)} ${sheet.references.map((r) => r.designation).join(" ")}`)}" aria-label="Sheet ${sheet.number}">${sheet.svg.replace(/^<\?xml[^>]*>\s*/, "")}</section>`).join("\n")}</main><script>${PACKET_VIEWER_SCRIPT}</script></body></html>\n`;
}
