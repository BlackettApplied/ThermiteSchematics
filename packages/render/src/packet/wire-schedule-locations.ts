import { measureText } from "../text-metrics.js";
import type { NavigationGeometry } from "./navigation-walk.js";
import type { ElectricalIr } from "@thermite/compiler";
import type { ScheduleReferences, EndpointSheetZones } from "@thermite/query";
import type { Draft, PaperPage, RenderedSheet } from "./types.js";
import { wireScheduleTerminalKeys } from "./wire-schedule-terminals.js";
import { incidenceKey, sourceIncidences } from "./navigation-incidence.js";
import { scheduleConductorKey } from "./terminal-strip-landings.js";
import { navigationGeometry } from "./navigation-walk.js";
import { project, inside, expand } from "../device-legend/geometry.js";
import { bounds } from "./page.js";
import { destinationToken, navigationZone } from "./navigation-location.js";
import { escapeXmlText } from "../svg/escape.js";
import { required } from "../presentation/util.js";

/** Exact native terminal markers supply endpoint landings across every issued
 * drawing. A device, net peer or inventory row never supplies a landing. */
export function wireScheduleLocations(
  ir: Readonly<ElectricalIr>,
  drafts: readonly Draft[],
  sheets: readonly RenderedSheet[],
  page: PaperPage,
  stripLocations?: ReadonlyMap<string, string>,
): ReadonlyMap<string, readonly (string | undefined)[]> {
  const terminals = new Map<string, string>();
  const incidences = sourceIncidences(ir);
  const needed = new Set(
    incidences.map((i) =>
      JSON.stringify([i.terminal.deviceUid, i.terminal.terminalKey]),
    ),
  );
  for (const [i, sheet] of sheets.entries()) {
    const draft = required(drafts[i], "Missing schedule location draft");
    if (draft.documentationTable) continue;
    const field = draft.drawingBounds ?? bounds(draft.title, page);
    const geometry = navigationGeometry(sheet.svg);
    const keys = wireScheduleTerminalKeys(ir, draft, geometry);
    for (const g of geometry) {
      const key = keys.get(g.node);
      if (!g.visible || key === undefined || !needed.has(key)) continue;
      const point = drawnTerminalAnchor(g);
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
        throw Error("Invalid drawn endpoint landing");
      if (!inside(point, expand(g.clip, 0.002))) continue;
      // A drawn landing without a grid location is a renderer error. It must
      // never silently become the native 'not drawn' state.
      if (!inside(point, field))
        throw Error("Drawn endpoint landing is outside its navigation field");
      if (!terminals.has(key))
        terminals.set(
          key,
          destinationToken({
            sheet: sheet.number,
            zone: navigationZone(point.x, point.y, field),
          }),
        );
    }
  }
  const result = new Map<string, (string | undefined)[]>();
  for (const incidence of incidences) {
    const location =
      terminals.get(
        JSON.stringify([
          incidence.terminal.deviceUid,
          incidence.terminal.terminalKey,
        ]),
      ) ?? stripLocations?.get(incidenceKey(incidence));
    if (location === undefined) continue;
    const key = scheduleConductorKey(incidence.element),
      ends = result.get(key) ?? [];
    ends[incidence.end] = location;
    result.set(key, ends);
  }
  return result;
}

/** Pin rows use the measured ink center of their first painted line. */
export function drawnTerminalAnchor(g: NavigationGeometry) {
  const a = g.node.attrs;
  if (g.node.name === "circle")
    return project({ x: Number(a.cx), y: Number(a.cy), w: 0, h: 0 }, g.matrix);
  const size = Number(g.style?.["font-size"] ?? a["font-size"]);
  const metrics = measureText(g.node.text, size);
  const anchor = g.style?.["text-anchor"] ?? a["text-anchor"];
  const x =
    Number(a.x) +
    metrics.width * (anchor === "middle" ? 0 : anchor === "end" ? -0.5 : 0.5);
  return project(
    { x, y: Number(a.y) + (metrics.descent - metrics.ascent) / 2, w: 0, h: 0 },
    g.matrix,
  );
}

function scheduleReferences(
  ir: Readonly<ElectricalIr>,
  locations: ReturnType<typeof wireScheduleLocations>,
): ScheduleReferences {
  const ends = (key: string): EndpointSheetZones => [
    locations.get(key)?.[0],
    locations.get(key)?.[1],
  ];
  return {
    conductors: new Map(
      [...ir.wires, ...ir.jumpers].map((w) => [w.uid, ends(w.uid)]),
    ),
    cableCores: new Map(
      ir.cables.map((c) => [
        c.uid,
        new Map(
          required(
            ir.cableTypes.find((t) => t.id === c.typeId),
            "Missing cable type",
          ).conductors.map((core) => [
            core.id,
            ends(JSON.stringify([c.uid, core.id])),
          ]),
        ),
      ]),
    ),
  };
}

/** Replace reserved single-line cells without moving any row or sheet. */
const isWireSchedule = (d: Draft) =>
  d.view.format === "documentation-view/0.1" && d.view.kind === "wires";

export function finalizeWireSchedules(
  ir: Readonly<ElectricalIr>,
  drafts: Draft[],
  sheets: RenderedSheet[],
  page: PaperPage,
  stripLocations: ReadonlyMap<string, string>,
) {
  if (!drafts.some(isWireSchedule)) return;
  const locations = wireScheduleLocations(
    ir,
    drafts,
    sheets,
    page,
    stripLocations,
  );
  const references = scheduleReferences(ir, locations);
  for (const [i, draft] of drafts.entries()) {
    if (!isWireSchedule(draft)) continue;
    draft.scheduleReferences = references;
    const sheet = required(sheets[i], "Missing wire schedule sheet");
    let svg = sheet.svg;
    for (const row of draft.documentRows ?? []) {
      const cells = [...row.cells],
        printed = [...row.printedCells];
      for (const column of [5, 6]) {
        if (printed[column]?.length !== 1)
          throw Error(
            "Wire schedule location must reserve one indivisible line",
          );
        const value = locations.get(row.nativeKey)?.[column - 5] ?? "not drawn";
        const marker = `id="sheet-${sheet.number}-${row.primitiveId}"`;
        const start = svg.indexOf(marker);
        if (start < 0) throw Error("Missing wire schedule row ink");
        const tail = svg.slice(start);
        const cell = new RegExp(
          `(<g data-report-column="${column + 1}"[^>]*>)([\\s\\S]*?)(</g>)`,
        );
        if (!cell.test(tail))
          throw Error("Missing wire schedule location cell");
        svg =
          svg.slice(0, start) +
          tail.replace(
            cell,
            (_, open: string, body: string, close: string) =>
              open +
              body.replace(
                /(<text\b[^>]*>)[\s\S]*?(<\/text>)/,
                (_: string, head: string, end: string) =>
                  head + escapeXmlText(value) + end,
              ) +
              close,
          );
        cells[column] = value;
        printed[column] = [value];
      }
      row.cells = cells;
      row.printedCells = printed;
    }
    sheets[i] = { ...sheet, svg };
  }
}
