import { readFileSync } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import {
  copyProject,
  ctx,
  noteJson,
  ok,
  readJson,
  repositoryRoot,
  writeJson,
  type Fact,
} from "./harness.js";
import { guideModel, type Fence, type GuideModel } from "./guide-model.js";
import { topicExecution } from "../../../../scripts/docs-example-evidence.mjs";
import { PROJECT_GUIDE_BYTE_LIMIT } from "../../src/project-guide-budget.js";
import { compileProject } from "@thermite/compiler";
import { buildDocumentation, relationPrintIdentity } from "@thermite/query";
import { splitWords } from "./commands.js";
import { circuitCaptionFixture } from "./wiring-circuits.js";

const guidePath = join(
  repositoryRoot,
  "packages/cli/assets/THERMITE_AGENTS.md",
);
export const guideBytes = readFileSync(guidePath);
export const projectGuide = guideModel(guideBytes.toString("utf8"));
const workflowsFile = "docs/project-workflows.md";
const workflows = guideModel(
  readFileSync(join(repositoryRoot, workflowsFile), "utf8"),
);
export const live = guideModel(projectGuide.text + "\n" + workflows.text);

export const workflowFacts: readonly Fact[] = [
  {
    claim: "Use a short group `lineReference` for circuit captions.",
    async check() {
      const { text } = await circuitCaptionFixture();
      expect(text.some((t) => t.endsWith(": 300"))).toBe(true);
      expect(text.some((t) => t.endsWith(": Output channels"))).toBe(true);
    },
  },
  {
    claim:
      "Network and assembly reports use the authored designation, then the printed endpoint pair, then the authored description. A blank reference needs source review.",
    async check() {
      const result = await compileProject(
        join(repositoryRoot, "examples/report-filtering"),
      );
      if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
      for (const [kind, designation, endpoints] of [
        ["network", "NET1", "PLC1: ETH ↔ DOC1: IN"],
        ["assemblies", "ASM1", "PLC1.X1 ↔ S1.P"],
      ] as const) {
        const { ir } = result;
        const relation = ir.relations.find(
          (r) => r.designation === designation,
        )!;
        const cell = () =>
          buildDocumentation(ir, {
            format: "documentation-view-request/0.1",
            kind,
          }).rows.find((r) => r.key === relation.uid)?.cells[0];
        expect(cell()).toBe(designation);
        delete relation.designation;
        expect(cell()).toBe(endpoints);
        const unavailable = new Map();
        expect(
          relationPrintIdentity(
            { ...relation, description: "Authored description" },
            unavailable,
          ).text,
        ).toBe("Authored description");
        expect(
          relationPrintIdentity({ ...relation, description: "" }, unavailable)
            .text,
        ).toBe("");
      }
    },
  },
  {
    claim:
      "Packet JSON `html` matches `.html` byte for byte. Text fitting uses bundled fonts.",
    async check() {
      const packetRequest = workflows.fences.find(
        (fence) =>
          fence.lang === "json" &&
          fence.body.includes('"schematic-packet-request/0.1"'),
      );
      if (!packetRequest) throw Error("Missing the guide's packet request");
      const args = ["packet", "--input", "-"];
      const project = ctx.pristine.starter;
      const standalone = await ok(args, project, packetRequest.body);
      const packet = await ok([...args, "--json"], project, packetRequest.body);
      const { html } = JSON.parse(packet.stdout);
      expect(html.match(/<style data-thermite-font=/gu)).toHaveLength(1);
      expect(html === standalone.stdout, "packet HTML bytes").toBe(true);
    },
  },
];

export async function verifyGuideBudgets() {
  expect(projectGuide.bytes).toBeLessThanOrEqual(PROJECT_GUIDE_BYTE_LIMIT);
  expect(
    (await stat(join(repositoryRoot, "AGENTS.md"))).size,
  ).toBeLessThanOrEqual(4_500);
  expect(projectGuide.text).toContain("follow **Extend a starter**");
  const delivered = await ok(["guide", "project-workflows"], ctx.work);
  expect(delivered.stdout).toBe(workflows.text);
}

const coreAdvice: [string, string][] = [
  [
    "Invent no pins, ratings, spares or title/revision data.",
    "Safety rule for authored facts.",
  ],
  [
    "Mark terminals unused or deferred only with explicit user intent.",
    "Authoring policy for connection dispositions.",
  ],
  [
    "After library edits, run `thermite lock .` before validation.",
    "The guard recipe tests the required order.",
  ],
  [
    "Snapshot before edits with `thermite snapshot -o drawings/before.json`.",
    "The command runs separately and the workflow facts test snapshots.",
  ],
  [
    "To undo registration of a new file, remove it from `sources` in `system.json`, confirm no source glob still matches it, then delete the unregistered file.",
    "The guarded starter recipe exercises removal in that order.",
  ],
];

export function verifyCoreAuthoringRules() {
  expect(projectGuide.sentences).toEqual(
    expect.arrayContaining([
      ...coreAdvice.map(([sentence]) => sentence),
      "For R006, narrow selection or use larger paper.",
      "Never change connectivity or shrink text to fit.",
      "Write new files completely before listing them in `sources` in `system.json`.",
      "Once listed, use guarded patches for every edit, including E011 repairs, except for JSON syntax repair.",
    ]),
  );
}

const deliveryRequestAdvice =
  "The workflow test issues the documented request on the synthetic conveyor and verifies its artifact inventory.";
const exportParityAdvice =
  "The CLI export parity tests compare generated bytes and effective options with standalone commands.";
const publicationAdvice =
  "The CLI publication tests exercise a source change, a late failure, concurrent writers and interruption.";
const freshnessAdvice =
  "The CLI check tests exercise exit status, byte and request changes, and unchanged timestamps.";

const deliveryAdvice: [string, string][] = [
  [
    "After the final edit, validate the project, generate the files together, and inspect the drawings.",
    "Handoff sequence with human drawing inspection.",
  ],
  [
    "Check freshness again just before handoff.",
    "An edit can invalidate a delivery between generation and handoff.",
  ],
  [
    "Save a strict `export-delivery-request/1` JSON file with a nonempty `jobs` array.",
    deliveryRequestAdvice,
  ],
  [
    "Each job declares its output formats and filenames.",
    deliveryRequestAdvice,
  ],
  [
    "Resolve command-line paths from the working directory, job inputs from the project directory, and output filenames from the delivery directory.",
    deliveryRequestAdvice,
  ],
  [
    "Use forward slashes for nested paths.",
    "Portable path spelling across supported operating systems.",
  ],
  ["**Packet.** Use an existing packet request.", deliveryRequestAdvice],
  [
    "Optional `page` (`size`, `orientation`, `marginMm`), `layout` and `index: true` apply the same overrides as packet flags.",
    exportParityAdvice,
  ],
  [
    "`strict: true` rejects compiler or packet coverage warnings.",
    publicationAdvice,
  ],
  [
    "**View.** Choose `power`, `actuation`, `loads`, `conductors` or `trace`.",
    "Delivery view jobs share the standalone intent parser.",
  ],
  [
    "Trace also takes `to` and optional `includePower`.",
    "Trace uses the same endpoint selectors as the standalone view.",
  ],
  [
    "Use either drawing flow and the same page, layout and index settings as `view`.",
    exportParityAdvice,
  ],
  [
    "Packet and view jobs also support `svg` for a single sheet.",
    publicationAdvice,
  ],
  [
    "Use HTML, PDF or JSON for multiple sheets.",
    "The SVG delivery probe verifies rejection for multiple sheets.",
  ],
  [
    "**Report.** Use any `thermite report <kind>` kind.",
    "Delivery and standalone CLI use the same report inventory.",
  ],
  [
    "Use `filter` for a named filter or `device` where the standalone report accepts it.",
    exportParityAdvice,
  ],
  [
    "CSV uses the same columns, selection and row policy as `thermite report <kind> -o <file>.csv`.",
    exportParityAdvice,
  ],
  [
    "A report job can also issue printable formats with the same page, layout and index settings as a standalone report.",
    "Printable report jobs use the standalone sheet renderer.",
  ],
  [
    "**Diagnostics.** The completeness inventory supports optional `device` or exact `location` scope and the standalone JSON, CSV and TXT formats.",
    "Both entry points use the same completeness query and serializers.",
  ],
  ["**Cable and review.** Cable uses a designation.", deliveryRequestAdvice],
  [
    "Review uses the JSON baseline saved with the snapshot command before the edit.",
    deliveryRequestAdvice,
  ],
  [
    "The bundle compiles once.",
    "The CLI publication test counts one compile and one render per distinct drawing.",
  ],
  [
    "It stages the requested files, rechecks the source and request bytes, and publishes `export-manifest.json` last.",
    publicationAdvice,
  ],
  [
    "The manifest records the expected files, their hashes, the effective export options and warning scopes.",
    deliveryRequestAdvice,
  ],
  [
    "The CLI reports compiler diagnostics once and reports packet coverage on the packet job.",
    exportParityAdvice,
  ],
  [
    "A failure before publication preserves the previous generation.",
    publicationAdvice,
  ],
  [
    "Check that generation against current inputs before relying on it.",
    "Source may change while the previous files remain.",
  ],
  [
    "If publication stops partway, rerun the bundle to replace the incomplete delivery.",
    publicationAdvice,
  ],
  ["A concurrent writer can reserve an output directory.", publicationAdvice],
  ["Retry after that writer exits.", "Reservations are held for publication."],
  [
    "After a forced termination, verify that no publisher is using the delivery before removing any empty `.thermite-export.lock` directories left in the output folders, then rerun the bundle.",
    "Operator recovery for an abandoned reservation.",
  ],
  [
    "For a custom delivery, opt in to sidecars as in `thermite view M1 --power -o <file>.pdf --receipt`.",
    exportParityAdvice,
  ],
  [
    "The same flag is available for named report, packet, diagnostics, cable and review exports.",
    exportParityAdvice,
  ],
  ["Keep each receipt sidecar beside its artifact.", freshnessAdvice],
  [
    "List the expected options and files in a delivery request and run `thermite export check --input <file> --out-dir <dir> --receipts`.",
    freshnessAdvice,
  ],
  [
    "The check hashes inputs and files without laying out drawings.",
    "The publication test observes zero additional compile or render calls during check.",
  ],
  [
    "Exit 0 means fresh, 1 means stale or invalid, and 2 means usage or infrastructure failure.",
    freshnessAdvice,
  ],
  [
    "JSON output includes machine-readable reason codes and paths.",
    freshnessAdvice,
  ],
  ["Format-only source and request edits count as changes.", freshnessAdvice],
  [
    "A timestamp edit with identical bytes preserves freshness.",
    freshnessAdvice,
  ],
];

export const workflowAdvice: [string, string][] = [
  ...coreAdvice,
  ...deliveryAdvice,
  [
    "Circuit bodies reserve space between split terminal captions and symbol strokes.",
    "The transformer-control and terminal-label clearance suites measure this printed geometry.",
  ],
  [
    "Before extending a starter, run `thermite guide agent-requests` and follow **Extend a starter**.",
    "The CLI guide suite executes this topic's starter recipe.",
  ],
  [
    "Guard existing files from inspection through dry-run and apply, including any undo.",
    "The guarded workflow and repair claims exercise both paths.",
  ],
  [
    "Never use git checkout or rm to undo an edit to a registered source.",
    "Authoring prohibition shared with the starter recipe.",
  ],
  [
    "Run `thermite guide project-workflows` for printing, reports, review, libraries/lock, connection completeness, wiring records, cables, communication, field hookups and circuits.",
    "This topic is run by the project workflow fences and existing fact checks.",
  ],
  [
    "For exact shapes use `thermite guide schema`.",
    "The CLI guide suite compares exact schemas.",
  ],
  [
    "Use `thermite guide drawing-frames` before changing paper frames or title data.",
    "Read-before policy; the topic is resolved offline.",
  ],
  [
    "It covers source binding.",
    "The offline drawing-frames topic links to the document binding contract.",
  ],
];

async function deliveryExample(fence: Fence) {
  const project = await copyProject(
    join(repositoryRoot, "examples/conveyor-line"),
    "delivery",
  );
  await writeFile(join(project, "delivery.request.json"), fence.body + "\n");
  noteJson(JSON.parse(fence.body));
  await writeJson(join(project, "packet.request.json"), {
    format: "schematic-packet-request/0.1",
    views: [{ format: "documentation-view-request/0.1", kind: "bom" }],
  });
  await writeJson(join(project, "cabinet.filter.json"), { devices: ["PLC1"] });
  await ok(["snapshot", "-o", "before.json"], project);
  return project;
}

async function executeDeliveryShell(fence: Fence, project: string) {
  let output = "";
  for (const line of fence.body.split("\n")) {
    const [command, ...args] = splitWords(line, true).words;
    expect(command).toBe("thermite");
    output = (await ok(args, project)).stdout;
  }
  expect(JSON.parse(output)).toMatchObject({ fresh: true, reasons: [] });
}

async function verifyDeliveryManifest(fence: Fence, project: string) {
  const expected = JSON.parse(fence.body).jobs.flatMap(
    (job: { outputs: Record<string, string> }) => Object.values(job.outputs),
  );
  const manifest = await readJson(
    join(project, "drawings/export-manifest.json"),
  );
  expect(
    manifest.artifacts.map((entry: { path: string }) => entry.path),
  ).toEqual(expected);
}

export async function verifyWorkflowExamples(
  runFence: (fence: Fence, model: GuideModel) => Promise<number>,
  executedFences: Set<number>,
) {
  const execution = topicExecution(workflowsFile, workflows.text, [
    "sh",
    "json",
  ]);
  execution.checkLanguages(workflows.fences);
  const request = workflows.fences.find(
    (fence) =>
      fence.lang === "json" &&
      fence.body.includes('"export-delivery-request/1"'),
  );
  const shell = workflows.fences.find(
    (fence) =>
      fence.lang === "sh" && fence.body.includes("thermite export bundle "),
  );
  if (!request || !shell)
    throw new Error("Missing the documented delivery example.");
  const project = await deliveryExample(request);
  const examples = new Map([
    [shell, () => executeDeliveryShell(shell, project)],
    [request, () => verifyDeliveryManifest(request, project)],
  ]);
  for (const [index, fence] of workflows.fences.entries()) {
    const combined = live.fences[index + projectGuide.fences.length]!;
    const runDefault = async () => {
      expect(await runFence(combined, live)).toBeGreaterThan(0);
    };
    const runExample = examples.get(fence) ?? runDefault;
    await execution.run(fence, async () => {
      await runExample();
      executedFences.add(combined.index);
    });
  }
  execution.finish(workflows.fences);
}
