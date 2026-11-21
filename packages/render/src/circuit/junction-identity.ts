import type { TerminalId } from "@thermite/compiler";
import type { Point } from "./types.js";
import type { CircuitTopologyState } from "./layout-routes.js";
import { escapeXmlAttribute as attr } from "../svg/escape.js";

/** Bind a measured junction to the unique terminal shared by every native
 * conductor there. Net membership alone cannot invent a landing identity. */
export function circuitJunctionIdentity(
  point: Point,
  state: Pick<CircuitTopologyState, "segments" | "cs" | "on" | "key">,
): TerminalId | undefined {
  const touching = [
    ...new Set(
      state.segments
        .filter((s) => state.on(point, s.a, s.b))
        .map((s) => s.index),
    ),
  ];
  const first = state.cs[touching[0] ?? -1];
  if (!first || touching.length < 2) return;
  const common = first.ends.filter((t) =>
    touching.every((i) =>
      state.cs[i]?.ends.some((u) => state.key(t) === state.key(u)),
    ),
  );
  return common.length === 1 ? common[0] : undefined;
}

export function circuitJunctionSvg(point: Point, state: CircuitTopologyState) {
  const terminal = circuitJunctionIdentity(point, state);
  const identity = terminal
    ? ` data-device-uid="${attr(terminal.deviceUid)}" data-terminal-key="${attr(terminal.terminalKey)}"`
    : "";
  return `<circle data-circuit-junction="true"${identity} cx="${state.n(point.x)}" cy="${state.n(point.y)}" r=".55" fill="#17212b"/>`;
}
