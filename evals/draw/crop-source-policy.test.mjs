import { it, expect } from "vitest";
import {
  checkSourceVerification,
  checkSourceReferences,
  predatesSourceVerification,
  assertNoCroplessFacts,
} from "./crop-source-policy.mjs";
import {
  sourceVerificationFixture,
  sourceGeometryFixture,
} from "./crop-source-fixture.mjs";
import { bindDrawingDraft } from "./repin-drawing-bindings.mjs";
import { pngFixture } from "./png-fixture.mjs";
import { hash } from "./support.mjs";
it.each([
  ["format", "invented"],
  ["dpi", 96],
  ["sourceSha256", "invented"],
  ["medium", "PDFKit"],
  ["sheet", 0],
  ["sheet", 1.5],
])("requires verified source %s = %s", (key, value) => {
  const entry = {
    sourceVerification: { ...sourceVerificationFixture(), [key]: value },
  };
  expect(() => checkSourceVerification(entry)).toThrow(/source with Chromium/);
});
it("requires contained source verification geometry", () => {
  const sourceVerification = sourceVerificationFixture();
  sourceVerification.instanceBbox.x = 20;
  expect(() => checkSourceVerification({ sourceVerification })).toThrow(
    /outside/,
  );
});
it("requires future cropped entries to have source verification", () =>
  expect(() =>
    checkSourceReferences(
      { pr: "#61" },
      [{ entry: {} }],
      hash("different signed file"),
    ),
  ).toThrow(/source with Chromium/));
it.each([
  ["#92", "b56690d45cae4a53beef6dfe39b68221d00d00842cce36445cd6c175b7094da5"],
  ["#61", "f9122b862d64548e21c3dfc8dfa4067c05c5d712d4a2ff1f9029322a05cca499"],
])(
  "recognizes exact historical %s signed bytes, not its PR alone",
  (pr, sha) => {
    expect(predatesSourceVerification({ pr }, sha)).toBe(true);
    expect(predatesSourceVerification({ pr }, hash("changed"))).toBe(false);
    expect(predatesSourceVerification({ pr: "#1" }, sha)).toBe(false);
    expect(checkSourceReferences({ pr }, [{ entry: {} }], sha)).toBe(
      "historical signed hash",
    );
  },
);
it.each(["drawingSha256", "sourceVerification"])(
  "refuses crop-less %s",
  (key) => {
    expect(() =>
      assertNoCroplessFacts({ entries: [{ [key]: "typed" }] }),
    ).toThrow(/Crop-less/);
  },
);
function draft() {
  const path = "crop.png",
    bytes = pngFixture(),
    sha256 = hash(bytes);
  return {
    file: {
      format: "thermite-draw-decisions/1.0",
      entries: [{ reviewed: false, crop: { path, sha256 } }],
    },
    index: {
      crops: [
        { path, sha256, ...sourceGeometryFixture(), capture: "fresh-source" },
      ],
    },
    crops: new Map([[path, bytes]]),
  };
}
it("refuses an uncited row even when all cited buffers are valid", () => {
  const c = draft();
  c.file.entries = [];
  expect(() => bindDrawingDraft(c.file, c.index, c.crops)).toThrow(
    /exactly cover/,
  );
});
it("bind checks instance containment rather than a row representative", () => {
  const c = draft();
  c.index.crops[0].instanceBbox.x = 30;
  expect(() => bindDrawingDraft(c.file, c.index, c.crops)).toThrow(/outside/);
});
it("typed source attestation is removed until the browser computes it", () => {
  const c = draft();
  c.file.entries[0].sourceVerification = sourceVerificationFixture();
  expect(
    bindDrawingDraft(c.file, c.index, c.crops).entries[0].sourceVerification,
  ).toBeUndefined();
});

it("missing hashes and unknown PRs never qualify as historical records", () => {
  expect(predatesSourceVerification({}, undefined)).toBe(false);
  expect(() => checkSourceReferences({}, [{ entry: {} }], undefined)).toThrow(
    /source with Chromium/,
  );
});
it("the binder refuses crop-less facts at its own call site", () => {
  const c = draft();
  c.file.entries.push({
    reviewed: false,
    action: "retire",
    drawingSha256: hash("unused"),
  });
  expect(() => bindDrawingDraft(c.file, c.index, c.crops)).toThrow(/Crop-less/);
});

it.each([
  undefined,
  "pipeline",
  "fresh-source ",
  { implementation: "fresh-source" },
])("bind requires the exact fresh-source capture label: %j", (capture) => {
  const c = draft();
  c.index.crops[0].capture = capture;
  expect(() => bindDrawingDraft(c.file, c.index, c.crops)).toThrow(
    /capture: "fresh-source"/,
  );
});
