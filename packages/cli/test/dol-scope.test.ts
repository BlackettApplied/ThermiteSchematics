// Executes the bounded-selection and projection paragraphs and DOL example.
// Scans four public documents for explicit complete-rung/terminal-coil overclaims.
// Self-tests pass mutated prose and observations to the same guards in memory.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";
import type { ElectricalIr } from "@thermite/compiler";
import {
  prepareSchematicDrawing,
  renderSchematic,
} from "../../render/src/renderer.js";
import { renderSchematicPacket } from "../../render/src/sheets.js";
import type { RenderSummary } from "../../render/src/types.js";
import { normalizeSchematicView } from "../../render/src/view-spec.js";
import { selectSemanticSubgraph } from "../../render/src/selection.js";
import { createSelectionContext } from "../../render/src/selection/context.js";
import { projectedCoilTerminalOwner } from "../../render/src/selection/conservation.js";
import { projectDeviceTypeSymbolMappings } from "../../render/src/symbols/mappings.js";
import { dolFixture } from "../../render/test/dol-control-junctions-fixture.js";
import {
  cards,
  control,
  flows,
  p6Fixture,
  required,
} from "../../render/test/off-view-fixtures.js";
import { flatten, sentencesOf } from "./project-guide/guide-model.js";

const bounded = [
  "Rooted actuation views retain equal-shortest paths to the chosen boundary; longer parallel branches can remain outside the view.",
  "Success does not promise complete rungs.",
  "At each drawn terminal with authored conductors outside the selected view, a nearby light, unfilled card reads **Off-view at D.T** and lists each conductor identity and opposite endpoint, for example `W5 → H1.X1`.",
  "The arrow identifies the authored opposite endpoint; it makes no current-direction, logic, potential or function claim.",
  "A card has no conductor stub or reference leader.",
  "It does not add the omitted device or function to the drawing.",
];
const projection = [
  "A supported unselected two-terminal coil can contribute an intermediate input-path terminal as context only.",
  "The mark says “coil outside view”; it does not select that coil, its other terminal, return wire or parallel loads.",
  "Return paths, loads, power and trace do not acquire this projection.",
  "See the [bounded DOL example](#bounded-dol-selection).",
];
const paths = [
  "docs/views.md",
  "docs/circuit-views.md",
  "packages/core-library/README.md",
  "packages/render/README.md",
] as const;
type Documents = Record<(typeof paths)[number], string>;

function assertNoForbiddenClaims(documents: Documents) {
  // Positive assertions only: "does not select that coil" remains legal.
  const coilSelection = /\bselects? (?:that|the) coil\b/gi;
  const forbidden = [
    /\brooted (?:actuation )?views? (?:always )?(?:draws?|renders?|shows?|includes?|guarantees?) (?:complete|whole|entire) rungs?\b/gi,
    coilSelection,
    /\bR1\.coil counts as an audited function appearance from its terminal alone\b/gi,
  ];
  for (const [path, markdown] of Object.entries(documents)) {
    const text = flatten(markdown.replace(/[`*_]/g, ""));
    for (const pattern of forbidden)
      for (const match of text.matchAll(pattern)) {
        if (
          pattern === coilSelection &&
          /\b(?:not|never|without)\s+$/i.test(text.slice(0, match.index))
        )
          continue;
        throw Error(`Forbidden DOL claim in ${path}: ${match[0]}`);
      }
  }
}

function identities(ir: ElectricalIr, summary: RenderSummary) {
  return {
    wires: summary.conductiveElementIds
      .map((id) => required(ir.wires.find((w) => w.uid === id.uid)).designation)
      .sort(),
    functions: summary.functionIds
      .map(
        (f) =>
          `${required(ir.devices.find((d) => d.uid === f.deviceUid)).designation}.${f.functionKey}`,
      )
      .sort(),
    terminals: summary.terminalIds.map(
      (t) =>
        `${required(ir.devices.find((d) => d.uid === t.deviceUid)).designation}.${t.terminalKey}`,
    ),
  };
}

async function equalBranches(flow: (typeof flows)[number]) {
  const f = await dolFixture("fuse-equal");
  try {
    const r = await renderSchematic(f.ir, control(flow));
    if (!r.ok) throw Error(JSON.stringify(r));
    return identities(f.ir, r.value.summary);
  } finally {
    await f.dispose();
  }
}

function projectionEligibility(ir: ElectricalIr, flow: (typeof flows)[number]) {
  const mappings = projectDeviceTypeSymbolMappings(ir);
  const normalized = normalizeSchematicView(ir, control(flow), { mappings });
  if (!normalized.ok) throw Error(JSON.stringify(normalized));
  const request = { ir, ...normalized.value, mappings };
  const context = createSelectionContext(request);
  const selected = selectSemanticSubgraph(request);
  if (!context.ok || !selected.ok)
    throw Error(JSON.stringify({ context, selected }));
  const owner = required(selected.value.terminalOwners?.[0]);
  const terminalKey = (t: typeof owner.terminal) =>
    JSON.stringify([t.deviceUid, t.terminalKey]);
  const key = terminalKey(owner.terminal);
  const incident = selected.value.paths.filter((p) =>
    p.steps.some(
      (s) => terminalKey(s.from) === key || terminalKey(s.to) === key,
    ),
  );
  const loads = normalizeSchematicView(ir, {
    format: "schematic-view-request/0.2",
    root: { by: "designation", value: "PS1" },
    intent: { kind: "loads" },
    flow,
  });
  if (!loads.ok) throw Error(JSON.stringify(loads));
  const project = (selection: typeof selected.value) =>
    projectedCoilTerminalOwner(context.value, selection, owner.terminal);
  return {
    eligible: project(selected.value),
    incident: incident.map((p) => ({
      lane: p.lane,
      start: terminalKey(p.start.terminal) === key,
      end: terminalKey(p.end.terminal) === key,
    })),
    returnOwner: project({
      ...selected.value,
      paths: selected.value.paths.map((p) => ({ ...p, lane: "return" })),
    }),
    powerOwner: project({
      ...selected.value,
      view: { ...selected.value.view, family: "power" },
    }),
    // Loads and trace share /0.2, refused before the projection inspects intent.
    intentOwner: project({ ...selected.value, view: loads.value.view }),
  };
}

async function observe(flow: (typeof flows)[number]) {
  const p6 = await p6Fixture();
  try {
    const saved = await dolFixture("saved");
    try {
      const request = control(flow);
      const p = await renderSchematic(p6.ir, request);
      const s = await prepareSchematicDrawing(saved.ir, request);
      if (!p.ok || !s.ok) throw Error(JSON.stringify({ p, s }));
      const circuit = JSON.parse(
        await readFile(join(saved.root, "control.circuit.json"), "utf8"),
      );
      const rooted = await renderSchematicPacket(saved.ir, {
        format: "schematic-packet-request/0.1",
        views: [
          request,
          { ...request, root: { by: "designation", value: "R1" } },
        ],
      });
      const explicit = await renderSchematicPacket(saved.ir, {
        format: "schematic-packet-request/0.1",
        views: [{ ...circuit, flow }],
      });
      if (!rooted.ok || !explicit.ok)
        throw Error(JSON.stringify({ rooted, explicit }));
      return {
        p6: {
          ...identities(p6.ir, p.value.summary),
          cards: cards(p.value.svg),
        },
        saved: identities(saved.ir, s.value.summary),
        equal: await equalBranches(flow),
        projection: projectionEligibility(saved.ir, flow),
        contexts: s.value.graph.nodes.filter(
          (n) => n.kind === "symbol" && n.representation === "terminal",
        ),
        rooted: rooted.value,
        explicit: explicit.value,
      };
    } finally {
      await saved.dispose();
    }
  } finally {
    await p6.dispose();
  }
}

type Observed = Awaited<ReturnType<typeof observe>>;
const claims = new Map<string, (o: Observed) => void>([
  [
    "The [synthetic P6 probe](../packages/render/test/off-view-fixtures.ts) puts its seal-in branch on a longer path.",
    ({ p6 }) => {
      expect(p6.wires).toEqual(["W30", "W32", "W33", "W34", "W36", "W41"]);
      expect(p6.functions).not.toContain("R1.contact14");
    },
  ],
  [
    "In both flows, K1 selects only `W30`, `W32`, `W33`, `W34`, `W36` and `W41`; `R1.contact14`, `R1.coil` and `H1.lamp` remain outside the view.",
    ({ p6 }) => {
      expect(p6.wires).toEqual(["W30", "W32", "W33", "W34", "W36", "W41"]);
      expect(p6.functions).toEqual([
        "K1.coil",
        "OL1.aux95",
        "PS1.dc_output",
        "S0.contact11",
        "S1.contact11",
        "S2.contact13",
      ]);
    },
  ],
  [
    "Four off-view cards list six omitted direct connections at drawn terminals.",
    ({ p6 }) => {
      expect(
        p6.cards.sort((a, b) =>
          String(a.terminal).localeCompare(String(b.terminal)),
        ),
      ).toEqual([
        { terminal: "K1.A1", rows: ["W38 → R1.A1", "W39 → H1.X1"] },
        { terminal: "OL1.96", rows: ["W35 → R1.11"] },
        { terminal: "PS1.-", rows: ["W40 → R1.A2", "W42 → H1.X2"] },
        { terminal: "S2.14", rows: ["W37 → R1.14"] },
      ]);
    },
  ],
  [
    "The cards disclose omissions without completing the rung.",
    ({ p6 }) => {
      const disclosed = p6.cards.flatMap((c) =>
        c.rows.map((r) => required(r).split(" → ")[0]),
      );
      expect(disclosed).toHaveLength(6);
      expect(disclosed.every((id) => !p6.wires.includes(id))).toBe(true);
    },
  ],
  [
    "In the [saved DOL fixture](../packages/core-library/test/fixtures/dol-starter/source.json), K1's view shows `R1.A1` as `coil outside view`; `R1.contact14` is selected and `R1.coil` is not.",
    ({ saved, contexts, rooted }) => {
      expect(saved.functions).toContain("R1.contact14");
      expect(saved.functions).not.toContain("R1.coil");
      expect(contexts).toHaveLength(1);
      expect(contexts[0]).toMatchObject({
        designation: "R1",
        functionIds: [],
        ports: [
          expect.objectContaining({
            terminal: expect.objectContaining({ terminalKey: "A1" }),
          }),
          expect.objectContaining({
            terminal: expect.objectContaining({ terminalKey: "A1" }),
          }),
        ],
      });
      expect(
        rooted.sheets.some((s) => s.svg.includes("coil outside view")),
      ).toBe(true);
    },
  ],
  [
    "A terminal-only context has empty function references and gives no audited function appearance.",
    ({ rooted }) => {
      const refs = rooted.sheets
        .flatMap((s) => s.references)
        .filter((r) => r.representation === "terminal");
      expect(refs.length).toBeGreaterThan(0);
      expect(
        refs.every((r) => r.designation === "R1" && r.functions.length === 0),
      ).toBe(true);
      expect(
        required(
          rooted.coverage.functions.find((f) => f.designation === "R1/coil"),
        ).appearances,
      ).toEqual([]);
    },
  ],
  [
    "Use [explicit circuit selections](circuit-views.md#request) and [packet coverage](circuit-views.md#packet-coverage-inventory) to audit a broader inventory; multiple rooted views remain outside the circuit/wiring audit.",
    ({ rooted, explicit }) => {
      expect(rooted.coverage.counts.conductors.represented).toBe(0);
      expect(rooted.coverage.counts.functions.represented).toBe(0);
      expect(rooted.coverage.unauditedSheets).toEqual(
        rooted.sheets.map((s) => s.number),
      );
      expect(explicit.coverage.counts.conductors.represented).toBe(17);
      expect(explicit.coverage.counts.functions.represented).toBe(14);
      expect(
        required(
          explicit.coverage.functions.find((f) => f.designation === "R1/coil"),
        ).appearances.length,
      ).toBeGreaterThan(0);
    },
  ],
]);

function assertParagraph(name: string, markdown: string, expected: string[]) {
  const paragraph = markdown
    .split(/\n\s*\n/)
    .find((block) => flatten(block).startsWith(expected[0]));
  if (
    !paragraph ||
    JSON.stringify(sentencesOf(paragraph)) !== JSON.stringify(expected)
  )
    throw Error(`Unverified DOL ${name} paragraph`);
}

function assertBounded(markdown: string, observed: Observed) {
  assertParagraph("bounded-selection", markdown, bounded);
  // The equal fixture has two two-wire/contact input arms; both must survive.
  expect(observed.equal.wires).toEqual(["W1", "W2", "W3", "W4", "W5"]);
  expect(observed.equal.functions).toEqual([
    "F1.pole1",
    "K1.coil",
    "PS1.dc_output",
    "S1.contact11",
  ]);
  // In P6 the longer holding arm is omitted and disclosed, rather than selected.
  expect(observed.p6.functions).not.toContain("R1.contact14");
  expect(observed.p6.cards.some((c) => c.rows.includes("W37 → R1.14"))).toBe(
    true,
  );
}

function assertProjection(markdown: string, observed: Observed) {
  assertParagraph("projection", markdown, projection);
  expect(observed.projection.eligible).toMatchObject({
    terminal: { terminalKey: "A1" },
    ownerFunctionIds: [expect.objectContaining({ functionKey: "coil" })],
  });
  expect(observed.projection.incident.length).toBeGreaterThan(0);
  expect(
    observed.projection.incident.every(
      (p) => p.lane === "input" && !p.start && !p.end,
    ),
  ).toBe(true);
  expect(observed.saved.functions).not.toContain("R1.coil");
  expect(observed.saved.functions).not.toContain("H1.lamp");
  expect(observed.saved.terminals).not.toContain("R1.A2");
  expect(observed.saved.wires).not.toContain("W40");
  expect(observed.projection.returnOwner).toBeUndefined();
  expect(observed.projection.powerOwner).toBeUndefined();
  expect(observed.projection.intentOwner).toBeUndefined();
}

function assertScope(documents: Documents, observed: Observed) {
  assertNoForbiddenClaims(documents);
  const markdown = documents["docs/views.md"];
  assertBounded(markdown, observed);
  assertProjection(markdown, observed);
  const section = markdown
    .split("### Bounded DOL selection\n")[1]
    ?.split(/^#{1,3} /m)[0];
  if (!section) throw Error("Missing DOL scope section");
  const sentences = sentencesOf(section);
  const missing = [...claims.keys()].filter(
    (claim) => !sentences.includes(claim),
  );
  const unverified = sentences.filter((claim) => !claims.has(claim));
  if (missing.length || unverified.length)
    throw Error(
      `Unverified DOL scope: ${JSON.stringify({ missing, unverified })}`,
    );
  expect(sentences).toEqual([...claims.keys()]);
  for (const check of claims.values()) check(observed);
}

let documents: Documents;
const observations = new Map<(typeof flows)[number], Observed>();
beforeAll(async () => {
  documents = Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [
        path,
        await readFile(new URL(`../../../${path}`, import.meta.url), "utf8"),
      ]),
    ),
  ) as Documents;
  for (const flow of flows) observations.set(flow, await observe(flow));
});

it.each(flows)(
  "executes the bounded-selection, projection and DOL prose against %s output",
  (flow) => assertScope(documents, required(observations.get(flow))),
);

it.each(flows)(
  "rejects the original rung/terminal documentation mutants in %s",
  (flow) => {
    const markdown = documents["docs/views.md"];
    const observed = required(observations.get(flow));
    assertScope(documents, observed);
    const mutants = [
      markdown.replace(
        /Success does not promise complete\s+rungs\./,
        "Rooted views draw complete rungs.",
      ),
      markdown.replace(
        "### Bounded DOL selection\n",
        "### Bounded DOL selection\n\nRooted views draw complete rungs.\n",
      ),
      markdown.replace(
        /A terminal-only context has empty function references and gives no\s+audited function appearance\./,
        "R1.coil counts as an audited function appearance from its terminal alone.",
      ),
    ];
    for (const mutant of mutants) {
      expect(mutant).not.toBe(markdown);
      expect(() =>
        assertScope({ ...documents, "docs/views.md": mutant }, observed),
      ).toThrow(/(?:Forbidden|Unverified) DOL/);
    }
  },
);

const overclaims = [
  { kind: "complete-rung", text: "Rooted views draw complete rungs." },
  { kind: "terminal-selects-coil", text: "The terminal selects that coil." },
];
it.each(
  paths.flatMap((path) => overclaims.map((claim) => ({ path, ...claim }))),
)(
  "forbidden-claim scan rejects $kind appended outside the DOL section in $path",
  ({ path, text }) => {
    assertNoForbiddenClaims(documents);
    const mutant = { ...documents, [path]: `${documents[path]}\n${text}\n` };
    expect(() => assertNoForbiddenClaims(mutant)).toThrow(
      `Forbidden DOL claim in ${path}`,
    );
  },
);

it.each(flows)(
  "bounded paragraph rejects an all-parallel-paths mutant in %s",
  (flow) => {
    const markdown = documents["docs/views.md"];
    const mutant = markdown.replace(
      /equal-shortest paths/,
      "all parallel paths",
    );
    expect(mutant).not.toBe(markdown);
    expect(() =>
      assertScope(
        { ...documents, "docs/views.md": mutant },
        required(observations.get(flow)),
      ),
    ).toThrow("Unverified DOL bounded-selection paragraph");
  },
);

it.each(flows)(
  "equal-shortest guard rejects a missing equal branch in %s output",
  (flow) => {
    const observed = required(observations.get(flow));
    const mutant = {
      ...observed,
      equal: {
        ...observed.equal,
        wires: observed.equal.wires.filter((w) => w !== "W3" && w !== "W4"),
        functions: observed.equal.functions.filter((f) => f !== "S1.contact11"),
      },
    };
    expect(() => assertScope(documents, mutant)).toThrow();
  },
);

it.each(flows)(
  "projection paragraph rejects expanded path scope in %s",
  (flow) => {
    const markdown = documents["docs/views.md"];
    const mutant = markdown.replace(
      /Return paths, loads,\s+power and trace do not acquire this projection\./,
      "Return paths, loads, power and trace also acquire this projection.",
    );
    expect(mutant).not.toBe(markdown);
    expect(() =>
      assertScope(
        { ...documents, "docs/views.md": mutant },
        required(observations.get(flow)),
      ),
    ).toThrow("Unverified DOL projection paragraph");
  },
);

it.each(flows)(
  "projection guard rejects counting the context coil in %s output",
  (flow) => {
    const observed = required(observations.get(flow));
    const mutant = {
      ...observed,
      saved: {
        ...observed.saved,
        functions: [...observed.saved.functions, "R1.coil"],
      },
    };
    expect(() => assertScope(documents, mutant)).toThrow();
  },
);

it("forbidden-claim scan rejects 'selects that coil' in the projection paragraph", () => {
  const markdown = documents["docs/views.md"];
  const mutant = markdown.replace(
    /it does not select\s+that coil/,
    "it selects that coil",
  );
  expect(mutant).not.toBe(markdown);
  expect(() =>
    assertNoForbiddenClaims({ ...documents, "docs/views.md": mutant }),
  ).toThrow("Forbidden DOL claim in docs/views.md");
});
