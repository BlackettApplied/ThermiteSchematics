import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtemp, realpath, rm, glob } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "../src/sheets.js";
import { scopedReferenceOracle } from "./helpers/local-reference-oracle.js";
import {
  cases,
  prepareProject,
  prepareRequest,
} from "../../../evals/draw/corpus.mjs";

import { checkSvgFontBudget } from "../../../evals/draw/font-budget.mjs";
import { embedPrintableFont } from "../../cli/src/printable-font.js";

const corpus = cases();
const extraFontCases = ["left-to-right", "top-to-bottom"].map((flow) => ({
  id: `off-view-connections-${flow}`,
  project: "examples/off-view-connections",
  request: "examples/off-view-connections/packet.json",
  flow,
  recipe: undefined,
}));
const fontCases = [...corpus.filter((spec) => !spec.sweep), ...extraFontCases];
const compiled = new Map<string, ReturnType<typeof compileProject>>();
const composed = new Set<string>();
const refusals = new Set([
  "sweep-report-filtering-letter-portrait-standard-left-to-right",
  "sweep-report-filtering-letter-portrait-standard-top-to-bottom",
  "sweep-report-filtering-letter-portrait-compact-left-to-right",
  "sweep-report-filtering-letter-portrait-compact-top-to-bottom",
]);
let scratch: string;
const root = process.cwd();

async function lockFixture(args: string[]) {
  const result = spawnSync(
    process.execPath,
    [resolve("thermite.mjs"), ...args],
    {
      encoding: "utf8",
    },
  );
  return { code: result.status, stderr: result.stderr };
}

// Flow, page and layout variants only alter the request. Each recipe gets
// one compiled project, and the adjacent ink and resource audits share a
// single packet for the exact same case.
async function renderCase(spec: (typeof corpus)[number]) {
  const key = JSON.stringify([spec.project, spec.recipe]);
  let project = compiled.get(key);
  if (!project) {
    project = prepareProject(
      spec,
      root,
      join(scratch, spec.id),
      lockFixture,
    ).then((path: string) => compileProject(path));
    compiled.set(key, project);
  }
  const c = await project;
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  return renderSchematicPacket(
    c.ir,
    await prepareRequest(spec, root),
    c.presentation,
  );
}

let lastPacket:
  { id: string; result: ReturnType<typeof renderCase> } | undefined;
function packetFor(spec: (typeof corpus)[number]) {
  if (lastPacket?.id !== spec.id)
    lastPacket = { id: spec.id, result: renderCase(spec) };
  return lastPacket.result;
}

beforeAll(async () => {
  scratch = await mkdtemp(
    join(await realpath(tmpdir()), "thermite-composed-corpus-"),
  );
});
afterAll(async () => {
  try {
    for (const id of [
      "machine-demo-top-to-bottom",
      "conveyor-line-top-to-bottom",
      "motor-starter-top-to-bottom",
    ])
      expect(composed.has(id), `No composed sheets inspected for ${id}`).toBe(
        true,
      );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
for (const entry of corpus) {
  it.each([entry])(
    "keeps every composed local resource scoped in $id",
    async (spec) => {
      const packet = await packetFor(spec);
      if (!packet.ok) {
        expect(refusals.has(spec.id), JSON.stringify(packet.error)).toBe(true);
        expect(packet.error.code).toBe("R006");
        return;
      }
      expect(refusals.has(spec.id)).toBe(false);
      for (const sheet of packet.value.sheets) {
        const inspected = scopedReferenceOracle(sheet.svg);
        if (inspected.sections) {
          composed.add(spec.id);
          expect(
            inspected.references,
            `${spec.id} sheet ${sheet.number}: empty guard`,
          ).toBeGreaterThan(0);
        }
      }
    },
    // Compact-frame cases still perform a complete ELK render. One took
    // 30.13 s on macOS CI, and the letter-landscape motor sweep took 22.36 s.
    entry.recipe === "compact-frame" ||
      (entry.sweep?.project === "motor-starter" &&
        entry.sweep.size === "letter" &&
        entry.sweep.orientation === "landscape")
      ? 60_000
      : 30_000,
  );
  if (!entry.sweep) registerFontBudget(entry);
}
for (const entry of extraFontCases) registerFontBudget(entry);

function registerFontBudget(entry: (typeof corpus)[number]) {
  it.each([entry])(
    "bounds every rendered shipped-example SVG: $id",
    async (spec) => {
      const result = await packetFor(spec);
      if (!result.ok) {
        expect(spec.id).toBe("motor-starter-top-to-bottom");
        expect(result.error.code).toBe("R006");
        return;
      }
      const style = result.value.html.match(
        /<style data-thermite-font="[^"]+">[^<]*<\/style>/u,
      );
      expect(style?.[0]).toBeDefined();
      expect(Buffer.byteLength(style?.[0] ?? "")).toBeLessThanOrEqual(
        500 * 1024,
      );
      for (const sheet of result.value.sheets) {
        const svg = embedPrintableFont(sheet.svg);
        expect(
          checkSvgFontBudget(svg, `${spec.id}/${sheet.number}`),
        ).toBeLessThanOrEqual(61440);
      }
    },
  );
}

it("covers every shipped example project in the font budget matrix", async () => {
  const inventory: string[] = [];
  for await (const file of glob("examples/**/system.json"))
    inventory.push(file.replace(/\\/gu, "/").replace(/\/system.json$/u, ""));
  expect(
    new Set(
      fontCases
        .filter((spec) => spec.project.startsWith("examples/"))
        .map((spec) => spec.project),
    ),
  ).toEqual(new Set(inventory));
});
