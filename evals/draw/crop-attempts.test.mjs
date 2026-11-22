import { expect, it, vi } from "vitest";
import { pngFixture } from "./png-fixture.mjs";
import { sourceVerificationFixture } from "./crop-source-fixture.mjs";
import {
  captureAttempts,
  checkAttempts,
  verifyAttemptPixels,
  checkAttemptStats,
  verificationPath,
} from "./crop-attempts.mjs";
import { checkSourceVerification } from "./crop-source-policy.mjs";
import { hash, json } from "./support.mjs";
const white = () =>
  pngFixture({ width: 100, height: 100, pixel: () => [255, 255, 255, 255] });
const black = () =>
  pngFixture({ width: 100, height: 100, pixel: () => [0, 0, 0, 255] });
async function run(passAt) {
  const attempts = [],
    references = new Map(),
    crop = white();
  const capture = vi.fn(async (n) => (n === passAt ? crop : black()));
  let selectedAttempt, error;
  try {
    selectedAttempt = await captureAttempts(
      crop,
      0,
      capture,
      references,
      attempts,
    );
  } catch (e) {
    error = e;
  }
  const v = { ...sourceVerificationFixture(crop), selectedAttempt, attempts };
  return { v, attempts, references, capture, crop, error };
}
it.each([1, 2, 3])(
  "stops on capture %s and retains the ordered integer stats and reference hashes",
  async (n) => {
    const c = await run(n);
    expect(c.error).toBeUndefined();
    expect(c.capture).toHaveBeenCalledTimes(n);
    expect(c.v.selectedAttempt).toBe(n);
    expect(c.attempts).toHaveLength(n);
    expect(c.references.size).toBe(n === 1 ? 1 : 2);
    expect(() =>
      checkSourceVerification({ sourceVerification: c.v }),
    ).not.toThrow();
    expect(() =>
      verifyAttemptPixels(c.v, c.crop, 0, c.references),
    ).not.toThrow();
    expect(c.attempts.at(-1).stats).toEqual({
      pixels: 10000,
      changed: 0,
      maximum: 0,
      absoluteError: 0,
    });
    if (n > 1)
      expect(c.attempts[0].stats).toEqual({
        pixels: 10000,
        changed: 10000,
        maximum: 255,
        absoluteError: 7650000,
      });
  },
);
it("exhausts exactly three captures and never creates a selected pass", async () => {
  const c = await run(0);
  expect(c.error.message).toMatch(/after 3 attempts/);
  expect(c.capture).toHaveBeenCalledTimes(3);
  expect(c.attempts).toHaveLength(3);
  expect(c.v.selectedAttempt).toBeUndefined();
  expect(() => checkAttempts(c.v)).toThrow();
});
it.each([
  ["dimensions", () => pngFixture({ width: 101, height: 100 })],
  [
    "alpha",
    () =>
      pngFixture({ width: 100, height: 100, pixel: () => [255, 255, 255, 0] }),
  ],
  ["PNG framing", () => Buffer.from("invalid")],
  [
    "infrastructure",
    () => {
      throw Error("Chromium closed");
    },
  ],
])("never retries %s", async (_, frame) => {
  const attempts = [],
    refs = new Map(),
    capture = vi.fn(async () => frame());
  await expect(
    captureAttempts(white(), 0, capture, refs, attempts),
  ).rejects.toThrow();
  expect(capture).toHaveBeenCalledTimes(1);
  expect(attempts[0]).toMatchObject({ verdict: "error", stats: null });
});
it("does not retry invalid stamp headers or foreign padding", async () => {
  const capture = vi.fn(async () => white());
  await expect(
    captureAttempts(white(), 86, capture, new Map(), []),
  ).rejects.toThrow();
  expect(capture).toHaveBeenCalledTimes(1);
});
const mutations = [
  [
    "non-integer passing stats",
    (v) => (v.attempts.at(-1).stats.absoluteError = 0.5),
  ],
  ["missing attempts", (v) => delete v.attempts],
  ["excess attempts", (v) => v.attempts.push(v.attempts.at(-1))],
  ["omitted first refusal", (v) => v.attempts.shift()],
  ["reordered attempts", (v) => v.attempts.reverse()],
  [
    "changed reference hash",
    (v) => (v.attempts[0].referenceSha256 = "invented"),
  ],
  [
    "changed previous hash",
    (v) => (v.attempts[1].previousSha256 = hash("wrong")),
  ],
  ["invented field", (v) => (v.attempts.at(-1).extra = true)],
  ["selected wrong attempt", (v) => (v.selectedAttempt = 1)],
  ["caller cap", (v) => (v.maxAttempts = 4)],
  ["looser limits", (v) => (v.limits.channel = 65)],
  ["capture implementation", (v) => (v.capture.implementation = "other")],
  ["capture flags", (v) => (v.capture.args = ["--disable-gpu"])],
  ["capture scale", (v) => (v.capture.deviceScaleFactor = 1)],
  ["empty browser", (v) => (v.capture.browser = "")],
  ["empty platform", (v) => (v.capture.platform = "")],
  ["false reason", (v) => (v.attempts.at(-1).reason = "other")],
  ["false verdict", (v) => (v.attempts[0].verdict = "pass")],
  [
    "skipped passing attempt",
    (v) => {
      v.attempts[0].stats = v.attempts[2].stats;
      v.attempts[0].reason = null;
      v.attempts[0].verdict = "pass";
      v.attempts.forEach(
        (a, i) => (a.previousSha256 = i ? hash(json(v.attempts[i - 1])) : null),
      );
    },
  ],
];
it.each(mutations)("rejects %s", async (_, mutate) => {
  const c = await run(3);
  mutate(c.v);
  expect(() => checkAttempts(c.v)).toThrow();
});
it.each([
  { pixels: 0, changed: 0, maximum: 0, absoluteError: 0 },
  { pixels: 1, changed: 2, maximum: 1, absoluteError: 2 },
  { pixels: 1, changed: 1, maximum: 256, absoluteError: 256 },
  { pixels: 1, changed: 1, maximum: 1, absoluteError: 0.5 },
  { pixels: 1, changed: 0, maximum: 1, absoluteError: 1 },
  { pixels: 1, changed: 1, maximum: 1, absoluteError: 1000 },
  { pixels: 1, changed: 1, maximum: 2, absoluteError: 1 },
  { pixels: 1, changed: 1, maximum: 1, absoluteError: 1, extra: 0 },
])("rejects inconsistent/non-integer stats %j", (s) =>
  expect(() => checkAttemptStats(s)).toThrow(),
);
it("recomputes pixels rather than trusting coherently edited, passing statistics", async () => {
  const c = await run(1),
    png = black(),
    sha = hash(png);
  c.v.attempts[0].referenceSha256 = sha;
  c.references = new Map([[sha, png]]);
  expect(() => verifyAttemptPixels(c.v, c.crop, 0, c.references)).toThrow(
    /statistics differ/,
  );
  c.v.attempts[0].referenceSha256 = hash(c.crop);
  expect(() => verifyAttemptPixels(c.v, c.crop, 0, c.references)).toThrow(
    /verification PNG/,
  );
});
it("refuses v1 even with an otherwise complete v2 body", () => {
  const sourceVerification = {
    ...sourceVerificationFixture(),
    format: "thermite-draw-source-crop/1.0",
  };
  expect(() => checkSourceVerification({ sourceVerification })).toThrow(
    /Bind crop/,
  );
});
it("requires the attempt policy on source attestation validation", () => {
  const v = sourceVerificationFixture();
  delete v.attempts;
  expect(() => checkSourceVerification({ sourceVerification: v })).toThrow();
});
it("requires the attempt policy when independently recomputing pixels", async () => {
  const c = await run(3);
  c.v.maxAttempts = 4;
  expect(() => verifyAttemptPixels(c.v, c.crop, 0, c.references)).toThrow();
});
it.each([
  ["channel", { pixels: 10000, changed: 1, maximum: 65, absoluteError: 65 }],
  ["fraction", { pixels: 10000, changed: 301, maximum: 1, absoluteError: 301 }],
  ["mean", { pixels: 10000, changed: 300, maximum: 32, absoluteError: 28800 }],
])("uses the fixed %s predicate for numeric retries", async (_, stats) => {
  const { pixelRefusal } = await import("./crop-source-pixels.mjs");
  expect(pixelRefusal(stats)).not.toBeNull();
});
it("preserves integer sums in signed serialization", async () => {
  const c = await run(3);
  expect(JSON.parse(json(c.v)).attempts).toEqual(c.attempts);
});
it("rejects invalid verification filenames", () =>
  expect(() => verificationPath("../wrong")).toThrow(
    /Invalid verification PNG hash/,
  ));
it("does not call a numeric failure a selected pass", () => {
  const v = sourceVerificationFixture();
  v.attempts[0].stats = {
    pixels: 360,
    changed: 360,
    maximum: 255,
    absoluteError: 275400,
  };
  v.attempts[0].reason =
    "Crop/source pixel delta exceeds antialiasing tolerance";
  expect(() => checkAttempts(v)).toThrow(/verdict differs/);
});
