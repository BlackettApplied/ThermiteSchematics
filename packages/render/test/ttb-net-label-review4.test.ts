import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { compileProject, lockProject } from "@thermite/compiler";
import { expect, it } from "vitest";
import { cases, prepare } from "../../../evals/draw/corpus.mjs";
import { renderSchematicPacket } from "../src/index.js";
import { normalizePaperPage } from "../src/packet/page.js";
import { rootedDiagnosticError } from "../src/packet/rooted-constraint.js";
import {
  nativeWinner,
  rootedWinner,
  searchRootedCandidates,
} from "../src/packet/rooted-search.js";
import {
  WRAPPED_UTILISATION_FLOOR,
  visibleDrawingAreaUtilisation,
} from "../src/packet/rooted-utilisation.js";
import { OUTER_SVG_PADDING } from "../src/symbols/catalog.js";
import { printableLabelGeometry } from "../src/symbols/printable-label.js";
import { orthogonalPathData } from "../src/svg/edge-path.js";
import { printableTextMetrics } from "../src/text-metrics.js";

const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(import.meta.dirname, "../../..");

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
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

async function compilePumpWithNames(
  tag: string,
  phaseNames: readonly [string, string, string],
  compactChain = false,
) {
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
  const root = await mkdtemp(join(tmpdir(), `thermite-r4-${tag}-`));
  await writeFile(
    join(root, "system.json"),
    JSON.stringify({
      format: "electrical-system/0.1",
      project: { name: `Synthetic ${tag}` },
      sources: ["source.json"],
      libraries: [{ name: "core", version: "0.2.0" }],
    }),
  );
  await writeFile(
    join(root, "source.json"),
    JSON.stringify({
      objects: compactChain ? compactPumpChain(raw.objects) : raw.objects,
    }),
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

async function baseTabloidRefusalMessage(
  ir: Awaited<ReturnType<typeof compilePumpWithNames>>["ir"],
  layout: "standard" | "compact" = "standard",
) {
  const view = {
    format: "schematic-view-request/0.1" as const,
    root: { by: "designation" as const, value: "M1" },
    family: "power" as const,
    flow: "top-to-bottom" as const,
  };
  const page = normalizePaperPage({
    size: "tabloid",
    orientation: "landscape",
  });
  assert.ok(page.ok);
  const run = await searchRootedCandidates(
    ir,
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
  return rootedDiagnosticError(rawError, run.diagnostics).message;
}

it("preserves exact single-line (inkTop + m.top) - m.middleBaseline arithmetic (#576 review4)", () => {
  const text = "PLC command, stop and overload interlocks";
  const m = printableTextMetrics(text, 10);
  const label = { x: 10, y: 17.355, width: 220, height: 14 };
  const route = [
    { x: 10, y: 24.355 },
    { x: 230, y: 24.355 },
  ] as const;
  const geom = printableLabelGeometry(label, text, 214, [route], 10, false);
  const inkTop = geom.ink.top;
  const baseOrder = inkTop + m.top - m.middleBaseline;
  expect(geom.y).toBe(baseOrder);
});

it.each([
  [
    "motor-starter-documentation-left-to-right",
    "1651391d94935c165585a79aa8459cf6125b2090d4d2285348dc3d838b3c3478",
  ],
  [
    "circuit-pagination-left-to-right",
    "3d9f23360f2e9b0f364d09da40ee7f7fa23cb1e63ee725398c3aa282d6f4effd",
  ],
  [
    "motor-starter-documentation-top-to-bottom",
    "b1f79bab13e88c5134ef2a5b26c2d93bae3d3b6f8e58fca8092b7cc75cbec73b",
  ],
] as const)(
  "keeps corpus packet %s byte-identical to pinned base (#576 review4)",
  async (caseId, pinnedHash) => {
    const spec = cases().find((entry) => entry.id === caseId);
    assert.ok(spec, `Missing corpus case ${caseId}`);
    const dir = await mkdtemp(join(await realpath(tmpdir()), "thermite-r4-"));
    try {
      const sub = join(dir, caseId);
      await mkdir(sub, { recursive: true });
      const { project, input } = await prepare(
        spec,
        REPO_ROOT,
        sub,
        async () => {
          throw Error("Unexpected CLI call during prepare");
        },
      );
      const output = join(sub, "packet.json");
      await execFileAsync(
        process.execPath,
        [
          join(REPO_ROOT, "thermite.mjs"),
          "packet",
          "--project",
          project,
          "--input",
          input,
          "-o",
          output,
        ],
        { cwd: REPO_ROOT },
      );
      expect(sha256(await readFile(output))).toBe(pinnedHash);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

it("returns exact base R006 refusal bytes when wrapped len60 fails DQ-12 utilisation floor (#576 review4)", async () => {
  const sample = "MCC1-MAIN-MOTOR-POWER-480VAC-BUS-FEEDER-PANEL-MOD-ALPHA-1-L1";
  const names = [
    sample,
    sample.replace(/L1$/u, "L2"),
    sample.replace(/L1$/u, "L3"),
  ] as const;
  const fixture = await compilePumpWithNames("len60-dq12", names);
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
      "protected width 414.70 mm exceeds 375.80 mm by 38.90 mm. Use a larger sheet or landscape.",
    );
    expect(packet.error.message).not.toMatch(
      /potential name|source net label/iu,
    );
  } finally {
    await fixture.dispose();
  }
});

it("quotes potential names containing $&, $1, and advice text literally in R006 (#576 review4)", async () => {
  const baseMessage =
    "No safe sheet grid fits: protected width 400.00 mm exceeds 375.80 mm by 24.20 mm. Use a larger sheet or landscape.";
  const baseError = { code: "R006" as const, message: baseMessage };
  const diagnostics = [
    {
      constraint: {
        kind: "protected-span" as const,
        spans: [
          {
            axis: "width" as const,
            requiredMm: 400,
            availableMm: 375.8,
            shortfallMm: 24.2,
          },
        ],
        message: baseMessage,
      },
    },
  ];
  for (const name of [
    "LONG$&-POTENTIAL",
    "LONG$1-POTENTIAL",
    "LONG. Use a larger sheet or landscape.",
  ]) {
    const out = rootedDiagnosticError(baseError, diagnostics, [name]);
    expect(out.message).toBe(
      `No safe sheet grid fits: protected width 400.00 mm exceeds 375.80 mm by 24.20 mm (source net label ${JSON.stringify(name)}). Use a shorter potential name, a larger sheet, or landscape.`,
    );
  }

  const names: readonly [string, string, string] = [
    `${"W".repeat(38)}$&${"W".repeat(12)}L1`,
    `${"W".repeat(38)}$&${"W".repeat(12)}L2`,
    `${"W".repeat(38)}$&${"W".repeat(12)}L3`,
  ];
  const fixture = await compilePumpWithNames("dollar-amp", names);
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
    for (const name of names) {
      expect(packet.error.message).toContain(JSON.stringify(name));
    }
    expect(packet.error.message).toContain(
      ". Use a shorter potential name, a larger sheet, or landscape.",
    );
  } finally {
    await fixture.dispose();
  }
});

it("keeps exact base R006 refusal bytes on multi-view packets (#576 review5)", async () => {
  const sample = "MCC1-MAIN-MOTOR-POWER-480VAC-BUS-FEEDER-PANEL-MOD-ALPHA-1-L1";
  const names = [
    sample,
    sample.replace(/L1$/u, "L2"),
    sample.replace(/L1$/u, "L3"),
  ] as const;
  const ttbView = {
    format: "schematic-view-request/0.1" as const,
    root: { by: "designation" as const, value: "M1" },
    family: "power" as const,
    flow: "top-to-bottom" as const,
  };
  const ltrView = { ...ttbView, flow: "left-to-right" as const };
  const fixture = await compilePumpWithNames("compact-multi", names, true);
  try {
    const single = await renderSchematicPacket(fixture.ir, {
      format: "schematic-packet-request/0.1",
      page: { size: "tabloid", orientation: "landscape" },
      views: [ttbView],
    });
    expect(single.ok).toBe(true);
    const expected = await baseTabloidRefusalMessage(fixture.ir, "standard");
    const multi = await renderSchematicPacket(fixture.ir, {
      format: "schematic-packet-request/0.1",
      page: { size: "tabloid", orientation: "landscape" },
      views: [ttbView, ltrView, ltrView],
    });
    expect(multi.ok).toBe(false);
    if (multi.ok) return;
    expect(multi.error.code).toBe("R006");
    expect(multi.error.message).toBe(
      `Packet view[0] "M1 / power": ${expected}`,
    );
    expect(multi.error.message).not.toMatch(
      /potential name|source net label/iu,
    );
  } finally {
    await fixture.dispose();
  }
});

it("enforces the 0.45 wrapped utilisation floor and keeps base refusal on jog-26 (#576 review5)", async () => {
  expect(WRAPPED_UTILISATION_FLOOR).toBe(0.45);
  const names = [
    `${"W".repeat(26)}-${"W".repeat(18)}L1`,
    `${"W".repeat(26)}-${"W".repeat(18)}L2`,
    `${"W".repeat(26)}-${"W".repeat(18)}L3`,
  ] as const;
  const fixture = await compilePumpWithNames("jog-26", names);
  try {
    const expected = await baseTabloidRefusalMessage(fixture.ir, "standard");
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
    expect(packet.error.message).toBe(
      `Packet view[0] "M1 / power": ${expected}`,
    );
    expect(packet.error.message).not.toMatch(
      /potential name|source net label/iu,
    );
  } finally {
    await fixture.dispose();
  }
});

it("applies the drawing-region filter per whole conductor shape and uniform meet scaling (#576 review5)", () => {
  const page = {
    size: "tabloid" as const,
    orientation: "landscape" as const,
    widthMm: 431.8,
    heightMm: 279.4,
    marginMm: 10,
  };
  const control = [
    [50, 50],
    [50, 199.8],
    [250, 199.8],
  ] as const;
  const measure = (
    other: readonly (readonly [number, number])[],
    vh: number,
    width: number,
  ) => {
    const routes = [control, other].map((path, i) => ({
      id: `path${i}`,
      points: path.map(([x, y]) => ({
        x: x - OUTER_SVG_PADDING - 30,
        y: y - OUTER_SVG_PADDING - 30,
      })),
    }));
    const geometry = routes
      .map(
        ({ id, points }) =>
          `<path id="${id}" class="net-path" d="${orthogonalPathData(points)}"/>`,
      )
      .join("");
    const content = `<g transform="translate(4 3)"><svg x="26" y="27" width="${width}" height="${vh}" viewBox="0 0 360 ${vh}" overflow="hidden">${geometry}</svg></g>`;
    const candidate = {
      prepared: {
        graph: {
          nodes: [],
          edges: routes.map(({ id }) => ({
            id,
            kind: "conductor" as const,
            sourcePortId: "",
            targetPortId: "",
          })),
        },
        layout: { nodes: [], edges: routes },
      },
      drafts: [{ content }],
    };
    return visibleDrawingAreaUtilisation(candidate, page);
  };
  const extendingOut = [
    [50, 70],
    [250.18, 70],
    [250.18, 245],
  ] as const;
  expect(measure(extendingOut, 225, 360)).toBeLessThan(0.4);
  expect(measure(extendingOut, 212, 360)).toBeGreaterThan(0.51);
  const inside = [
    [50, 70],
    [250.18, 70],
    [250.18, 230],
  ] as const;
  expect(measure(inside, 225, 360.001)).toBeCloseTo(
    measure(inside, 225, 360),
    12,
  );
});
