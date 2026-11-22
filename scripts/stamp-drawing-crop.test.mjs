import { pngFixture } from "../evals/draw/png-fixture.mjs";
import { expect, it, vi } from "vitest";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { drawingHash } from "../evals/draw/png-ink.mjs";
import {
  assertCropContainsInstance,
  stampInstanceDrawingCrop,
  stampDrawingCrop,
  headerFontPixels,
} from "./stamp-drawing-crop.mjs";
const geometry = {
  instance: { bbox: { x: 1, y: 1, w: 1, h: 1 } },
  cropBbox: { x: 0, y: 0, w: 3, h: 3 },
};
it("rebuilds each original stamp from a group's retained pixels and literal header lines", async () => {
  const canvas = createCanvas(90, 30),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 90, 30);
  ctx.strokeStyle = "black";
  ctx.strokeRect(5, 5, 50, 20);
  const raw = canvas.toBuffer("image/png");
  const a = ["marker A", "case one", "source.png", "token A"];
  const b = ["marker B", "case two", "source.png", "token B"];
  const first = await stampDrawingCrop(raw, a, false, geometry),
    second = await stampDrawingCrop(raw, b, false, geometry);
  expect(first.equals(second)).toBe(false);
  expect(drawingHash(first, 86)).toBe(drawingHash(second, 86));
  expect(
    (await stampDrawingCrop(first, b, true, geometry)).equals(second),
  ).toBe(true);
});
it("refuses unstorable or multiline header provenance", async () => {
  await expect(stampDrawingCrop(Buffer.alloc(0), ["one"])).rejects.toThrow(
    "four header lines",
  );
  await expect(
    stampDrawingCrop(Buffer.alloc(0), ["a\nb", "c", "d", "e"]),
  ).rejects.toThrow("printable ASCII");
});

it("refuses the false C005 header on the row's C001 representative crop", async () => {
  const instance = {
    text: "C005 / 01",
    bbox: { x: 216.184, y: 212.455, w: 9.029, h: 1.617 },
  };
  expect(() =>
    assertCropContainsInstance(instance, {
      x: 232.584,
      y: 116.955,
      w: 15.029,
      h: 7.617,
    }),
  ).toThrow("Cited instance is outside the source crop");
  expect(() =>
    assertCropContainsInstance(instance, {
      x: 213.184,
      y: 209.455,
      w: 15.029,
      h: 7.617,
    }),
  ).not.toThrow();
  await expect(
    stampInstanceDrawingCrop(
      pngFixture(),
      ["marker", "scope", "source", "C005 / 01"],
      instance,
      { x: 232.584, y: 116.955, w: 15.029, h: 7.617 },
    ),
  ).rejects.toThrow("Cited instance is outside the source crop");
});

it("refuses failed bundled-font registration before using a machine fallback", async () => {
  const registration = vi
    .spyOn(GlobalFonts, "registerFromPath")
    .mockReturnValue(null);
  vi.resetModules();
  try {
    await expect(import("./stamp-drawing-crop.mjs")).rejects.toThrow(
      "Could not register bundled crop-header font",
    );
  } finally {
    registration.mockRestore();
    vi.resetModules();
  }
});

it("refuses to strip an 86-pixel band that is not a stamped header", async () => {
  const canvas = createCanvas(90, 120),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 90, 120);
  ctx.strokeStyle = "black";
  ctx.strokeRect(5, 100, 50, 15);
  await expect(
    stampDrawingCrop(
      canvas.toBuffer("image/png"),
      ["a", "b", "c", "d"],
      true,
      geometry,
    ),
  ).rejects.toThrow("Stamped header band must not be blank");
});

it("requires instance containment on the general stamper API", async () => {
  await expect(
    stampDrawingCrop(pngFixture(), ["a", "b", "c", "d"]),
  ).rejects.toThrow("outside the source crop");
});

it.each(["instance", "source-bbox"])(
  "the stamper CLI independently requires --%s",
  async (missing) => {
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(
      "bun",
      [
        "scripts/stamp-drawing-crop.mjs",
        "--drawing",
        "missing.png",
        "--header-lines",
        "missing.json",
        "--output",
        "missing-output.png",
        ...(missing === "instance"
          ? ["--source-bbox", "bbox.json"]
          : ["--instance", "instance.json"]),
      ],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(
      /AssertionError(?: \[ERR_ASSERTION\])?: Use --drawing/,
    );
  },
);
it("bind refuses header pixels that contradict report-owned literal header lines", async () => {
  const { verifyStampHeaders } =
    await import("../evals/draw/crop-stamp-check.mjs");
  const actual = await stampDrawingCrop(
    pngFixture(),
    ["marker", "scope", "token", "Text B"],
    false,
    geometry,
  );
  const row = {
    path: "crop.png",
    headerPixels: 86,
    headerLines: ["marker", "scope", "token", "Text A"],
    instanceBbox: geometry.instance.bbox,
    sourceBbox: geometry.cropBbox,
  };
  await expect(
    verifyStampHeaders({ crops: [row] }, new Map([[row.path, actual]])),
  ).rejects.toThrow(/header pixels differ/);
  row.headerLines[3] = "Text B";
  await expect(
    verifyStampHeaders({ crops: [row] }, new Map([[row.path, actual]])),
  ).resolves.toBeUndefined();
});
it("keeps the physical page visible on an overflowing case/view line", async () => {
  const line =
    "case-with-a-long-prefix | " +
    "a detailed view title ".repeat(4) +
    " | physical page ";
  const a = ["marker", line + "1", "token", "Text W-C11"],
    b = ["marker", line + "9", "token", "Text W-C11"];
  const A = await stampDrawingCrop(pngFixture(), a, false, geometry),
    B = await stampDrawingCrop(pngFixture(), b, false, geometry);
  expect(A.equals(B)).toBe(false);
  expect(drawingHash(A, 86)).toBe(drawingHash(B, 86));
  expect((await stampDrawingCrop(A, a, true, geometry)).equals(A)).toBe(true);
});
it("uses 14 px by default, permits exactly 10 px and refuses below the floor", () => {
  expect(headerFontPixels(90, 100, "line 1")).toBe(14);
  expect(headerFontPixels(140, 100, "line 1")).toBe(10);
  expect(() => headerFontPixels(140.001, 100, "line 2 token abc")).toThrow(
    /line 2 token abc: header needs 117 px width at 10 px minimum; available 116 px/,
  );
});
it.each(["W".repeat(500), "\\u1234".repeat(100)])(
  "refuses an overflowing literal header without truncation: %s",
  async (line) => {
    await expect(
      stampDrawingCrop(
        pngFixture(),
        ["marker", line, "Report instance token-abc", "Text W-C11"],
        false,
        geometry,
      ),
    ).rejects.toThrow(
      /Header line 2 ".*" \(Report instance token-abc\).*width at 10 px minimum; available 760 px/,
    );
  },
);
it("quotes a shortened preview of the overflowing line rather than the token line", async () => {
  const line = 'Text "offending" ' + "W".repeat(500);
  let error;
  try {
    await stampDrawingCrop(
      pngFixture(),
      ["marker", "scope", "Report instance token-abc", line],
      false,
      geometry,
    );
  } catch (e) {
    error = e;
  }
  expect(error?.message).toContain(
    `Header line 4 ${JSON.stringify(line.slice(0, 77) + "...")} (Report instance token-abc)`,
  );
  expect(error.message).not.toContain(line);
  expect(error.message).toContain("width at 10 px minimum; available 760 px");
});
