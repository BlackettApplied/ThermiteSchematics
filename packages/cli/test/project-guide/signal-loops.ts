// Field-device hookup pages. Every case draws a signal-loop packet view of the
// visible signal-loop fixture (PT1 -> cordset CB1 -> bulkhead XP1 -> feed-through
// XT1 -> AI1 ch0) or the analog-output fixture (AQ1 ch3 -> XT1 -> XP1 -> V1
// command, with an auxiliary XT1 aux1 -> V1 supply pair), each built from the
// opt-in field-interfaces and industrial-pilot libraries.
//
// Each fixture is built, locked and validated once and shared; a variant is a
// copy with one source edit. Renders that several facts read run once. Further
// request refusals a sentence lists render in this worker through the packet
// command's renderer (`refusedHere`); the source-fault matrices that
// signal-loop.test.ts and analog-output.test.ts iterate run here from their
// shared case tables (engine-cases.ts).
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { expect } from "vitest";
import { flatten } from "./guide-model.js";
import {
  ctx,
  describeRun,
  editJson,
  freshProject,
  lockAndValidate,
  makeProject,
  ok,
  once,
  packet,
  readJson,
  rejected,
  repositoryRoot,
  sharedProject,
  type FactModule,
  type Run,
} from "./harness.js";

// ---------------------------------------------------------------------------
// The guide's literal request values

const FROM = { device: "PT1", function: "signal" };
const TO = { device: "AI1", function: "ch0" };
const ASSEMBLY = {
  cable: "CB1",
  connector: "M12",
  description: "4-pole molded cordset (proposed)",
};
const ENCLOSURE = {
  label: "Main cabinet",
  devices: ["XP1", "XT1", "AI1"],
  wallDevice: "XP1",
};
const AUXILIARY = {
  from: { device: "XT1", function: "aux1" },
  to: { device: "V1", function: "supply" },
};
const INVALID = "Invalid signal loop request";
/** Engine fixtures and shared case tables, loaded once a check needs them. */
const engine = () => import("./engine-cases.js");
/** `refused`, rendered in this worker; for further forms beside a CLI run. */
async function refusedHere(project: string, request: unknown, message: string) {
  expect(await (await engine()).refusedHere(project, request)).toContain(
    message,
  );
}

const loopView = (extra: Record<string, unknown> = {}) => ({
  format: "signal-loop-view-request/0.1",
  from: FROM,
  to: TO,
  ...extra,
});
const sheet = (view: unknown, orientation = "landscape") => ({
  format: "schematic-packet-request/0.1",
  page: { size: "tabloid", orientation },
  views: [view],
});
// Five short notes and one of 240 characters, the longest accepted.
const LONG_NOTE = "Proposed pin map; verify hardware. ".repeat(7).slice(0, 240);
const NOTES = ["Note 1", "Note 2", "Note 3", "Note 4", "Note 5", LONG_NOTE];
// A cabinet group with no wall device, entirely inside the boundary.
const INTERIOR = { label: "Main cabinet", devices: ["XT1", "AI1"] };

const PLAIN = sheet(loopView());
const VERTICAL = sheet(loopView({ flow: "top-to-bottom" }), "portrait");
// Every optional field the plain loop accepts, in one horizontal drawing.
const OPTIONS = sheet(
  loopView({ flow: "left-to-right", notes: NOTES, enclosures: [INTERIOR] }),
);
const GROUPED = sheet(
  loopView({ cableAssemblies: [ASSEMBLY], enclosures: [ENCLOSURE] }),
);

// ---------------------------------------------------------------------------
// Shared projects

type Base = "signal-loop" | "analog-output";
const LIBRARIES = ["field-interfaces", "industrial-pilot"];
// The analog base also marks its unfinished feed terminals in the source.
const FEED_DESCRIPTION = "24 V feed TBD; upstream supply not designed";
interface Built {
  readonly project: string;
  readonly validation: Run;
}
function base(fixture: Base): Promise<Built> {
  return once(`signal-loops:base:${fixture}`, async () => {
    let validation: Run | undefined;
    const project = await sharedProject(
      `signal-loops:${fixture}`,
      async (p) => {
        const dir = `packages/cli/fixtures/${fixture}`;
        const made = await makeProject({
          name: fixture,
          copy: {
            ...Object.fromEntries(LIBRARIES.map((n) => [n, `libraries/${n}`])),
            "source.json": `${dir}/source.json`,
            ...(fixture === "analog-output"
              ? { "packet.request.json": `${dir}/packet.request.json` }
              : {}),
          },
          json: {
            "system.json": {
              format: "electrical-system/0.1",
              project: { name: fixture },
              sources: ["source.json"],
              libraries: LIBRARIES.map((name) => ({
                name,
                version: "0.1.0",
                path: name,
              })),
            },
          },
        });
        if (fixture === "analog-output")
          await editJson(join(made, "source.json"), (s) => {
            object(s, "XT1").description = FEED_DESCRIPTION;
          });
        await cp(made, p, { recursive: true });
        validation = await lockAndValidate(p);
      },
    );
    return { project, validation: validation! };
  });
}
const loop = () => base("signal-loop");
const analog = () => base("analog-output");
/**
 * A shared copy of a base with one source edit. The copied lock still
 * matches because libraries are unchanged; every packet compiles the source,
 * so an R006 rather than a compile error shows the edited source is valid.
 */
function variant(
  name: string,
  from: Base,
  edit: (source: any) => void,
): Promise<string> {
  return sharedProject(`signal-loops:${name}`, async (p) => {
    await cp((await base(from)).project, p, { recursive: true });
    await editJson(join(p, "source.json"), edit);
  });
}

const cable = (source: any) =>
  source.objects.find((o: any) => o.kind === "cable");
const object = (source: any, designation: string) =>
  source.objects.find((o: any) => o.designation === designation);
const wire = (a: string, at: string, b: string, bt: string) => ({
  kind: "wire",
  uid: randomUUID(),
  designation: "EXTRA",
  endpoints: [
    { device: a, terminal: at },
    { device: b, terminal: bt },
  ],
});
const looseCore = () =>
  variant("loose-core", "signal-loop", (s) => {
    cable(s).conductors[3].endpoints[1] = null;
  });
// An extra wire from a spare bulkhead pin is an onward branch the loop would hide.
const hiddenBranch = () =>
  variant("hidden-branch", "signal-loop", (s) => {
    s.objects.push(wire("XP1", "3", "XT1", "5"));
  });
// A legacy assignment without usage is not explicitly spare.
const unspecifiedCore = () =>
  variant("unspecified-core", "signal-loop", (s) => {
    delete cable(s).conductors[3].usage;
  });
const uidOf = async (project: string, designation: string) =>
  object(await readJson(join(project, "source.json")), designation).uid;
const analogRequest = async () =>
  readJson(join((await analog()).project, "packet.request.json"));

// ---------------------------------------------------------------------------
// Drawings

interface Drawing {
  readonly json: any;
  readonly document: Document;
  readonly text: readonly string[];
  /**
   * Visible text in drawing order, whitespace collapsed (a wrapped line keeps
   * its break's space); core detail inside <desc> is excluded.
   */
  readonly visible: string;
  readonly references: readonly string[];
}
async function drawn(project: string, request: unknown): Promise<Drawing> {
  const run = await packet(project, request);
  expect(run.code, describeRun(run.args, run)).toBe(0);
  const svg = run.json.sheets.map((s: any) => s.svg).join("\n");
  const { document } = parseHTML(svg);
  const text = [...document.querySelectorAll("text")].map(
    (t) => t.textContent ?? "",
  );
  return {
    json: run.json,
    document,
    text,
    visible: text.join(" ").replace(/\s+/g, " "),
    references: run.json.sheets[0].references.map((r: any) => r.designation),
  };
}
/** The packet's R006 (unprintable layout) error; any other outcome fails. */
async function refusal(project: string, request: unknown) {
  const run = await packet(project, request);
  expect(run.code, describeRun(run.args, run)).toBe(1);
  const { error } = JSON.parse(run.stderr);
  expect(error, describeRun(run.args, run)).toMatchObject({ code: "R006" });
  return error.message as string;
}
async function refused(project: string, request: unknown, message: string) {
  expect(await refusal(project, request)).toContain(message);
}
/** One render or refusal shared by every fact that reads it. */
const shared = {
  plain: () =>
    once("signal-loops:plain", async () =>
      drawn((await loop()).project, PLAIN),
    ),
  vertical: () =>
    once("signal-loops:vertical", async () =>
      drawn((await loop()).project, VERTICAL),
    ),
  options: () =>
    once("signal-loops:options", async () =>
      drawn((await loop()).project, OPTIONS),
    ),
  grouped: () =>
    once("signal-loops:grouped", async () =>
      drawn((await loop()).project, GROUPED),
    ),
  analog: () =>
    once("signal-loops:analog", async () =>
      drawn((await analog()).project, await analogRequest()),
    ),
  looseCore: () =>
    once("signal-loops:loose-core", async () =>
      refusal(await looseCore(), PLAIN),
    ),
  unspecifiedCore: () =>
    once("signal-loops:unspecified-core", async () =>
      refusal(await unspecifiedCore(), PLAIN),
    ),
  // Grouped, so the same run shows an assembly does not hide the branch.
  hiddenBranch: () =>
    once("signal-loops:hidden-branch", async () =>
      refusal(await hiddenBranch(), GROUPED),
    ),
};
const cores = (jacket: Element) =>
  JSON.parse(jacket.querySelector("desc")!.textContent!) as {
    id: string;
    net: string;
    spare: boolean;
  }[];

// ---------------------------------------------------------------------------
// Facts

const module: FactModule = {
  facts: [
    {
      claim:
        'A packet can include `signal-loop-view-request/0.1` with `from: {device: "PT1", function: "signal"}`, `to: {device: "AI1", function: "ch0"}`, optional `flow` and up to six short `notes`: a two-wire transmitter, authored cordset, continuous bulkhead contacts, optional feed-through terminals and the input channel.',
      async check() {
        const { project } = await loop();
        // Flow is optional; a vertical four-device chain fits portrait paper.
        const [plain, vertical, options] = await Promise.all([
          shared.plain(),
          shared.vertical(),
          shared.options(),
        ]);
        for (const d of [plain, vertical, options]) {
          expect(d.json.sheets).toHaveLength(1);
          expect(d.json.sheets[0].view).toMatchObject({
            kind: "signal-loop",
            title: "PT1 - signal loop",
          });
          expect(d.references).toEqual(["PT1", "XP1", "XT1", "AI1"]);
        }
        expect(
          plain.json.sheets[0].references.map((r: any) => r.functions),
        ).toEqual([["signal"], [], [], ["ch0"]]);
        // Short notes print as single lines; the 240-character one wraps.
        for (const note of NOTES.slice(0, 5))
          expect(options.text).toContain(note);
        expect(options.visible).toContain(LONG_NOTE);
        const direct = variant("no-feed-through", "signal-loop", (s) => {
          object(s, "W1").endpoints[1] = { device: "AI1", terminal: "9" };
          object(s, "W3").endpoints[1] = { device: "AI1", terminal: "13" };
          s.objects = s.objects.filter(
            (o: any) => !["W2", "W4"].includes(o.designation),
          );
        });
        await Promise.all([
          refused(
            project,
            sheet(loopView({ notes: [...NOTES, "Note 7"] })),
            INVALID,
          ),
          // Reversed, the source is an input channel, not a transmitter.
          refused(
            project,
            sheet(loopView({ from: TO, to: FROM })),
            "Signal loop views require a two-wire transmitter to an input channel",
          ),
          (async () =>
            expect((await drawn(await direct, PLAIN)).references).toEqual([
              "PT1",
              "XP1",
              "AI1",
            ]))(),
          // An unknown flow and a 241-character note.
          refusedHere(project, sheet(loopView({ flow: "up" })), INVALID),
          refusedHere(
            project,
            sheet(loopView({ notes: [`${LONG_NOTE}W`] })),
            INVALID,
          ),
        ]);
      },
    },
    {
      claim:
        "The opt-in `field-interfaces` library supplies proposed generic M12 profiles.",
      async check() {
        for (const template of ["starter", "cabinets"] as const) {
          const project = ctx.pristine[template];
          const manifest = await readJson(join(project, "system.json"));
          expect(manifest.libraries.map((l: any) => l.name)).toEqual(["core"]);
          expect(existsSync(join(project, "libraries/field-interfaces"))).toBe(
            false,
          );
        }
        const starter = await freshProject("starter");
        const manifest = await readJson(join(starter, "system.json"));
        const sources = await Promise.all(
          manifest.sources.map(async (s: string) => ({
            path: s,
            objects: (await readJson(join(starter, s))).objects,
          })),
        );
        const devices = sources.find((s) =>
          s.objects.some((o: any) => o.kind === "device"),
        )!.path;
        await editJson(join(starter, devices), (f) =>
          f.objects.push({
            kind: "device",
            uid: randomUUID(),
            designation: "XP1",
            type: "field-interfaces:m12-a4-bulkhead",
          }),
        );
        await rejected(
          ["validate", "."],
          starter,
          "E103",
          'references unknown type "field-interfaces:m12-a4-bulkhead"',
        );
        const { validation } = await loop();
        expect(validation.stdout + validation.stderr).toContain(
          "W904 PT1: Incomplete connection model: Proposed four-pin loop-powered interface",
        );
        // The transmitter's caption is its library type description.
        expect((await shared.plain()).visible).toContain(
          "4-20 mA / M12 A-coded / proposed pin map",
        );
      },
    },
    {
      claim: "See `thermite guide signal-loops` for limits and fixtures.",
      async check() {
        const doc = flatten(
          await readFile(join(repositoryRoot, "docs/signal-loops.md"), "utf8"),
        );
        expect(doc).toContain(
          "Notes allow at most six nonempty strings, each at most 240 characters.",
        );
        expect(doc).toContain(
          "At most seven cable assembly options and four enclosure groups may be supplied.",
        );
        for (const path of [
          "packages/cli/fixtures/signal-loop/source.json",
          "packages/cli/fixtures/analog-output/source.json",
          "packages/cli/fixtures/analog-output/packet.request.json",
        ]) {
          expect(doc).toContain(`(../${path})`);
          expect(existsSync(join(repositoryRoot, path)), path).toBe(true);
        }
      },
    },
    {
      claim:
        "Both paths must be complete and unbranched, with every traversed cable core represented; extra cores must be explicitly spare and terminated at both ends.",
      async check() {
        expect(await shared.unspecifiedCore()).toContain(
          "A cable has an additional active core outside this two-wire loop",
        );
        expect(await shared.looseCore()).toContain(
          "Cable CB1 has unassigned or loose cores",
        );
        // Incomplete, branched and unassigned-core sources, and an active
        // extra core, each fail R006 plain and grouped on the engine fixture.
        const { claimed, LOOP_FAULTS } = await engine();
        await claimed(LOOP_FAULTS, {
          "missing-wire": "R006, R006",
          branch: "R006, R006",
          "unassigned-core": "R006, R006",
          "extra-active": "R006, R006",
        });
      },
    },
    {
      claim:
        "Loose cores, active cores outside explicit auxiliary pairs or hidden branches fail R006: inspect them in a conductor view, and never change connectivity just to obtain a drawing.",
      async check() {
        const [loose, active, branch] = await Promise.all([
          shared.looseCore(),
          shared.unspecifiedCore(),
          shared.hiddenBranch(),
        ]);
        expect(loose).toContain(
          "Cable CB1 has unassigned or loose cores; use its conductor view",
        );
        expect(active).toContain(
          "A cable has an additional active core outside this two-wire loop",
        );
        expect(branch).toContain(
          "A shown terminal has an additional connection outside the selected loop",
        );
        // An active power core without its auxiliary pair also fails there.
        const { claimed, OUTPUT_FAULTS } = await engine();
        await claimed(OUTPUT_FAULTS, { "omitted-power": "R006" });
        const view = JSON.parse(
          (
            await ok(
              ["view", "CB1", "--conductors", "--json"],
              await looseCore(),
            )
          ).stdout,
        );
        expect(view.sheets[0].view).toMatchObject({ intent: "conductors" });
        const { document } = parseHTML(view.sheets[0].svg);
        const text = [...document.querySelectorAll("text")].map(
          (t) => t.textContent,
        );
        for (const label of [
          "4 cores / 2 spare / 0 unassigned",
          "D / Black",
          "X UNTERMINATED",
        ])
          expect(text).toContain(label);
      },
    },
    {
      claim:
        "A bulkhead pin is one continuous terminal with front/rear access, not a function that shorts contacts.",
      async check() {
        const { project } = await loop();
        const [inspected, d] = await Promise.all([
          ok(["inspect", "XP1", "--json"], project),
          shared.plain(),
        ]);
        const xp1 = JSON.parse(inspected.stdout).object;
        expect(xp1.functions).toEqual([]);
        expect(new Set(xp1.terminals.map((t: any) => t.net.id)).size).toBe(4);
        // The field core and the cabinet wire land on the same terminal.
        expect(
          xp1.terminals[0].elements.map((e: any) => e.display).sort(),
        ).toEqual(["CB1.A", "W1"]);
        const body = d.document.querySelector(
          `[data-device-uid="${xp1.uid}"]`,
        )!;
        const labels = [...body.querySelectorAll("text")].map(
          (t) => t.textContent,
        );
        // Active pins 1 and 2 show both faces joined by one contact line; the
        // spare pins 3 and 4 end at the bulkhead and show an unused rear face.
        expect(body.querySelectorAll("circle")).toHaveLength(6);
        expect(body.querySelectorAll("path")).toHaveLength(2);
        for (const [label, n] of [
          ["1", 2],
          ["2", 2],
          ["3", 1],
          ["4", 1],
          ["unused", 2],
        ] as const)
          expect(
            labels.filter((l) => l === label),
            label,
          ).toHaveLength(n);
      },
    },
    {
      claim:
        "Numbered symbols are not connector face views; sensor/cordset pin assignments remain subject to part review.",
      async check() {
        const [{ validation }, d] = await Promise.all([loop(), shared.plain()]);
        expect(d.visible).toContain(
          "connector contact numbers are not a mating-face view",
        );
        expect(d.text).toContain(
          "Field-device hookup - verify selected connector pinout before construction",
        );
        expect(validation.stdout + validation.stderr).toContain(
          "W904 PT1: Incomplete connection model: Proposed four-pin loop-powered interface. Exact transmitter, connector pinout and any grounding requirements remain to be selected and verified.",
        );
      },
    },
    {
      claim:
        'For a molded cordset overview, add `cableAssemblies: [{cable: "CB1", connector: "M12", description: "4-pole molded cordset (proposed)"}]`: one jacket line with connector ends and the actual pin map, never merging nets.',
      async check() {
        const d = await shared.grouped();
        const jackets = d.document.querySelectorAll("[data-cable-assembly]");
        expect(jackets).toHaveLength(1);
        const jacket = jackets[0]!;
        expect(jacket.querySelectorAll("path")).toHaveLength(1);
        expect(jacket.hasAttribute("data-net-id")).toBe(false);
        const members = cores(jacket);
        expect(members.map((c) => JSON.parse(c.id).conductorId)).toEqual([
          "A",
          "B",
          "C",
          "D",
        ]);
        expect(new Set(members.map((c) => c.net)).size).toBe(4);
        expect(members.filter((c) => c.spare)).toHaveLength(2);
        expect(
          d.document.querySelectorAll('[data-connector-interface="assembly"]'),
        ).toHaveLength(2);
        expect(
          d.document.querySelectorAll("[data-loop-conductor]"),
        ).toHaveLength(4);
        for (const text of [
          "4 cores / pin map:",
          "1-1, 2-2, 3-3 spare, 4-4 spare",
          "Heavy line = cable assembly, not a shared electrical net.",
        ])
          expect(d.visible).toContain(text);
        // A non-straight map is printed as authored.
        const crossed = await variant("crossed-pins", "signal-loop", (s) => {
          cable(s).conductors[2].endpoints[1].terminal = "4";
          cable(s).conductors[3].endpoints[1].terminal = "3";
        });
        const drawing = await (await engine()).renderHere(crossed, GROUPED);
        expect(drawing.ok).toBe(true);
        if (drawing.ok)
          expect(drawing.value.sheets[0]!.svg).toContain(
            "1-1, 2-2, 3-4 spare, 4-3 spare",
          );
      },
    },
    {
      claim: "Omit it for core/color detail.",
      async check() {
        const [plain, grouped] = await Promise.all([
          shared.plain(),
          shared.grouped(),
        ]);
        expect(
          plain.document.querySelectorAll("[data-cable-assembly]"),
        ).toHaveLength(0);
        expect(
          plain.document.querySelectorAll("[data-loop-conductor]"),
        ).toHaveLength(8);
        for (const label of ["CB1/A", "Brown", "Black / spare"])
          expect(plain.text).toContain(label);
        expect(grouped.visible).not.toContain("Brown");
      },
    },
    {
      claim:
        "Descriptions are presentation claims, not manufacturer facts; loose or hidden branched cores still fail.",
      async check() {
        const [grouped, branch] = await Promise.all([
          shared.grouped(),
          shared.hiddenBranch(),
        ]);
        expect(grouped.visible).toContain(ASSEMBLY.description);
        expect(branch).toContain(
          "A shown terminal has an additional connection outside the selected loop",
        );
        // Loose cores fail with an assembly too, and descriptions are bounded
        // at 120 characters.
        await Promise.all([
          (async () =>
            refusedHere(
              await looseCore(),
              GROUPED,
              "Cable CB1 has unassigned or loose cores",
            ))(),
          refusedHere(
            (await loop()).project,
            sheet(
              loopView({
                cableAssemblies: [
                  { ...ASSEMBLY, description: "x".repeat(121) },
                ],
                enclosures: [ENCLOSURE],
              }),
            ),
            INVALID,
          ),
        ]);
      },
    },
    {
      claim:
        '`enclosures: [{label: "Main cabinet", devices: ["XP1", "XT1", "AI1"], wallDevice: "XP1"}]` draws location boundaries.',
      async check() {
        const [{ project }, d] = await Promise.all([loop(), shared.grouped()]);
        const uids = await Promise.all(
          ENCLOSURE.devices.map((tag) => uidOf(project, tag)),
        );
        const boxes = d.document.querySelectorAll("[data-enclosure]");
        expect(boxes).toHaveLength(1);
        const box = boxes[0]!;
        expect(box.getAttribute("data-enclosure")).toBe("Main cabinet");
        expect(JSON.parse(box.getAttribute("data-member-uids")!)).toEqual(uids);
        expect(box.getAttribute("data-wall-device-uid")).toBe(uids[0]);
        expect(box.querySelector("rect")).not.toBeNull();
        expect(box.querySelector("text")!.textContent).toBe("Main cabinet");
      },
    },
    {
      claim:
        "Membership must be explicit, unique and contiguous in the chain; location strings never imply it.",
      async check() {
        const { project } = await loop();
        const [plain, source] = await Promise.all([
          shared.plain(),
          readJson(join(project, "source.json")),
          refused(
            project,
            sheet(
              loopView({
                enclosures: [{ ...ENCLOSURE, devices: ["XP1", "AI1"] }],
              }),
            ),
            "Enclosure devices must form a contiguous section of the signal chain",
          ),
          // Unknown, repeated and overlapping members.
          refusedHere(
            project,
            sheet(
              loopView({
                enclosures: [
                  { ...ENCLOSURE, devices: ["XP1", "XT1", "missing"] },
                ],
              }),
            ),
            'Enclosure device "missing" is not uniquely present in this view.',
          ),
          refusedHere(
            project,
            sheet(
              loopView({
                enclosures: [
                  { ...ENCLOSURE, devices: ["XP1", "XT1", "XT1", "AI1"] },
                ],
              }),
            ),
            "Enclosures need unique names and disjoint device membership.",
          ),
          refusedHere(
            project,
            sheet(
              loopView({
                enclosures: [ENCLOSURE, { label: "Second", devices: ["AI1"] }],
              }),
            ),
            "Enclosures need unique names and disjoint device membership.",
          ),
        ]);
        // XT1 and AI1 share a location string, yet no boundary is drawn.
        expect(object(source, "XT1").location).toBe(
          object(source, "AI1").location,
        );
        expect(
          plain.document.querySelectorAll("[data-enclosure]"),
        ).toHaveLength(0);
      },
    },
    {
      claim:
        "The optional wall device must be the first or last member, have a bulkhead profile and accompany interior devices.",
      async check() {
        const [{ project }, inside, exit, output] = await Promise.all([
          loop(),
          shared.options(),
          shared.analog(),
          analog(),
        ]);
        await Promise.all([
          // First member, but a terminal strip rather than a bulkhead.
          refused(
            project,
            sheet(
              loopView({
                enclosures: [{ ...INTERIOR, wallDevice: "XT1" }],
              }),
            ),
            "A wall device must be the first or last member and declare a bulkhead-connector profile, alongside interior devices",
          ),
          // A middle or non-member wall device and a lone wall device.
          ...[
            { ...ENCLOSURE, wallDevice: "XT1" },
            { ...ENCLOSURE, wallDevice: "PT1" },
            { ...ENCLOSURE, devices: ["XP1"] },
          ].map((enclosure) =>
            refusedHere(
              project,
              sheet(loopView({ enclosures: [enclosure] })),
              "A wall device must be the first or last member and declare a bulkhead-connector profile, alongside interior devices",
            ),
          ),
        ]);
        const insideBox = inside.document.querySelector("[data-enclosure]")!;
        expect(insideBox.getAttribute("data-enclosure")).toBe("Main cabinet");
        expect(insideBox.hasAttribute("data-wall-device-uid")).toBe(false);
        // The analog fixture's cabinet group ends at its wall device XP1.
        const exitBox = exit.document.querySelector("[data-enclosure]")!;
        const xp1 = await uidOf(output.project, "XP1");
        expect(exitBox.getAttribute("data-wall-device-uid")).toBe(xp1);
        expect(
          JSON.parse(exitBox.getAttribute("data-member-uids")!).at(-1),
        ).toBe(xp1);
      },
    },
    {
      claim:
        "For a powered analog actuator, `from` may be a two-terminal output channel and `to` a two-terminal function on a `thermite:analog-actuator` profile.",
      async check() {
        const [output, request, d] = await Promise.all([
          analog(),
          analogRequest(),
          shared.analog(),
        ]);
        expect(request.views[0]).toMatchObject({
          from: { device: "AQ1", function: "ch3" },
          to: { device: "V1", function: "command" },
        });
        const [aq4, valves] = await Promise.all([
          readJson(
            join(
              output.project,
              "industrial-pilot/types/siemens-aq4ui-st-2wire.json",
            ),
          ),
          readJson(join(output.project, "field-interfaces/types.json")),
        ]);
        const ch3 = aq4.types[0].functions.ch3;
        expect(ch3).toMatchObject({ kind: "channel", direction: "output" });
        expect(ch3.terminals).toHaveLength(2);
        const valve = "field-interfaces:ram-valve-m12-proposed";
        expect(valves.types.find((t: any) => t.id === valve).symbol).toBe(
          "thermite:analog-actuator",
        );
        expect(d.json.sheets[0].view).toMatchObject({
          kind: "signal-loop",
          title: "V1 - analog output",
        });
        expect(d.references).toEqual(["AQ1", "XT1", "XP1", "V1"]);
        expect(d.visible).toContain("ch3 / selected channel");
        // Only the library can make V1's command a one-terminal function.
        const oneTerminal = sharedProject(
          "signal-loops:one-terminal-command",
          async (p) => {
            await cp(output.project, p, { recursive: true });
            await editJson(join(p, "field-interfaces/types.json"), (t) => {
              t.types.find(
                (x: any) => x.id === valve,
              ).functions.command.terminals = ["2"];
            });
            await ok(["lock", "."], p);
          },
        );
        const minimal = (from: unknown, to: unknown) =>
          sheet({ format: "signal-loop-view-request/0.1", from, to });
        const ch3Out = { device: "AQ1", function: "ch3" };
        const notActuator =
          "Signal loop views require a two-wire transmitter to an input channel, or an output channel to an analog-actuator profile";
        await Promise.all([
          // A two-terminal function on a terminal-strip profile is no actuator.
          refused(
            output.project,
            minimal(ch3Out, { device: "XT1", function: "aux1" }),
            notActuator,
          ),
          // AQ1 supply is a two-terminal load, not an output channel.
          refused(
            output.project,
            minimal({ device: "AQ1", function: "supply" }, request.views[0].to),
            notActuator,
          ),
          (async () =>
            refused(
              await oneTerminal,
              minimal(ch3Out, request.views[0].to),
              "V1.command must identify a two-terminal function",
            ))(),
        ]);
      },
    },
    {
      claim:
        'Up to two `auxiliary: [{from: {device: "XT1", function: "aux1"}, to: {device: "V1", function: "supply"}}]` pairs show explicit power in the same chain; each must be complete, unbranched, forward in the chain and on separate nets.',
      async check() {
        const [output, request, d] = await Promise.all([
          analog(),
          analogRequest(),
          shared.analog(),
        ]);
        expect(request.views[0].auxiliary).toEqual([AUXILIARY]);
        expect(
          d.json.sheets[0].references.map((r: any) => [
            r.designation,
            r.functions,
          ]),
        ).toEqual([
          ["AQ1", ["ch3"]],
          ["XT1", ["aux1"]],
          ["XP1", []],
          ["V1", ["command", "supply"]],
        ]);
        const withAuxiliary = (auxiliary: unknown[]) => {
          const r = structuredClone(request);
          r.views[0].auxiliary = auxiliary;
          return r;
        };
        await Promise.all([
          // Two identical pairs pass the count limit and fail on shared nets.
          refused(
            output.project,
            withAuxiliary([AUXILIARY, AUXILIARY]),
            "Auxiliary pairs must use distinct nets, separate from the command pair",
          ),
          refused(
            output.project,
            withAuxiliary([AUXILIARY, AUXILIARY, AUXILIARY]),
            INVALID,
          ),
          // Loose, branched, reversed and off-chain pairs, on the engine
          // fixture.
          (async () => {
            const { claimed, OUTPUT_FAULTS } = await engine();
            await claimed(OUTPUT_FAULTS, {
              "duplicate-pair": "R006",
              "reverse-pair": "R006",
              branch: "R006",
              "loose-power": "R006",
              "power-as-spare": "R006",
              "different-chain": "R006",
            });
          })(),
        ]);
      },
    },
    {
      claim: "No supply or command/power commoning is inferred.",
      async check() {
        const [output, d] = await Promise.all([analog(), shared.analog()]);
        const jacket = d.document.querySelector("[data-cable-assembly]")!;
        // V1's four cores (power +/0 V, command +/return) stay on four nets.
        expect(new Set(cores(jacket).map((c) => c.net)).size).toBe(4);
        expect(
          d.document.querySelectorAll("[data-loop-conductor]"),
        ).toHaveLength(6);
        // The output module's own supply stays unconnected rather than implied.
        expect(output.validation.stdout + output.validation.stderr).toContain(
          "W903 AQ1: Required terminal AQ1.L+ has no connection",
        );
      },
    },
    {
      claim:
        "Mark unfinished feeds and provisional pinouts in source descriptions and view notes.",
      async check() {
        const [output, request, d] = await Promise.all([
          analog(),
          analogRequest(),
          shared.analog(),
        ]);
        // The analog base validated with XT1's feed marked in its description.
        const source = await readJson(join(output.project, "source.json"));
        expect(object(source, "XT1").description).toBe(FEED_DESCRIPTION);
        expect(request.views[0].notes.length).toBeGreaterThan(0);
        for (const note of request.views[0].notes)
          expect(d.visible).toContain(note);
        expect(d.visible).toContain("feed TBD");
      },
    },
  ],
  unexecuted: new Map(),
};
export default module;
