import { buildDocumentation } from "../../packages/query/dist/index.js";
import { nativeStrip } from "./terminal-strip-native.mjs";
import { checkTerminalStrip } from "./terminal-strip-check.mjs";
import { stripInventoryEquality } from "./terminal-strip-inventory.mjs";
import { isStripApproachFinding } from "./terminal-strip-approaches.mjs";
import { IdentifierMeasurementError } from "./identifier-errors.mjs";

const inkFields = [
  "terminals",
  "bridges",
  "incidences",
  "unclaimed",
  "rows",
  "references",
  "headings",
  "notes",
  "texts",
  "continuations",
  "bridgeLabels",
];
function viewSheets(packet, geometries, index, table) {
  // The registry/attribute pair locates a request's pages only. It proves no ink.
  const documents = (packet.navigation?.documents ?? []).filter(
    (d) =>
      d.authoredOrder === index &&
      !d.autoOrigin &&
      ["terminals", "terminal-strip"].includes(d.kind),
  );
  const keys = documents
    .map((d) => d.id.match(/view\/1\/[a-f0-9]+$/u)?.[0])
    .filter(Boolean);
  return packet.sheets.filter(
    (s, i) =>
      ["terminals", "terminal-strip"].includes(s.view.kind) &&
      (keys.length && geometries[i]?.terminalStripInk
        ? keys.some((key) =>
            geometries[i].terminalStripInk.viewKeys?.includes(key),
          )
        : s.view.title === table.title),
  );
}
function viewInk(packet, geometries, sheets) {
  const ink = Object.fromEntries(inkFields.map((key) => [key, []]));
  for (const sheet of sheets) {
    const measured = geometries[packet.sheets.indexOf(sheet)]?.terminalStripInk;
    if (!measured || inkFields.some((key) => !Array.isArray(measured[key])))
      throw new IdentifierMeasurementError(
        `DQ-23 Chromium strip measurement unavailable on sheet ${sheet.number}`,
      );
    for (const key of inkFields) ink[key].push(...measured[key]);
  }
  return ink;
}
function locatedFinding(finding, index, title, ink) {
  const terminal = finding.terminal ?? finding.at;
  const identity = terminal ?? finding.uid ?? finding.device ?? "view";
  const nativeLocator = `terminal-plan/${index}/${identity}/${finding.kind}`;
  const drawn = ink.terminals.find((t) => t.key === terminal);
  return {
    ...finding,
    nativeLocator,
    element: nativeLocator,
    designation: nativeLocator,
    view: index,
    title,
    ...(!finding.bbox && drawn?.rect
      ? { bbox: drawn.rect, sourceSheet: drawn.sheet }
      : {}),
  };
}
function measureView(packet, geometries, ir, view, index) {
  const table = buildDocumentation(ir, view);
  const uids = [...new Set(table.rows.map((r) => JSON.parse(r.key)[0]))];
  const sheets = viewSheets(packet, geometries, index, table);
  const identity = {
    view: index,
    title: table.title,
    sheets: sheets.map((s) => s.number),
  };
  if (!uids.length)
    return {
      ...identity,
      assessment: "not-applicable",
      reason: "Empty native terminal selection",
    };
  const native = nativeStrip(ir, uids);
  const ink = viewInk(packet, geometries, sheets);
  const checked = checkTerminalStrip(native, ink);
  const equality = stripInventoryEquality(table, ink);
  const findings = [...checked.findings, ...equality.findings].map((f) =>
    locatedFinding(f, index, table.title, ink),
  );
  return {
    ...identity,
    assessment: findings.length ? "fail" : "pass",
    strict: true,
    findings,
    obligations: checked.obligations,
    approachCounts: checked.approachCounts,
    terminals: native.terminals.map((t) => t.key),
    bridges: native.bridges.map((b) => b.uid),
    inventoryEquality: equality.rows,
  };
}
export function terminalPlanAudits(packet, geometries, ir, request) {
  const views = (request.views ?? []).flatMap((v, i) =>
    v.format === "documentation-view-request/0.1" && v.kind === "terminals"
      ? [{ view: v, index: i }]
      : [],
  );
  if (!views.length)
    return [
      {
        assessment: "not-applicable",
        reason: "No requested terminal plan",
        sheets: [],
      },
    ];
  return views.map(({ view, index }) =>
    measureView(packet, geometries, ir, view, index),
  );
}

export function terminalPlanSheet(sheet, context) {
  const audits = terminalPlanAudits(
    context.packet,
    context.geometries,
    context.ir,
    context.request,
  );
  const matches = audits.filter(
    (a) =>
      a.sheets.includes(sheet.number) ||
      (!a.sheets.length && sheet.number === context.packet.sheets[0]?.number),
  );
  const findings = matches.flatMap((a) =>
    (a.findings ?? []).filter(
      (f) => !isStripApproachFinding(f) || f.sourceSheet === sheet.number,
    ),
  );
  const approachCounts = matches
    .filter((a) =>
      a.findings?.some(
        (f) => isStripApproachFinding(f) && f.sourceSheet === sheet.number,
      ),
    )
    .map((a) => ({ view: a.view, ...a.approachCounts[sheet.number] }));
  return { findings, approachCounts };
}
