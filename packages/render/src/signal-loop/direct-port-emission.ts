import { pinLegend } from "../signal-loop/pin-rows.js";
import { terminalPortAttribute } from "../layout/port-attributes.js";
import { escapeXmlAttribute as attr } from "../svg/escape.js";
import { connectorPort } from "../symbols/field-device.js";
import type { LoopEmissionContext, LoopPort } from "./direct-types.js";
export function emitDirectLoopSpecialPort(
  p: LoopPort,
  context: LoopEmissionContext,
) {
  const { out, vertical, index, stages, type, list, node, uid, width } =
    context;
  if (p.assembly) {
    out.push(
      `<g ${terminalPortAttribute(p.id)}>${connectorPort(
        p.x,
        p.y,
        vertical,
        p.side,
        p.assembly.assembly!.connector,
      )}</g>`,
    );
    return true;
  }
  if (p.suppressed) {
    if (!vertical && (index === 0 || index === stages.length - 1)) {
      const role =
        type.terminals.find((t) => t.key === p.terminal)?.description ?? "";
      const connector = list.find((q) => q.assembly && q.side === p.side)!
        .assembly!.assembly!.connector;
      const clearance = 7 + width(connector);
      const legendX = p.side === "in" ? clearance : 3;
      out.push(
        ...pinLegend(
          uid,
          p.terminal,
          role,
          Math.min(node.width! - 18, node.width! - clearance - 3),
          legendX,
          p.y + 1,
        ),
      );
    }
    return true;
  }

  return false;
}

export function emitDirectLoopRole(p: LoopPort, context: LoopEmissionContext) {
  const { out, vertical, index, stages, type, node, wrap, text } = context;
  if (!vertical && (index === 0 || index === stages.length - 1)) {
    const role = type.terminals.find((t) => t.key === p.terminal)?.description;
    if (role) {
      const lines = wrap(role, node.width! - 12);
      if (lines.length > 2)
        throw new Error(
          "Terminal description is too long for a signal loop view.",
        );
      lines.forEach((line, i) =>
        out.push(text(p.side === "in" ? 9 : 3, p.y + 1 + i * 3.3, line, 2.7)),
      );
    }
  }
}

export function emitDirectLoopAuxiliary(
  p: LoopPort,
  context: LoopEmissionContext,
) {
  const { selected, uid, type, list, node, vertical, out, wrap, text } =
    context;
  const auxiliaryEnd = selected.auxiliary.some((a) =>
    [a.from, a.to].some((e) =>
      e.function.terminals.some(
        (t) => t.deviceUid === uid && t.terminalKey === p.terminal,
      ),
    ),
  );
  const label = auxiliaryEnd
    ? (type.terminals.find((t) => t.key === p.terminal)?.description ??
      "Auxiliary feed")
    : "unused";
  // Use the actual space between adjacent terminal lanes. A short word
  // such as "unused" stays whole; only genuinely overlong tokens split.
  const laneWidth =
    Math.min(
      ...list
        .filter((q) => !q.assembly && q.x !== p.x)
        .map((q) => Math.abs(q.x - p.x)),
      2 * Math.min(p.x, node.width! - p.x),
    ) - 2;
  const lines = wrap(label, vertical ? laneWidth : node.width! - 12);
  if (lines.length > (vertical ? 6 : 2))
    throw new Error("Auxiliary feed legend is too long.");
  lines.forEach((line, i) =>
    out.push(
      text(
        vertical ? p.x : node.width! / 2,
        (vertical
          ? p.side === "in"
            ? 11
            : node.height! - (auxiliaryEnd ? 23 : 9)
          : p.y + 1) +
          i * 3.3,
        line,
        2.7,
        "middle",
      ),
    ),
  );
}

export function emitDirectLoopPorts(context: LoopEmissionContext) {
  const { uid, out, node, vertical, text, key, n, index, stages, list } =
    context;
  for (const p of list) {
    if (emitDirectLoopSpecialPort(p, context)) continue;
    out.push(
      `<circle ${terminalPortAttribute(p.id)} data-loop-terminal="${attr(key({ deviceUid: uid, terminalKey: p.terminal }))}" cx="${n(p.x)}" cy="${n(p.y)}" r="0.8" fill="white" stroke="#344054" stroke-width="0.3"/>`,
    );
    out.push(
      vertical
        ? text(p.x + 1.5, p.side === "in" ? 4 : node.height! - 2, p.terminal)
        : text(
            p.side === "in" ? 2 : node.width! - 2,
            p.y - 1.5,
            p.terminal,
            2.7,
            p.side === "in" ? "start" : "end",
          ),
    );
    emitDirectLoopRole(p, context);
    const twin = list.find(
      (q) =>
        !q.suppressed &&
        !q.assembly &&
        q.terminal === p.terminal &&
        q.side !== p.side,
    );
    if (twin && p.side === "in")
      out.push(
        `<path d="M ${n(p.x)} ${n(p.y)} L ${n(twin.x)} ${n(twin.y)}" stroke="#344054" stroke-width="0.3" fill="none"/>`,
      );
    if (
      ((!twin &&
        !list.some((q) => q.suppressed && q.terminal === p.terminal)) ||
        p.unused) &&
      index !== 0 &&
      index !== stages.length - 1
    ) {
      emitDirectLoopAuxiliary(p, context);
    }
  }
}
