import { expect, it } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { parseHTML } from "linkedom";
import { renderSchematicPacket, renderSchematicSheets } from "../src/sheets.js";
import { createTerminalIr } from "../../query/test/fixtures.js";
import { required } from "./fixtures.js";

it("nests XT-HMI bridge spans and separates wire leaders without strip growth", async () => {
  const c = await compileProject("examples/operator-console");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const r = await renderSchematicSheets(
    c.ir,
    {
      format: "documentation-view-request/0.1",
      kind: "terminals",
      device: "XT-HMI",
    },
    undefined,
    { size: "a3", orientation: "portrait" },
  );
  if (!r.ok) throw Error(JSON.stringify(r.error));
  const strips = r.value.sheets.filter((s) => s.view.kind === "terminal-strip");
  expect(strips).toHaveLength(1);
  const doc = parseHTML(strips[0]!.svg).document;
  const bridges = [
    ...doc.querySelectorAll("[data-strip-jumper]:not([data-strip-jumper-end])"),
  ].map((g) => {
    const numbers = g
      .querySelector("path")!
      .getAttribute("d")!
      .match(/-?[\d.]+/gu)!
      .map(Number);
    return {
      uid: g.getAttribute("data-strip-jumper"),
      top: Math.min(numbers[1]!, numbers[3]!),
      bottom: Math.max(numbers[1]!, numbers[3]!),
      lane: numbers[2]!,
      token: g.querySelector("text")!.textContent,
    };
  });
  for (const outer of bridges)
    for (const inner of bridges)
      if (outer.top < inner.top && outer.bottom > inner.bottom)
        expect(outer.lane).toBeGreaterThan(inner.lane);
  for (const terminal of doc.querySelectorAll("[data-strip-terminal]")) {
    const key = terminal.getAttribute("data-strip-terminal");
    const rect = terminal.querySelector("rect")!;
    const centre =
      Number(rect.getAttribute("y")) + Number(rect.getAttribute("height")) / 2;
    const paths = [...doc.querySelectorAll("[data-strip-incidence]")]
      .filter((g) => g.getAttribute("data-strip-at") === key)
      .map((g) =>
        g
          .querySelector("path")!
          .getAttribute("d")!
          .match(/-?[\d.]+/gu)!
          .map(Number),
      );
    const starts = paths.map((n) => `${n[0]},${n[1]}`);
    expect(new Set(starts).size).toBe(starts.length);
    for (const p of paths)
      expect(Math.abs(p[1]! - centre)).toBeGreaterThan(0.5);
    const perSide = new Map<number, number[]>();
    for (const p of paths) {
      const a = perSide.get(p[0]!) ?? [];
      a.push(p[2]!);
      perSide.set(p[0]!, a);
    }
    for (const elbows of perSide.values())
      expect(new Set(elbows).size).toBe(elbows.length);
  }
});

it.each([
  ["examples/conveyor-line", "TB1", "left-to-right"],
  ["examples/conveyor-line", "TB1", "top-to-bottom"],
  ["examples/operator-console", "XT-HMI", "left-to-right"],
  ["examples/operator-console", "XT-HMI", "top-to-bottom"],
] as const)(
  "keeps native approaches separate in %s / %s / %s",
  async (project, designation, flow) => {
    const { ir, document } = await approachFixture(project, designation, flow);
    const device = required(
      ir.devices.find((d) => d.designation === designation),
    );
    const jumpers = ir.jumpers.filter((j) =>
      j.endpoints.every((e) => e.terminal.deviceUid === device.uid),
    );
    const body = required(
      [...document.querySelectorAll("[data-strip-terminal]")].find(
        (e) => e.getAttribute("data-terminal-key") === "2",
      ),
    );
    const key = body.getAttribute("data-strip-terminal");
    const bridges = jumpers.filter((j) =>
      j.endpoints.some((e) => e.terminal.terminalKey === "2"),
    );
    expect(bridges).toHaveLength(designation === "TB1" ? 1 : 2);
    const approaches = bridges.map((j) => bridgeApproach(document, j));
    if (designation === "TB1") {
      const core = required(ir.cables.find((c) => c.designation === "CBL1"));
      const stub = required(
        [...document.querySelectorAll("[data-strip-incidence]")].find(
          (e) =>
            e.getAttribute("data-strip-at") === key &&
            e.getAttribute("data-strip-incidence") ===
              JSON.stringify([core.uid, "1+"]),
        ),
      );
      expect(stub.textContent?.replace(/\s+/gu, " ")).toContain(
        "CBL1/1+ → JB1.X1.1",
      );
      const vertices = pathVertices(stub);
      checkLanding(document, "2", required(vertices[0]));
      approaches.push(vertices);
    }
    const [a, b] = approaches;
    expect(inkMeetings(required(a), required(b))).toEqual([]);
  },
);

async function approachFixture(
  project: string,
  designation: string,
  flow: "left-to-right" | "top-to-bottom",
) {
  const compiled = await compileProject(project);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const { ir, presentation } = compiled;
  const packet = await renderSchematicPacket(
    ir,
    {
      format: "schematic-packet-request/0.1",
      page: { size: "a3", orientation: "portrait" },
      index: false,
      views: [
        ...(designation === "TB1"
          ? [
              {
                format: "schematic-view-request/0.1" as const,
                family: "power" as const,
                root: { by: "designation" as const, value: "M1" },
                flow,
              },
            ]
          : []),
        {
          format: "documentation-view-request/0.1",
          kind: "terminals",
          device: designation,
        },
      ],
    },
    presentation,
  );
  if (!packet.ok) throw Error(packet.error.message);
  const strip = packet.value.sheets.filter(
    (s) => s.view.kind === "terminal-strip",
  );
  expect(strip).toHaveLength(1);
  return { ir, document: parseHTML(required(strip[0]).svg).document };
}

function nestedApproaches() {
  const ir = createTerminalIr([
    { uid: "strip", designation: "XT-NEST", terminalKeys: ["3", "2", "1"] },
    { uid: "peer", designation: "PEER", terminalKeys: ["1", "2", "3"] },
  ]);
  required(ir.deviceTypes[0]).terminalOrder = ["3", "2", "1"];
  const source = required(ir.devices[0]).source;
  const end = (deviceUid: string, terminalKey: string) => ({
    terminal: { deviceUid, terminalKey },
    source,
  });
  ir.jumpers = ["2", "1"].map((key, index) => ({
    uid: `jumper-${key}`,
    designation: `J${key}`,
    aliases: [],
    source,
    endpoints:
      index === 0
        ? [end("strip", "3"), end("strip", key)]
        : [end("strip", key), end("strip", "3")],
  }));
  ir.wires = ["1", "2"].map((key) => ({
    uid: `wire-${key}`,
    designation: `W${key}`,
    aliases: [],
    source,
    endpoints: [end("strip", "3"), end("peer", key)],
  }));
  return ir;
}

it("keeps two nested bridges and two wire stubs distinct at one terminal", async () => {
  const ir = nestedApproaches();
  const result = await renderSchematicSheets(
    ir,
    {
      format: "documentation-view-request/0.1",
      kind: "terminals",
      device: "XT-NEST",
    },
    undefined,
    { size: "tabloid", orientation: "landscape" },
  );
  if (!result.ok) throw Error(result.error.message);
  const sheet = required(
    result.value.sheets.find((s) => s.view.kind === "terminal-strip"),
  );
  const { document } = parseHTML(sheet.svg);
  const bridges = ir.jumpers.map((jumper) => bridgeApproach(document, jumper));
  const stubs = [...document.querySelectorAll("[data-strip-incidence]")];
  expect(
    stubs.map((stub) => stub.getAttribute("data-strip-incidence")),
  ).toEqual(["wire-1", "wire-2"]);
  const approaches = [
    ...bridges,
    ...stubs.map((stub) => {
      const points = pathVertices(stub);
      checkLanding(document, "3", required(points[0]));
      return points;
    }),
  ];
  approaches.forEach((a, index) => {
    for (const b of approaches.slice(index + 1))
      expect(inkMeetings(a, b)).toEqual([]);
  });
});

type Dom = ReturnType<typeof parseHTML>["document"];
type Element = Dom["documentElement"];
type Point = { x: number; y: number };

function pathVertices(group: Element): Point[] {
  const data = required(
    group.querySelector("path")?.getAttribute("d") ?? undefined,
  );
  const points: Point[] = [];
  for (const [, command, first, second] of data.matchAll(
    /([MLHV]) (-?[\d.]+)(?: (-?[\d.]+))?/gu,
  )) {
    const prev = points.at(-1);
    points.push({
      x: command === "V" ? required(prev).x : Number(first),
      y:
        command === "H"
          ? required(prev).y
          : Number(command === "V" ? first : second),
    });
  }
  expect(points.length).toBeGreaterThanOrEqual(4);
  return points;
}
function bridgeApproach(doc: Dom, jumper: ElectricalIr["jumpers"][number]) {
  const group = required(
    [...doc.querySelectorAll("[data-strip-jumper]")].find(
      (e) => e.getAttribute("data-strip-jumper") === jumper.uid,
    ),
  );
  const vertices = pathVertices(group);
  for (const [index, { terminal }] of jumper.endpoints.entries())
    checkLanding(
      doc,
      terminal.terminalKey,
      required(index === 0 ? vertices[0] : vertices.at(-1)),
    );
  return vertices;
}

function checkLanding(doc: Dom, key: string, point: Point) {
  const body = required(
    [...doc.querySelectorAll("[data-strip-terminal]")].find(
      (e) => e.getAttribute("data-terminal-key") === key,
    ),
  );
  const rect = required(body.querySelector("rect") ?? undefined);
  const edge =
    Number(rect.getAttribute("x")) + Number(rect.getAttribute("width"));
  expect(point.x).toBeCloseTo(edge, 2);
  expect(point.y).toBeGreaterThan(Number(rect.getAttribute("y")));
  expect(point.y).toBeLessThan(
    Number(rect.getAttribute("y")) + Number(rect.getAttribute("height")),
  );
}

function inkMeetings(a: Point[], b: Point[]) {
  const segments = (points: Point[]) =>
    points.slice(1).map((end, i) => {
      const start = required(points[i]);
      expect(start.x === end.x || start.y === end.y).toBe(true);
      return {
        left: Math.min(start.x, end.x),
        right: Math.max(start.x, end.x),
        top: Math.min(start.y, end.y),
        bottom: Math.max(start.y, end.y),
      };
    });
  return segments(a).flatMap((first) =>
    segments(b).filter(
      (second) =>
        // Compare centre lines padded by the two stroke half-widths (up to 0.5 mm total).
        first.left <= second.right + 0.5 &&
        second.left <= first.right + 0.5 &&
        first.top <= second.bottom + 0.5 &&
        second.top <= first.bottom + 0.5,
    ),
  );
}
