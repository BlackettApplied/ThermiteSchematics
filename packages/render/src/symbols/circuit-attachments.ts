import type { TerminalId } from "@thermite/compiler";
import { required } from "../presentation/util.js";
import { escapeXmlAttribute as attr } from "../svg/escape.js";
import { circuitAttachment } from "./circuit.js";
import { terminalAttachmentStroke } from "./attachment-stroke.js";

type AttachmentNode = {
  width: number;
  height: number;
  pins: {
    id: string;
    terminal: TerminalId;
    x: number;
    y: number;
    side: string;
  }[];
};

/** Preserve catalog attachment geometry while selecting ink by the routed port. */
export function circuitTerminalAttachments(
  node: AttachmentNode,
  terminals: readonly TerminalId[],
  earth: boolean,
  vertical: boolean,
  cx: number,
  cy: number,
  weights?: ReadonlyMap<string, number>,
): string {
  return [
    required(terminals[0], "Missing first attachment terminal"),
    ...(earth
      ? []
      : [required(terminals.at(-1), "Missing last attachment terminal")]),
  ]
    .map((terminal, i) => {
      const side = vertical
        ? i === 0
          ? "NORTH"
          : "SOUTH"
        : i === 0
          ? "WEST"
          : "EAST";
      const same = (t: TerminalId) =>
        t.deviceUid === terminal.deviceUid &&
        t.terminalKey === terminal.terminalKey;
      const pin = required(
        node.pins.find((p) => same(p.terminal) && p.side === side) ??
          node.pins.find((p) => same(p.terminal)),
        "Missing circuit attachment pin",
      );
      const target = vertical
        ? { x: cx, y: cy + (i === 0 ? -4 : 4) }
        : { x: cx + (i === 0 ? -4 : 4), y: cy };
      return `<g data-terminal-attachment="${attr(JSON.stringify([terminal.deviceUid, terminal.terminalKey]))}" data-attachment-from="${attr(JSON.stringify({ x: pin.x, y: pin.y }))}" data-attachment-to="${attr(JSON.stringify(target))}">${circuitAttachment(pin, target, side, node.width, node.height, terminalAttachmentStroke(pin.id, weights))}</g>`;
    })
    .join("");
}
