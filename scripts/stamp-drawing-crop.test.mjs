import { expect, it, vi } from "vitest";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { drawingHash } from "../evals/draw/png-ink.mjs";
import {
  assertCropContainsInstance,
  stampInstanceDrawingCrop,
  stampDrawingCrop,
} from "./stamp-drawing-crop.mjs";
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
  const first = await stampDrawingCrop(raw, a),
    second = await stampDrawingCrop(raw, b);
  expect(first.equals(second)).toBe(false);
  expect(drawingHash(first, 86)).toBe(drawingHash(second, 86));
  expect((await stampDrawingCrop(first, b, true)).equals(second)).toBe(true);
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
      Buffer.alloc(0),
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
    stampDrawingCrop(canvas.toBuffer("image/png"), ["a", "b", "c", "d"], true),
  ).rejects.toThrow("Stamped header band must not be blank");
});
