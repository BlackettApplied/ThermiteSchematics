import type { ConductiveElementId, ElectricalIr } from "@thermite/compiler";
import {
  expand,
  inside,
  project,
  type Rect,
} from "../device-legend/geometry.js";
import { pathInk } from "../device-legend/shape-ink.js";
import type { SvgNode } from "../device-legend/svg-tree.js";
import { required } from "../presentation/util.js";
import {
  conductorEndpoints,
  incidenceKey,
  sourceIncidences,
  type SourceIncidence,
} from "./navigation-incidence.js";
import { destinationToken, navigationZone } from "./navigation-location.js";
import {
  navigationGeometry,
  type NavigationGeometry,
} from "./navigation-walk.js";
import { bounds } from "./page.js";
import { stripTerminalKey } from "./terminal-strip-facts.js";
import type {
  Draft,
  PaperPage,
  RenderedSheet,
  SheetReference,
} from "./types.js";

export const scheduleConductorKey = (id: ConductiveElementId) =>
  id.kind === "cable_conductor"
    ? JSON.stringify([id.cableUid, id.conductorId])
    : id.uid;

function paints(g: NavigationGeometry, channel: "fill" | "stroke") {
  const style = g.style ?? g.node.attrs;
  const colour = style[channel] ?? (channel === "fill" ? "black" : "none");
  return (
    g.visible &&
    Number(style.opacity ?? 1) > 0 &&
    colour !== "none" &&
    colour !== "transparent" &&
    Number(style[`${channel}-opacity`] ?? 1) > 0 &&
    (channel === "fill" || Number(style["stroke-width"] ?? 1) > 0)
  );
}

function terminalBody(
  node: SvgNode,
  children: ReadonlyMap<SvgNode, NavigationGeometry>,
  labels: ReadonlyMap<string, string>,
): Rect | undefined {
  const key = node.attrs["data-strip-terminal"] ?? "";
  const label = labels.get(key);
  if (
    label === undefined ||
    !node.children.some((child) => {
      const g = children.get(child);
      return (
        child.name === "text" && child.text === label && g && paints(g, "fill")
      );
    })
  )
    return;
  const rect = node.children.find((child) => child.name === "rect");
  const g = rect && children.get(rect);
  if (!g || (!paints(g, "fill") && !paints(g, "stroke"))) return;
  const { x, y, width, height } = g.node.attrs;
  const body = project(
    { x: Number(x), y: Number(y), w: Number(width), h: Number(height) },
    g.matrix,
  );
  if (body.w > 0 && body.h > 0 && inside(body, expand(g.clip, 0.002)))
    return body;
}

function stripPath(
  parent: SvgNode,
  geometry: ReadonlyMap<SvgNode, NavigationGeometry>,
) {
  const path = parent.children.find((child) => child.name === "path");
  const g = path && geometry.get(path);
  const data = path?.attrs.d ?? "";
  if (
    !g ||
    !paints(g, "stroke") ||
    !pathInk(data).some((r) => r.w > 0 || r.h > 0)
  )
    return [];
  return conductorEndpoints(data)
    .map((p) => project({ ...p, w: 0, h: 0 }, g.matrix))
    .filter((p) => inside(p, expand(g.clip, 0.002)));
}

function landedEnds(
  node: SvgNode,
  ends: readonly SourceIncidence[],
  bodies: ReadonlyMap<string, Rect>,
  geometry: ReadonlyMap<SvgNode, NavigationGeometry>,
) {
  const [first, last] = stripPath(node, geometry);
  if (!first || !last) return [];
  const a = node.attrs;
  const reaches = (end: SourceIncidence, point: Rect) => {
    const body = bodies.get(stripTerminalKey(end.terminal));
    return body && inside(point, expand(body, 0.002));
  };
  if (a["data-strip-jumper"] && a["data-strip-jumper-end"] === undefined)
    return ends.length === 2 &&
      ends.every(
        (end) =>
          end.element.kind === "jumper" &&
          reaches(end, end.end === 0 ? first : last),
      )
      ? ends
      : [];
  return ends.filter(
    (end) =>
      stripTerminalKey(end.terminal) === a["data-strip-at"] &&
      reaches(end, first) &&
      (!a["data-strip-jumper"] ||
        (end.element.kind === "jumper" &&
          String(end.end) === a["data-strip-jumper-end"])),
  );
}

function fragmentLandings(
  fragment: SvgNode,
  geometry: ReadonlyMap<SvgNode, NavigationGeometry>,
  labels: ReadonlyMap<string, string>,
  conductors: ReadonlyMap<string, SourceIncidence[]>,
) {
  const bodies = new Map<string, Rect>();
  for (const node of fragment.children) {
    const body = terminalBody(node, geometry, labels);
    if (body)
      bodies.set(
        required(
          node.attrs["data-strip-terminal"],
          "Missing strip terminal key",
        ),
        body,
      );
  }
  const paths = fragment.children.flatMap((node) => {
    const id =
      node.attrs["data-strip-incidence"] ?? node.attrs["data-strip-jumper"];
    return id === undefined
      ? []
      : [landedEnds(node, conductors.get(id) ?? [], bodies, geometry)];
  });
  return { bodies, paths };
}

function terminalAnchor(body: Rect, field: Rect) {
  const xMm = body.x + body.w / 2,
    yMm = body.y + body.h / 2;
  if (!inside({ x: xMm, y: yMm, w: 0, h: 0 }, field))
    throw Error("Drawn strip landing is outside its navigation field");
  return { xMm, yMm, zone: navigationZone(xMm, yMm, field) };
}

function bindStripSheet(
  ir: Readonly<ElectricalIr>,
  sheet: RenderedSheet,
  field: Rect,
  conductors: ReadonlyMap<string, SourceIncidence[]>,
  locations: Map<string, string>,
): SheetReference[] {
  const measured = navigationGeometry(sheet.svg);
  const geometry = new Map(measured.map((g) => [g.node, g]));
  const references: SheetReference[] = [];
  for (const { node } of measured) {
    const uid = node.attrs["data-terminal-strip"];
    if (!uid) continue;
    const device = ir.devices.find((d) => d.uid === uid);
    if (!device) continue;
    const labels = new Map(
      ir.terminals
        .filter(({ id }) => id.deviceUid === uid)
        .map(({ id }) => [stripTerminalKey(id), id.terminalKey]),
    );
    const { bodies, paths } = fragmentLandings(
      node,
      geometry,
      labels,
      conductors,
    );
    const first = bodies.values().next().value;
    if (!first) continue;
    references.push({
      deviceUid: uid,
      designation: device.designation,
      functions: [],
      representation: "terminal-strip",
      ...terminalAnchor(first, field),
    });
    bindFragmentIncidences(paths, bodies, field, sheet.number, locations);
  }
  return references;
}

function bindFragmentIncidences(
  paths: readonly (readonly SourceIncidence[])[],
  bodies: ReadonlyMap<string, Rect>,
  field: Rect,
  sheet: number,
  locations: Map<string, string>,
) {
  for (const ends of paths) {
    // An unqualified path at a self-loop terminal could be either native end.
    // Require two painted paths before crediting both ends.
    const [first, second] = ends;
    const loop =
      first &&
      second &&
      stripTerminalKey(first.terminal) === stripTerminalKey(second.terminal);
    if (loop && paths.filter((other) => other[0] === first).length < 2)
      continue;
    for (const end of ends) {
      const key = incidenceKey(end);
      if (locations.has(key)) continue;
      const body = required(
        bodies.get(stripTerminalKey(end.terminal)),
        "Missing painted strip body",
      );
      locations.set(
        key,
        destinationToken({ sheet, zone: terminalAnchor(body, field).zone }),
      );
    }
  }
}

/** Bind measured strip ink after final sheet placement. Supply the same
 * appearances to index/references and the conductor-specific schedule fallback. */
export function locateStripSheets(
  ir: Readonly<ElectricalIr>,
  drafts: readonly Draft[],
  sheets: RenderedSheet[],
  page: PaperPage,
): ReadonlyMap<string, string> {
  const locations = new Map<string, string>();
  if (!drafts.some((d) => d.terminalStrip)) return locations;
  const conductors = new Map<string, SourceIncidence[]>();
  for (const incidence of sourceIncidences(ir)) {
    const key = scheduleConductorKey(incidence.element);
    const ends = conductors.get(key) ?? [];
    ends.push(incidence);
    conductors.set(key, ends);
  }
  for (const [i, draft] of drafts.entries()) {
    if (!draft.terminalStrip) continue;
    const sheet = required(sheets[i], "Missing issued strip sheet");
    const references = bindStripSheet(
      ir,
      sheet,
      draft.drawingBounds ?? bounds(draft.title, page),
      conductors,
      locations,
    );
    sheets[i] = { ...sheet, references };
  }
  return locations;
}
