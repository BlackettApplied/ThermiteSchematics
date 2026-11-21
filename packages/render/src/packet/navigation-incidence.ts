import type {
  ElectricalIr,
  TerminalId,
  ConductiveElementId,
} from "@thermite/compiler";
import type { PlacedOccurrence } from "./navigation-types.js";
import type { RenderedSheet } from "./types.js";
import {
  navigationGeometry,
  type NavigationGeometry,
} from "./navigation-walk.js";
import { inside, expand, project } from "../device-legend/geometry.js";
import { authoredTerminalIncidence } from "../off-view/incidence.js";
import { terminalIdKey } from "../ordering.js";
import type { OffViewConnection } from "../off-view/model.js";
import { descendants } from "../device-legend/svg-tree.js";
import { required } from "../presentation/util.js";
export interface SourceIncidence {
  element: ConductiveElementId;
  end: number;
  terminal: TerminalId;
}
const sameTerminal = (a: TerminalId, b: TerminalId) =>
  a.deviceUid === b.deviceUid && a.terminalKey === b.terminalKey;
const elementKey = (id: ConductiveElementId) =>
  id.kind === "cable_conductor"
    ? JSON.stringify([id.kind, id.cableUid, id.conductorId])
    : JSON.stringify([id.kind, id.uid]);
export const incidenceKey = (i: SourceIncidence) =>
  JSON.stringify([elementKey(i.element), i.end]);
/** Enumerates endpoints, including BOTH ends of a loop and singly terminated cores. */
export function sourceIncidences(
  ir: Readonly<ElectricalIr>,
): SourceIncidence[] {
  const out: SourceIncidence[] = [];
  const add = (
    element: ConductiveElementId,
    ends: readonly (TerminalId | null)[],
  ) =>
    ends.forEach((terminal, end) => {
      if (terminal) out.push({ element, terminal, end });
    });
  for (const w of ir.wires)
    add(
      { kind: "wire", uid: w.uid },
      w.endpoints.map((e) => e.terminal),
    );
  for (const j of ir.jumpers)
    add(
      { kind: "jumper", uid: j.uid },
      j.endpoints.map((e) => e.terminal),
    );
  for (const cable of ir.cables) {
    const cores = new Map<string, (TerminalId | null)[]>(
      ir.cableConductors
        .filter((c) => c.cableUid === cable.uid)
        .map((c) => [c.id.conductorId, c.endpoints.map((e) => e.terminal)]),
    );
    for (const c of cable.assignments ?? [])
      cores.set(
        c.id,
        c.endpoints.map((e) => e?.terminal ?? null),
      );
    for (const [id, ends] of cores)
      add(
        { kind: "cable_conductor", cableUid: cable.uid, conductorId: id },
        ends,
      );
  }
  return out;
}
export function pathElement(
  g: NavigationGeometry,
): ConductiveElementId | undefined {
  const a = g.node.attrs;
  if (a["data-wire-uid"]) return { kind: "wire", uid: a["data-wire-uid"] };
  if (a["data-jumper-uid"])
    return { kind: "jumper", uid: a["data-jumper-uid"] };
  if (a["data-cable-uid"] && a["data-conductor-id"])
    return {
      kind: "cable_conductor",
      cableUid: a["data-cable-uid"],
      conductorId: a["data-conductor-id"],
    };
}
export function conductorEndpoints(d: string): { x: number; y: number }[] {
  const tokens =
    d.match(/[MLHV]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi) ?? [];
  const points: { x: number; y: number }[] = [];
  let x = 0,
    y = 0,
    command = "",
    i = 0;
  while (i < tokens.length) {
    if (/^[MLHV]$/i.test(required(tokens[i], "Missing route token")))
      command = required(tokens[i++], "Missing route command");
    if (command === "M" || command === "L") {
      x = Number(tokens[i++]);
      y = Number(tokens[i++]);
    } else if (command === "H") x = Number(tokens[i++]);
    else if (command === "V") y = Number(tokens[i++]);
    else throw Error("Unsupported physical route command");
    points.push({ x, y });
  }
  return points.length
    ? [
        required(points[0], "Missing route start"),
        required(points.at(-1), "Missing route end"),
      ]
    : [];
}
function reaches(
  g: NavigationGeometry,
  terminal: TerminalId,
  points: readonly { x: number; y: number }[],
): number {
  if (!g.visible || g.node.name !== "path") return 0;
  const a = g.node.attrs;
  if (
    !["source", "target"].some(
      (end) =>
        a[`data-${end}-device-uid`] === terminal.deviceUid &&
        a[`data-${end}-terminal-key`] === terminal.terminalKey,
    )
  )
    return 0;
  return conductorEndpoints(a.d ?? "").filter((end) => {
    const p = project({ ...end, w: 0, h: 0 }, g.matrix);
    return (
      inside(p, expand(g.clip, 0.002)) &&
      points.some((point) => Math.hypot(p.x - point.x, p.y - point.y) < 0.02)
    );
  }).length;
}
function visibleOffViewElements(
  scope: readonly NavigationGeometry[],
  terminal: TerminalId,
  records: readonly OffViewConnection[],
): ConductiveElementId[] {
  const cards = scope.filter((g) => {
    if (
      !g.visible ||
      g.node.attrs["data-off-view-terminal-id"] !== JSON.stringify(terminal)
    )
      return false;
    const rect = g.node.children.find((n) => n.name === "rect");
    if (!rect) return false;
    const a = rect.attrs;
    return inside(
      project(
        {
          x: Number(a.x),
          y: Number(a.y),
          w: Number(a.width),
          h: Number(a.height),
        },
        g.matrix,
      ),
      expand(g.clip, 0.002),
    );
  });
  return cards.flatMap((g) => visibleCardElements(g, scope, records));
}
function visibleCardElements(
  g: NavigationGeometry,
  scope: readonly NavigationGeometry[],
  records: readonly OffViewConnection[],
): ConductiveElementId[] {
  const rows = descendants(g.node).filter((n) =>
    (n.attrs.class ?? "").includes("off-view-row"),
  );
  const elements = JSON.parse(
    g.node.attrs["data-off-view-conductors"] ?? "[]",
  ) as ConductiveElementId[];
  const expected = elements.map((element) =>
    required(
      records.find((r) => elementKey(r.elementId) === elementKey(element)),
      "Foreign off-view incidence",
    ),
  );
  const normalize = (s: string) => s.replace(/\s+/g, "");
  if (
    !rows.length ||
    rows.some((r) => !scope.find((n) => n.node === r)?.visible) ||
    normalize(rows.map((r) => r.text).join("")) !==
      normalize(
        expected.map((r) => `${r.designation} → ${r.destination}`).join(""),
      )
  )
    throw Error("Visible off-view ink does not match native source-incidence");
  return elements;
}

/** Source endpoint partition at EACH full rooted appearance, using visible local ink. */
export function validateAppearanceIncidence(
  ir: Readonly<ElectricalIr>,
  occurrences: readonly PlacedOccurrence[],
  sheets: readonly RenderedSheet[],
) {
  const native = sourceIncidences(ir),
    records = authoredTerminalIncidence(ir);
  for (const sheet of sheets) {
    const all = navigationGeometry(sheet.svg);
    for (const o of occurrences.filter(
      (o) =>
        o.destination.sheet === sheet.number &&
        o.role === "full-function" &&
        o.representation !== "circuit",
    )) {
      const scope = all.filter((g) => g.viewKey === o.provenance.view.key);
      for (const key of o.terminalKeys) {
        const terminal = { deviceUid: o.source.deviceUid, terminalKey: key };
        const points = appearanceTerminalPoints(scope, o, key, terminal, ir);
        const expected = native.filter((i) =>
          sameTerminal(i.terminal, terminal),
        );
        const listed = visibleOffViewElements(
          scope,
          terminal,
          records.get(terminalIdKey(terminal)) ?? [],
        );
        validateDrawnSource(scope, points, terminal, expected, ir);
        for (const incidence of expected) {
          const drawn = scope.reduce((n, g) => {
            const id = pathElement(g);
            return (
              n +
              (id && elementKey(id) === elementKey(incidence.element)
                ? reaches(g, terminal, points)
                : 0)
            );
          }, 0);
          const off = listed.filter(
            (id) => elementKey(id) === elementKey(incidence.element),
          );
          const count = expected.filter(
            (i) => elementKey(i.element) === elementKey(incidence.element),
          ).length;
          if (drawn + off.length !== count || (drawn > 0 && off.length > 0))
            throw Error(
              `Appearance source-incidence partition failed at ${o.source.deviceUid}/${key}: ${incidenceKey(incidence)}`,
            );
        }
        if (
          listed.some(
            (id) =>
              !expected.some((i) => elementKey(i.element) === elementKey(id)),
          )
        )
          throw Error("Invented off-view incidence");
      }
    }
  }
}

function terminalPoint(marker: NavigationGeometry) {
  return project(
    {
      x: Number(marker.node.attrs.cx),
      y: Number(marker.node.attrs.cy),
      w: 0,
      h: 0,
    },
    marker.matrix,
  );
}

function validateDrawnSource(
  scope: readonly NavigationGeometry[],
  points: readonly { x: number; y: number }[],
  terminal: TerminalId,
  expected: readonly SourceIncidence[],
  ir: Readonly<ElectricalIr>,
) {
  const net = required(
    ir.indexes.netIdByTerminal.find((n) => sameTerminal(n.key, terminal)),
    "Terminal has no native net",
  ).value;
  for (const g of scope) {
    const id = pathElement(g);
    if (!id || reaches(g, terminal, points) === 0) continue;
    if (!expected.some((i) => elementKey(i.element) === elementKey(id)))
      throw Error("Invented drawn source incidence");
    if (g.node.attrs["data-net-id"] !== net)
      throw Error("Drawn source/net conservation failed");
  }
}

/** A source-owned fan-out stub extends the same terminal, never another device function or a mere same-UID stroke. */
function attachedTerminalPoints(
  scope: readonly NavigationGeometry[],
  terminal: TerminalId,
  initial: readonly { x: number; y: number }[],
  ir: Readonly<ElectricalIr>,
) {
  const points = [...initial],
    net = ir.indexes.netIdByTerminal.find((n) =>
      sameTerminal(n.key, terminal),
    )?.value;
  const stubs = scope
    .filter(
      (g) =>
        g.visible &&
        g.node.attrs["data-presentation-only"] === "true" &&
        g.node.attrs["data-net-id"] === net &&
        ["source", "target"].every(
          (side) =>
            g.node.attrs[`data-${side}-device-uid`] === terminal.deviceUid &&
            g.node.attrs[`data-${side}-terminal-key`] === terminal.terminalKey,
        ),
    )
    .map((g) => ({
      g,
      ends: conductorEndpoints(g.node.attrs.d ?? "").map((p) =>
        project({ ...p, w: 0, h: 0 }, g.matrix),
      ),
    }))
    .filter(
      ({ g, ends }) =>
        ends.length === 2 &&
        ends.every((p) => inside(p, expand(g.clip, 0.002))),
    );
  let changed = true;
  while (changed) {
    changed = false;
    for (const { ends } of stubs)
      if (
        ends.some((end) =>
          points.some((p) => Math.hypot(p.x - end.x, p.y - end.y) < 0.02),
        )
      )
        for (const end of ends)
          if (
            !points.some((p) => Math.hypot(p.x - end.x, p.y - end.y) < 0.02)
          ) {
            points.push(end);
            changed = true;
          }
  }
  return points;
}

function appearanceTerminalPoints(
  scope: readonly NavigationGeometry[],
  o: PlacedOccurrence,
  key: string,
  terminal: TerminalId,
  ir: Readonly<ElectricalIr>,
) {
  const markers = scope.filter(
    (g) =>
      o.terminalPrimitiveIds.includes(g.node.attrs.id ?? "") &&
      g.node.attrs["data-terminal-key"] === key,
  );
  if (!markers.length) throw Error("Missing appearance terminal");
  return attachedTerminalPoints(
    scope,
    terminal,
    markers.map(terminalPoint),
    ir,
  );
}
