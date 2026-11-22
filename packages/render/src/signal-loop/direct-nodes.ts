import type { LoopPort, LoopNodeGeometry } from "./direct-types.js";
import { appendPinRows } from "../signal-loop/pin-rows.js";
import { drawingDeviceTag, deviceHeaderHeight } from "../device-tag-svg.js";
import { selectedChannelCaption } from "../symbols/printable-policy.js";
import type { TerminalId } from "@thermite/compiler";
import type {
  LoopNodeContext,
  LoopSelection,
  LoopUtilities,
  Conductor,
} from "./direct-types.js";
import {
  directLoopPorts,
  appendDirectAssemblyPorts,
} from "./direct-node-ports.js";
export function loopDestinationOrder(
  terminal: string,
  uid: string,
  stages: string[],
  physicalEdges: Conductor[],
  selected: LoopSelection,
  key: LoopUtilities["key"],
) {
  let current: TerminalId = { deviceUid: uid, terminalKey: terminal };
  while (current.deviceUid !== stages.at(-1)) {
    const next = physicalEdges.filter((e) => key(e.ends[0]) === key(current));
    if (next.length !== 1) return Number.MAX_SAFE_INTEGER;
    current = next[0]!.ends[1];
  }
  const endType = selected.to.type;
  return (endType.terminalOrder ?? endType.terminals.map((t) => t.key)).indexOf(
    current.terminalKey,
  );
}

export function orderedLoopTerminals(
  uid: string,
  type: LoopSelection["to"]["type"],
  context: LoopNodeContext,
) {
  const { physicalEdges, stages, selected, key, compare } = context;
  const terms = new Set(
    physicalEdges.flatMap((e) =>
      e.ends.filter((t) => t.deviceUid === uid).map((t) => t.terminalKey),
    ),
  );
  // Order contacts toward the actuator; real identifiers remain schematic,
  // not a connector-face view. ELK owns placement and routing.
  const destinationOrder = (terminal: string) =>
    loopDestinationOrder(terminal, uid, stages, physicalEdges, selected, key);
  const ordered = [...terms].sort((a, b) => {
    if (selected.output) {
      const difference = destinationOrder(a) - destinationOrder(b);
      if (difference) return difference;
    }
    const order = type.terminalOrder ?? type.terminals.map((t) => t.key);
    return order.indexOf(a) - order.indexOf(b) || compare(a, b);
  });

  return ordered;
}

export function directLoopNodeCaption(
  uid: string,
  index: number,
  context: LoopNodeContext,
) {
  const { devices, types, selected, stages, tags, captions, wrap } = context;
  const device = devices.get(uid)!,
    type = types.get(device.typeId)!;
  const channel =
    uid === selected.from.device.uid
      ? selected.from
      : uid === selected.to.device.uid
        ? selected.to
        : undefined;
  const isChannel = channel?.function.kind === "channel";
  const preferredWidth = selected.output
    ? index === 0 || index === stages.length - 1
      ? 50
      : 44
    : isChannel
      ? 66
      : 50;
  const tag = drawingDeviceTag(device, type, preferredWidth);
  tags.set(uid, tag);
  const captionWidth = tag.widthMm;
  let w = captionWidth;
  const caption = [
    ...(device.location?.trim() ? wrap(device.location, captionWidth - 6) : []),
    ...(isChannel
      ? wrap(selectedChannelCaption(channel!), captionWidth - 6)
      : []),
  ];
  captions.set(uid, caption);

  return { device, type, captionWidth, w, caption, tag };
}

export function directLoopNode(
  uid: string,
  index: number,
  context: LoopNodeContext,
) {
  const { vertical, stages, pinRows } = context;
  const { device, type, captionWidth, caption, tag } = directLoopNodeCaption(
    uid,
    index,
    context,
  );
  let { w } = { w: captionWidth };
  const ordered = orderedLoopTerminals(uid, type, context);
  if (vertical) w += Math.max(66, ordered.length * 14 + 10);
  if (vertical && (index === 0 || index === stages.length - 1))
    pinRows.set(
      uid,
      appendPinRows(caption, type, ordered, uid, captionWidth - 6),
    );
  const header =
    (index === 0 && type.symbol === "thermite:pressure-transmitter" ? 26 : 5) +
    deviceHeaderHeight(tag, caption);
  const h = vertical
    ? Math.max(header + 5, 35)
    : header + ordered.length * 10 + 5;

  const list = directLoopPorts(
    uid,
    index,
    ordered,
    captionWidth,
    w,
    h,
    header,
    context,
  );
  appendDirectAssemblyPorts(
    list,
    { uid, index, device, type, captionWidth, w, h, header },
    context,
  );
  return finishDirectLoopNode(list, { uid, index, w, h }, context);
}

export function finishDirectLoopNode(
  list: LoopPort[],
  geometry: Pick<LoopNodeGeometry, "uid" | "index" | "w" | "h">,
  context: LoopNodeContext,
) {
  const { uid, index, w, h } = geometry;
  const { vertical, width, ports } = context;
  if (list.some((p) => width(p.terminal) > (vertical ? 11 : w / 2 - 5)))
    throw new Error(
      "Terminal identifier is too wide for the signal loop symbol.",
    );
  ports.set(uid, list);
  return {
    id: `n${index}`,
    width: w,
    height: h,
    layoutOptions: { "elk.portConstraints": "FIXED_POS" },
    ports: list
      .filter((p) => !p.suppressed && !p.unused)
      .map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        width: 0,
        height: 0,
        layoutOptions: {
          "elk.port.side": vertical
            ? p.side === "in"
              ? "NORTH"
              : "SOUTH"
            : p.side === "in"
              ? "WEST"
              : "EAST",
        },
      })),
  };
}
