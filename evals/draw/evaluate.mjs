import { classifyTextGeometry } from "./text-classification.mjs";
import * as checks from "./checks.mjs";
const reasons = {
  "DQ-07":
    "Needs exported printed contact-mirror identities, their sheet.zone destinations and coil associations; related-function metadata alone does not identify the printed mirror.",
  "DQ-24":
    "Needs exported configured wire-numbering policy and number-to-conductor assignments; authored connection labels are not a numbering policy.",
};
export function observation(c, s, dq, issues = [], extra = {}) {
  return {
    id: `${c.id}/${dq}/sheet-${String(s.number).padStart(3, "0")}`,
    case: c.id,
    dq,
    sheet: s.number,
    medium: "svg",
    status: issues.length ? "fail" : "pass",
    evidence: { findingCount: issues.length, findings: issues },
    ...extra,
  };
}
export function textGeometryIssues(g) {
  return [
    ...checks.textBounds(g),
    ...cohort(checks.legibility(g), (f) => [f.kind, f.font, f.role]),
  ];
}
export function evaluateSheet(
  c,
  s,
  packet,
  g,
  ir,
  pdf,
  parity,
  symbols,
  tables = [],
  geometries = [],
) {
  classifyTextGeometry(g, ir);
  const interference = checks.conductorInterference(g);
  const obs = (dq, issues, extra) => observation(c, s, dq, issues, extra),
    out = [];
  const schematic =
    s.view.format.startsWith("schematic-view") ||
    ["circuit", "wiring", "signal-loop"].includes(s.view.kind);
  out.push(
    obs("DQ-01", checks.labelParity(parity), {
      scope:
        "Visible SVG labels: pdf.js raster regions, with optional Apple PDFKit cross-check. Ink loss threshold 18%; historical scaled-mask compatibility is audited separately from actual raster loss.",
    }),
  );
  out.push(
    obs("DQ-02", [
      ...textGeometryIssues(g),
      ...interference.filter((f) =>
        ["text-across-conductor", "plate-over-foreign-conductor"].includes(
          f.kind,
        ),
      ),
      ...checks.plateOcclusion(g),
    ]),
  );
  out.push(
    obs(
      "DQ-02",
      cohort(
        checks.legibility({ texts: checks.pdfGeometryTexts(g.texts, pdf) }),
        (f) => [f.kind, f.font, f.role],
      ),
      {
        id: `${c.id}/DQ-02/pdf-${s.number}`,
        medium: "pdf",
        scope:
          "Physical PDF em size on matched source labels, using the declared PDF font; unmatched runs are disclosed by DQ-21.",
      },
    ),
  );
  out.push(
    obs(
      "DQ-03",
      [
        ...checks.symbolIsolation(symbols),
        ...interference.filter((f) => f.kind === "conductor-through-symbol"),
      ],
      {
        scope:
          "Electrical strokes on independent source ports and foreign routed conductors crossing genuine symbol strokes or independent-net ports. Mechanical enclosures are excluded. Contact/winding meaning remains a visual review.",
      },
    ),
  );
  if (g.catalogs.includes("circuit"))
    out.push(
      obs("DQ-03", [], {
        id: `${c.id}/DQ-03/catalog-roles-${s.number}`,
        status: "not-implemented",
        reason:
          "Complete circuit-catalog lint needs exported per-primitive electrical-ink roles. Mechanical enclosures and functional boundaries are excluded; independent legacy source-port strokes are checked, and the visual legend review remains required.",
      }),
    );
  out.push(
    obs("DQ-03", [], {
      id: `${c.id}/DQ-03/visual-${s.number}`,
      status: "manual",
      reason:
        "Review symbol interpretation and legend against independent nets.",
    }),
  );
  out.push(
    obs("DQ-04", [], {
      status: "manual",
      reason:
        "Two reviewers compare selected-standard glyphs and qualifiers to the fixed checklist.",
    }),
  );
  out.push(obs("DQ-05", checks.functionKeys(g, ir)));
  out.push(
    obs("DQ-06", checks.deviceTags(g, ir, s.references, schematic), {
      scope:
        "Designation and authored device description; explicit string rating/part fields when exported. No rating is invented from terminal capability.",
    }),
  );
  out.push(
    obs("DQ-08", checks.continuations(s, packet, g, geometries), {
      scope:
        "Reciprocal exported continuations and printed sheet.zone/conductor. Conductor order needs an exported ordered connector/port association.",
    }),
  );
  if (s.continuations?.length)
    out.push(
      obs("DQ-08", [], {
        id: `${c.id}/DQ-08/conductor-order-${s.number}`,
        status: "not-implemented",
        reason:
          "Needs ordered physical terminal/port identities on off-page connectors to prove conductor order. Reciprocal connector anchors and destination zones are measured independently where identifiable; current exports associate labels and net IDs.",
      }),
    );
  out.push(obs("DQ-09", checks.zones(g, s.references)));
  out.push(obs("DQ-10", checks.phaseOrder(g, c.flow)));
  if (!c.sweep)
    out.push(
      obs("DQ-11", [], {
        status: "not-implemented",
        reason:
          "Flow success/remedy is assessed in the 36-cell sweep, not this corpus entry.",
      }),
    );
  out.push(
    obs("DQ-12", [], {
      status: "not-implemented",
      reason:
        "Packet median measured separately; proving previous-sheet packability needs exported movable content blocks and ELK clearance constraints.",
    }),
  );
  out.push(obs("DQ-13", checks.strokesAndDots(g)));
  out.push(
    obs("DQ-14", checks.doubleLandings(g), {
      scope:
        "Distinct conductor IDs with exported physical endpoints and visible terminal anchors must approach separately. Same-direction shared final strokes are a merged landing.",
      ...(!g.shapes.some((s) => s.conductor && s.endpoints?.length) &&
      g.shapes.some((s) => s.conductor)
        ? {
            status: "not-implemented",
            reason:
              "Needs physical endpoint-to-path and terminal-anchor exports for this view family.",
          }
        : {}),
    }),
  );
  out.push(
    obs("DQ-15", checks.routeQuality(g), {
      scope:
        "Routed conductor geometry only; a detour is flagged for review because no routing reason log is exported.",
    }),
  );
  const curved = g.shapes.filter(
    (s) => s.conductor && s.routePath && checks.routePoints(s) === null,
  );
  if (curved.length)
    out.push(
      obs("DQ-15", [], {
        id: `${c.id}/DQ-15/curved-${s.number}`,
        status: "not-implemented",
        reason:
          "Needs exact bend/segment exports for curved or disjoint conductor routes; no sampled points are treated as real jogs.",
        paths: curved.map((s) => s.element),
      }),
    );
  out.push(
    obs("DQ-16", checks.wirePlacement(g), {
      ...(!g.texts.some((t) => t.wire) && g.shapes.some((s) => s.conductor)
        ? {
            status: "not-implemented",
            reason:
              "Needs exported label-to-conductor identity for legacy flat conductor labels.",
          }
        : {}),
      scope:
        "Paths with conductor identity; legacy net-edge labels without a wire association need that export before proximity can be proven.",
    }),
  );
  out.push(obs("DQ-17", checks.terminalText(g)));
  out.push(
    obs(
      "DQ-23",
      s.view.kind === "terminals" && g.reportRows.length
        ? [
            {
              kind: "terminal-plan-is-table",
              element: "terminal-plan",
              designation: s.view.title ?? "terminals",
              sheetLevel: true,
              rows: g.reportRows.length,
            },
          ]
        : [],
      {
        scope:
          "Requested terminal plan must contain graphical strip geometry; report-row cells identify current table-only output.",
      },
    ),
  );
  out.push(obs("DQ-18", checks.titleFields(g)));
  out.push(
    obs("DQ-19", [
      ...checks
        .textBounds({ ...g, texts: g.texts.filter((t) => t.row) })
        .filter((x) => x.kind === "text-outside-cell"),
      ...cohort(
        checks.reports(
          g,
          s,
          packet,
          tables.find((t) => t.kind === s.view.kind),
        ),
        (f) =>
          f.kind === "report-null-placeholder"
            ? [f.kind, f.columnIndex]
            : [f.kind, f.element],
      ),
    ]),
  );
  out.push(
    obs(
      "DQ-21",
      cohort(checks.fontMetrics(g.texts, pdf), (f) => [
        f.fontPair,
        f.columnIndex ?? "labels",
      ]),
      {
        scope:
          "Matched PDF/SVG label advances; tolerance max(0.15 mm, 2%). Raster parity independently covers missing regions. Unmatched/split runs are counted, not assumed equal.",
        unmatchedPdfLabels: g.texts.filter(
          (t) =>
            !pdf.some(
              (p) =>
                p.text.replace(/\s+/g, " ") === t.text.replace(/\s+/g, " "),
            ),
        ).length,
      },
    ),
  );
  const unmatched = g.texts.filter(
    (t) =>
      !pdf.some(
        (p) => p.text.replace(/\s+/g, " ") === t.text.replace(/\s+/g, " "),
      ),
  ).length;
  if (unmatched)
    out.push(
      obs("DQ-21", [], {
        id: `${c.id}/DQ-21/unmatched-${s.number}`,
        status: "not-implemented",
        reason:
          "Needs a PDF text-run to SVG-label association, or per-glyph advances for split/shaped labels.",
        unmatchedLabels: unmatched,
      }),
    );
  out.push(
    obs("DQ-22", [], {
      status: "manual",
      reason:
        "Blind Claude and Codex drafter reviews at print size; record material/minor red-lines with sheet.zone.",
    }),
  );
  for (const [dq, reason] of Object.entries(reasons))
    out.push(obs(dq, [], { status: "not-implemented", reason }));
  return out;
}
export function evaluatePacket(c, packet, geometries, tables = []) {
  const first = packet.sheets[0],
    out = [observation(c, first, "DQ-20", checks.packetStyle(geometries))];
  for (const medium of ["svg", "html", "pdf"]) {
    const texts = geometries.flatMap((g, i) =>
      (medium === "svg"
        ? g.texts
        : medium === "html"
          ? (g.htmlTexts ?? [])
          : checks.pdfGeometryTexts(g.texts, g.pdfTexts ?? [])
      ).map((t) => ({
        ...t,
        policySheet: i + 1,
      })),
    );
    for (const font of [...new Set(texts.map((t) => t.font))].sort()) {
      const group = texts.filter((t) => t.font === font);
      const issues = checks.capPolicy(group, medium);
      const sheet =
        packet.sheets[(issues[0]?.policySheet ?? group[0].policySheet) - 1];
      out.push({
        ...observation(c, sheet, "DQ-02", issues),
        id: `${c.id}/DQ-02/iso-policy-${medium}-${encodeURIComponent(font)}`,
        classification: "policy-gap",
        medium,
        ...(group.every((t) => t.capHeightMm === undefined)
          ? {
              status: "not-implemented",
              reason:
                "PDF cap policy needs the declared font CapHeight metric; no platform substitute is used.",
            }
          : {}),
        scope:
          "ISO cap height policy, separate from em geometry; requires renderer/user adoption",
      });
    }
  }
  for (const table of tables.filter(
    (t, i) => tables.findIndex((x) => x.kind === t.kind) === i,
  )) {
    const sheet =
      packet.sheets.find((s) => s.view.kind === table.kind) ?? first;
    out.push({
      ...observation(
        c,
        sheet,
        "DQ-19",
        tables.filter((t) => t.kind === table.kind).length === 1
          ? checks.reportInventory(table, packet, geometries)
          : [],
      ),
      id: `${c.id}/DQ-19/query-${table.kind}`,
      ...(tables.filter((t) => t.kind === table.kind).length > 1
        ? {
            status: "not-implemented",
            reason:
              "Needs source request/view index on report sheets to distinguish multiple reports of the same kind.",
          }
        : {
            scope:
              "Exact source-row identities and multiplicities from the built public query API versus actual DOM report rows.",
          }),
    });
  }
  const indexes = packet.sheets.filter((s) => s.view.kind === "index");
  if (indexes.length) {
    const listed = new Set(
      indexes.flatMap((s) => geometries[packet.sheets.indexOf(s)].reportRows),
    );
    const missing = packet.sheets.filter((s) => !listed.has(String(s.number)));
    out.push({
      ...observation(
        c,
        indexes[0],
        "DQ-19",
        missing.map((s) => ({
          kind: "index-omits-sheet",
          element: "drawing-index",
          designation: s.view.title ?? s.view.root?.designation ?? s.view.kind,
          sheetLevel: true,
          missingSheet: s.number,
        })),
      ),
      id: `${c.id}/DQ-19/index-completeness`,
    });
  }
  const printedZones = checks.printedReferenceZones(packet, geometries);
  for (const sheet of packet.sheets.filter((s) => s.view.kind === "references"))
    out.push({
      ...observation(
        c,
        sheet,
        "DQ-09",
        printedZones
          .filter((x) => x.sheet === sheet.number)
          .map((x) => x.finding),
      ),
      id: `${c.id}/DQ-09/printed-references-${sheet.number}`,
    });
  for (const [i, sheet] of packet.sheets.entries())
    if (
      sheet.references?.some(
        (r) =>
          sheet.references.filter((q) => q.deviceUid === r.deviceUid).length >
          1,
      ) ||
      sheet.references?.some((r) => {
        const body = geometries[i].devices.find(
          (d) => d.deviceUid === r.deviceUid,
        );
        return body && checks.zonesForBox(geometries[i], body.bbox).length > 1;
      })
    )
      out.push({
        ...observation(c, sheet, "DQ-09", []),
        id: `${c.id}/DQ-09/appearance-anchor-${sheet.number}`,
        status: "not-implemented",
        reason:
          "Needs a stable per-appearance/connector anchor identity to distinguish repeated device appearances or a device spanning zone boundaries. Unique unambiguous targets are measured from the printed grid.",
      });
  const measured = geometries
    .map((g, i) => ({
      sheet: packet.sheets[i].number,
      ...checks.utilisation(g),
    }))
    .filter((x) => x.fraction !== undefined);
  if (measured.length) {
    const sorted = measured.map((x) => x.fraction).sort((a, b) => a - b),
      n = sorted.length,
      median =
        n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    out.push({
      ...observation(
        c,
        first,
        "DQ-12",
        median < 0.4
          ? [
              {
                kind: "median-utilisation-below-40-percent",
                element: "packet",
                designation: "drawing area",
                bbox: measured[0].bbox,
                median,
                perSheet: measured,
              },
            ]
          : [],
      ),
      id: `${c.id}/DQ-12/packet-median`,
      scope:
        "Bounding envelope of measured conductor/symbol ink divided by the inner drawing area (frame/title excluded); table/index sheets excluded. Packability is separately unimplemented.",
    });
  }
  return out;
}
export function symbolsFromGeometry(g, ir) {
  const netByTerminal = new Map(
    ir.nets.flatMap((n) =>
      n.terminalIds.map((t) => [`${t.deviceUid}/${t.terminalKey}`, n.id]),
    ),
  );
  const ports = g.terminals.map((t) => ({
    ...t,
    net: t.net ?? netByTerminal.get(`${t.deviceUid}/${t.terminal}`),
  }));
  const result = [];
  for (const d of ir.devices) {
    const source = ir.functions.some(
      (f) => f.id.deviceUid === d.uid && f.kind === "source",
    );
    const ps = ports.filter((p) => p.deviceUid === d.uid),
      shapes = g.shapes.filter(
        (s) =>
          source &&
          s.deviceUid === d.uid &&
          !s.terminal &&
          !s.outline &&
          s.symbol?.includes("source") &&
          s.cls?.includes("symbol-body"),
      );
    if (ps.length > 1 && shapes.length)
      result.push({
        element: d.uid,
        designation: d.designation,
        bbox: shapes[0].bbox,
        ports: ps,
        shapes,
      });
  }
  return result;
}
export function sweepResults(cases, results) {
  const rows = [];
  for (const c of cases.filter((c) => c.sweep && c.flow === "top-to-bottom")) {
    const horizontal = results.find(
        (x) => x.case === c.id.replace("top-to-bottom", "left-to-right"),
      ),
      vertical = results.find((x) => x.case === c.id);
    if (!horizontal || !vertical) throw Error("Sweep pairing incomplete");
    const issues = [];
    let remedies = [];
    if (horizontal.ok && !vertical.ok) {
      remedies = results.filter(
        (x) =>
          x.ok &&
          x.spec.sweep?.project === c.sweep.project &&
          x.spec.flow === c.flow &&
          (x.spec.sweep.layout === "compact" || x.spec.sweep.size === "a3"),
      );
      if (vertical.error?.code !== "R006" || !remedies.length)
        issues.push({
          kind: "vertical-flow-fails-without-verified-remedy",
          element: "request",
          designation: c.sweep.project,
          sheetLevel: true,
          error: vertical.error,
          remedies: remedies.map((x) => x.case),
        });
    }
    rows.push({
      ...observation(c, { number: 0 }, "DQ-11", issues),
      id: `${c.id}/DQ-11/flow-comparison`,
      evidence: {
        findingCount: issues.length,
        findings: issues,
        horizontalSuccess: horizontal.ok,
        verticalSuccess: vertical.ok,
        verticalError: vertical.error ?? null,
        verifiedRemedies: remedies.map((r) => r.case),
      },
      scope:
        "36 paper/orientation/layout cells, each in both flows. Remedy is executed and must render; default tabloid standard refusal is still recorded as a render failure.",
    });
  }
  return rows;
}

function cohort(findings, key) {
  const grouped = new Map();
  for (const f of findings) {
    const k = JSON.stringify(key(f));
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(f);
  }
  return [...grouped.values()].map((list) => ({
    ...list[0],
    instances: list.map(
      ({ kind, fontPair, font, role, ...instance }) => instance,
    ),
    instanceCount: list.length,
  }));
}
