import { it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  assemble,
  it0,
  A,
  B,
  view,
  view2,
  gone,
  mid,
} from "./repin-fixture.mjs";
import { cliFixture } from "./repin-cli-fixture.mjs";
import { prepareRepin, reviewInventory } from "./repin-core.mjs";
import { draftDecisions } from "./repin-draft.mjs";
const old = it0("old", { src: "device/K1/text" }),
  moved = it0("moved", { src: "device/K1/text" }),
  unrelated = it0("unrelated", { text: "ZZ", src: "device/zz/text" });
const laundering = (extra = {}) =>
  assemble({
    registryItems: [old],
    currentItems: [moved, unrelated],
    entries: ({ add, sup }) => [sup(old, 2), add(moved), add(unrelated)],
    ...extra,
  });
it.each(["same file", "other file", "free cause"])(
  "refuses a move hidden behind an unrelated successor: %s",
  (shape) => {
    const c = laundering();
    if (shape === "other file") {
      const f = c.decisions[0],
        e = f.entries.splice(1, 1)[0];
      f.entries[0].successor = 1;
      c.decisions.push({ ...f, entries: [e] });
    }
    if (shape === "free cause")
      c.decisions[0].entries[0].cause = "not-measured";
    expect(() => prepareRepin(c)).toThrow(/Retirement could be a move/);
  },
);
it("finds a hidden scope-added move", () => {
  const existing = it0("existing", { sheet: view2, src: old.src }),
    target = { ...existing, sheet: view };
  const c = assemble({
    registryItems: [old, existing],
    currentItems: [existing, target, unrelated],
    entries: ({ sup, scopeAdd, add }) => [
      sup(old, 2),
      scopeAdd(target),
      add(unrelated),
    ],
  });
  expect(() => prepareRepin(c)).toThrow(/Retirement could be a move/);
});
it("permits a reviewed notMove only on a non-named candidate", () => {
  const c = laundering(),
    e = c.decisions[0].entries;
  const a = c.before.instances[0],
    b = c.inv.instances.find((i) => i.markerId === e[1].to.markerId);
  const crop = (n) => {
    const p = {
      path: `evals/out/draw-samples/exception-${n}.png`,
      sha256: String(n).repeat(64),
    };
    c.cropHashes.set(p.path, p.sha256);
    return p;
  };
  c.decisions[0].notMove = [
    {
      from: a.token,
      to: b.token,
      reason: "Synthetic independent distinction",
      crops: [crop(1), crop(2)],
    },
  ];
  expect(prepareRepin(c).expected.outcomes).toMatchObject({
    superseded: 1,
    notMove: 1,
    moves: 0,
  });
  e[0].successor = 1;
  expect(() => prepareRepin(c)).toThrow(/Superseded could be a move/);
});
it("refuses an unmeasured superseded source", () => {
  const x = { ...old, sheet: gone };
  const c = assemble({
    registryItems: [x],
    currentItems: [unrelated],
    entries: ({ sup, add }) => [sup(x, 1), add(unrelated)],
  });
  expect(() => prepareRepin(c)).toThrow(/source must be measured/);
});
it.each([
  { case: B },
  { medium: "pdf" },
  { kind: "other-kind" },
  { dq: "DQ-09" },
])("requires case, medium, kind and DQ compatibility %j", (patch) => {
  const t = { ...unrelated, ...patch };
  const c = assemble({
    registryItems: [old],
    currentItems: [t],
    cases: [A, B],
    media: ["svg", "pdf"],
    entries: ({ sup, add }) => [sup(old, 1), add(t)],
  });
  expect(() => prepareRepin(c)).toThrow(/share case, medium, kind and DQ/);
});
function partial(hidden = false) {
  const a = it0("two", { text: "AA", src: "device/a/text" }),
    b = it0("two", { text: "BB", src: "device/b/text" }),
    c = it0("c", { text: "CC" }),
    d = it0("d", {
      text: "DD",
      src: hidden ? "device/a/text" : "device/d/text",
    });
  const x = assemble({
    registryItems: [a, b],
    currentItems: [c, d],
    entries: ({ sup, add }) => [sup(a, 2), sup(a, 3), add(c), add(d)],
  });
  const aa = x.before.instances.find((i) => i.facts.text === "AA"),
    bb = x.before.instances.find((i) => i.facts.text === "BB");
  x.decisions[0].entries[0].instances = [aa.token];
  x.decisions[0].entries[1].instances = [bb.token];
  return x;
}
it("keeps action, successor and actual source count in each partial receipt", () => {
  const r = prepareRepin(partial());
  const rows = r.receipts.filter((e) => e.action === "superseded");
  expect(rows).toHaveLength(2);
  expect(r.expected.outcomes.superseded).toBe(2);
  for (const e of rows) {
    expect(e.instances).toBe(1);
    expect(e.successor).toBeDefined();
    expect(e.toolProved.successor).toMatchObject({
      form: "successor",
      sourceInstances: 1,
    });
  }
});
it("checks each partial source against all booked fresh targets", () => {
  const x = partial(true),
    entries = x.decisions[0].entries;
  entries[1] = { ...entries[1], action: "retire", cause: "fixed" };
  delete entries[1].successor;
  expect(() => prepareRepin(x)).toThrow(/Retirement could be a move/);
});
it("retire cannot carry succession fields", () => {
  const c = assemble({
    registryItems: [old],
    currentItems: [unrelated],
    entries: ({ retire, add }) => [
      { ...retire(old, "fixed"), successor: 1 },
      add(unrelated),
    ],
  });
  expect(() => prepareRepin(c)).toThrow(/Unknown decision field/);
});
it("checks policy-gap classification on a superseded source", () => {
  const a = it0("policy-old", {
      kind: "iso-cap-height-policy",
      dq: "DQ-02",
      check: "iso-cap-height-policy",
    }),
    b = it0("policy-new", { kind: a.kind, dq: a.dq, check: a.check });
  const x = assemble({
    registryItems: [a],
    currentItems: [b],
    entries: ({ sup, add }) => [sup(a, 1), add(b)],
  });
  expect(prepareRepin(x).expected.outcomes.superseded).toBe(1);
  x.decisions[0].entries[0].classification = "drawing";
  expect(() => prepareRepin(x)).toThrow(/classification/);
});
function survivor({ sharing = false, provable = false } = {}) {
  const a = it0("src", { src: "device/a/text" }),
    b = it0("src2", { src: "device/b/text" }),
    s = it0("survives", { src: provable ? a.src : "device/s/text" });
  return assemble({
    registryItems: [a, ...(sharing ? [b] : []), s],
    currentItems: [s],
    entries: ({ sup }) =>
      [a, ...(sharing ? [b] : [])].map((i) => {
        const e = sup(i, 0);
        delete e.successor;
        return {
          ...e,
          survivor: {
            markerId: mid(s),
            scope: { case: A, sheet: view, medium: "svg" },
          },
        };
      }),
  });
}
it("uses an existing observed survivor without repair credit", () => {
  const r = prepareRepin(survivor());
  expect(r.expected.outcomes).toMatchObject({
    superseded: 1,
    supersededSurvivors: 1,
    fixes: 0,
  });
  expect(r.receipts[0].toolProved.successor.form).toBe("survivor");
});
it.each([
  "both",
  "neither",
  "missing marker",
  "missing scope",
  "consumed",
  "provable",
])("refuses invalid survivor form: %s", (mode) => {
  const c = survivor({ provable: mode === "provable" }),
    e = c.decisions[0].entries[0];
  if (mode === "both") e.successor = 0;
  if (mode === "neither") delete e.survivor;
  if (mode === "missing marker") e.survivor.markerId = "missing";
  if (mode === "missing scope") e.survivor.scope.sheet = view2;
  if (mode === "consumed")
    c.decisions[0].entries.push({
      ...e,
      markerId: e.survivor.markerId,
      scope: e.survivor.scope,
    });
  expect(() => prepareRepin(c)).toThrow(
    /exactly one|existing registry|must be observed|cannot be retired|could be a move/,
  );
});
it("checks survivor sharing on every source", () => {
  const c = survivor({ sharing: true });
  expect(() => prepareRepin(c)).toThrow(/sharing/);
  c.decisions[0].entries.forEach(
    (e) => (e.sharedSuccessorReason = "Synthetic reviewed identity merge"),
  );
  expect(prepareRepin(c).expected.outcomes.supersededSurvivors).toBe(2);
});
it.each(["duplicate", "bad successor"])(
  "checks explicit draft choice %s",
  (mode) => {
    const c = assemble({
        registryItems: [old],
        currentItems: [unrelated],
        entries: ({ sup, add }) => [sup(old, 1), add(unrelated)],
      }),
      i = reviewInventory(c),
      d = draftDecisions(i, { pr: "#probe" }),
      entryIndex = d.entries.findIndex((e) => e.action === "retire"),
      successor = d.entries.findIndex((e) => e.action === "new-defect");
    const choices =
      mode === "duplicate"
        ? [
            { entryIndex, successor },
            { entryIndex, successor },
          ]
        : [{ entryIndex, successor: 999 }];
    expect(() =>
      draftDecisions(i, { pr: "#probe", superseded: choices }),
    ).toThrow(/repeated|successor/);
  },
);
it("runs real draft CLI and forwards choices through writeDraft", async () => {
  const c = await cliFixture();
  try {
    const inventory = JSON.parse(
        await readFile(join(c.out, "inventory.json"), "utf8"),
      ),
      d = draftDecisions(inventory, { pr: "#probe" }),
      a = d.entries.findIndex((e) => e.action === "retire"),
      b = d.entries.findIndex((e) => e.action === "new-defect");
    const args = [
      "draft",
      "--inventory",
      join(c.out, "inventory.json"),
      "--pr",
      "#probe",
      "--output",
      join(c.out, "chosen.json"),
      "--superseded",
      `${a}:${b}`,
    ];
    const r = c.run(...args);
    expect(r.status, r.stderr).toBe(0);
    expect(
      JSON.parse(await readFile(join(c.out, "chosen.json"), "utf8")).entries[a]
        .action,
    ).toBe("superseded");
    const bad = c.run(
      ...args.map((x) =>
        x === join(c.out, "chosen.json")
          ? join(c.out, "bad.json")
          : x === `${a}:${b}`
            ? `${a}:${b}:extra`
            : x,
      ),
    );
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("Use --superseded");
    const outside = c.run(
      "--report",
      join(c.out, "report.json"),
      "--inventory",
      join(c.out, "new-inventory.json"),
      "--superseded",
      `${a}:${b}`,
    );
    expect(outside.status).toBe(1);
    expect(outside.stderr).toContain("Draft-only flags");
  } finally {
    await c.cleanup();
  }
});
it("permits an observed existing identity at a new, separately booked scope", () => {
  const source = it0("source"),
    existing = it0("existing"),
    target = { ...existing, sheet: view2 };
  const c = assemble({
    registryItems: [source, existing],
    currentItems: [existing, target],
    entries: ({ sup, scopeAdd }) => {
      const e = sup(source, 1);
      delete e.successor;
      return [
        {
          ...e,
          survivor: {
            markerId: mid(existing),
            scope: { case: A, sheet: view2, medium: "svg" },
          },
        },
        scopeAdd(target),
      ];
    },
  });
  expect(prepareRepin(c).expected.outcomes).toMatchObject({
    supersededSurvivors: 1,
    additions: 1,
  });
});
it("refuses an existing survivor that is absent at the named scope", () => {
  const c = survivor();
  c.decisions[0].entries[0].survivor.scope.sheet = view2;
  expect(() => prepareRepin(c)).toThrow(/Survivor must be observed/);
});
it.each(["reference", "scope"])("rejects extra survivor %s fields", (where) => {
  const c = survivor();
  if (where === "reference")
    c.decisions[0].entries[0].survivor.extra = "unexpected";
  else c.decisions[0].entries[0].survivor.scope.extra = "unexpected";
  expect(() => prepareRepin(c)).toThrow(/Invalid survivor reference/);
});
it("cannot call a newly observed unregistered identity a survivor", () => {
  const c = assemble({
    registryItems: [old],
    currentItems: [unrelated],
    entries: ({ sup, add }) => {
      const e = sup(old, 1);
      delete e.successor;
      return [
        {
          ...e,
          survivor: {
            markerId: mid(unrelated),
            scope: { case: A, sheet: view, medium: "svg" },
          },
        },
        add(unrelated),
      ];
    },
  });
  expect(() => prepareRepin(c)).toThrow(
    /Survivor must be an existing registry marker/,
  );
});
it("sharing compares resolved targets across successor and survivor forms", () => {
  const a = it0("a"),
    b = it0("b"),
    e = it0("existing"),
    elsewhere = { ...e, sheet: view2 };
  const c = assemble({
    registryItems: [a, b, elsewhere],
    currentItems: [elsewhere, e],
    entries: ({ sup, scopeAdd }) => {
      const s = sup(b, 2);
      delete s.successor;
      s.survivor = {
        markerId: mid(e),
        scope: { case: A, sheet: view, medium: "svg" },
      };
      return [sup(a, 2), s, scopeAdd(e)];
    },
  });
  expect(() => prepareRepin(c)).toThrow(/sharing a successor/);
  c.decisions[0].entries[0].sharedSuccessorReason =
    "Two sources consolidate here";
  expect(() => prepareRepin(c)).toThrow(/sharing a successor/);
  c.decisions[0].entries[1].sharedSuccessorReason =
    "Same reviewed consolidation";
  expect(prepareRepin(c).expected.outcomes).toMatchObject({
    superseded: 2,
    supersededSurvivors: 1,
  });
});
it("a rename onto an unpinned observed scope cannot also be a survivor", () => {
  const a = it0("a"),
    b = it0("b"),
    e = it0("e"),
    elsewhere = { ...e, sheet: view2 };
  const c = assemble({
    registryItems: [a, b, elsewhere],
    currentItems: [elsewhere, e],
    entries: ({ sup, scopeAdd, retire }) => {
      const s = sup(a, 1);
      delete s.successor;
      s.survivor = {
        markerId: mid(e),
        scope: { case: A, sheet: view, medium: "svg" },
      };
      const r = retire(b, "removed"),
        n = scopeAdd(e);
      return [
        s,
        {
          ...r,
          action: "rename",
          from: { markerId: r.markerId, scope: r.scope },
          to: n.to,
          pairs: [],
        },
      ];
    },
  });
  expect(() => prepareRepin(c)).toThrow(/Survivor cannot be retired, moved/);
});
it("drafts survivor choices through the real CLI without re-sorting entries", async () => {
  const c = await cliFixture({ survivor: true });
  try {
    const inv = JSON.parse(
        await readFile(join(c.out, "inventory.json"), "utf8"),
      ),
      d = draftDecisions(inv, { pr: "#probe" }),
      entryIndex = d.entries.findIndex((e) => e.action === "retire"),
      token = inv.current[0].token;
    const args = [
      "draft",
      "--inventory",
      join(c.out, "inventory.json"),
      "--pr",
      "#probe",
      "--output",
      join(c.out, "survivor.json"),
      "--survivor",
      `${entryIndex}:${token}`,
    ];
    const run = c.run(...args);
    expect(run.status, run.stderr).toBe(0);
    const selected = JSON.parse(
      await readFile(join(c.out, "survivor.json"), "utf8"),
    );
    expect(selected.entries[entryIndex]).toMatchObject({
      action: "superseded",
      reviewed: false,
      cause: "",
      survivor: {
        markerId: inv.current[0].markerId,
        scope: inv.current[0].scope,
      },
    });
    expect(selected.entries[entryIndex].successor).toBeUndefined();
    const invalid = c.run(
      ...args.map((x) =>
        x === join(c.out, "survivor.json")
          ? join(c.out, "invalid-survivor.json")
          : x === `${entryIndex}:${token}`
            ? `${entryIndex}:${token}:extra`
            : x,
      ),
    );
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("Use --survivor");
    const outside = c.run(
      "--report",
      join(c.out, "report.json"),
      "--inventory",
      join(c.out, "new.json"),
      "--survivor",
      `${entryIndex}:${token}`,
    );
    expect(outside.status).toBe(1);
    expect(outside.stderr).toContain("Draft-only flags");
    const options = { pr: "#probe", survivors: [{ entryIndex, token }] };
    expect(() =>
      draftDecisions(inv, {
        ...options,
        survivors: [...options.survivors, ...options.survivors],
      }),
    ).toThrow(/repeated/);
    expect(() =>
      draftDecisions(inv, {
        ...options,
        survivors: [{ entryIndex, token: "unknown" }],
      }),
    ).toThrow(/observed existing/);
    expect(() =>
      draftDecisions(inv, {
        ...options,
        survivors: [{ entryIndex: 999, token }],
      }),
    ).toThrow(/retirement/);
  } finally {
    await c.cleanup();
  }
});
it("a new identity cannot be selected by --survivor", () => {
  const c = assemble({
      registryItems: [old],
      currentItems: [unrelated],
      entries: ({ retire, add }) => [retire(old, "fixed"), add(unrelated)],
    }),
    inv = reviewInventory(c),
    d = draftDecisions(inv, { pr: "#probe" });
  expect(() =>
    draftDecisions(inv, {
      pr: "#probe",
      survivors: [
        {
          entryIndex: d.entries.findIndex((e) => e.action === "retire"),
          token: inv.current[0].token,
        },
      ],
    }),
  ).toThrow(/observed existing/);
});
