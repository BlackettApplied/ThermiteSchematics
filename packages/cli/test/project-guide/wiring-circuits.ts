// Terminal wiring views and function-based circuit drawings. Every case runs
// a packet against one shared cabinets project extended with a few wires, a
// jumper, a single-ended core, a PLC and an overload relay, or against the
// circuit-pagination example. Accepted views are drawn together in one packet
// (one sheet per view) and read by title; each refusal keeps its own run.
import { cp } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { svgTextGeometry } from "../../../render/test/source-isolation.js";
import { join } from "node:path";
import { expect } from "vitest";
import {
  copyProject,
  ctx,
  describeRun,
  editJson,
  makeProject,
  ok,
  once,
  packet,
  parallel,
  readJson,
  rejected,
  sharedProject,
  writeJson,
  type FactModule,
} from "./harness.js";

// ---------------------------------------------------------------------------
// Fixture: cabinets (TB1, TB2, cable CBL1 with cores 1+, 1-, 2+, 2-) plus
// physical wiring chosen so each marker below has exactly one cause.

const W1 = "11111111-1111-4111-8111-111111111111";
const J1 = "22222222-2222-4222-8222-222222222222";
const PLC1 = "66666666-6666-4666-8666-666666666666";
const end = (device: string, terminal: string) => ({ device, terminal });
const CONNECTIONS = {
  objects: [
    // W1 and W2 share the printed label "101" on different nets.
    {
      uid: W1,
      kind: "wire",
      designation: "W1",
      endpoints: [end("TB1", "3"), end("TB2", "3")],
      properties: { label: "101", size: "18AWG", color: "red" },
    },
    {
      uid: J1,
      kind: "jumper",
      designation: "J1",
      endpoints: [end("TB2", "3"), end("TB2", "4")],
    },
    // W2 also lands on TB1.1, so a view of CBL1/1+ alone has one outside
    // connection there.
    {
      uid: "33333333-3333-4333-8333-333333333333",
      kind: "wire",
      designation: "W2",
      endpoints: [end("TB1", "1"), end("TB2", "5")],
      properties: { label: "101" },
    },
    // W3 and W4 meet only through OL1's normally closed pole1.
    {
      uid: "44444444-4444-4444-8444-444444444444",
      kind: "wire",
      designation: "W3",
      endpoints: [end("TB1", "6"), end("OL1", "1/L1")],
    },
    {
      uid: "55555555-5555-4555-8555-555555555555",
      kind: "wire",
      designation: "W4",
      endpoints: [end("OL1", "2/T1"), end("TB2", "6")],
    },
  ],
};
const EXTRA_DEVICES = [
  {
    uid: PLC1,
    kind: "device",
    designation: "PLC1",
    type: "core:plc-compact",
    location: "CONTROL CABINET",
    io: { addressSpace: "PLC1", channels: { do1: { usage: "spare" } } },
  },
  {
    uid: "77777777-7777-4777-8777-777777777777",
    kind: "device",
    designation: "OL1",
    type: "core:overload-3p-1nc",
    location: "CONTROL CABINET",
  },
];
const EQUIPMENT = "devices/equipment.json";
const OVERLOAD = "libraries/core/types/overload-3p-1nc.json";
const MOTOR = "libraries/core/types/motor-3ph.json";

/**
 * The shared, validated base. Core CBL1/2+ is made single-ended (TB1.7 to
 * nothing, still spare), so validation proves it is legal source.
 */
const base = () =>
  sharedProject("wiring:base", async (project) => {
    await cp(ctx.pristine.cabinets, project, { recursive: true });
    await editJson(join(project, EQUIPMENT), (file) => {
      file.objects.push(...EXTRA_DEVICES);
      file.objects.find(
        (o: any) => o.kind === "cable",
      ).conductors[2].endpoints[0] = end("TB1", "7");
    });
    await writeJson(
      join(project, "connections/control-power.json"),
      CONNECTIONS,
    );
    await ok(["validate", "."], project);
  });
/** Template UIDs are random; read them from the shared base. */
const ids = () =>
  once("wiring:ids", async () => {
    const equipment = await readJson(join(await base(), EQUIPMENT));
    const uid = (designation: string): string =>
      equipment.objects.find((o: any) => o.designation === designation).uid;
    return { tb1: uid("TB1"), tb2: uid("TB2"), cable: uid("CBL1") };
  });

// ---------------------------------------------------------------------------
// Requests and SVG markers

const WIRING = "wiring-view-request/0.1";
const CIRCUIT = "circuit-view-request/0.1";
const sheets = (views: unknown[], page?: unknown) => ({
  format: "schematic-packet-request/0.1",
  ...(page ? { page } : {}),
  views,
});
const wiring = (view: Record<string, unknown>, page?: unknown) =>
  sheets([{ format: WIRING, ...view }], page);
const circuit = (view: Record<string, unknown>, page?: unknown) =>
  sheets([{ format: CIRCUIT, ...view }], page);
const fn = (value: string, key: string) => ({
  device: { by: "designation", value },
  key,
});
const unescape = (s: string) =>
  s
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
const texts = (svg: string) =>
  [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => unescape(m[1]!));
/** Conductor designation -> derived net ID, from circuit SVG metadata. */
const nets = (svg: string): Record<string, string> =>
  Object.fromEntries(
    [
      ...svg.matchAll(
        /data-conductor-designation="([^"]*)" data-net-id="([^"]*)"/g,
      ),
    ].map((m) => [m[1]!, m[2]!]),
  );
/** Function key -> the first catalog mark drawn inside its block. */
const marks = (svg: string): Record<string, string | undefined> =>
  Object.fromEntries(
    svg
      .split('data-function-key="')
      .slice(1)
      .map((c) => [
        c.slice(0, c.indexOf('"')),
        c.match(/data-circuit-mark="([^"]*)"/)?.[1],
      ]),
  );
/** Left edge of a device block in a circuit group. */
const left = (svg: string, uid: string) =>
  svg.match(
    new RegExp(
      `data-device-uid="${uid}"[^>]*transform="translate\\(([\\d.]+) `,
    ),
  )?.[1];

interface Sheet {
  readonly title: string;
  readonly svg: string;
  readonly text: readonly string[];
  readonly json: any;
}
interface Drawing {
  readonly json: any;
  readonly svg: string;
  readonly text: readonly string[];
  readonly sheets: readonly Sheet[];
}
/** A successful packet: every sheet's SVG and texts, plus the JSON. */
async function drawn(project: string, req: unknown): Promise<Drawing> {
  const run = await packet(project, req);
  expect(run.code, describeRun(run.args, run)).toBe(0);
  const all: Sheet[] = run.json.sheets.map((s: any) => ({
    title: s.view.title,
    svg: s.svg,
    text: texts(s.svg),
    json: s,
  }));
  return {
    json: run.json,
    svg: all.map((s) => s.svg).join("\n"),
    text: all.flatMap((s) => s.text),
    sheets: all,
  };
}
/** The one sheet a view titled `title` produced. */
function sheet(drawing: Drawing, title: string): Sheet {
  const found = drawing.sheets.filter((s) => s.title === title);
  expect(found, `sheets titled ${title}`).toHaveLength(1);
  return found[0]!;
}
/** A packet refused with R006 carrying `message`. */
async function refused(project: string, req: unknown, message: string) {
  const run = await packet(project, req);
  expect(run.code, describeRun(run.args, run)).toBe(1);
  const { error } = JSON.parse(run.stderr);
  expect(error.code, describeRun(run.args, run)).toBe("R006");
  expect(error.message).toContain(message);
}

const INVALID_WIRING =
  "Invalid wiring view. Select 1-60 unique conductor designations or UIDs, a title and optional notes.";
const INVALID_CIRCUIT =
  "Invalid circuit view: supply a title, 1–200 source-selected groups, optional flow, 1 or 2 columns and notes.";
const INVALID_GROUP =
  "Invalid circuit group: unique id, optional label/lineReference, up to 120 conductors and 1–80 functions are required.";
const DO0 = [{ id: "g", functions: [fn("PLC1", "do0")], conductors: [] }];
const ordered = (title: string, a: string, b: string) => ({
  format: CIRCUIT,
  title,
  groups: [
    {
      id: "g",
      functions: [fn(a, "terminal1"), fn(b, "terminal1")],
      conductors: ["CBL1/1+"],
    },
  ],
});
const OVERLOAD_VIEW = {
  format: CIRCUIT,
  title: "Overload",
  groups: [
    {
      id: "g",
      functions: [fn("OL1", "pole1"), fn("OL1", "aux95")],
      conductors: ["W3", "W4"],
    },
  ],
};

/**
 * Every accepted wiring and circuit view, one sheet each. None of these
 * circuit views selects PLC1 `supply`, so no cross-reference joins them.
 */
const ACCEPTED = sheets([
  {
    format: WIRING,
    title: "Wiring title",
    conductors: ["CBL1/1+", "W1", "J1"],
    notes: ["Wiring note"],
  },
  { format: WIRING, title: "By UID", conductors: [W1, J1] },
  {
    format: WIRING,
    title: "Ordered",
    conductors: ["CBL1/1+"],
    deviceOrder: ["TB2", "TB1"],
  },
  { format: WIRING, title: "Markers", conductors: ["CBL1/1+"] },
  { format: WIRING, title: "Through contact", conductors: ["W3"] },
  { format: WIRING, title: "Wide", conductors: ["W1", "J1"] },
  {
    format: CIRCUIT,
    title: "Circuit title",
    flow: "left-to-right",
    columns: 1,
    notes: ["Circuit note"],
    groups: DO0,
  },
  {
    format: CIRCUIT,
    title: "Vertical",
    flow: "top-to-bottom",
    columns: 2,
    groups: DO0,
  },
  { format: CIRCUIT, title: "Defaults", groups: DO0 },
  {
    format: CIRCUIT,
    title: "Groups",
    groups: [
      {
        id: "grpA",
        label: "Supply",
        lineReference: "300",
        functions: [fn("PLC1", "do0")],
        conductors: [],
      },
      {
        id: "grpB",
        functions: [{ device: { by: "uid", value: PLC1 }, key: "do1" }],
        conductors: [],
      },
    ],
  },
  ordered("Forward", "TB1", "TB2"),
  ordered("Reverse", "TB2", "TB1"),
  OVERLOAD_VIEW,
]);
const accepted = () =>
  once("wiring:accepted", async () => drawn(await base(), ACCEPTED));

/**
 * Three groups whose single drawing carries the empty-list, catalog, label
 * and boundary markers. It stays alone in its packet: cross-references span
 * every circuit view of a packet, and coverage counts the whole packet.
 */
const MULTI = circuit({
  title: "Markers",
  groups: [
    {
      id: "A",
      label: "Supply",
      lineReference: "300",
      functions: [fn("PLC1", "supply")],
      conductors: [],
    },
    {
      id: "B",
      functions: [fn("PLC1", "do0"), fn("PLC1", "do1")],
      conductors: [],
    },
    {
      id: "C",
      functions: [fn("TB1", "terminal3")],
      conductors: ["W1", "W2"],
    },
  ],
});
const multi = () =>
  once("wiring:multi", async () => drawn(await base(), MULTI));

const MAIN_AND_AUX = {
  pole1: "overload",
  pole2: "overload",
  pole3: "overload",
  aux95: "contact-nc",
};
/** The base with explicit overload marks, relocked, drawn once. */
const mapped = () =>
  once("wiring:mapped", async () => {
    const project = await sharedProject("wiring:mapped", async (project) => {
      await cp(await base(), project, { recursive: true });
      await editJson(join(project, OVERLOAD), (file) => {
        file.types[0].circuitSymbols = MAIN_AND_AUX;
      });
      await ok(["lock", "."], project);
    });
    return drawn(project, sheets([OVERLOAD_VIEW]));
  });

const module: FactModule = {
  facts: [
    {
      claim:
        "Tags: designation ≥2.7 mm, instance/else-type description and catalog part ≥2.5 mm.",
      async check() {
        const doc = parseHTML((await multi()).svg).document;
        const texts = [...doc.querySelectorAll("svg")].flatMap((svg) =>
          svgTextGeometry(svg),
        );
        const tags = texts.filter((t) =>
          t.element.hasAttribute("data-tag-field"),
        );
        expect(tags.length).toBeGreaterThan(0);
        for (const t of tags)
          expect(t.em).toBeGreaterThanOrEqual(
            t.element.getAttribute("data-tag-field") === "designation"
              ? 2.7
              : 2.5,
          );
        const owners = new Set(
          tags.map((t) => t.element.getAttribute("data-tag-owner-uid")),
        );
        for (const uid of owners) {
          const fields = tags
            .filter((t) => t.element.getAttribute("data-tag-owner-uid") === uid)
            .map((t) => t.element.getAttribute("data-tag-field"));
          expect(fields).toContain("designation");
          expect(fields).toContain("description");
        }
      },
    },
    {
      claim:
        "Read `thermite guide circuit-symbols` before selecting a disconnector profile.",
      async check() {
        const guide = await ok(["guide", "circuit-symbols"], ctx.work);
        expect(guide.stdout).toContain("thermite:disconnector");
        expect(guide.stdout.replace(/\s+/gu, " ")).toContain(
          "Isolation suitability",
        );
      },
    },
    {
      claim:
        "Packets accept `wiring-view-request/0.1` with `title`, unique `conductors` (wire/jumper tags or UIDs, or cores terminated at both ends such as `CBL1/1+`), optional `notes`, and optional `deviceOrder` listing every included device.",
      async check() {
        const [drawing, { cable }, project] = await Promise.all([
          accepted(),
          ids(),
          base(),
        ]);
        const tagged = sheet(drawing, "Wiring title");
        for (const id of [
          W1,
          J1,
          JSON.stringify({ cableUid: cable, conductorId: "1+" }),
        ])
          expect(tagged.svg).toContain(
            `data-wiring-conductor="${id.replace(/"/g, "&quot;")}"`,
          );
        for (const s of ["W1", "J1", "CBL1/1+", "Wiring title", "Wiring note"])
          expect(tagged.text).toContain(s);
        for (const id of [W1, J1])
          expect(sheet(drawing, "By UID").svg).toContain(
            `data-wiring-conductor="${id}"`,
          );
        sheet(drawing, "Ordered");
        const rejections: [Record<string, unknown>, string][] = [
          // The same wire by tag and by UID is one identity.
          [
            { title: "T", conductors: ["W1", W1] },
            "Duplicate conductor identity in wiring view.",
          ],
          // CBL1/2+ is valid source with only one end terminated.
          [
            { title: "T", conductors: ["CBL1/2+"] },
            'Conductor "CBL1/2+" does not resolve uniquely to fully terminated physical wiring.',
          ],
          [
            { title: "T", conductors: ["CBL1/1+"], deviceOrder: ["TB1"] },
            "deviceOrder must list each included device exactly once.",
          ],
          // `title` is required.
          [{ conductors: ["CBL1/1+"] }, INVALID_WIRING],
        ];
        await parallel(rejections, ([view, message]) =>
          refused(project, wiring(view), message),
        );
      },
    },
    {
      claim:
        "These horizontal views show selected physical wiring; `[ +N ]` marks other connections at a terminal, and omitted terminals are counted.",
      async check() {
        const { text } = sheet(await accepted(), "Markers");
        // TB1.1 also carries W2; TB2.1 carries nothing else.
        expect(text.filter((s) => /^\S+ \[ \+\d+ \]$/.test(s))).toEqual([
          "1 [ +1 ]",
        ]);
        expect(
          text.filter((s) => s === "7 other terminals: schedule"),
        ).toHaveLength(2);
        // There is no flow option: the layout is always horizontal.
        await refused(
          await base(),
          wiring({
            title: "T",
            conductors: ["CBL1/1+"],
            flow: "top-to-bottom",
          }),
          INVALID_WIRING,
        );
      },
    },
    {
      claim: "Continuity through functions is not inferred.",
      async check() {
        const drawing = await accepted();
        // W4 is on the far side of the closed contact, yet it is not counted.
        const { text } = sheet(drawing, "Through contact");
        expect(text).toContain("1/L1");
        expect(text.some((s) => s.startsWith("1/L1 ["))).toBe(false);
        const net = nets(sheet(drawing, "Overload").svg);
        expect(net.W3).toBeTruthy();
        expect(net.W4).toBeTruthy();
        expect(net.W3).not.toBe(net.W4);
      },
    },
    {
      claim: "Oversize selections fail R006.",
      async check() {
        const project = await base();
        const a4 = { size: "a4", orientation: "portrait" };
        // The same selection fits tabloid, and a narrower one fits A4.
        sheet(await accepted(), "Wide");
        await Promise.all([
          refused(
            project,
            wiring({ title: "T", conductors: ["W1", "J1"] }, a4),
            "Wiring view cannot fit at readable text size. Select fewer conductors or larger paper.",
          ),
          drawn(project, wiring({ title: "T", conductors: ["W1"] }, a4)),
        ]);
      },
    },
    {
      claim:
        "Packets accept `circuit-view-request/0.1` with `title`, `groups`, optional `flow`, `columns: 1|2` and `notes`.",
      async check() {
        const drawing = await accepted();
        const { text } = sheet(drawing, "Circuit title");
        for (const s of ["Circuit title", "View notes", "Circuit note"])
          expect(text).toContain(s);
        sheet(drawing, "Vertical");
        sheet(drawing, "Defaults");
        // Only 1 or 2 columns, and `title` is required.
        const project = await base();
        await parallel(
          [{ title: "T", columns: 3, groups: DO0 }, { groups: DO0 }],
          (view) => refused(project, circuit(view), INVALID_CIRCUIT),
        );
      },
    },
    {
      claim:
        'Each group has a unique `id`, optional `label` and `lineReference`, `conductors`, and `functions` selectors such as `{device: {by: "designation", value: "PLC1"}, key: "do0"}`.',
      async check() {
        const { svg, text } = sheet(await accepted(), "Groups");
        expect(svg).toContain(
          'data-circuit-group="grpA" data-source-line-reference="300"',
        );
        expect(svg).toContain('data-circuit-group="grpB"');
        expect(text).toContain("Ref. 300 · Supply");
        for (const key of ["do0", "do1"])
          expect(svg).toContain(
            `data-function-id="[&quot;${PLC1}&quot;,&quot;${key}&quot;]"`,
          );
        // Group ids are unique, and `conductors` is required.
        const project = await base();
        await parallel(
          [
            [DO0[0], { ...DO0[0], functions: [fn("PLC1", "do1")] }],
            [{ id: "g", functions: [fn("PLC1", "do0")] }],
          ],
          (groups) =>
            refused(project, circuit({ title: "T", groups }), INVALID_GROUP),
        );
      },
    },
    {
      claim: "Use real function keys and conductor identities.",
      async check() {
        const project = await base();
        await Promise.all([
          refused(
            project,
            circuit({
              title: "T",
              groups: [
                { id: "g", functions: [fn("PLC1", "do9")], conductors: [] },
              ],
            }),
            "Circuit g: PLC1/do9 is not a declared device function.",
          ),
          // An unknown conductor selector.
          refused(
            project,
            circuit({
              title: "T",
              groups: [
                {
                  id: "g",
                  functions: [fn("PLC1", "do0")],
                  conductors: ["not-a-wire"],
                },
              ],
            }),
            "does not resolve uniquely",
          ),
        ]);
      },
    },
    {
      claim: "Empty conductors show unconnected functions, not spares.",
      async check() {
        const { svg } = await multi();
        // An open (white) terminal mark has no selected wiring.
        expect(svg).toMatch(
          /data-terminal-key="X2\.0"><circle[^>]*fill="white"/,
        );
        const block = (key: string) => {
          const at = svg.indexOf(`data-function-key="${key}"`);
          expect(at, key).toBeGreaterThanOrEqual(0);
          return svg.slice(at, svg.indexOf("</g></g>", at));
        };
        expect(block("do0")).toContain("<title>PLC1/do0</title>");
        expect(block("do0")).not.toContain("SPARE");
        // SPARE appears once, only where the source marks do1 spare.
        expect(block("do1")).toContain("SPARE");
        expect(svg.match(/SPARE/g)).toHaveLength(1);
      },
    },
    {
      claim:
        "Group order affects presentation; order functions by reading stage (PLC outputs, terminal points, interlocks, coils). A device's first appearance sets its display order.",
      async check() {
        const [drawing, { tb1, tb2 }] = await Promise.all([accepted(), ids()]);
        const forward = sheet(drawing, "Forward").svg;
        const reverse = sheet(drawing, "Reverse").svg;
        expect(left(forward, tb1)).toBe("2");
        expect(left(forward, tb2)).not.toBe("2");
        expect(left(reverse, tb2)).toBe("2");
        expect(left(reverse, tb1)).not.toBe("2");
        expect(nets(forward)["CBL1/1+"]).toBeTruthy();
        expect(nets(reverse)["CBL1/1+"]).toBe(nets(forward)["CBL1/1+"]);
      },
    },
    {
      claim:
        "The view draws selected functions with terminal labels, wire numbers and references.",
      async check() {
        const { svg, text } = await multi();
        expect(svg).toContain('data-circuit-mark="load"');
        expect(svg).toContain('data-circuit-mark="terminal"');
        // Terminal labels and the wire number.
        for (const s of ["L+", "M", "X2.0", "X2.1", "101"])
          expect(text).toContain(s);
        // Cross-references from the PLC's internal supply relations name the
        // other group: A by its line reference, B by its id.
        expect(text.some((t) => t.endsWith(": 300"))).toBe(true);
        expect(text.some((t) => t.endsWith(": B"))).toBe(true);
      },
    },
    {
      claim:
        "A wire's `properties.label` is its printed number, separate from its source identity; repeated labels never join nets.",
      async check() {
        const { svg, text } = await multi();
        expect(text.filter((s) => s === "101")).toHaveLength(2);
        expect(text).not.toContain("W1");
        expect(text).not.toContain("W2");
        expect(svg).toContain('data-conductor-designation="W1"');
        const net = nets(svg);
        expect(net.W1).toBeTruthy();
        expect(net.W2).toBeTruthy();
        expect(net.W1).not.toBe(net.W2);
      },
    },
    {
      claim:
        "Boundary counts expose connections outside the selection; a circuit view is not a completeness audit.",
      async check() {
        const { text, json } = await multi();
        // TB1.1 also carries CBL1/1+, TB2.3 also carries J1, and TB2 itself
        // is an unselected endpoint device.
        for (const s of ["1 [+1]", "3 [+1]", "BOUNDARY"])
          expect(text).toContain(s);
        expect(json.coverage.counts.conductors).toMatchObject({
          represented: 2,
          outsideAuditedViews: 5,
        });
      },
    },
    {
      claim: "ELK owns placement and routing.",
      async check() {
        // Requests have no placement fields to override the layout.
        await refused(
          await base(),
          circuit({ title: "T", groups: [{ ...DO0[0], x: 10 }] }),
          INVALID_GROUP,
        );
      },
    },
    {
      claim:
        "Large groups split into numbered parts with whole conductors; R006 means a conductor, coupled symbol or label cannot fit. Narrow the selection or use a larger sheet; never change topology to obtain a drawing.",
      async check() {
        const source = "examples/circuit-pagination";
        const project = await makeProject({
          name: "wiring-pagination",
          copy: Object.fromEntries(
            [
              "system.json",
              "source.json",
              "library",
              "electrical-system.lock.json",
              "packet.json",
            ].map((p) => [p, `${source}/${p}`]),
          ),
        });
        const req = await readJson(join(project, "packet.json"));
        // Vertical flow with wide margins: Letter cannot hold one complete
        // conductor and its references; Tabloid can, in numbered parts.
        const vertical = (size: string) => ({
          ...req,
          page: { size, orientation: "landscape", marginMm: 25 },
          views: [{ ...req.views[0], flow: "top-to-bottom" }],
        });
        const [, { svg, text, json }] = await Promise.all([
          refused(
            project,
            vertical("letter"),
            "Circuit chain: a complete conductor, symbol or continuation block cannot fit at readable size.",
          ),
          drawn(project, vertical("tabloid")),
        ]);
        const parts = text
          .map((s) =>
            /^Ref\. 200 · Series contact chain - Part (\d+)\/(\d+)$/.exec(s),
          )
          .filter((m) => m !== null);
        const total = Number(parts[0]?.[2]);
        expect(total).toBeGreaterThan(1);
        expect(parts.map((m) => `${m[1]}/${m[2]}`)).toEqual(
          Array.from({ length: total }, (_, i) => `${i + 1}/${total}`),
        );
        // Each of the 19 selected conductors is drawn once, in one part.
        const conductors = [
          ...svg.matchAll(
            /data-circuit-conductor="[^"]*" data-conductor-designation="([^"]*)"/g,
          ),
        ].map((m) => m[1]);
        expect(conductors).toHaveLength(19);
        expect(new Set(conductors).size).toBe(19);
        expect(json.sheets[0].circuitContinuations[0]).toMatchObject({
          group: "chain",
          fromPart: 1,
        });
      },
    },
    {
      claim:
        "Library `circuitSymbols` maps real function keys to explicit closed-catalog marks, for example different marks for a device's main and auxiliary contacts.",
      async check() {
        const [drawing, after] = await Promise.all([accepted(), mapped()]);
        expect(marks(sheet(drawing, "Overload").svg)).toMatchObject({
          pole1: "overload",
          aux95: "contact-nc",
        });
        expect(marks(sheet(after, "Overload").svg)).toMatchObject({
          pole1: "overload",
          aux95: "contact-nc",
        });
        // Marks come from a closed catalog: an unknown one fails the schema.
        const project = await copyProject(await base(), "wiring-mark");
        await editJson(join(project, OVERLOAD), (file) => {
          file.types[0].circuitSymbols = { aux95: "sparkle" };
        });
        await rejected(
          ["lock", "."],
          project,
          "E014",
          "Value is not one of the allowed values",
        );
      },
    },
    {
      claim:
        "E206 checks function existence, kind, terminal count and contact state.",
      async check() {
        // One relocked library with four independent bad marks; validation
        // reports each one separately, naming its function and mismatch.
        const project = await copyProject(await base(), "wiring-e206");
        await editJson(join(project, OVERLOAD), (file) => {
          file.types[0].circuitSymbols = {
            pole1: "overload",
            pole2: "coil",
            pole9: "overload",
            aux95: "contact-no",
          };
        });
        // No device uses the motor type; every loaded type is checked.
        await editJson(join(project, MOTOR), (file) => {
          file.types[0].circuitSymbols = { motor_load: "lamp" };
        });
        await ok(["lock", "."], project);
        const run = await rejected(["validate", "."], project, "E206");
        const lines = run.stdout
          .split("\n")
          .filter((l) => /^\S+:\d+:\d+ [A-Z]\d{3} /.test(l))
          .map((l) => l.replace(/^\S+:\d+:\d+ /, ""))
          .sort();
        expect(lines).toEqual(
          [
            'E206 core:overload-3p-1nc circuitSymbols references undeclared function "pole9".',
            'E206 core:overload-3p-1nc circuitSymbols mark "coil" is incompatible with function "pole2" (contact, 2 terminals, normally closed).',
            'E206 core:motor-3ph circuitSymbols mark "lamp" is incompatible with function "motor_load" (load, 3 terminals).',
            'E206 core:overload-3p-1nc circuitSymbols mark "contact-no" is incompatible with function "aux95" (contact, 2 terminals, normally closed).',
            "W903 PLC1: Required terminal PLC1.L+ has no connection. Required terminal PLC1.M has no connection.",
            "W903 OL1: Required terminal OL1.95 has no connection. Required terminal OL1.96 has no connection.",
          ].sort(),
        );
      },
    },
    {
      claim: "Marks do not create continuity or bonds.",
      async check() {
        const [drawing, after] = await Promise.all([accepted(), mapped()]);
        const before = nets(sheet(drawing, "Overload").svg);
        const mappedSheet = sheet(after, "Overload");
        expect(marks(mappedSheet.svg).pole1).toBe("overload");
        const net = nets(mappedSheet.svg);
        expect(net).toEqual(before);
        expect(net.W3).not.toBe(net.W4);
      },
    },
  ],
  unexecuted: new Map([
    [
      "Add terminal/wire schedules for complete detail.",
      "Advice; the wiring view only points readers to the schedules.",
    ],
    [
      "Follow `thermite guide circuit-symbols` and `thermite guide circuit-views`; never infer a mark from a tag or part-number substring.",
      "Advice about which documents to follow and how to choose marks.",
    ],
  ]),
};
export default module;
