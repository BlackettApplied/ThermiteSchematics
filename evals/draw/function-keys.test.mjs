import { expect, it } from "vitest";
import { functionKeys } from "./checks.mjs";

const ir = {
  devices: [
    { uid: "ai", designation: "AI1" },
    { uid: "pt", designation: "PT1" },
  ],
  functions: [
    { id: { deviceUid: "ai", functionKey: "ch0" } },
    { id: { deviceUid: "pt", functionKey: "signal" } },
  ],
  terminals: [],
};
const findings = (text, data = ir) =>
  functionKeys({ texts: [{ element: "note", text }] }, data);

it.each(["AI1.ch0", "PT1.signal"])(
  "DQ-05 measures a qualified key embedded in an engine note: %s",
  (key) => {
    expect(findings(`polarity not verified: ${key}.`)).toMatchObject([
      { kind: "printed-function-key", key },
    ]);
  },
);

it("reports both qualified keys and repeated occurrences in text order", () => {
  expect(
    findings("polarity not verified: AI1.ch0, PT1.signal.").map((f) => f.key),
  ).toEqual(["AI1.ch0", "PT1.signal"]);
  const note = "polarity not verified: AI1.ch0, PT1.signal, AI1.ch0.";
  expect(findings(note).map(({ key, keyOffset }) => [key, keyOffset])).toEqual([
    ["AI1.ch0", note.indexOf("AI1.ch0")],
    ["PT1.signal", note.indexOf("PT1.signal")],
    ["AI1.ch0", note.lastIndexOf("AI1.ch0")],
  ]);
});

it("retains the authored-description exemption without exempting function captions", () => {
  const text = "AI1.ch0, PT1.signal";
  const data = {
    ...ir,
    devices: [{ ...ir.devices[0], description: text }, ir.devices[1]],
  };
  const measure = (role) =>
    functionKeys(
      {
        texts: [
          {
            element: "description",
            text,
            deviceUid: "ai",
            tagOwnerUid: "ai",
            tagField: "description",
            tagOwnershipValid: true,
            role,
          },
        ],
      },
      data,
    );
  expect(measure("")).toEqual([]);
  expect(measure("label-function").map((f) => f.key)).toEqual([
    "AI1.ch0",
    "PT1.signal",
  ]);
});

it("exempts only marked request-note text, keeping identical generated text measured", () => {
  const text = "polarity not verified: AI1.ch0, PT1.signal.";
  const result = functionKeys(
    {
      texts: [
        { element: "authored", text, authoredText: "request-note" },
        { element: "generated", text },
        { element: "unrecognized-origin", text, authoredText: "engine-note" },
      ],
    },
    ir,
    {
      sheet: { view: { title: "Authored", format: "signal-loop-view/0.1" } },
      request: {
        views: [
          {
            title: "Authored",
            format: "signal-loop-view-request/0.1",
            notes: [text],
          },
        ],
      },
    },
  );
  expect(result.map(({ element, key }) => [element, key])).toEqual([
    ["generated", "AI1.ch0"],
    ["generated", "PT1.signal"],
    ["unrecognized-origin", "AI1.ch0"],
    ["unrecognized-origin", "PT1.signal"],
  ]);
});

it("DQ-05 accepts terminal bindings and designation-only fallback", () => {
  for (const note of [
    "polarity not verified: AI1 terminals 9–13, PT1 terminals 1/2.",
    "polarity not verified: AI1, PT1.",
  ])
    expect(findings(note)).toEqual([]);
});

it("does not mistake longer identifiers or authored terminals for function keys", () => {
  expect(findings("polarity not verified: XAI1.ch0, AI1.ch01.")).toEqual([]);
  expect(
    findings("Landed on PT1.signal.", {
      ...ir,
      terminals: [{ id: { deviceUid: "pt", terminalKey: "signal" } }],
    }),
  ).toEqual([]);
});

it("matches qualified designations and keys literally", () => {
  const data = {
    ...ir,
    devices: [{ uid: "ai", designation: "AI(1)+" }],
    functions: [{ id: { deviceUid: "ai", functionKey: "ch[0]" } }],
  };
  expect(findings("polarity not verified: AI(1)+.ch[0].", data)).toHaveLength(
    1,
  );
  expect(findings("polarity not verified: AI1.ch0.", data)).toEqual([]);
});
