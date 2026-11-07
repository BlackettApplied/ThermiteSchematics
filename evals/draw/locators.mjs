import { parseHTML } from "linkedom";
import { hash, json } from "./support.mjs";

export const normalized = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
export function viewKey(view) {
  return view.root
    ? `view:${view.family}/${view.root.designation}/${view.intent ?? "default"}`
    : `view:${view.kind ?? view.format}/${view.title ?? ""}`;
}
export function sourceNames(ir) {
  return new Map(
    [
      ...(ir.devices ?? []),
      ...(ir.wires ?? []),
      ...(ir.jumpers ?? []),
      ...(ir.cables ?? []),
      ...(ir.relations ?? []),
    ].map((x) => [x.uid, x.designation ?? x.uid]),
  );
}
function sourceValue(value, names) {
  if (Array.isArray(value)) return value.map((x) => sourceValue(x, names));
  if (typeof value !== "string") return value;
  if (names.has(value)) return names.get(value);
  try {
    return sourceValue(JSON.parse(value), names);
  } catch {
    return value;
  }
}
export function sourceKey(value, names) {
  const parsed = sourceValue(value, names);
  return typeof parsed === "string" ? parsed : JSON.stringify(parsed);
}
// Metadata only. Geometry is exclusively measured by Chromium, never linkedom.
export function svgLocators(svg, ir, view, tables = []) {
  const document = parseHTML(svg).document,
    root = document.querySelector("svg"),
    names = sourceNames(ir);
  const headerRects = [...root.children].filter(
    (e) =>
      e.tagName.toLowerCase() === "rect" &&
      e.getAttribute("stroke") === "#9ba6b4",
  );
  const table = tables.find((t) => t.kind === view.kind),
    headers = new Map();
  for (const [i, rect] of headerRects.entries()) {
    const expected = normalized(
      table?.columns[i] ?? rect.nextElementSibling?.textContent,
    );
    let combined = "";
    const matched = [];
    for (
      let e = rect.nextElementSibling;
      e?.tagName.toLowerCase() === "text";
      e = e.nextElementSibling
    ) {
      const next = [
        normalized(combined + " " + e.textContent),
        normalized(combined + e.textContent),
      ].find((candidate) => expected.startsWith(candidate));
      if (!next) break;
      combined = next;
      matched.push(e);
      if (combined === expected) {
        for (const text of matched) headers.set(text, expected);
        break;
      }
    }
  }
  const headerNames = headerRects.map((rect) =>
    headers.get(rect.nextElementSibling),
  );
  const all = [...root.querySelectorAll("*")],
    result = new Map();
  const attr = (e, k) => e.closest(`[${k}]`)?.getAttribute(k);
  for (const [i, e] of all.entries()) {
    const cls = normalized(e.getAttribute("class"))
      .split(" ")
      .filter(Boolean)
      .sort()
      .join(".");
    let locator,
      source = false;
    const row = attr(e, "data-report-row"),
      column = e.closest("[data-report-column]");
    if (row) {
      let name = column?.getAttribute("data-column-name");
      if (!name) {
        const p = e.closest("[data-report-row]");
        let prev = e;
        while (prev && prev.parentElement !== p) prev = prev.parentElement;
        while (prev && prev.tagName.toLowerCase() !== "rect")
          prev = prev.previousElementSibling;
        const rects = [...p.children].filter(
          (x) => x.tagName.toLowerCase() === "rect",
        );
        const index = rects.indexOf(prev);
        name =
          table?.columns[index] ?? headerNames[index] ?? `column-${index + 1}`;
      }
      locator = `cell/${view.kind}/${sourceKey(row, names)}/${normalized(name)}`;
      source = view.kind !== "index";
    } else if (column) {
      locator = `header/${view.kind}/${normalized(column.getAttribute("data-column-name"))}`;
      source = true;
    } else if (headers.has(e)) {
      locator = `header/${view.kind}/${headers.get(e)}`;
      source = true;
    }
    if (!locator) {
      const clip = e
        .getAttribute("clip-path")
        ?.match(/-clip-([0-9a-f]+)\)/)?.[1];
      if (clip && clip.length % 4 === 0) {
        try {
          const decoded = String.fromCharCode(
            ...clip.match(/.{4}/g).map((x) => parseInt(x, 16)),
          );
          locator = `semantic/${JSON.stringify(sourceValue(JSON.parse(decoded), names))}`;
          source = true;
        } catch {}
      }
    }
    if (!locator) {
      const uid = attr(e, "data-device-uid"),
        wire =
          attr(e, "data-wire-label") ??
          attr(e, "data-wire-uid") ??
          attr(e, "data-jumper-uid") ??
          attr(e, "data-circuit-conductor") ??
          attr(e, "data-wiring-conductor");
      if (uid) {
        const terminal =
            attr(e, "data-terminal-key") ?? attr(e, "data-terminal-id"),
          fn = attr(e, "data-function-key"),
          symbol = attr(e, "data-symbol-id") ?? attr(e, "data-circuit-mark");
        locator = `device/${sourceKey(uid, names)}${terminal ? `/terminal/${sourceKey(terminal, names)}` : fn ? `/function/${fn}` : symbol ? `/symbol/${symbol}` : ""}/${e.tagName.toLowerCase()}.${cls}`;
        source = true;
      } else if (wire) {
        locator = `conductor/${sourceKey(wire, names)}/${e.tagName.toLowerCase()}.${cls}`;
        source = true;
      }
    }
    result.set(`${e.tagName.toLowerCase()}-${i}`, {
      locator:
        locator ?? `class/${e.tagName.toLowerCase()}.${cls || "unclassified"}`,
      source,
      column:
        column?.getAttribute("data-column-name") ??
        (row ? locator?.split("/").slice(3).join("/") : null),
      font: normalized(
        attr(e, "font-family") ?? e.style?.fontFamily ?? "unspecified",
      ),
    });
  }
  return result;
}
function fieldKey(field) {
  return field.startsWith("authored part ") ? "authored-part" : field;
}
// Independent missing requirements are independent defects, even when a checker
// presents them together in one finding. Coordinates and DOM ordinals never key.
export function identities(
  row,
  finding,
  index = new Map(),
  view = {},
  ir = {},
) {
  const names = sourceNames(ir),
    meta = index.get(finding.element);
  let locator = meta?.locator,
    source = meta?.source ?? false;
  const sourceElement = names.get(finding.element);
  if (sourceElement) {
    locator = `device/${sourceElement}`;
    source = true;
  }
  if (
    !locator &&
    finding.designation &&
    finding.designation !== "sheet" &&
    finding.element !== "sheet" &&
    !/^(text|path|circle|rect|line|g)-\d+$/.test(finding.element ?? "")
  ) {
    locator = `source/${sourceKey(finding.designation, names)}`;
    source = true;
  }
  if (finding.kind === "missing-device-tag-fields") {
    locator = `device/${finding.designation}`;
    source = true;
  }
  if (finding.kind === "incomplete-off-page-reference") {
    locator = `continuation/${finding.conductor}`;
    source = true;
  }
  if (finding.kind === "render-refusal") {
    locator = `request/${finding.error.code}/${finding.error.reason ?? "layout"}`;
    source = true;
  }
  if (finding.kind === "symbol-joins-independent-ports") {
    locator += `/ports/${[...new Set(finding.ports.map((p) => p.terminal))].sort().join(",")}`;
  }
  if (finding.kind === "reversed-phase-order")
    locator += `/sequence/${finding.sequence.join(",")}`;
  if (finding.kind === "missing-raster-label")
    locator = `${finding.backend}/${locator}`;
  if (finding.kind === "index-omits-sheet") {
    locator = `drawing-index/${finding.designation}`;
    source = true;
  }
  if (
    ["incomplete-title-block", "incomplete-four-side-zones"].includes(
      finding.kind,
    )
  ) {
    locator = `sheet/${finding.kind}`;
    source = false;
  }
  if (
    ["wire-schedule-without-sheet-zones", "terminal-plan-is-table"].includes(
      finding.kind,
    )
  ) {
    locator = `report/${view.kind}/${finding.kind}`;
    source = true;
  }
  if (
    finding.kind === "mixed-fonts-or-symbol-catalogs" ||
    finding.kind === "median-utilisation-below-40-percent"
  ) {
    locator = `packet/${finding.kind}`;
    source = true;
  }
  if (!locator)
    locator = `class/${String(finding.element ?? "sheet").replace(/-\d+$/, "")}`;
  if (finding.otherElement) {
    const other = index.get(finding.otherElement);
    locator = [locator, other?.locator ?? "class/text.unclassified"]
      .sort()
      .join(" overlaps ");
    source = source && !!other?.source;
  }
  if (finding.kind === "report-null-placeholder") {
    finding.sourceLocator = locator;
    locator = `null-policy/${view.kind}/${meta?.column ?? finding.columnIndex}/literal-placeholder`;
    source = true;
  }
  if (finding.kind === "iso-cap-height-policy") {
    locator = `policy/iso-cap-height/${finding.font}/${finding.medium}`;
    source = true;
  }
  if (finding.kind === "pdf-svg-advance-difference") {
    finding.sourceLocator = locator;
    const column =
      meta?.column ??
      (locator?.startsWith("header/")
        ? locator.slice(locator.indexOf("/", 7) + 1)
        : null);
    locator = `font-pair/${finding.fontPair}/${column ? view.kind : "drawing"}/${column ?? "labels"}`;
    source = true;
  }
  if (["text-below-minimum-em", "distorted-glyphs"].includes(finding.kind)) {
    finding.sourceLocator = locator;
    locator = `typography/${finding.font}/${meta?.column ?? finding.role ?? "frame"}/${finding.kind}`;
    source = true;
  }
  const sheet =
    finding.kind === "iso-cap-height-policy"
      ? "packet"
      : finding.kind === "render-refusal"
        ? "request"
        : locator.startsWith("packet/")
          ? "packet"
          : source
            ? viewKey(view)
            : `sheet:${row.sheet}`;
  const missing = finding.missing?.length
    ? finding.missing.map(fieldKey)
    : finding.kind === "incomplete-four-side-zones"
      ? Object.entries(finding.sides)
          .filter(
            ([side, n]) => n < (side === "top" || side === "bottom" ? 6 : 4),
          )
          .map(([side]) => side)
      : [null];
  return missing.map((field) => ({
    dq: row.dq,
    kind: finding.kind,
    locator: locator + (field ? `/missing/${field}` : ""),
    sheet,
    medium: finding.medium ?? (row.id.includes("/html-") ? "html" : "svg"),
    coarse: !source,
  }));
}
export const identityKey = (x) =>
  JSON.stringify([x.dq, x.family, x.kind, x.locator, x.check]);
export const markerId = (x) => `${x.dq}/${hash(identityKey(x)).slice(0, 16)}`;
export function familyFor(caseId, specs) {
  const c = specs.find((c) => c.id === caseId);
  return c?.project ?? caseId.replace(/-(left-to-right|top-to-bottom)$/, "");
}
export function checkKey(row) {
  if (row.classification === "policy-gap") return "iso-cap-height-policy";
  if (row.dq === "DQ-20") return "packet-style";
  const tail = row.id.split("/").at(-1);
  if (tail === "sheet-000" && row.dq === "DQ-11") return "render";
  return /^(sheet-\d+|html-\d+|pdf-\d+)$/.test(tail)
    ? "sheet"
    : tail.replace(/-\d+$/, "");
}
export function attachIdentities(rows, index, view, ir, family) {
  for (const row of rows) {
    row.viewScope = viewKey(view);
    row.family = family;
    row.check = checkKey(row);
    for (const f of row.evidence?.findings ?? []) {
      if (f.instances)
        for (const instance of f.instances)
          instance.sourceLocator =
            index.get(instance.element)?.locator ?? "unexported";
      f.identities = identities(row, f, index, view, ir).map((x) => ({
        ...x,
        family:
          f.kind === "pdf-svg-advance-difference"
            ? "font-metrics"
            : f.kind === "iso-cap-height-policy"
              ? "font-policy"
              : family,
        check: row.check,
      }));
    }
  }
  return rows;
}
