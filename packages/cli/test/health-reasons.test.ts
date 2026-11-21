import { expect, it } from "vitest";
import {
  acceptBudget,
  createBudget,
  lowerBudget,
  historyRegressions,
} from "../../../scripts/health-ratchet.mjs";
import {
  migrateReasonLists,
  reasonHistoryRegressions,
  appendedReasonMatches,
} from "../../../scripts/health-reasons.mjs";
import { fn, repo, put, metrics } from "./health-fixture.js";
it("retains historical raise records losslessly while banking a reduction", () => {
  const root = repo(),
    path = "packages/example/src/history.ts",
    id = "functions:" + path + "#existing";
  put(root, path, fn(95));
  const base = metrics(root),
    budget = createBudget(base);
  budget.reasons[id] = [
    { identity: id, from: 80, to: 90, reason: "first" },
    { identity: id, from: 90, to: 95, reason: "second" },
  ];
  put(root, path, fn(93));
  const current = metrics(root),
    next = lowerBudget(current, budget, { budget, metrics: base });
  expect(next.functions[path + "#existing"]).toBe(93);
  expect(next.reasons[id]).toEqual(budget.reasons[id]);
  expect(historyRegressions(current, next, budget, base)).toEqual([]);
  const forged = structuredClone(next);
  forged.reasons[id].shift();
  expect(reasonHistoryRegressions(forged, budget).join()).toContain(
    "must append",
  );
  put(root, path, fn(96));
  expect(() =>
    acceptBudget(metrics(root), budget, "third", { budget, metrics: base }),
  ).toThrow("cannot rise");
});
it("migrates v4 single reason records losslessly and leaves arrays idempotent", () => {
  const old = {
    version: 4,
    reasons: {
      item: { identity: "item", from: 70, to: 80, reason: "original" },
    },
  };
  const next = migrateReasonLists(old);
  expect(next).toEqual({ ...old, reasons: { item: [old.reasons.item] } });
  expect(migrateReasonLists(next)).toEqual(next);
  expect(old.reasons.item.reason).toBe("original");
});

it.each([
  ["zero-width space", "Earlier\u200breview", "Earlier review"],
  ["word joiner", "Earlier\u2060review", "Earlier review"],
  ["soft hyphen", "Earlier\u00adreview", "Earlier review"],
  [
    "mixed format and whitespace",
    " Ear\u200blier\t re\u2060view\u00ad ",
    "Earlier review",
  ],
  ["removed format character", "Earlier review", "Earlier\u200breview"],
])(
  "round 4 INFO rejects a format-only reason replay: %s",
  (_name, reason, before) => {
    const identity = "typeAssertions:packages/example/src/replay.ts";
    const old = { identity, from: 0, to: 1, reason: before };
    expect(
      appendedReasonMatches([old, { ...old, reason }], [old], identity, 0, 1),
    ).toBe(false);
  },
);

it("keeps genuinely different reason text, including a trailing period, fresh", () => {
  const identity = "typeAssertions:packages/example/src/replay.ts";
  const old = { identity, from: 0, to: 1, reason: "Earlier review" };
  expect(
    appendedReasonMatches(
      [old, { ...old, reason: "Earlier review." }],
      [old],
      identity,
      0,
      1,
    ),
  ).toBe(true);
});

it.each(["\u034f", "\ufe0f", "\u3164", "\u115f"])(
  "rejects a default-ignorable-only reason replay: %j",
  (invisible) => {
    const identity = "typeAssertions:packages/example/src/replay.ts";
    const old = { identity, from: 0, to: 1, reason: "Earlier review" };
    expect(
      appendedReasonMatches(
        [old, { ...old, reason: "Earlier" + invisible + " review" }],
        [old],
        identity,
        0,
        1,
      ),
    ).toBe(false);
  },
);
