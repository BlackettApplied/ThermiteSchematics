import { nativeWireSources } from "./wire-source-contract.mjs";
import { issuedRows } from "./m3-documents.mjs";
import { finding, painted } from "./review-geometry.mjs";
import { sufficient } from "./document-dependencies.mjs";
import {
  inventoryScopeProse,
  inventoryCountFindings,
} from "./inventory-scope-counts.mjs";
const qualified = (s) =>
  /^(?:(?:supplementary|supplemental|partial|filtered|subset)\b|cable core (?:details|inventory)\b|(?:inventory )?scope:\s*(?:supplementary|partial|filtered|subset|cable cores? only)\b)/i.test(
    s.trim(),
  ) ||
  /\bwire (?:inventory|schedule)\s*(?:[—–:-]|\()\s*(?:supplementary|supplemental|partial|filtered|subset)\b/i.test(
    s,
  );
const title = (t) =>
  (t.primitiveIds ?? []).some((id) => /-document-label$/.test(id));
const unavailable = (item, reason, extra = {}) =>
  finding("wire-inventory-scope-unavailable", item, { reason, ...extra });
function emptyInventory(g, headings, local, source) {
  const heading = headings[0];
  if (local.length || headings.length !== 1 || !heading.documentId)
    return false;
  const empty = g.texts.some(
    (t) =>
      t.documentId === heading.documentId &&
      painted(t) &&
      (t.text === "No matching records" ||
        /^No wire, jumper or cable-core rows/.test(t.text)),
  );
  return (
    empty &&
    (!source.length ||
      inventoryScopeProse(g, heading, new Set([heading.documentId])).some(
        qualified,
      ))
  );
}
function inventoryPopulation(sheet, packet, geometries, source) {
  const g = geometries[packet.sheets.indexOf(sheet)];
  if (!g) return { findings: [unavailable({}, "Sheet geometry missing")] };
  const all = issuedRows(packet, geometries).filter((r) => r.kind === "wires"),
    local = all.filter((r) => r.sheet === sheet.number);
  const ids = new Set(local.map((r) => r.documentId)),
    headings = g.texts.filter((t) => title(t) && painted(t));
  if (emptyInventory(g, headings, local, source))
    return {
      g,
      ids: new Set([headings[0].documentId]),
      heading: headings[0],
      rows: [],
    };
  if (
    ids.size !== 1 ||
    headings.length !== 1 ||
    local.some((r) => !r.visible) ||
    !g.reportCells?.length
  )
    return {
      findings: [
        unavailable(
          headings[0],
          "Missing or ambiguous owned title, rows, or measured cells",
        ),
      ],
    };
  return {
    g,
    ids,
    heading: headings[0],
    rows: all.filter((r) => ids.has(r.documentId)),
  };
}
function inventoryScopeFindings({ g, ids, heading, rows }, source) {
  const out = [],
    keys = rows.map((r) => r.key),
    native = new Set(source.map((r) => r.key));
  const unreadable = rows.filter(
    (r) => !source.some((s) => s.key === r.key && sufficient(r, s)),
  );
  if (unreadable.length)
    out.push(
      unavailable(
        heading,
        "Printed native row facts unavailable or contradictory",
        { rows: unreadable.map((r) => r.key) },
      ),
    );
  const missing = [...native].filter((k) => !keys.includes(k)),
    foreign = keys.filter((k) => !native.has(k));
  const prose = inventoryScopeProse(g, heading, ids);
  out.push(...inventoryCountFindings(prose, rows, source, heading, qualified));
  if (
    prose.some((p) =>
      /^Supplementary cable[- ]core inventory|^Cable[- ]core (?:details|inventory)/i.test(
        p,
      ),
    ) &&
    source.some(
      (s) => keys.includes(s.key) && s.element.kind !== "cable_conductor",
    )
  )
    out.push(
      unavailable(heading, "Cable-core scope includes non-core native rows"),
    );
  if (foreign.length || new Set(keys).size !== keys.length)
    out.push(
      unavailable(heading, "Unknown or duplicate native rows", { foreign }),
    );
  if (missing.length && !prose.some(qualified))
    out.push(
      finding("partial-wire-inventory-without-scope", heading, {
        documentId: [...ids][0],
        printedRows: keys.length,
        nativeRows: native.size,
        omittedRows: missing,
        title: heading.text,
      }),
    );
  return out;
}
export function inventoryScopeAudit(sheet, packet, geometries, ir) {
  if (sheet.view?.kind !== "wires") return { findings: [], eligible: 0 };
  let source;
  try {
    if (
      !["wires", "jumpers", "cables", "cableTypes", "cableConductors"].every(
        (k) => Array.isArray(ir?.[k]),
      )
    )
      throw Error("Native conductor inventory missing");
    source = nativeWireSources(ir).rows;
  } catch (error) {
    return { eligible: 1, findings: [unavailable({}, error.message)] };
  }
  const population = inventoryPopulation(sheet, packet, geometries, source);
  return {
    eligible: 1,
    findings: population.findings ?? inventoryScopeFindings(population, source),
  };
}
