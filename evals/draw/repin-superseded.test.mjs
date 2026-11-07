import { it, expect } from "vitest";
import {
  prepareRepin,
  reassess,
  instanceInventory,
  reviewInventory,
} from "./repin-core.mjs";
import { draftDecisions } from "./repin-draft.mjs";
import { checkerManifestHash } from "./checker-manifest.mjs";
import { serializeRegistry } from "./marker-authoring.mjs";
import { markerId } from "./locators.mjs";
import { hash, json } from "./support.mjs";
const cid = "superseded-left-to-right",
  view = "view:io/I/O",
  specs = [{ id: cid, flow: "left-to-right" }];
const common = {
  reviewed: true,
  signOff: { kind: "agent", by: "Synthetic protocol fixture, not approval" },
  causeClass: "identity-change",
  note: "Synthetic no-credit succession",
  classification: "drawing",
};
const identity = (name, sheet = view) => ({
  dq: "DQ-05",
  family: "fixture",
  kind: "printed-function-key",
  locator: "device/" + name,
  check: "sheet",
  coarse: false,
  sheet,
  medium: "svg",
});
function fixture({
  provable = false,
  addition = false,
  sharing = false,
  renumber = false,
} = {}) {
  const olds = [identity("old"), ...(sharing ? [identity("old-two")] : [])],
    fresh = identity("new"),
    target = { ...fresh, sheet: addition ? "view:io/Next" : view };
  const mk = (i) => ({
    id: markerId(i),
    dq: i.dq,
    family: i.family,
    kind: i.kind,
    locator: i.locator,
    check: i.check,
    coarse: false,
    scopes: [{ cases: [cid], sheets: [i.sheet], media: ["svg"] }],
    bands: {},
    count: [1, 1],
  });
  const registry = {
      format: "thermite-draw-expectations/2.0",
      markers: [...olds, ...(addition ? [fresh] : [])].map(mk),
    },
    registrySha256 = hash(serializeRegistry(registry));
  const finding = (i) => ({
    kind: i.kind,
    text: renumber
      ? i.locator.includes("old")
        ? "SHEET 10 / 20"
        : "SHEET 11 / 21"
      : "K1",
    sourceLocator: renumber
      ? "class/sheet-number/text"
      : provable
        ? "device/K1/text"
        : i.locator,
    identities: [i],
  });
  function report(items) {
    const rows = Array.from({ length: 24 }, (_, n) => ({
      id: `sup/DQ-${n + 1}`,
      case: cid,
      dq: `DQ-${String(n + 1).padStart(2, "0")}`,
      check: "sheet",
      sheet: 1,
      viewScope: view,
      medium: "svg",
      status: "pass",
      evidence: { findings: [] },
    }));
    items.forEach((i, n) =>
      rows.push({
        id: `sup/item-${n}`,
        case: cid,
        dq: i.dq,
        check: "sheet",
        sheet: 1,
        viewScope: i.sheet,
        medium: "svg",
        status: "fail",
        evidence: { findings: [finding(i)] },
      }),
    );
    const checkers = { "expectations.mjs": registrySha256 },
      r = {
        format: "thermite-draw-eval/1.0",
        mode: "strict",
        subset: "full",
        cases: [cid],
        corpusSha256: "seal",
        evalsVersion: "4.2",
        checkers,
        checkerSha256: checkerManifestHash(checkers),
        results: rows,
      };
    const a = reassess(r, registry, specs);
    return {
      ...r,
      results: a.rows,
      summary: a.summary,
      drift: a.drift,
      exitCode: a.exitCode,
    };
  }
  const baseline = report([...olds, ...(addition ? [fresh] : [])]),
    current = report([...(addition ? [fresh] : []), target]),
    baselineSha256 = hash(json(baseline)),
    reportSha256 = hash(json(current)),
    inventory = instanceInventory(current, reportSha256);
  const g = [...inventory.groups.values()].find(
      (g) => g.markerId === markerId(target) && g.scope.sheet === target.sheet,
    ),
    crop = {
      path: "evals/out/draw-samples/sup/target.png",
      sha256: hash("synthetic-crop"),
    };
  const entries = olds.map((i) => ({
    ...common,
    action: "superseded",
    markerId: markerId(i),
    scope: { case: cid, sheet: view, medium: "svg" },
    cause: "The identity is re-keyed; the defect persists",
    successor: olds.length,
  }));
  entries.push({
    ...common,
    action: addition ? "scope-added" : "new-defect",
    to: { markerId: g.markerId, scope: g.scope },
    instances: g.tokens,
    ...(addition ? {} : { crop }),
  });
  const file = {
    format: "thermite-draw-decisions/1.0",
    pr: "#fixture",
    summarySha256: reportSha256,
    registrySha256,
    checkerSha256: current.checkerSha256,
    corpusSha256: "seal",
    evalsVersion: "4.2",
    baselineSha256,
    entries,
    ...(addition && provable
      ? {
          sheetRenames: [
            { case: cid, medium: "svg", from: view, to: target.sheet },
          ],
        }
      : {}),
  };
  return {
    registry,
    registrySha256,
    report: current,
    reportSha256,
    checkerSha256: current.checkerSha256,
    specs,
    decisions: [file],
    baselines: new Map([[baselineSha256, baseline]]),
    cropHashes: new Map([[crop.path, crop.sha256]]),
  };
}
it.each([false, true])(
  "accepts unprovable succession with addition=%s, without fix/removal credit",
  (addition) => {
    const c = fixture({ addition }),
      r = prepareRepin(c);
    expect(r.expected.exitCode).toBe(0);
    expect(r.expected.outcomes).toMatchObject({
      superseded: 1,
      fixes: 0,
      removals: 0,
      moves: 0,
    });
    expect(
      r.receipts.find((r) => r.action === "superseded").toolProved.successor,
    ).toMatchObject({
      entryIndex: 1,
      action: addition ? "scope-added" : "new-defect",
    });
    expect(
      r.receipts.find((r) => r.action === "superseded"),
    ).not.toHaveProperty("measuredScope");
  },
);
it.each([false, true])(
  "refuses a provable move with addition=%s",
  (addition) => {
    expect(() => prepareRepin(fixture({ provable: true, addition }))).toThrow(
      /Superseded could be a move/,
    );
  },
);
it.each([undefined, -1, "1", 999, 0])(
  "refuses missing/invalid/wrong-action successor %s",
  (successor) => {
    const c = fixture();
    c.decisions[0].entries[0].successor = successor;
    expect(() => prepareRepin(c)).toThrow(/Successor|successor/);
  },
);
it("cannot refer to a successor in another decisions file", () => {
  const c = fixture(),
    file = c.decisions[0],
    target = file.entries.pop();
  c.decisions.push({ ...file, entries: [target] });
  expect(() => prepareRepin(c)).toThrow(
    /does not exist in this decisions file/,
  );
});
it.each([undefined, "", "  ", 4])(
  "requires a non-empty succession cause %s",
  (cause) => {
    const c = fixture();
    c.decisions[0].entries[0].cause = cause;
    expect(() => prepareRepin(c)).toThrow(/non-empty cause/);
  },
);
it.each(["fixed", " fixed ", "FIXED"])(
  "refuses a superseded entry claiming %s",
  (cause) => {
    const c = fixture();
    c.decisions[0].entries[0].cause = cause;
    expect(() => prepareRepin(c)).toThrow(/cannot also claim fixed/);
  },
);
it.each(["reviewed", "signOff", "note", "causeClass"])(
  "retains the usual review gate: %s",
  (field) => {
    const c = fixture();
    delete c.decisions[0].entries[0][field];
    expect(() => prepareRepin(c)).toThrow(/Unreviewed|signOff|rationale/);
  },
);
it.each([[], ["first"], ["first", " "]].map((reasons) => ({ reasons })))(
  "refuses shared successor without reasons on every source $reasons",
  ({ reasons }) => {
    const c = fixture({ sharing: true });
    reasons.forEach((reason, n) => {
      c.decisions[0].entries[n].sharedSuccessorReason = reason;
    });
    expect(() => prepareRepin(c)).toThrow(
      /sharing a successor needs sharedSuccessorReason/,
    );
  },
);
it("allows an explicit reviewed many-to-one identity merge without credit", () => {
  const c = fixture({ sharing: true });
  c.decisions[0].entries.slice(0, 2).forEach((e) => {
    e.sharedSuccessorReason =
      "Both old identities consolidate into the same surviving defect";
  });
  const r = prepareRepin(c);
  expect(r.expected.outcomes).toMatchObject({
    superseded: 2,
    fixes: 0,
    newDefects: 1,
  });
  expect(
    r.receipts
      .filter((r) => r.action === "superseded")
      .every((r) => r.reviewerJudged.sharedSuccessorReason),
  ).toBe(true);
});
it("refuses an unused sharing declaration", () => {
  const c = fixture();
  c.decisions[0].entries[0].sharedSuccessorReason = "No other source";
  expect(() => prepareRepin(c)).toThrow(/Unused sharedSuccessorReason/);
});
it.each([[], ["unknown"]].map((instances) => ({ instances })))(
  "refuses missing/unknown observed successor instances $instances",
  ({ instances }) => {
    const c = fixture();
    c.decisions[0].entries[1].instances = instances;
    expect(() => prepareRepin(c)).toThrow(
      instances.length
        ? /Unknown superseded successor instance/
        : /observed instances/,
    );
  },
);
it("requires the hash-bound baseline even for a whole superseded scope", () => {
  const c = fixture();
  delete c.decisions[0].baselineSha256;
  expect(() => prepareRepin(c)).toThrow(/hash-bound baseline/);
});
it("refuses an unknown source instance", () => {
  const c = fixture();
  c.decisions[0].entries[0].instances = ["unknown"];
  expect(() => prepareRepin(c)).toThrow(/Unknown superseded source instance/);
});
it("drafts superseded only when explicitly chosen, leaving review and cause empty", () => {
  const c = fixture(),
    inventory = reviewInventory(c),
    draft = draftDecisions(inventory, { pr: "#fixture" });
  expect(draft.entries.some((e) => e.action === "superseded")).toBe(false);
  const entryIndex = draft.entries.findIndex((e) => e.action === "retire"),
    successor = draft.entries.findIndex((e) => e.action === "new-defect");
  const chosen = draftDecisions(inventory, {
    pr: "#fixture",
    superseded: [{ entryIndex, successor }],
  });
  expect(chosen.entries[entryIndex]).toMatchObject({
    action: "superseded",
    successor,
    reviewed: false,
    cause: "",
    causeClass: "",
    note: "",
    signOff: { kind: "", by: "" },
  });
  expect(() =>
    draftDecisions(inventory, {
      pr: "#fixture",
      superseded: [{ entryIndex: successor, successor }],
    }),
  ).toThrow(/needs a retirement/);
});

it("handles renumbered class-only sheet labels as superseded, not repaired", () => {
  const c = fixture({ renumber: true });
  expect(prepareRepin(c).expected.outcomes).toMatchObject({
    superseded: 1,
    fixes: 0,
    removals: 0,
  });
});
it("notMove cannot waive a provable superseded move", () => {
  const c = fixture({ provable: true });
  c.decisions[0].notMove = [
    {
      from: "stand-in",
      to: "stand-in",
      reason: "reviewed exception",
      crops: [],
    },
  ];
  expect(() => prepareRepin(c)).toThrow(/Superseded could be a move/);
});
it("names the successor-action refusal before processing an invalid target action", () => {
  const c = fixture();
  c.decisions[0].entries[1].action = "retire";
  expect(() => prepareRepin(c)).toThrow(
    /successor must be new-defect or scope-added/,
  );
});
