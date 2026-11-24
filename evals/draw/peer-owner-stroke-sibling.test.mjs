import { afterAll, beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { compileProject } from "../../packages/compiler/dist/index.js";
import { embedPrintableFont } from "../../packages/cli/dist/printable-font.js";
import { renderSchematicPacket } from "../../packages/render/dist/index.js";
import { NavigationSlotFailure } from "../../packages/render/dist/packet/navigation-slots.js";
import { navigationGeometry } from "../../packages/render/dist/packet/navigation-walk.js";
import { emitPeerReferences } from "../../packages/render/dist/packet/peer-reference-ink.js";
import { peerRouteIndex } from "../../packages/render/dist/packet/peer-route-ink.js";
import { printableTextMetrics } from "../../packages/render/dist/text-metrics.js";
import { drawingContextOptions, launch, openSheet } from "./browser.mjs";
import { peerReferenceFindings } from "./issued-reference-audit.mjs";
import { nativeRows } from "./m3-native.mjs";
import {
  CONDUCTOR_OWNER_MARGIN_MM,
  boxGap,
  foreignConductorBoxes,
} from "./peer-owner-ink.mjs";
import { terminalPeerObligations } from "./terminal-peer-oracle.mjs";

let browser, page;
beforeAll(async () => {
  // Accurate Canvas bounds for small-font clearance checks (crbug.com/479240778).
  browser = await launch([
    "--enable-blink-features=CanvasTextMetricsPreciseBounds",
  ]);
  page = await browser.newPage(drawingContextOptions);
});
afterAll(async () => browser?.close());

async function runStrokeMarginProbe(strokeWidth, extraMm) {
  const value = "W1 · A.1 → B.1 02.B2";
  const compact = "→ B.1 02.B2";
  const metric = printableTextMetrics(value, 2.5);
  const field = {
    x: 50,
    y: 50,
    w: metric.right - metric.left + 0.041,
    h: metric.top - metric.bottom + 0.041,
  };
  const owner = { x: 50, y: 46.7, w: 1.3, h: 1.3 };
  const source = ["A.1", "w1", "B.1"];
  const ownWire = { kind: "wire", uid: "w1" };
  const y = +(field.y + field.h + boxGap(field, owner) + extraMm).toFixed(4);
  const baseSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="300mm" height="200mm" viewBox="0 0 300 200" font-family="Thermite Sans, sans-serif">` +
    `<g data-device-uid="A"><circle class="terminal-marker" data-terminal-marker="true" data-terminal-key="1" cx="50.65" cy="47.35" r=".65" fill="white" stroke="#17212b" stroke-width=".3"/></g>` +
    `<g data-circuit-conductor="w2"><path d="M40 ${y} H100" fill="none" stroke="#17212b" stroke-width="${strokeWidth}"/></g></svg>`;
  const runs = peerRouteIndex(navigationGeometry(baseSvg)).foreignRuns(ownWire);
  const sheet = {
    number: 1,
    svg: baseSvg,
    title: "Stroke edge probe",
    view: { format: "documentation-view/0.1", kind: "wiring" },
    continuations: [],
  };
  const entry = {
    kind: "conductor-peer",
    identity: source,
    owner,
    foreignConductors: runs,
    value,
    compact,
    destination: "02.B2",
    ownerLabel: "A.1",
  };
  let renderedSvg;
  let rendererAccepted = true;
  try {
    renderedSvg = emitPeerReferences(sheet, field, [entry]).svg;
  } catch (err) {
    if (!(err instanceof NavigationSlotFailure)) throw err;
    rendererAccepted = false;
  }
  const probeSvg =
    renderedSvg ??
    baseSvg.replace(
      "</svg>",
      `<text data-peer-reference="conductor-peer" data-peer-source='${JSON.stringify(source)}' x="${field.x + 0.02 - metric.left}" y="${field.y + 0.02 + metric.top}" font-size="2.5">${value}</text></svg>`,
    );
  const g = await openSheet(page, embedPrintableFont(probeSvg));
  const observedOwner = g.tranche4.markers.find(
    (m) => m.deviceUid === "A",
  ).bbox;
  const observedForeign = foreignConductorBoxes(g, ownWire);
  const findings = peerReferenceFindings(1, g, [
    {
      kind: "conductor-peer",
      source,
      owners: [observedOwner],
      foreignConductors: observedForeign,
      values: [value],
      compactValues: [compact],
      ownerLabel: "A.1",
    },
  ]);
  return { rendererAccepted, observedForeign, findings };
}

it("#573 measures 0.25 mm foreign conductor stroke-edge margin in Chromium DQ-08 and renderer", async () => {
  // 0.40 mm stroke at extra = 0.52 mm -> 0.32 mm stroke-edge margin >= 0.25 mm: both accept.
  const pass = await runStrokeMarginProbe(0.4, 0.52);
  expect(pass.observedForeign).toHaveLength(1);
  expect(pass.observedForeign[0].h).toBeCloseTo(0.4, 2);
  expect(pass.rendererAccepted).toBe(true);
  expect(pass.findings).toEqual([]);

  // Boundary probe below 0.25 mm: 0.40 mm stroke at extra = 0.26 mm leaves
  // +0.26 mm centerline (> 0.25 mm) but +0.06 mm stroke-edge (< 0.25 - 0.17 mm): both reject.
  const reject = await runStrokeMarginProbe(0.4, 0.26);
  expect(reject.observedForeign).toHaveLength(1);
  expect(reject.observedForeign[0].h).toBeCloseTo(0.4, 2);
  expect(reject.rendererAccepted).toBe(false);
  expect(reject.findings).toContainEqual(
    expect.objectContaining({
      kind: "issued-peer-reference-foreign-owner",
      minimumMarginMm: CONDUCTOR_OWNER_MARGIN_MM,
    }),
  );
}, 60_000);

it("#573 operator-console issues all 18 sheets and DQ-08 flags moving K-Y A1 note 0.5 mm toward sibling A2", async () => {
  const compiled = await compileProject("examples/operator-console");
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const req = JSON.parse(
    await readFile("examples/operator-console/packet.request.json", "utf8"),
  );
  const pkt = await renderSchematicPacket(
    compiled.ir,
    req,
    compiled.presentation,
  );
  if (!pkt.ok) throw Error(pkt.error.message);
  expect(pkt.value.sheets).toHaveLength(18);
  const geoms = [];
  for (const s of pkt.value.sheets)
    geoms.push(await openSheet(page, embedPrintableFont(s.svg)));
  const obls = terminalPeerObligations(
    pkt.value,
    geoms,
    compiled.ir,
    nativeRows(compiled.ir),
  );
  for (const [i, s] of pkt.value.sheets.entries())
    expect(
      peerReferenceFindings(
        s.number,
        geoms[i],
        obls.filter((o) => o.sheet === s.number),
      ),
    ).toEqual([]);

  // Moving sheet-5 K-Y A1 note 0.50 mm toward sibling A2 must be flagged with minimumMarginMm 0.
  const s5 = geoms[4];
  const s5Obls = obls.filter((o) => o.sheet === 5);
  const note = s5.texts.find(
    (t) =>
      t.peerReference === "terminal-interface" &&
      t.text.startsWith("K-Y · coil terminal A1"),
  );
  expect(note).toBeDefined();
  const shifted = { ...note, bbox: { ...note.bbox, y: note.bbox.y + 0.5 } };
  const mutated = {
    ...s5,
    texts: s5.texts.map((t) => (t === note ? shifted : t)),
  };
  const findings = peerReferenceFindings(5, mutated, s5Obls);
  expect(findings).toContainEqual(
    expect.objectContaining({
      kind: "issued-peer-reference-foreign-owner",
      minimumMarginMm: 0,
    }),
  );
}, 120_000);
