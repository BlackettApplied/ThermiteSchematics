// Executes the generated project guide (packages/cli/assets/THERMITE_AGENTS.md)
// against fresh starter and cabinets projects initialized from this checkout.
//
// - Every fenced block runs on its own parsed content.
// - Every command, agent tool and flag the guide shows exists, with its values,
//   on the command it belongs to.
// - Every prose sentence is checked by a fact module in ./project-guide or is
//   listed there as advice with a reason.
// - Every diagnostic code and documented field is observed at runtime.
//
// Each check takes a GuideModel, so the self-tests at the end run the same
// checks against deliberately broken copies of the guide. Agents read the
// guide, so expectations live here and in ./project-guide, never in the guide.
// The observation gates run after every execution in this file, so run the
// whole file, not a filtered subset.
import { readFileSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agent,
  copyProject,
  editJson,
  ok,
  ctx,
  describeRun,
  entry,
  exec,
  freshProject,
  hashTree,
  integrity,
  observed,
  readJson,
  repositoryRoot,
  request,
  setUpSuite,
  sharedProjectsUnchanged,
  tearDownSuite,
  TEMPLATES,
  thermite,
  writeJson,
  type FactModule,
  type Template,
} from "./project-guide/harness.js";
import {
  flatten,
  guideModel,
  leadIn,
  type Fence,
  type GuideModel,
} from "./project-guide/guide-model.js";
import {
  checkCommand,
  expandAlternatives,
  expectedCode,
  isPlaceholder,
  splitWords,
} from "./project-guide/commands.js";
import communication from "./project-guide/communication-completeness.js";
import core, { assertCloneWarnings, viewRoots } from "./project-guide/core.js";
import general from "./project-guide/general.js";
import signalLoops from "./project-guide/signal-loops.js";
import wiring from "./project-guide/wiring-circuits.js";

const guidePath = join(
  repositoryRoot,
  "packages/cli/assets/THERMITE_AGENTS.md",
);
const guideBytes = readFileSync(guidePath);
const live = guideModel(guideBytes.toString("utf8"));
/** The G1 budget; G6 compacts the guide further. */
const GUIDE_BYTE_BUDGET = 19_500;
/** Concrete inline commands checked against the CLI tree but not executed. */
const INLINE_NOT_RUN = new Map<string, string>([
  [
    "thermite watch --input packet.json -o drawings/packet.html",
    "watch polls until interrupted; its command and flags are still checked",
  ],
]);

const MODULES: Record<string, FactModule> = {
  core,
  general,
  "communication-completeness": communication,
  "signal-loops": signalLoops,
  "wiring-circuits": wiring,
};
const FACTS = Object.entries(MODULES).flatMap(([module, { facts }]) =>
  facts.map((fact) => ({ module, ...fact })),
);
// The advice ledger. Moving a sentence here from a checked fact is a reviewed
// change: justify each moved sentence in the pull request.
const UNEXECUTED = new Map(
  Object.values(MODULES).flatMap(({ unexecuted }) => [...unexecuted]),
);
/** Sentences proven by executing fenced blocks, and the recipes that prove them. */
const VERIFIED_BY_BLOCKS = new Map<string, readonly string[]>([
  [
    "This packet puts every starter device on a schematic sheet; for `cabinets`, use root `CBL1` and intent `conductors`.",
    ["packet-starter", "packet-cabinets"],
  ],
  ["Make UUIDs with the second line:", ["uuid"]],
]);
/** Documented words no run observes, each with a reason. */
const VOCABULARY_EXEMPT = new Map<string, string>([
  ["RIO1", "an illustrative far-end designation in a communication example"],
]);
/**
 * Flag fragments whose commands are named in prose rather than by a preceding
 * `thermite <command>`: exact sentence and fragment, and the commands.
 */
const FLAG_BINDINGS: readonly {
  readonly sentence: string;
  readonly fragment: string;
  readonly commands: () => readonly string[];
}[] = [
  {
    sentence:
      "W906: undrawn devices in drawing packets; warnings exit 0 or 1 with `--strict`.",
    fragment: "--strict",
    commands: () => ["packet"],
  },
  {
    sentence:
      "Commands default to `--project .`; `validate`/`lock` also take a path, never both (`thermite validate . --strict`).",
    fragment: "--project .",
    commands: () => [
      ...ctx.tree.alpha.filter((name) => !["init", "guide"].includes(name)),
      "validate",
      "lock",
    ],
  },
  {
    sentence:
      "Write large outputs to files: `create-view` returns tens of KB and `inspect` several KB; `view`, `packet` or `report` without `-o` print a whole HTML document.",
    fragment: "-o",
    commands: () => ["view", "packet", "report"],
  },
  {
    sentence: "Info exits 0, even with `--strict`.",
    fragment: "--strict",
    commands: () => ["validate"],
  },
];

// ---------------------------------------------------------------------------
// Command lines

const commandPrefix = (words: readonly string[]) =>
  words.slice(0, words[0] === "agent" ? 2 : 1);

/** Every `thermite` command line in sh fences and inline spans, in order. */
function mentions(model: GuideModel) {
  const found: { line: number; order: number; words: string[] }[] = [];
  for (const fence of model.fences.filter((f) => f.lang === "sh"))
    fence.body.split("\n").forEach((text, i) => {
      const { words } = splitWords(text, false);
      if (words[0] === "thermite")
        found.push({
          line: fence.line + 1 + i,
          order: 0,
          words: words.slice(1),
        });
    });
  model.spans.forEach((span, order) => {
    if (span.text.startsWith("thermite "))
      found.push({
        line: span.line,
        order,
        words: splitWords(span.text, false).words.slice(1),
      });
  });
  return found.sort((a, b) => a.line - b.line || a.order - b.order);
}
/**
 * Every command line, and every prose flag fragment bound to its command: a
 * listed binding, else the nearest preceding `thermite <command>` in the same
 * paragraph, else in the same section.
 */
function commandProblems(model: GuideModel): string[] {
  const problems: string[] = [];
  for (const fence of model.fences.filter((f) => f.lang === "sh"))
    for (const line of fence.body.split("\n").filter((l) => l.trim())) {
      const { words } = splitWords(line, true);
      if (words[0] === "thermite")
        for (const argv of expandAlternatives(words))
          problems.push(...checkCommand(argv.slice(1), line));
    }
  const all = mentions(model);
  model.spans.forEach((span, order) => {
    if (span.text.startsWith("thermite "))
      problems.push(
        ...checkCommand(splitWords(span.text, false).words.slice(1), span.text),
      );
    if (!/^-{1,2}[a-z]/.test(span.text)) return;
    const words = splitWords(span.text, false).words;
    const where = `\`${span.text}\` at line ${span.line}`;
    const listed = FLAG_BINDINGS.find(
      (b) =>
        b.fragment === span.text &&
        b.sentence === model.sentences[span.sentence],
    );
    const before = all.filter(
      (m) => m.line < span.line || (m.line === span.line && m.order < order),
    );
    const near =
      before.findLast(
        (m) => model.paragraphOf[m.line] === model.paragraphOf[span.line],
      ) ??
      before.findLast(
        (m) => model.sectionOf[m.line] === model.sectionOf[span.line],
      );
    const commands = listed
      ? listed.commands().map((name) => [name])
      : near
        ? [commandPrefix(near.words)]
        : [];
    if (commands.length === 0)
      problems.push(`${where}: no command to bind this flag to`);
    for (const command of commands)
      problems.push(
        ...checkCommand(
          [...command, ...words],
          `${where} (${command.join(" ")})`,
          true,
        ),
      );
  });
  return problems;
}

// ---------------------------------------------------------------------------
// Executing fenced blocks

const recipes = new Set<string>();
const executedFences = new Set<number>();

/** Templates whose projects contain every designation named in `strings`. */
function templatesFor(strings: readonly string[]): Template[] {
  const known = new Set(TEMPLATES.flatMap((t) => [...ctx.designations[t]]));
  const named = strings.filter((s) => known.has(s));
  return TEMPLATES.filter((t) =>
    named.every((d) => ctx.designations[t].has(d)),
  );
}
function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value && typeof value === "object")
    return Object.values(value).flatMap(stringsIn);
  return [];
}
function toolOf(value: Record<string, unknown>): string {
  if ("patchFormat" in value) return "apply-source-patch";
  if ("spec" in value) return "create-view";
  if ("query" in value) return "query";
  if ("target" in value) return "resolve";
  if ("selector" in value) return "inspect";
  return "validate";
}
/**
 * The block's own value where it applies to `template`; for a packet, the
 * lead-in's stated variant ("for `cabinets`, use root `CBL1` and intent
 * `conductors`") otherwise.
 */
function fenceValueFor(
  fence: Fence,
  template: Template,
  model: GuideModel,
): any {
  const value = JSON.parse(fence.body);
  if (templatesFor(stringsIn(value)).includes(template)) return value;
  if (value.format !== "schematic-packet-request/0.1") return undefined;
  const variant = new RegExp(
    `for \`${template}\`, use root \`([^\`]+)\` and intent \`([^\`]+)\``,
  ).exec(leadIn(model, fence));
  if (variant === null) return undefined;
  for (const view of value.views)
    if (view.format === "schematic-view-request/0.2") {
      view.root = { by: "designation", value: variant[1] };
      view.intent = { kind: variant[2] };
    }
  return value;
}
function applicableTemplates(fence: Fence, model: GuideModel) {
  const templates = TEMPLATES.filter(
    (t) => fenceValueFor(fence, t, model) !== undefined,
  );
  if (templates.length === 0)
    throw new Error(
      `The ${fence.lang} block at line ${fence.line} applies to no template.`,
    );
  return templates;
}

async function checkOutput(words: readonly string[], project: string) {
  const at = words.findIndex((w) => w === "-o" || w === "--output");
  if (at < 0) return;
  const file = words[at + 1]!;
  const bytes = await readFile(join(project, file));
  expect(bytes.length, `${file} is empty`).toBeGreaterThan(0);
  const text = bytes.toString("utf8");
  const extension = /\.([a-z]+)$/.exec(file)?.[1];
  if (extension === "pdf") expect(text.startsWith("%PDF-"), file).toBe(true);
  else if (extension === "html") expect(text).toMatch(/^<!doctype html>/i);
  else if (extension === "svg") expect(text).toMatch(/<svg[\s>]/);
  else if (extension === "json") expect(() => JSON.parse(text)).not.toThrow();
}
/** Writes the nearest preceding guide request block a command's `--input` names. */
async function materializeInput(
  words: readonly string[],
  project: string,
  template: Template,
  line: number,
  model: GuideModel,
) {
  const at = words.indexOf("--input");
  if (at < 0) return;
  const file = words[at + 1]!;
  if (file === "-") throw new Error("Guide shell lines cannot supply stdin.");
  const target = join(project, file);
  if (
    await stat(target).then(
      () => true,
      () => false,
    )
  )
    return;
  const wanted = (value: any) =>
    words[0] === "packet" || words[0] === "watch"
      ? value.format === "schematic-packet-request/0.1"
      : words[0] === "continuity"
        ? value.format === "continuity-check-request/0.1"
        : words[0] === "agent" &&
          value.format === "agent-tool-request/0.1" &&
          toolOf(value) === words[1];
  const fence = model.fences.findLast(
    (f) => f.lang === "json" && f.line < line && wanted(JSON.parse(f.body)),
  );
  const value = fence && fenceValueFor(fence, template, model);
  if (value === undefined)
    throw new Error(`No guide request block supplies ${file} for ${template}.`);
  await mkdir(dirname(target), { recursive: true });
  await writeJson(target, value);
}
async function runBunRecipe(
  args: readonly string[],
  project: string,
  template: Template,
) {
  const run = await exec(args, project);
  expect(run.code, `bun ${args.join(" ")}\n${run.stderr}`).toBe(0);
  const output = run.stdout.trim();
  if (output.startsWith("sha256-")) {
    const file = args.at(-1)!;
    expect(output).toBe(integrity(await readFile(join(project, file))));
    // The engine agrees: the source guard and an A004 probe both report this
    // exact value as current.
    const designation = [...ctx.devices[template]][0]!;
    const inspected = await agent(
      "inspect",
      request({
        selector: { by: "designation", value: designation },
        include: ["source"],
      }),
      project,
    );
    expect(inspected.result.value.sourceFiles).toContainEqual(
      expect.objectContaining({ file, integrity: output }),
    );
    const probe = await agent(
      "apply-source-patch",
      request({
        patchFormat: "json-patch/0.1",
        dryRun: true,
        files: [
          {
            path: file,
            expectedIntegrity: integrity(Buffer.from("stale")),
            operations: [{ op: "test", path: "/objects", value: [] }],
          },
        ],
      }),
      project,
    );
    expect(probe.report.error).toMatchObject({
      code: "A004",
      actualIntegrity: output,
    });
    recipes.add("integrity");
  } else if (ctx.uidPattern.test(output)) recipes.add("uuid");
  else throw new Error(`Unclassified recipe output: ${output}`);
}
async function runShellFence(fence: Fence, model: GuideModel) {
  const lines = fence.body
    .split("\n")
    .map((line, i) => ({ line, at: fence.line + 1 + i }))
    .filter(({ line }) => line.trim() !== "")
    .map((l) => ({ ...l, ...splitWords(l.line, true) }));
  const ran = new Set<string>();
  let runs = 0;
  // Each template runs the block in order in its own project, beside the
  // other templates.
  const runTemplate = async (template: Template) => {
    const applicable = lines.filter((l) =>
      templatesFor(l.words).includes(template),
    );
    if (applicable.length === 0) return;
    const project = await freshProject(template);
    for (const { line, at, words, comment } of applicable) {
      for (const argv of expandAlternatives(words)) {
        const [program, ...args] = argv;
        if (program === "bun") await runBunRecipe(args, project, template);
        else if (program === "thermite") {
          expect(checkCommand(args, line)).toEqual([]);
          await materializeInput(args, project, template, at, model);
          const run = await thermite(args, project);
          const code = expectedCode(comment);
          if (code === undefined) {
            expect(run.code, describeRun(args, run)).toBe(0);
            await checkOutput(args, project);
          } else {
            expect(run.code, describeRun(args, run)).not.toBe(0);
            expect(run.stdout + run.stderr, describeRun(args, run)).toContain(
              code,
            );
          }
        } else throw new Error(`Unknown program in guide: ${line}`);
        runs += 1;
      }
      ran.add(line);
    }
  };
  // Wait for every template, so a failing one leaves no command running.
  const settled = await Promise.allSettled(TEMPLATES.map(runTemplate));
  for (const result of settled)
    if (result.status === "rejected") throw result.reason;
  expect(
    lines.filter((l) => !ran.has(l.line)).map((l) => l.line),
    "lines that apply to no template",
  ).toEqual([]);
  return runs;
}
/**
 * Runs a packet; when its lead-in promises every device a schematic sheet, the
 * result must draw every device of the template.
 */
async function runPacket(
  value: unknown,
  template: Template,
  everyDevice: boolean,
) {
  const project = await freshProject(template);
  await writeJson(join(project, "packet.json"), value);
  const args = ["packet", "--input", "packet.json", "--json"];
  const run = await thermite(args, project);
  expect(run.code, describeRun(args, run)).toBe(0);
  if (!everyDevice) return;
  expect(JSON.parse(run.stdout).coverage.diagnostics ?? []).toEqual([]);
  const drawn = new Set(
    JSON.parse(run.stdout)
      .sheets.filter((s: any) => /^schematic-view\//.test(s.view.format))
      .flatMap((s: any) => s.references.map((r: any) => r.designation)),
  );
  expect(
    [...ctx.devices[template]].filter((d) => !drawn.has(d)),
    `${template} devices missing from schematic sheets`,
  ).toEqual([]);
  recipes.add(`packet-${template}`);
}
async function runJsonFence(fence: Fence, model: GuideModel) {
  const format = JSON.parse(fence.body).format;
  let runs = 0;
  for (const template of applicableTemplates(fence, model)) {
    const value = fenceValueFor(fence, template, model);
    if (stringsIn(value).some(isPlaceholder))
      throw new Error(`The block at line ${fence.line} has placeholders.`);
    if (format === "agent-tool-request/0.1") {
      const project = await freshProject(template);
      const tool = toolOf(value);
      const run = await agent(tool, value, project);
      expect(run.code, describeRun(["agent", tool], run)).toBe(0);
    } else if (format === "schematic-packet-request/0.1") {
      const everyDevice =
        /This packet puts every \w+ device on a schematic sheet/.test(
          leadIn(model, fence),
        );
      await runPacket(value, template, everyDevice);
    } else if (format === "continuity-check-request/0.1") {
      const project = await freshProject(template);
      await writeJson(join(project, "checks.json"), value);
      const args = ["continuity", "--input", "checks.json", "--json"];
      const run = await thermite(args, project);
      expect(run.code, describeRun(args, run)).toBe(0);
      expect(JSON.parse(run.stdout).passed).toBe(true);
    } else throw new Error(`No executor for fenced JSON format ${format}.`);
    runs += 1;
  }
  return runs;
}
/** Executes one fenced block on its own content; returns the runs made. */
async function runFence(fence: Fence, model: GuideModel): Promise<number> {
  if (fence.lang === "sh") return runShellFence(fence, model);
  if (fence.lang === "json") return runJsonFence(fence, model);
  throw new Error(`No executor for \`\`\`${fence.lang} blocks.`);
}

// ---------------------------------------------------------------------------
// Sentence ledger

/**
 * The consecutive guide sentences a claim consists of, or undefined when the
 * claim is not a run of whole sentences of this guide.
 */
function claimSentences(claim: string, model: GuideModel) {
  const text = flatten(claim);
  for (let i = 0; i < model.sentences.length; i += 1) {
    if (!text.startsWith(model.sentences[i]!)) continue;
    let at = model.sentences[i]!.length;
    let j = i;
    while (at < text.length) {
      const gap = /^ (?:- )?/.exec(text.slice(at))?.[0];
      const next = model.sentences[j + 1];
      if (!gap || next === undefined || !text.startsWith(next, at + gap.length))
        break;
      at += gap.length + next.length;
      j += 1;
    }
    if (at === text.length) return model.sentences.slice(i, j + 1);
  }
  return undefined;
}
function ledgerProblems(model: GuideModel) {
  const covered = new Set<string>();
  const missingClaims: string[] = [];
  for (const { claim } of FACTS) {
    const sentences = claimSentences(claim, model);
    if (sentences === undefined) missingClaims.push(claim);
    else sentences.forEach((s) => covered.add(s));
  }
  const listed = (s: string) => UNEXECUTED.has(s) || VERIFIED_BY_BLOCKS.has(s);
  return {
    missingClaims,
    unclassified: model.sentences.filter((s) => !covered.has(s) && !listed(s)),
    stale: [...UNEXECUTED.keys(), ...VERIFIED_BY_BLOCKS.keys()].filter(
      (s) => !model.sentences.includes(s),
    ),
    alsoChecked: [...UNEXECUTED.keys(), ...VERIFIED_BY_BLOCKS.keys()].filter(
      (s) => covered.has(s),
    ),
  };
}

// ---------------------------------------------------------------------------
// Observation gates

/** Diagnostic codes the guide names, with ranges such as E300-E302 expanded. */
function guideCodes(model: GuideModel) {
  const codes = new Set<string>();
  for (const m of model.text.matchAll(
    /\b([AEWQRTI])(\d{3})(?:-\1?(\d{3}))?\b/g,
  )) {
    const [first, last = first] = [Number(m[2]), Number(m[3] ?? m[2])];
    for (let n = first; n <= last; n += 1)
      codes.add(`${m[1]}${String(n).padStart(3, "0")}`);
  }
  return [...codes].sort();
}
function codeProblems(model: GuideModel) {
  return [...guideCodes(model)]
    .filter((code) => !observed.codes.has(code))
    .map((code) => `${code} is never produced by a run`);
}

const SKIPPED_SPANS = [
  /^(thermite|bun)\b/, // command lines: checked against the CLI tree
  /^-/, // flags and `-` stdin: bound to their commands
  /^<[^<>]*>$/, // placeholders
  /→/, // the workflow line; each step is a tool
  /^\[ \+N \]$/, // a drawing marker
  /^(~|~0|~1|\/)$/, // JSON Pointer escape characters
  /^\d+(\.\d+)*$/, // version numbers
  /^\.(html|pdf|json|svg)$/, // output extensions: checked by printing facts
  /^[\w.-]*\.(json|lock|md)$|^\.gitignore$|^(docs|libraries)\//, // files
];
const FIELD_PATH = /^\.?[A-Za-z_]\w*(\[\])?(\.[A-Za-z_]\w*)*$/;
/** The keys, values and identifiers an inline span documents. */
function documentedWords(span: string): string[] {
  if (SKIPPED_SPANS.some((p) => p.test(span))) return [];
  if (/^[a-z]+:[\w-]+$/.test(span)) return [span];
  if (FIELD_PATH.test(span)) return span.split(/\.|\[\]/).filter(Boolean);
  if (!/[{}[\]":|]/.test(span)) return [span];
  const words = new Set<string>();
  for (const m of span.matchAll(/"([^"]*)"(\s*:)?/g))
    if (m[2] !== undefined || !/<|\.\.\./.test(m[1]!)) words.add(m[1]!);
  const bare = span.replace(/"[^"]*"/g, '""');
  for (const m of bare.matchAll(/([A-Za-z_]\w*)\s*:/g)) words.add(m[1]!);
  for (const m of bare.matchAll(/[{,]\s*([A-Za-z_]\w*)\s*(?=[,}])/g))
    words.add(m[1]!);
  return [...words];
}
let cliWords = new Set<string>();
function vocabularyProblems(model: GuideModel) {
  const problems = new Set<string>();
  for (const span of model.spans)
    for (const word of documentedWords(span.text))
      if (
        !observed.words.has(word) &&
        !cliWords.has(word) &&
        !VOCABULARY_EXEMPT.has(word)
      )
        problems.add(`${word} (in \`${span.text}\`) is never observed`);
  return [...problems];
}

// ---------------------------------------------------------------------------

/** A copy of the guide with `from` replaced (exactly once) by `to`. */
function mutate(from: string, to: string): GuideModel {
  expect(live.text.split(from).length, `mutation source: ${from}`).toBe(2);
  return guideModel(live.text.replace(from, to));
}
const pristineHashes = new Map<Template, Map<string, string>>();

beforeAll(async () => {
  await setUpSuite();
  for (const template of TEMPLATES) {
    expect(await readFile(join(ctx.pristine[template], "AGENTS.md"))).toEqual(
      guideBytes,
    );
    pristineHashes.set(template, await hashTree(ctx.pristine[template]));
  }
  const kinds = await thermite(["report", "bogus"], ctx.pristine.starter);
  cliWords = new Set([
    ...ctx.tree.commands.keys(),
    ...ctx.tree.tools.keys(),
    ...[...ctx.tree.commands.values(), ...ctx.tree.tools.values()].flatMap(
      (spec) => spec.options.flatMap((o) => o.choices ?? []),
    ),
    ...(/Report kind must be ([^.]+)\./
      .exec(kinds.stdout + kinds.stderr)?.[1]
      ?.split(", ") ?? []),
    ...TEMPLATES,
  ]);
}, 120_000);
afterAll(async () => {
  await (await import("./project-guide/engine-cases.js")).removeCaseFixtures();
  await tearDownSuite();
});

describe("generated project guide", () => {
  it("fits its budget, resolves offline guide pointers and names the pinned runtime", async () => {
    expect(live.bytes).toBeLessThanOrEqual(GUIDE_BYTE_BUDGET);
    expect(live.text.match(/docs\/[\w./-]+\.md/g) ?? []).toEqual([]);
    const pointers = [
      ...new Set(
        [...live.text.matchAll(/`thermite guide ([a-z-]+)`/g)].map(
          (m) => m[1]!,
        ),
      ),
    ];
    expect(pointers.length).toBeGreaterThan(0);
    for (const pointer of pointers) await ok(["guide", pointer], ctx.work);
    const pinned = (await readJson(join(repositoryRoot, "package.json")))
      .packageManager as string;
    expect(live.flat).toContain(`Bun ${pinned.replace(/^bun@/, "")}`);
    expect(live.flat).toContain("`bun <thermite>/thermite.mjs`");
    await expect(stat(entry)).resolves.toBeTruthy();
  });

  it("shows only real commands, agent tools, options and choices, each flag on its own command", () => {
    expect(commandProblems(live)).toEqual([]);
    const mentioned = new Set(
      [...live.text.matchAll(/\bthermite ([a-z][\w-]*)/g)].map((m) => m[1]),
    );
    expect(
      [...ctx.tree.alpha, "validate", "lock", "agent"].filter(
        (c) => !mentioned.has(c),
      ),
      "commands the guide never shows",
    ).toEqual([]);
    const bullets = [...live.text.matchAll(/^- `([a-z-]+)`:/gm)].map(
      (m) => m[1],
    );
    expect(bullets.sort()).toEqual([...ctx.tree.tools.keys()].sort());
    expect(live.flat).toContain(
      `The ${["zero", "one", "two", "three", "four", "five", "six", "seven"][ctx.tree.tools.size]} stateless tools`,
    );
  });

  it("lists exactly the report kinds the CLI accepts", async () => {
    const run = await thermite(["report", "bogus"], ctx.pristine.starter);
    const kinds = /Report kind must be ([^.]+)\./.exec(
      run.stdout + run.stderr,
    )?.[1];
    expect(kinds, describeRun(["report", "bogus"], run)).toBeDefined();
    const reportLine = live.fences
      .flatMap((f) => (f.lang === "sh" ? f.body.split("\n") : []))
      .find((line) => /^thermite report </.test(line));
    const documented = /<([^>]+)>/.exec(reportLine ?? "")?.[1]?.split("|");
    expect(documented?.sort()).toEqual(kinds!.split(", ").sort());
  });

  const concrete = live.spans
    .map((span) => span.text)
    .filter(
      (span, i, all) =>
        span.startsWith("thermite ") &&
        span !== "thermite agent" &&
        !isPlaceholder(span) &&
        !/[[\]]/.test(span) &&
        all.indexOf(span) === i,
    );
  const inlineWords = (span: string) => splitWords(span, true).words.slice(1);

  // Blocks are independent, so they run concurrently; the harness bounds the
  // processes they start.
  it.concurrent.each(
    live.fences.map(
      (fence) => [`${fence.lang} block at line ${fence.line}`, fence] as const,
    ),
  )(
    "executes the %s",
    async (_, fence) => {
      expect(await runFence(fence, live)).toBeGreaterThan(0);
      executedFences.add(fence.index);
    },
    240_000,
  );
  // Inline commands run in document order in one project per template, so a
  // command may rely on an earlier one; each template's chain runs beside the
  // blocks.
  it.concurrent.each(TEMPLATES)(
    "runs the inline commands that apply to %s in document order",
    async (template) => {
      let project: string | undefined;
      for (const span of concrete) {
        if (INLINE_NOT_RUN.has(span)) continue;
        const words = inlineWords(span);
        if (!templatesFor(words).includes(template)) continue;
        project ??= await freshProject(template);
        const line = live.spans.find((s) => s.text === span)!.line;
        await materializeInput(words, project, template, line, live);
        const run = await thermite(words, project);
        if (
          template === "starter" &&
          words.join(" ") === "validate . --strict"
        ) {
          expect(run.code, describeRun(words, run)).toBe(1);
          expect(run.stdout.match(/ W\d{3} /g)).toEqual([" W905 "]);
          expect(run.stderr).toBe("");
        } else {
          expect(run.code, describeRun(words, run)).toBe(0);
          await checkOutput(words, project);
        }
      }
    },
    240_000,
  );
  it("binds every inline command to a template or exempts it with a reason", () => {
    expect(
      concrete.filter(
        (span) =>
          !INLINE_NOT_RUN.has(span) &&
          templatesFor(inlineWords(span)).length === 0,
      ),
      "inline commands that apply to no template",
    ).toEqual([]);
    for (const [span, reason] of INLINE_NOT_RUN)
      expect(reason.trim(), span).not.toBe("");
  });

  it("executed every block and every recipe", () => {
    expect(
      live.fences
        .filter((f) => !executedFences.has(f.index))
        .map((f) => `line ${f.line}`),
    ).toEqual([]);
    expect([...recipes].sort()).toEqual(
      ["integrity", ...[...VERIFIED_BY_BLOCKS.values()].flat()].sort(),
    );
  });

  it("has no stale inline exemptions", () => {
    expect(
      [...INLINE_NOT_RUN.keys()].filter((s) => !concrete.includes(s)),
    ).toEqual([]);
  });
});

describe("documented facts", () => {
  it.concurrent.each(
    FACTS.map(
      (fact) => [`${fact.module}: ${fact.claim.slice(0, 110)}`, fact] as const,
    ),
  )(
    "%s",
    async (_, fact) => {
      expect(live.flat, "claim text is in the guide").toContain(
        flatten(fact.claim),
      );
      await fact.check();
    },
    240_000,
  );
  it("left the pristine and shared projects byte-identical", async () => {
    for (const template of TEMPLATES)
      expect(await hashTree(ctx.pristine[template]), template).toEqual(
        pristineHashes.get(template),
      );
    await sharedProjectsUnchanged();
  });
});

describe("sentence ledger", () => {
  it("checks or classifies every sentence, with whole-sentence claims and no stale entries", () => {
    expect(ledgerProblems(live)).toEqual({
      missingClaims: [],
      unclassified: [],
      stale: [],
      alsoChecked: [],
    });
    for (const [sentence, reason] of UNEXECUTED) {
      expect(reason.trim(), sentence).not.toBe("");
      expect(
        guideCodes(guideModel(sentence)),
        `advice names no code: ${sentence}`,
      ).toEqual([]);
    }
  });
});

describe("observation gates", () => {
  it("produced or pinned every diagnostic code the guide names", async () => {
    expect(guideCodes(live).length).toBeGreaterThan(0);
    expect(await codeProblems(live)).toEqual([]);
  });
  it("observed every documented key, value and identifier", () => {
    expect(vocabularyProblems(live)).toEqual([]);
    expect(
      [...VOCABULARY_EXEMPT.keys()].filter(
        (word) =>
          !live.spans.some((s) => documentedWords(s.text).includes(word)),
      ),
      "stale vocabulary exemptions",
    ).toEqual([]);
  });
});

describe("self-tests: the checks reject broken guides", () => {
  it("runs a packet block's own value, not the guide's first packet", async () => {
    const packet = live.fences.find((f) =>
      f.body.includes('"schematic-packet-request/0.1"'),
    );
    expect(packet, "the guide has a JSON packet block").toBeDefined();
    const broken = mutate(
      packet!.body,
      '{"format":"schematic-packet-request/0.1","views":"BROKEN"}',
    );
    const fence = broken.fences.find((f) => f.body.includes("BROKEN"))!;
    await expect(runFence(fence, broken)).rejects.toThrow(/R006/);
  });

  it("fails a block that applies to no template", async () => {
    const sentence = "and exits 1 when a declared path is not modeled.";
    const broken = mutate(
      sentence,
      `${sentence}\n\n\`\`\`json\n{"format":"continuity-check-request/0.1","checks":[],"note":["PS1","TB1"]}\n\`\`\``,
    );
    const fence = broken.fences.find((f) => f.body.includes('"note"'))!;
    await expect(runFence(fence, broken)).rejects.toThrow(
      /applies to no template/,
    );
  });

  it("checks each flag fragment against its own command", () => {
    const broken = mutate(
      '`--location "HMI console"`',
      '`--name "HMI console"`',
    );
    expect(commandProblems(broken)).toEqual([
      expect.stringMatching(/\(diagnostics\): unknown option --name$/),
    ]);
    const bogus = mutate(
      "thermite packet --input packet.json -o drawings/packet.pdf",
      "thermite packet --input packet.json --bogus -o drawings/packet.pdf",
    );
    expect(commandProblems(bogus)).toEqual([
      expect.stringContaining("unknown option --bogus"),
    ]);
  });

  it("reports a changed diagnostic code as a missing claim and an unclassified sentence", () => {
    const broken = mutate("Unknown keys fail E205.", "Unknown keys fail E206.");
    const problems = ledgerProblems(broken);
    expect(problems.missingClaims).toEqual([
      expect.stringContaining("Unknown keys fail E205."),
    ]);
    expect(problems.unclassified).toContain("Unknown keys fail E206.");
  });

  it("reports an added sentence as unclassified", () => {
    const sentence = "not automatically spare.";
    const broken = mutate(
      sentence,
      `${sentence} Communication relations join nets.`,
    );
    expect(ledgerProblems(broken)).toEqual({
      missingClaims: [],
      unclassified: ["Communication relations join nets."],
      stale: [],
      alsoChecked: [],
    });
  });

  it("fails a shell line whose expected code is wrong", async () => {
    const broken = mutate("# R002:", "# R001:");
    const fence = broken.fences.find((f) => f.body.includes("# R001:"))!;
    await expect(runFence(fence, broken)).rejects.toThrow(/R001/);
  });

  it("fails a block it has no executor for", async () => {
    const broken = mutate("```sh\nthermite packet", "```text\nthermite packet");
    const fence = broken.fences.find((f) => f.lang === "text")!;
    await expect(runFence(fence, broken)).rejects.toThrow(/No executor/);
  });

  it("reports a code no run produces and a field no run observes", async () => {
    const code = mutate(
      "An `exclusive` terminal takes one conductor (E201).",
      "An `exclusive` terminal takes one conductor (E299).",
    );
    expect(await codeProblems(code)).toEqual([expect.stringMatching(/^E299 /)]);
    const field = mutate("`allowedLookup`", "`allowedHint`");
    expect(vocabularyProblems(field)).toEqual([
      expect.stringMatching(/^allowedHint /),
    ]);
  });
});

describe("self-tests: weakened engine cases fail the claims on them", () => {
  const cases = () => import("./project-guide/engine-cases.js");
  const sourceOf = (test: string) =>
    readFile(join(repositoryRoot, test), "utf8");
  /** `source` with its first `from` replaced; the replacement must apply. */
  const edited = (source: string, from: string, to: string) => {
    expect(source, from).toContain(from);
    return source.replace(from, to);
  };

  it("fails a claim on a row the shared table no longer holds", async () => {
    const { claimProblems, registrationProblems, CONNECTION_FAULTS } =
      await cases();
    // The communication matrix without its "verb" row.
    const without = {
      ...CONNECTION_FAULTS,
      rows: CONNECTION_FAULTS.rows.filter((row) => row !== "verb"),
    };
    expect(await claimProblems(without, { verb: "E204" })).toEqual([
      'CONNECTION_REJECTIONS has 0 "verb" rows; the guide claims one',
    ]);
    // The engine test iterating its own rows instead of the shared table.
    const own = edited(
      await sourceOf(CONNECTION_FAULTS.test),
      "it.each(CONNECTION_REJECTIONS)(",
      'it.each(["missing-port", "medium"])(',
    );
    expect(registrationProblems(CONNECTION_FAULTS, own)).toEqual([
      `${CONNECTION_FAULTS.test} uses CONNECTION_REJECTIONS 0 times besides its import; only its registration may`,
      `${CONNECTION_FAULTS.test} registers CONNECTION_REJECTIONS 0 times, not once`,
    ]);
  });

  it("fails a forced or undeclared skip of delegated cases", async () => {
    const { declarationProblems, registrationProblems, HELD_SIGNALS } =
      await cases();
    const source = await sourceOf(HELD_SIGNALS.test);
    expect(registrationProblems(HELD_SIGNALS, source)).toEqual([]);
    const declared =
      "it.skipIf(POSIX_SIGNALS_UNAVAILABLE).each(RESERVATION_SIGNALS)(";
    const forced = (to: string) => edited(source, declared, to);
    const weakened: [string, string][] = [
      ["forced skipIf", forced("it.skipIf(true).each(RESERVATION_SIGNALS)(")],
      [
        "widened skipIf",
        forced(
          "it.skipIf(POSIX_SIGNALS_UNAVAILABLE || true).each(RESERVATION_SIGNALS)(",
        ),
      ],
      ["skip", forced("it.skip.each(RESERVATION_SIGNALS)(")],
      ["only elsewhere", edited(source, '  it("', '  it.only("')],
      ["skipped describe", edited(source, 'describe("', 'describe.skip("')],
      [
        "conditional describe",
        edited(source, 'describe("', 'describe.skipIf(true)("'),
      ],
      ["todo describe", edited(source, 'describe("', 'describe.todo("')],
      [
        "runtime skip",
        edited(
          source,
          "async (signal) => {",
          "async (signal, { skip }) => {\n      skip();",
        ),
      ],
      [
        "shadowed constant",
        forced(`const POSIX_SIGNALS_UNAVAILABLE = true;\n  ${declared}`),
      ],
    ];
    for (const [name, text] of weakened)
      expect(registrationProblems(HELD_SIGNALS, text), name).not.toEqual([]);
    // Another test skipping on its own condition leaves the cases running.
    expect(
      registrationProblems(
        HELD_SIGNALS,
        edited(source, '  it("', '  it.skipIf(true)("'),
      ),
    ).toEqual([]);
    // The case module's constant forced on, off its platform condition, or
    // declared as another platform condition that matches this one.
    const skip = HELD_SIGNALS.skip!;
    const declaring = await sourceOf(skip.declaredIn);
    expect(declarationProblems(skip, declaring)).toEqual([]);
    for (const condition of ["true", 'process.platform !== "darwin"'])
      expect(
        declarationProblems(
          skip,
          edited(
            declaring,
            'POSIX_SIGNALS_UNAVAILABLE = process.platform === "win32"',
            `POSIX_SIGNALS_UNAVAILABLE = ${condition}`,
          ),
        ),
        condition,
      ).toEqual([
        `${skip.declaredIn} does not declare exactly export const POSIX_SIGNALS_UNAVAILABLE = process.platform === "win32";`,
      ]);
    expect(
      registrationProblems(
        { ...HELD_SIGNALS, skip: { ...skip, value: !skip.when } },
        source,
      ),
    ).toEqual([
      `POSIX_SIGNALS_UNAVAILABLE is ${!skip.when}, but its declared platform condition is ${skip.when}`,
    ]);
  });

  it("fails a claimed row whose execution no longer shows the claim", async () => {
    const { claimProblems, LOOP_FAULTS } = await cases();
    const { renderLoopRejection } = await import("./signal-loop.cases.js");
    // The suite asserts each row's outcome itself, so whatever the engine
    // test asserts, a case that no longer applies its fault fails here.
    const unfaulted = {
      ...LOOP_FAULTS,
      run: async () =>
        (await renderLoopRejection("none" as never))
          .map((r) => (r.ok ? "rendered" : r.error.code))
          .join(", "),
    };
    expect(await claimProblems(unfaulted, { branch: "R006, R006" })).toEqual([
      'LOOP_REJECTIONS "branch" gave "rendered, rendered"; the guide states "R006, R006"',
    ]);
    const silent = { ...LOOP_FAULTS, run: async () => "" };
    expect(await claimProblems(silent, { branch: "R006, R006" })).toEqual([
      'LOOP_REJECTIONS "branch" gave ""; the guide states "R006, R006"',
    ]);
  });
});

describe("self-tests: clone diagnostics remain exact", () => {
  it.each(["W111", "W303", "W904"])(
    "rejects an added %s on the actual site-clone fixture",
    async (code) => {
      const project = await copyProject(await viewRoots(), `clone-${code}`);
      const { randomUUID } = await import("node:crypto");
      if (code === "W111") {
        const limit = (
          await readJson(
            join(project, "libraries/core/types/limit-switch-2wire.json"),
          )
        ).types[0];
        await editJson(join(project, "site/types/clones.json"), (f) =>
          f.types.push({
            ...limit,
            id: "site:switch-bad",
            symbol: "thermite:motor-3ph",
          }),
        );
        await editJson(join(project, "devices/equipment.json"), (f) =>
          f.objects.push({
            uid: randomUUID(),
            kind: "device",
            designation: "LS5",
            type: "site:switch-bad",
          }),
        );
      } else if (code === "W904") {
        await editJson(join(project, "site/types/clones.json"), (f) => {
          const limit = f.types.find(
            (t: any) => t.id === "site:limit-switch-2wire",
          );
          limit.connectionCoverage = {
            status: "partial",
            notes: "Synthetic incomplete-interface mutation.",
          };
        });
      } else {
        const equipment = await readJson(
          join(project, "devices/equipment.json"),
        );
        const source = equipment.objects.find(
          (o: any) => o.type === "core:supply-480v-3ph",
        );
        await editJson(join(project, "connections/control-power.json"), (f) =>
          f.objects.push({
            uid: randomUUID(),
            kind: "wire",
            designation: "W-MUTATION-480",
            endpoints: [
              { device: source.designation, terminal: "L1" },
              { device: "PLC1", terminal: "X1.0" },
            ],
          }),
        );
      }
      await ok(["lock", "."], project);
      await expect(assertCloneWarnings(project)).rejects.toThrow(code);
    },
  );
});
