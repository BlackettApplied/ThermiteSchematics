import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { hash } from "./support.mjs";
import { compareReports } from "./paired-raster.mjs";
import {
  pairedRegions,
  compareSamples,
  GATE_MODE,
  GATE_ARGS,
} from "./paired-raster-plan.mjs";
import { pngFixture } from "./png-fixture.mjs";
import { gateSource } from "./paired-raster-capture.mjs";

function report(svg) {
  return {
    mode: "strict",
    results: [
      {
        case: "case",
        sheet: 1,
        dq: "DQ-13",
        medium: "svg",
        evidence: {
          crop: "case/dot.png",
          cropDpi: 300,
          cropBbox: { x: 0, y: 0, w: 25.4, h: 25.4 },
          findings: [],
        },
      },
    ],
    sourceHashes: {
      format: "thermite-draw-sources/1.0",
      sheets: [
        {
          case: "case",
          sheet: 1,
          svg: { path: "case/sheet-001.svg", sha256: hash(svg) },
        },
      ],
    },
  };
}
const white =
  '<svg xmlns="http://www.w3.org/2000/svg" width="25.4mm" height="25.4mm" viewBox="0 0 25.4 25.4"><rect width="25.4" height="25.4" fill="white"/></svg>';
const dot = white.replace(
  "</svg>",
  '<rect x="8.466666666666667" y="8.466666666666667" width="0.08466666666666667" height="0.08466666666666667" fill="black" shape-rendering="crispEdges"/></svg>',
);
async function inputs(head, check) {
  const root = await mkdtemp(join(tmpdir(), "thermite-paired-raster-"));
  try {
    const paths = [];
    for (const [name, svg] of [
      ["base", white],
      ["head", head],
    ]) {
      const dir = join(root, name);
      await mkdir(join(dir, "case"), { recursive: true });
      await writeFile(join(dir, "case/sheet-001.svg"), svg);
      const path = join(dir, "summary.json");
      await writeFile(path, JSON.stringify(report(svg)));
      paths.push(path);
    }
    await check(...paths);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
it("gate-only fresh source renders are byte-identical and explicitly GPU-disabled", () =>
  inputs(white, async (base, head) => {
    const result = await compareReports(base, head);
    expect(result.byteIdentical).toBe(true);
    expect(result.mode).toBe(GATE_MODE);
    expect(result.results[0]).toMatchObject({
      mode: GATE_MODE,
      args: GATE_ARGS,
      byteIdentical: true,
      changedPixels: 0,
      maxChannelDelta: 0,
    });
    expect(result.results[0].browser).toMatch(/^\d+\./);
  }));
it("a planted one-pixel source change fails the GPU-disabled byte gate", () =>
  inputs(dot, async (base, head) => {
    const result = await compareReports(base, head);
    expect(result.byteIdentical).toBe(false);
    expect(result.results[0]).toMatchObject({
      changedPixels: 1,
      maxChannelDelta: 255,
    });
    expect(result.results[0].baseSourceSha256).not.toBe(
      result.results[0].headSourceSha256,
    );
  }));
it("reads a PDF pin through its own case and physical sheet", () =>
  inputs(white, async (base) => {
    const PDFDocument = createRequire(import.meta.url)("pdfkit");
    const document = new PDFDocument({ size: [72, 72], margin: 0 });
    const chunks = [];
    document.on("data", (bytes) => chunks.push(bytes));
    const complete = new Promise((done) => document.on("end", done));
    document.rect(0, 0, 72, 72).fill("white");
    document.end();
    await complete;
    const bytes = Buffer.concat(chunks),
      source = report(white);
    await writeFile(join(dirname(base), "case/packet.pdf"), bytes);
    source.sourceHashes.sheets[0].pdf = {
      path: "case/packet.pdf",
      sha256: hash(bytes),
    };
    const pinned = await gateSource(dirname(base), source, {
      case: "case",
      sheet: 1,
      medium: "pdf",
    });
    expect(pinned.bytes.equals(bytes)).toBe(true);
    expect(pinned.sha).toBe(hash(bytes));
  }));
it("missing or extra crop regions fail before rasterization", () => {
  const a = report(white),
    b = report(white);
  b.results = [];
  expect(() => pairedRegions(a, b)).toThrow(/No PNG|inventory/);
  expect(() => pairedRegions(b, a)).toThrow(/No PNG|inventory/);
  expect(() => pairedRegions(b, b)).toThrow(/No PNG/);
});
it("a changed crop box fails even with the same PNG name", () => {
  const a = report(white),
    b = report(white);
  b.results[0].evidence.cropBbox.x = 1;
  expect(() => pairedRegions(a, b)).toThrow(/boxes/);
});
it("mode labels and launch arguments cannot be mixed with default captures", () => {
  const sample = {
    png: pngFixture(),
    capture: { mode: GATE_MODE, browser: "145.0.7632.6", args: [...GATE_ARGS] },
  };
  expect(() =>
    compareSamples(sample, {
      ...sample,
      capture: { ...sample.capture, mode: "default" },
    }),
  ).toThrow(/mode/);
  expect(() =>
    compareSamples(sample, {
      ...sample,
      capture: { ...sample.capture, args: [] },
    }),
  ).toThrow(/mode/);
});

it("a planted one-pixel source change is outside the adaptive base envelope", () =>
  inputs(dot, async (base, head) => {
    const result = await compareReports(base, head);
    expect(result.pass).toBe(false);
    expect(result.results[0]).toMatchObject({
      verdict: "fail",
      N: 10,
      envelope: { changedPixels: 0, maxChannelDelta: 0 },
      headDistance: { changedPixels: 1, maxChannelDelta: 255 },
    });
  }));
