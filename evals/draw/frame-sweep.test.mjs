import { beforeAll, afterAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compileProject } from "@thermite/compiler";
import { renderCompactBenchmark } from "../../packages/render/src/internal/drawing-frame/benchmark.js";
import { embedPrintableFont } from "../../packages/cli/dist/printable-font.js";
import { launch, drawingContextOptions } from "./browser.mjs";
import { continuationGeometry } from "./frame-census/continuations.mjs";
import { verifyFrameCounts } from "./frame-census/contracts.mjs";

let browser, page, ir, presentation, template, narrow, folded;
let narrowPlanning, foldedPlanning;
beforeAll(async () => {
  const project = fileURLToPath(
    new URL("../../examples/machine-demo/", import.meta.url),
  );
  const compiled = await compileProject(project);
  expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
  if (!compiled.ok) return;
  ir = compiled.ir;
  presentation = compiled.presentation;
  template = JSON.parse(
    await readFile(
      new URL(
        "../../examples/machine-demo/packet.request.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  narrow = await renderCompactBenchmark(
    ir,
    {
      ...template,
      page: { size: "a3", orientation: "landscape" },
      layout: "standard",
    },
    presentation,
    (r) => {
      narrowPlanning = r;
    },
  );
  expect(narrow.ok, JSON.stringify(narrow)).toBe(true);
  folded = await renderCompactBenchmark(
    ir,
    {
      ...template,
      page: { size: "a3", orientation: "landscape" },
      layout: "compact",
    },
    presentation,
    (r) => {
      foldedPlanning = r;
    },
  );
  expect(folded.ok, JSON.stringify(folded)).toBe(true);
  browser = await launch();
  page = await (await browser.newContext(drawingContextOptions)).newPage();
}, 120000);
afterAll(async () => {
  await browser?.close();
});
it("M-N1-LEGAL: the narrow repeat sweep uses legal fallback cuts without page growth", () => {
  expect(narrow.ok, JSON.stringify(narrow)).toBe(true);
  if (!narrow.ok) return;
  expect(
    verifyFrameCounts(
      [
        {
          case: "repeat-machine-demo-a3-landscape-standard-left-to-right",
          before: 23,
        },
      ],
      [
        {
          case: "repeat-machine-demo-a3-landscape-standard-left-to-right",
          pages: narrow.value.sheets.length,
        },
      ],
    ).after,
  ).toBe(23);
  for (const sheet of narrow.value.sheets) {
    expect(sheet.svg).toContain(`SHEET ${sheet.number} OF 23`);
    expect(sheet.svg).toContain(`>${sheet.number} of 23</text>`);
  }
});
it("M-N1-LEGAL/GAP: every final stub stays two millimetres long and joins its visible owned route", async () => {
  expect(narrow.ok && folded.ok).toBe(true);
  if (!narrow.ok || !folded.ok) return;
  expect(folded.value.sheets.length).toBe(21);
  let endpoints = 0;
  for (const sheet of [...narrow.value.sheets, ...folded.value.sheets]) {
    if (!sheet.continuations.length) continue;
    const actual = await continuationGeometry(
      page,
      embedPrintableFont(sheet.svg),
      sheet.continuations,
    );
    endpoints += actual.endpoints;
    expect(
      actual.findings,
      `sheet ${sheet.number}: ${JSON.stringify(actual.findings)}`,
    ).toEqual([]);
  }
  expect(endpoints).toBeGreaterThan(0);
});
it("detects a stub shifted inside its own visible route instead of starting at the cut edge", async () => {
  expect(narrow.ok).toBe(true);
  if (!narrow.ok) return;
  const sheet = narrow.value.sheets.find(
    (s) =>
      /<path d="M [^ ]+ [^ ]+ L [^ ]+ [^ ]+"/.test(s.svg) &&
      s.continuations.length,
  );
  expect(sheet).toBeDefined();
  if (!sheet) return;
  let changed = false;
  const svg = sheet.svg.replace(
    /(<a[^>]*data-continuation-id="[^"]+"[^>]*>\s*<path d=")M ([^ ]+) ([^ ]+) L ([^ ]+) ([^"]+)(")/g,
    (match, prefix, x, y, tx, ty, suffix) => {
      if (changed || +y !== +ty || Math.abs(Math.abs(+x - +tx) - 2) > 1e-6)
        return match;
      changed = true;
      const dx = +tx > +x ? -0.1 : 0.1;
      return `${prefix}M ${+x + dx} ${y} L ${+tx + dx} ${ty}${suffix}`;
    },
  );
  expect(changed).toBe(true);
  const actual = await continuationGeometry(
    page,
    embedPrintableFont(svg),
    sheet.continuations,
  );
  expect(
    actual.findings.some((f) => f.kind === "stub-not-on-visible-owned-route"),
  ).toBe(true);
});
it("M-N1-LEGAL: an impossible protected-width case refuses atomically", async () => {
  const request = {
    ...template,
    page: { size: "letter", orientation: "portrait" },
    layout: "standard",
    views: template.views.map((v) =>
      v.flow ? { ...v, flow: "top-to-bottom" } : v,
    ),
  };
  const result = await renderCompactBenchmark(ir, request, presentation);
  expect(result).toMatchObject({
    ok: false,
    error: { code: "R006", reason: "unprintable-layout" },
  });
  if (result.ok) return;
  expect(result.error.message).toMatch(/protected width .*exceeds/);
  expect("value" in result).toBe(false);
});

it("plans the folded A3 banks within each sheet's field budget before considering legacy placement", () => {
  for (const receipts of [narrowPlanning, foldedPlanning]) {
    expect(receipts.length).toBeGreaterThan(0);
    for (const r of receipts) {
      expect(r.candidates.length).toBeGreaterThan(0);
      expect(r.sheets.length).toBe(r.referenceFields.length);
      expect(
        r.candidates.every((c) => c.fields.length === c.losses.length),
      ).toBe(true);
      expect(
        r.sheets.every(
          (s) =>
            s.lossPercent <= 2 &&
            s.strategy !== "legacy-continuation-placement",
        ),
      ).toBe(true);
      expect(r.candidates.every((c) => c.scale === r.referenceScale)).toBe(
        true,
      );
      expect(r.fallback).toBeUndefined();
    }
  }
  const affected = foldedPlanning.find(
    (r) => r.view.root.designation === "LS1",
  );
  expect(affected.sheets).toHaveLength(1);
  expect(affected.sheets[0].strategy).toBe("folded-group");
  expect(affected.sheets[0].lossPercent).toBe(0);
  expect(affected.termination).toBe("zero-loss-lower-bound");
  const chosen = affected.candidates.find(
    (c) => c.id === affected.sheets[0].candidate,
  );
  expect(chosen.groups).toEqual([[0, 1]]);
  expect(chosen.failure).toBeUndefined();
});

it("retains both finite per-side legal reservation fallbacks for the narrow repeat view", async () => {
  const { prepareSchematicDrawing } =
    await import("../../packages/render/src/renderer.js");
  const { continuationBanks } =
    await import("../../packages/render/src/packet/continuation-bank.js");
  const { rootedSpace } =
    await import("../../packages/render/src/packet/rooted-build.js");
  const { normalizePaperPage } =
    await import("../../packages/render/src/packet/page.js");
  const { useCompactFrame } =
    await import("../../packages/render/src/packet/frame-profile.js");
  const request = template.views.find((v) => v.root?.value === "LS1");
  const prepared = await prepareSchematicDrawing(ir, request, presentation, {
    packetContinuations: true,
  });
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) return;
  const paper = normalizePaperPage({ size: "a3", orientation: "landscape" });
  expect(paper.ok).toBe(true);
  if (!paper.ok) return;
  useCompactFrame(paper.value);
  const { b, scale } = rootedSpace(prepared.value, paper.value, false);
  const banks = continuationBanks(prepared.value, b, scale, 0, true);
  for (const extra of [1.7, 3.5])
    expect(
      banks.some(
        (bank) => bank.extra?.left === extra && bank.extra?.right === extra,
      ),
    ).toBe(true);
});
