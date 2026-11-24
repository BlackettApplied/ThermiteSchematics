import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compileProject, lockProject } from "@thermite/compiler";
import { expect, it } from "vitest";
import { renderSchematicPacket } from "../src/index.js";
import { normalizePaperPage } from "../src/packet/page.js";
import { rootedDiagnosticError } from "../src/packet/rooted-constraint.js";
import {
  nativeWinner,
  rootedWinner,
  searchRootedCandidates,
} from "../src/packet/rooted-search.js";
import { wrappableVerticalSourceNetLabelIds } from "../src/packet/rooted-source-labels.js";
import { splitTwoLineNetLabel } from "../src/presentation/net-label-wrap.js";
import { parseSvg } from "./off-view-fixtures.js";

function replaceStringValues(
  value: unknown,
  target: string,
  replacement: string,
): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (value[i] === target) value[i] = replacement;
      else replaceStringValues(value[i], target, replacement);
    }
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    if (entry === target) {
      Reflect.set(value, key, replacement);
    } else {
      replaceStringValues(entry, target, replacement);
    }
  }
}

function compactPumpChain(objects: unknown[]): unknown[] {
  const kept = objects.filter((obj) => {
    if (typeof obj !== "object" || obj === null || !("kind" in obj))
      return true;
    if (
      obj.kind === "device" &&
      "designation" in obj &&
      (obj.designation === "K1" || obj.designation === "OL1")
    )
      return false;
    if (
      obj.kind === "wire" &&
      "endpoints" in obj &&
      Array.isArray(obj.endpoints)
    )
      return !obj.endpoints.some(
        (ep: unknown) =>
          typeof ep === "object" &&
          ep !== null &&
          "device" in ep &&
          (ep.device === "K1" || ep.device === "OL1"),
      );
    return true;
  });
  for (const [q, m, id] of [
    ["2/T1", "U", "102"],
    ["4/T2", "V", "106"],
    ["6/T3", "W", "110"],
  ] as const) {
    kept.push({
      uid: `00000000-0000-4000-8000-000000000${id}`,
      kind: "wire",
      designation: `W${id}`,
      endpoints: [
        { device: "Q1", terminal: q },
        { device: "M1", terminal: m },
      ],
      properties: { label: id },
    });
  }
  return kept;
}

async function pumpVariantObjects(
  phaseNames: readonly [string, string, string],
  renameLocation?: readonly [string, string],
  compactChain = false,
): Promise<Record<string, unknown>> {
  const raw: unknown = JSON.parse(
    await readFile(
      resolve(import.meta.dirname, "fixtures/agent-refusals/pump.json"),
      "utf8",
    ),
  );
  assert.ok(
    typeof raw === "object" &&
      raw !== null &&
      "objects" in raw &&
      Array.isArray(raw.objects),
  );
  if (renameLocation !== undefined) {
    replaceStringValues(raw, renameLocation[0], renameLocation[1]);
  }
  const byTerm = new Map([
    ["L1", phaseNames[0]],
    ["L2", phaseNames[1]],
    ["L3", phaseNames[2]],
  ]);
  for (const obj of raw.objects) {
    if (
      typeof obj !== "object" ||
      obj === null ||
      !("kind" in obj) ||
      obj.kind !== "potential" ||
      !("at" in obj) ||
      typeof obj.at !== "object" ||
      obj.at === null ||
      !("device" in obj.at) ||
      obj.at.device !== "SUP1" ||
      !("terminal" in obj.at) ||
      typeof obj.at.terminal !== "string"
    ) {
      continue;
    }
    const next = byTerm.get(obj.at.terminal);
    if (next !== undefined && "name" in obj) obj.name = next;
  }
  return {
    objects: compactChain ? compactPumpChain(raw.objects) : raw.objects,
  };
}

async function compilePumpVariant(
  tag: string,
  phaseNames: readonly [string, string, string],
  options: {
    readonly projectName?: string;
    readonly renameLocation?: readonly [string, string];
    readonly compactChain?: boolean;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), `thermite-ttblong-${tag}-`));
  await writeFile(
    join(root, "system.json"),
    JSON.stringify({
      format: "electrical-system/0.1",
      project: { name: options.projectName ?? `Synthetic ${tag}` },
      sources: ["source.json"],
      libraries: [{ name: "core", version: "0.2.0" }],
    }),
  );
  await writeFile(
    join(root, "source.json"),
    JSON.stringify(
      await pumpVariantObjects(
        phaseNames,
        options.renameLocation,
        options.compactChain,
      ),
    ),
  );
  const locked = await lockProject(root);
  assert.ok(locked.ok, JSON.stringify(locked));
  const compiled = await compileProject(root);
  assert.ok(compiled.ok, JSON.stringify(compiled));
  return {
    ir: compiled.ir,
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}

function phaseTriple(sample: string): readonly [string, string, string] {
  return [
    sample,
    sample.replace(/L1$/u, "L2"),
    sample.replace(/L1$/u, "L3"),
  ] as const;
}

function netLabelGroups(svg: string) {
  const doc = parseSvg(svg);
  const byClip = new Map<
    string,
    { lines: string[]; fontSizes: number[]; ys: number[] }
  >();
  for (const el of doc.querySelectorAll("text.label-net")) {
    const text = el.textContent ?? "";
    if (!text) continue;
    const clip = el.getAttribute("clip-path") ?? "";
    const entry = byClip.get(clip) ?? { lines: [], fontSizes: [], ys: [] };
    entry.lines.push(text);
    entry.fontSizes.push(Number(el.getAttribute("font-size")));
    entry.ys.push(Number(el.getAttribute("y")));
    byClip.set(clip, entry);
  }
  return [...byClip.values()];
}

it("splits potential names only at existing separators closest to the middle (#576)", () => {
  expect(
    splitTwoLineNetLabel(
      "MCC1-MAIN-MOTOR-POWER-480VAC-BUS-FEEDER-PANEL-MOD-01-L1",
    ),
  ).toEqual(["MCC1-MAIN-MOTOR-POWER-480VAC-", "BUS-FEEDER-PANEL-MOD-01-L1"]);
  expect(splitTwoLineNetLabel("MAIN_BUS_480VAC_FEEDER_L1")).toEqual([
    "MAIN_BUS_",
    "480VAC_FEEDER_L1",
  ]);
  expect(splitTwoLineNetLabel("PANEL.A.480VAC.BUS.L1")).toEqual([
    "PANEL.A.",
    "480VAC.BUS.L1",
  ]);
  expect(splitTwoLineNetLabel("MAIN/FEEDER/480V/L1")).toEqual([
    "MAIN/FEEDER/",
    "480V/L1",
  ]);
  expect(splitTwoLineNetLabel("MAIN PANEL 480VAC BUS L1")).toEqual([
    "MAIN PANEL ",
    "480VAC BUS L1",
  ]);
  expect(
    splitTwoLineNetLabel(
      "MAINPOWERPANEL480VACBUSFEEDERSECTIONAMAINFEEDERBRANCHL1",
    ),
  ).toBeUndefined();
  expect(splitTwoLineNetLabel(`${"W".repeat(36)}-L1`, ["L1"])).toBeUndefined();
  expect(splitTwoLineNetLabel(`${"W".repeat(35)}L1-X`)).toBeUndefined();
  expect(splitTwoLineNetLabel("-WWWW")).toBeUndefined();
  expect(splitTwoLineNetLabel("LONG-FEEDER-LINE1", ["line1"])).toEqual([
    "LONG-",
    "FEEDER-LINE1",
  ]);
  expect(
    splitTwoLineNetLabel(`${"W".repeat(20)}-LINE1`, ["LINE1"]),
  ).toBeUndefined();
  const consec = `${"A".repeat(27)}-${"B".repeat(2)}   ${"C".repeat(28)}`;
  expect(splitTwoLineNetLabel(consec)).toEqual([
    `${"A".repeat(27)}-${"B".repeat(2)}   `,
    "C".repeat(28),
  ]);
});

it.each([
  ["length-55", "MCC1-MAIN-MOTOR-POWER-480VAC-BUS-FEEDER-PANEL-MOD-01-L1"],
  ["length-60", "MCC1-MAIN-MOTOR-POWER-480VAC-BUS-FEEDER-PANEL-MOD-ALPHA-1-L1"],
] as const)(
  "issues TTB Tabloid landscape power packet with verbatim two-line source net labels for %s (#576)",
  async (tag, sample) => {
    const names = phaseTriple(sample);
    const fixture = await compilePumpVariant(tag, names, {
      compactChain: true,
    });
    try {
      const packet = await renderSchematicPacket(fixture.ir, {
        format: "schematic-packet-request/0.1",
        page: { size: "tabloid", orientation: "landscape" },
        views: [
          {
            format: "schematic-view-request/0.1",
            root: { by: "designation", value: "M1" },
            family: "power",
            flow: "top-to-bottom",
          },
        ],
      });
      assert.ok(packet.ok, JSON.stringify(packet));
      const groups = packet.value.sheets.flatMap((s) => netLabelGroups(s.svg));
      const reconstructed = [
        ...new Set(
          groups.map((g) => g.lines.join("")).filter((t) => names.includes(t)),
        ),
      ].sort();
      expect(reconstructed).toEqual([...names].sort());
      for (const group of groups.filter((g) =>
        names.includes(g.lines.join("")),
      )) {
        expect(group.lines).toHaveLength(2);
        expect(group.fontSizes).toEqual([10, 10]);
        expect(group.ys[1]! - group.ys[0]!).toBeGreaterThanOrEqual(12);
      }
    } finally {
      await fixture.dispose();
    }
  },
);

it("keeps single-line source net labels for short phases alongside wrapped long phases (#576)", async () => {
  const names = [
    "MCC1-MAIN-MOTOR-POWER-480VAC-BUS-FEEDER-PANEL-MOD-ALPHA-1-L1",
    "MCC1-MAIN-MOTOR-POWER-480VAC-BUS-FEEDER-PANEL-MOD-ALPHA-1-L2",
    "480VAC-L3",
  ] as const;
  const fixture = await compilePumpVariant("mixed", names, {
    compactChain: true,
  });
  try {
    const packet = await renderSchematicPacket(fixture.ir, {
      format: "schematic-packet-request/0.1",
      page: { size: "tabloid", orientation: "landscape" },
      views: [
        {
          format: "schematic-view-request/0.1",
          root: { by: "designation", value: "M1" },
          family: "power",
          flow: "top-to-bottom",
        },
      ],
    });
    assert.ok(packet.ok, JSON.stringify(packet));
    const groups = packet.value.sheets.flatMap((s) => netLabelGroups(s.svg));
    const byText = new Map(groups.map((g) => [g.lines.join(""), g]));
    expect(byText.get(names[0])?.lines).toHaveLength(2);
    expect(byText.get(names[1])?.lines).toHaveLength(2);
    expect(byText.get(names[2])?.lines).toEqual(["480VAC-L3"]);
  } finally {
    await fixture.dispose();
  }
});

it("refuses with actionable R006 naming potential and widths when no separator exists (#576)", async () => {
  const sample = "MAINPOWERPANEL480VACBUSFEEDERSECTIONAMAINFEEDERBRANCHL1";
  const names = phaseTriple(sample);
  const fixture = await compilePumpVariant("nosep", names);
  try {
    const packet = await renderSchematicPacket(fixture.ir, {
      format: "schematic-packet-request/0.1",
      page: { size: "tabloid", orientation: "landscape" },
      views: [
        {
          format: "schematic-view-request/0.1",
          root: { by: "designation", value: "M1" },
          family: "power",
          flow: "top-to-bottom",
        },
      ],
    });
    expect(packet.ok).toBe(false);
    if (packet.ok) return;
    expect(packet.error.code).toBe("R006");
    expect(packet.error.message).toContain(sample);
    expect(packet.error.message).toMatch(
      /protected width [0-9.]+ mm exceeds 375\.80 mm/u,
    );
    expect(packet.error.message).toMatch(/shorter potential name/iu);
    expect(packet.error.message).toMatch(/larger sheet/iu);
  } finally {
    await fixture.dispose();
  }
});

it("refuses with actionable R006 when even the two-line form still exceeds the field (#576)", async () => {
  const sample = "MCC1-MAIN-MOTOR-POWER-480VAC-BUS-FEEDER-PANEL-MOD-01-L1";
  const names = phaseTriple(sample);
  const fixture = await compilePumpVariant("two-line-too-wide", names);
  try {
    const packet = await renderSchematicPacket(fixture.ir, {
      format: "schematic-packet-request/0.1",
      page: { size: "letter", orientation: "portrait" },
      views: [
        {
          format: "schematic-view-request/0.1",
          root: { by: "designation", value: "M1" },
          family: "power",
          flow: "top-to-bottom",
        },
      ],
    });
    expect(packet.ok).toBe(false);
    if (packet.ok) return;
    expect(packet.error.code).toBe("R006");
    expect(packet.error.message).toContain(sample);
    expect(packet.error.message).toMatch(
      /protected width [0-9.]+ mm exceeds 159\.90 mm/u,
    );
    expect(packet.error.message).toMatch(/shorter potential name/iu);
    expect(packet.error.message).toMatch(/larger sheet/iu);
  } finally {
    await fixture.dispose();
  }
});

it("breaks space-separated 60-character TTB source net labels verbatim onto two lines (#576)", async () => {
  const sample = "MCC1 MAIN MOTOR POWER 480VAC BUS FEEDER PANEL MOD ALPHA 1 L1";
  const names = phaseTriple(sample);
  const fixture = await compilePumpVariant("space-60", names, {
    compactChain: true,
  });
  try {
    const packet = await renderSchematicPacket(fixture.ir, {
      format: "schematic-packet-request/0.1",
      page: { size: "tabloid", orientation: "landscape" },
      views: [
        {
          format: "schematic-view-request/0.1",
          root: { by: "designation", value: "M1" },
          family: "power",
          flow: "top-to-bottom",
        },
      ],
    });
    assert.ok(packet.ok, JSON.stringify(packet));
    const groups = packet.value.sheets.flatMap((s) => netLabelGroups(s.svg));
    const reconstructed = [
      ...new Set(
        groups.map((g) => g.lines.join("")).filter((t) => names.includes(t)),
      ),
    ].sort();
    expect(reconstructed).toEqual([...names].sort());
    for (const group of groups.filter((g) =>
      names.includes(g.lines.join("")),
    )) {
      expect(group.lines).toHaveLength(2);
      expect(group.lines[0]!.endsWith(" ")).toBe(true);
      expect(group.fontSizes).toEqual([10, 10]);
    }
  } finally {
    await fixture.dispose();
  }
});

it("keeps LTR long names and <=24-char fitting TTB names single-line with exact base bytes (#576)", async () => {
  const longNames = phaseTriple(
    "MCC1-MAIN-MOTOR-POWER-480VAC-BUS-FEEDER-PANEL-MOD-ALPHA-1-L1",
  );
  const shortNames = phaseTriple("MAIN-PANEL-480VAC-BUS-L1");
  const longFixture = await compilePumpVariant("ltr-60", longNames, {
    projectName: "Synthetic #576",
  });
  const shortFixture = await compilePumpVariant("ttb-24", shortNames, {
    projectName: "Synthetic #576",
  });
  const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
  try {
    const ltr = await renderSchematicPacket(longFixture.ir, {
      format: "schematic-packet-request/0.1",
      page: { size: "tabloid", orientation: "landscape" },
      views: [
        {
          format: "schematic-view-request/0.1",
          root: { by: "designation", value: "M1" },
          family: "power",
          flow: "left-to-right",
        },
      ],
    });
    assert.ok(ltr.ok, JSON.stringify(ltr));
    const ltrMatches = ltr.value.sheets
      .flatMap((s) => netLabelGroups(s.svg))
      .filter((g) => longNames.includes(g.lines.join("")));
    expect(
      [...new Set(ltrMatches.map((g) => g.lines.join("")))].sort(),
    ).toEqual([...longNames].sort());
    for (const group of ltrMatches) expect(group.lines).toHaveLength(1);
    expect(ltr.value.sheets.map((s) => sha256(s.svg))).toEqual([
      "714539c782bad3ed879ceca0a09c4d63206f17ec679ce978128d829674c9311f",
    ]);

    const ttb = await renderSchematicPacket(shortFixture.ir, {
      format: "schematic-packet-request/0.1",
      page: { size: "letter", orientation: "landscape" },
      views: [
        {
          format: "schematic-view-request/0.1",
          root: { by: "designation", value: "M1" },
          family: "power",
          flow: "top-to-bottom",
        },
      ],
    });
    assert.ok(ttb.ok, JSON.stringify(ttb));
    const ttbMatches = ttb.value.sheets
      .flatMap((s) => netLabelGroups(s.svg))
      .filter((g) => shortNames.includes(g.lines.join("")));
    expect(
      [...new Set(ttbMatches.map((g) => g.lines.join("")))].sort(),
    ).toEqual([...shortNames].sort());
    for (const group of ttbMatches) expect(group.lines).toHaveLength(1);
    expect(ttb.value.sheets.map((s) => sha256(s.svg))).toEqual([
      "f560c68baf8132fe472f63f60a1641342f071804be62d257865704a3ebccf3d1",
      "f39c448956cf7c3ad5f420a5c69e637dc7aafa2d8f56e31518a3c73f72f896a1",
      "4bf27ddcebe45457234660423959c2388765805d55095f8e1d8d7b885b1ad0a7",
      "9b1d7c0795fb5fdace6a88783bfe01f9ba126f809ed392a6685f3be526db347a",
    ]);
  } finally {
    await longFixture.dispose();
    await shortFixture.dispose();
  }
});

it("refuses 36-W -L1/L2/L3 instead of emitting a short terminal-duplicate second row (#576)", async () => {
  const names = phaseTriple(`${"W".repeat(36)}-L1`);
  const fixture = await compilePumpVariant("short36", names);
  const view = {
    format: "schematic-view-request/0.1" as const,
    root: { by: "designation" as const, value: "M1" },
    family: "power" as const,
    flow: "top-to-bottom" as const,
  };
  try {
    const page = normalizePaperPage({
      size: "tabloid",
      orientation: "landscape",
    });
    assert.ok(page.ok);
    const run = await searchRootedCandidates(
      fixture.ir,
      view,
      undefined,
      page.value,
      false,
    );
    expect(
      await wrappableVerticalSourceNetLabelIds(
        fixture.ir,
        view,
        undefined,
        run,
        page.value,
      ),
    ).toBeUndefined();
    const packet = await renderSchematicPacket(fixture.ir, {
      format: "schematic-packet-request/0.1",
      page: { size: "tabloid", orientation: "landscape" },
      views: [view],
    });
    expect(packet.ok).toBe(false);
    if (packet.ok) return;
    expect(packet.error.code).toBe("R006");
    expect(packet.error.message).toContain(names[0]);
    expect(packet.error.message).toMatch(/shorter potential name/iu);
  } finally {
    await fixture.dispose();
  }
});

it("preserves original R006 verbatim and selects zero wrap IDs when 180-W location caption binds (#576)", async () => {
  const names = ["MCC1-480V-L1", "MCC1-480V-L2", "MCC1-480V-L3"] as const;
  const fixture = await compilePumpVariant("location180", names, {
    renameLocation: ["PUMP", "W".repeat(180)],
  });
  const view = {
    format: "schematic-view-request/0.1" as const,
    root: { by: "designation" as const, value: "M1" },
    family: "power" as const,
    flow: "top-to-bottom" as const,
  };
  try {
    const page = normalizePaperPage({
      size: "tabloid",
      orientation: "landscape",
    });
    assert.ok(page.ok);
    const run = await searchRootedCandidates(
      fixture.ir,
      view,
      undefined,
      page.value,
      false,
    );
    expect(
      await wrappableVerticalSourceNetLabelIds(
        fixture.ir,
        view,
        undefined,
        run,
        page.value,
      ),
    ).toBeUndefined();
    const winner = rootedWinner(run, page.value);
    const native = nativeWinner(run);
    const rawError =
      (!native &&
        run.nativeErrors.get(winner?.profile ?? run.prepared[0]?.profile)) ||
      run.errors[0];
    assert.ok(rawError);
    const expected = rootedDiagnosticError(rawError, run.diagnostics);
    const packet = await renderSchematicPacket(fixture.ir, {
      format: "schematic-packet-request/0.1",
      page: { size: "tabloid", orientation: "landscape" },
      views: [view],
    });
    expect(packet.ok).toBe(false);
    if (packet.ok) return;
    expect(packet.error.code).toBe("R006");
    expect(packet.error.message).toBe(
      `Packet view[0] "M1 / power": ${expected.message}`,
    );
    expect(packet.error.message).toContain(
      "protected width 442.45 mm exceeds 375.80 mm by 66.65 mm. Use a larger sheet or landscape.",
    );
    expect(packet.error.message).not.toMatch(
      /potential name|source net label/iu,
    );
    expect(expected.details).toBeUndefined();
    expect(packet.error.details).toEqual({
      view: { title: "M1 / power", viewIndex: 0 },
      viewIndex: 0,
      viewTitle: "M1 / power",
      views: [{ title: "M1 / power", viewIndex: 0 }],
    });
  } finally {
    await fixture.dispose();
  }
});

it("enforces two-line box clearance against non-owner frames in validate-output (#576)", async () => {
  const names = phaseTriple(
    "MCC1-MAIN-MOTOR-POWER-480VAC-BUS-FEEDER-PANEL-MOD-ALPHA-1-L1",
  );
  const fixture = await compilePumpVariant("twoline-collision", names);
  try {
    const { layoutPresentationGraph } =
      await import("../src/layout/elk-adapter.js");
    const { createElkEngine } = await import("../src/layout/elk-runtime.js");
    const { wrapPresentationNetLabels } =
      await import("../src/presentation/net-label-wrap.js");
    const { agentPresentation } = await import("./helpers/agent-recovery.js");
    const { graph: baseGraph, selected } = agentPresentation(fixture.ir, {
      format: "schematic-view-request/0.1",
      root: { by: "designation", value: "M1" },
      family: "power",
      flow: "top-to-bottom",
    });
    const wrapIds = new Set(
      baseGraph.edges
        .filter((e) => e.netLabel && names.includes(e.netLabel.text))
        .map((e) => e.netLabel!.id),
    );
    const wrapped = wrapPresentationNetLabels(baseGraph, wrapIds);
    const baseEngine = createElkEngine();
    const realLayout = baseEngine.layout.bind(baseEngine);
    const engine = createElkEngine();
    engine.layout = async (input, options) => {
      const output = await realLayout(input, options);
      const nonOwner = output.children
        ?.flatMap((loc) => loc.children ?? [])
        .find((dev) => dev.labels?.[0]?.text !== "SUP1");
      const loc = output.children?.find((l) =>
        l.children?.some((d) => d === nonOwner),
      );
      const netLabel = output.edges
        ?.flatMap((e) => e.labels ?? [])
        .find((l) => l.text === names[0]);
      assert.ok(nonOwner && loc && netLabel);
      // Place only the second line (bottom half of the 28-unit box) into the non-owner frame.
      netLabel.x = (loc.x ?? 0) + (nonOwner.x ?? 0) + 4;
      netLabel.y = (loc.y ?? 0) + (nonOwner.y ?? 0) - 18;
      return output;
    };
    const outcome = await layoutPresentationGraph(wrapped, {
      engine,
      selected,
    });
    expect(outcome).toMatchObject({
      ok: false,
      failureKind: "net-label-intersection",
      error: { code: "R004" },
    });
  } finally {
    await fixture.dispose();
  }
});

it("keeps base refusal bytes and zero wrap IDs for 152-W borderline location width (#576)", async () => {
  const names = ["MCC1-480V-L1", "MCC1-480V-L2", "MCC1-480V-L3"] as const;
  const fixture = await compilePumpVariant("location152", names, {
    renameLocation: ["PUMP", "W".repeat(152)],
  });
  const view = {
    format: "schematic-view-request/0.1" as const,
    root: { by: "designation" as const, value: "M1" },
    family: "power" as const,
    flow: "top-to-bottom" as const,
  };
  try {
    const page = normalizePaperPage({
      size: "tabloid",
      orientation: "landscape",
    });
    assert.ok(page.ok);
    const run = await searchRootedCandidates(
      fixture.ir,
      view,
      undefined,
      page.value,
      false,
    );
    expect(
      await wrappableVerticalSourceNetLabelIds(
        fixture.ir,
        view,
        undefined,
        run,
        page.value,
      ),
    ).toBeUndefined();
    const winner = rootedWinner(run, page.value);
    const native = nativeWinner(run);
    const rawError =
      (!native &&
        run.nativeErrors.get(winner?.profile ?? run.prepared[0]?.profile)) ||
      run.errors[0];
    assert.ok(rawError);
    const expected = rootedDiagnosticError(rawError, run.diagnostics);
    const packet = await renderSchematicPacket(fixture.ir, {
      format: "schematic-packet-request/0.1",
      page: { size: "tabloid", orientation: "landscape" },
      views: [view],
    });
    expect(packet.ok).toBe(false);
    if (packet.ok) return;
    expect(packet.error.code).toBe("R006");
    expect(packet.error.message).toBe(
      `Packet view[0] "M1 / power": ${expected.message}`,
    );
    expect(packet.error.message).toContain(
      "protected width 383.21 mm exceeds 375.80 mm by 7.41 mm. Use a larger sheet or landscape.",
    );
    expect(packet.error.message).not.toMatch(
      /potential name|source net label/iu,
    );
  } finally {
    await fixture.dispose();
  }
});

it.each([
  [
    "consecutive-space-break-standard",
    `${"W".repeat(28)}   ${"W".repeat(27)}L1`,
    "standard" as const,
    "protected width 538.70 mm exceeds 375.80 mm by 162.90 mm. Use a larger sheet or landscape.",
  ],
  [
    "consecutive-space-break-compact",
    `${"W".repeat(28)}   ${"W".repeat(27)}L1`,
    "compact" as const,
    "protected width 538.70 mm exceeds 375.80 mm by 162.90 mm. Use a larger sheet or landscape.",
  ],
  [
    "longW-0-standard",
    `${"W".repeat(22)}-${"W".repeat(23)}L1`,
    "standard" as const,
    "protected width 454.70 mm exceeds 375.80 mm by 78.90 mm. Use a larger sheet or landscape.",
  ],
] as const)(
  "falls back to base refusal when wrapped two-line label cannot sit at route source for %s (#576)",
  async (tag, sample, layout, expectedFragment) => {
    const names = phaseTriple(sample);
    const fixture = await compilePumpVariant(tag, names);
    const view = {
      format: "schematic-view-request/0.1" as const,
      root: { by: "designation" as const, value: "M1" },
      family: "power" as const,
      flow: "top-to-bottom" as const,
    };
    try {
      const page = normalizePaperPage({
        size: "tabloid",
        orientation: "landscape",
      });
      assert.ok(page.ok);
      const run = await searchRootedCandidates(
        fixture.ir,
        view,
        undefined,
        page.value,
        layout === "compact",
      );
      const winner = rootedWinner(run, page.value);
      const native = nativeWinner(run);
      const rawError =
        (!native &&
          run.nativeErrors.get(winner?.profile ?? run.prepared[0]?.profile)) ||
        run.errors[0];
      assert.ok(rawError);
      const expected = rootedDiagnosticError(rawError, run.diagnostics);
      const packet = await renderSchematicPacket(fixture.ir, {
        format: "schematic-packet-request/0.1",
        layout,
        page: { size: "tabloid", orientation: "landscape" },
        views: [view],
      });
      expect(packet.ok).toBe(false);
      if (packet.ok) return;
      expect(packet.error.code).toBe("R006");
      expect(packet.error.message).toBe(
        `Packet view[0] "M1 / power": ${expected.message}`,
      );
      expect(packet.error.message).toContain(expectedFragment);
      expect(packet.error.message).not.toMatch(
        /potential name|source net label/iu,
      );
    } finally {
      await fixture.dispose();
    }
  },
);
