import type { ElectricalIr } from "@thermite/compiler";
import type { SvgNode } from "../device-legend/svg-tree.js";
import type { NavigationGeometry } from "./navigation-walk.js";
import type { Draft } from "./types.js";
import { sourceIncidences } from "./navigation-incidence.js";
import { required } from "../presentation/util.js";

/** Adapter-owned native identities, never a designation inferred from ink. */
export function wireScheduleTerminalKeys(
  ir: Readonly<ElectricalIr>,
  draft: Draft,
  geometry: readonly NavigationGeometry[],
): ReadonlyMap<SvgNode, string> {
  const keys = new Map<SvgNode, string>();
  for (const g of geometry) {
    if (
      g.node.name !== "circle" &&
      !(g.node.name === "text" && g.node.attrs["data-pin-terminal"])
    )
      continue;
    const a = g.node.attrs;
    if (a["data-pin-terminal"]) {
      const terminal: unknown = JSON.parse(a["data-pin-terminal"]);
      if (
        !Array.isArray(terminal) ||
        terminal.length !== 2 ||
        terminal.some((s) => typeof s !== "string")
      )
        throw Error("Invalid native pin-list terminal identity");
      keys.set(g.node, JSON.stringify(terminal));
    } else if (a["data-loop-terminal"]) {
      const terminal: unknown = JSON.parse(a["data-loop-terminal"]);
      if (
        !Array.isArray(terminal) ||
        terminal.length !== 2 ||
        terminal.some((s) => typeof s !== "string")
      )
        throw Error("Invalid native loop terminal identity");
      keys.set(g.node, JSON.stringify(terminal));
    } else if (g.deviceUid && a["data-terminal-key"]) {
      keys.set(g.node, JSON.stringify([g.deviceUid, a["data-terminal-key"]]));
    }
  }
  if (
    draft.view.format === "schematic-view/0.2" &&
    draft.view.intent === "conductors"
  )
    cableTerminalKeys(ir, geometry, keys);
  return keys;
}

/** Cable rows print native end A then end B, omitting markers for null ends.
 * This binding uses the native core structure and the adapter's actual circles. */
function cableTerminalKeys(
  ir: Readonly<ElectricalIr>,
  geometry: readonly NavigationGeometry[],
  keys: Map<SvgNode, string>,
) {
  const incidences = sourceIncidences(ir);
  for (const g of geometry) {
    const a = g.node.attrs;
    if (g.node.name !== "g" || !a["data-cable-uid"] || !a["data-conductor-id"])
      continue;
    const ends = incidences.filter(
      (i) =>
        i.element.kind === "cable_conductor" &&
        i.element.cableUid === a["data-cable-uid"] &&
        i.element.conductorId === a["data-conductor-id"],
    );
    const circles = g.node.children.filter((n) => n.name === "circle");
    if (circles.length !== ends.length)
      throw Error("Native cable endpoint marker inventory mismatch");
    for (const [index, circle] of circles.entries()) {
      const terminal = required(
        ends[index],
        "Missing native cable endpoint",
      ).terminal;
      keys.set(
        circle,
        JSON.stringify([terminal.deviceUid, terminal.terminalKey]),
      );
    }
  }
}
