import { deviceTagFields } from "../device-tags.js";
import type { IrDevice, IrDeviceType } from "@thermite/compiler";
import { drawingDeviceTag } from "../device-tag-svg.js";
import { CAPTION_CLEARANCE_MM, CaptionPlacementError } from "./caption-ink.js";
import { printableTextMetrics } from "./printable-font.js";

interface CaptionOwner {
  width: number;
  device: { designation: string };
  relationLabels: readonly string[];
  pins: { x: number; side: string }[];
}

/** Validate with the emitter's actual local ink before ELK. Only an owner
 * without a legal caption position receives an extra measured side lane.
 * Existing printable nodes, wrapping and port identities stay unchanged. */
export function reserveCircuitCaptions<Node extends CaptionOwner>(
  nodes: Node[],
  vertical: boolean,
  probe: (node: Node) => unknown,
): void {
  const gap = CAPTION_CLEARANCE_MM + 0.4 / 2 + 0.002;
  for (const node of nodes) {
    if (!vertical && !node.relationLabels.length) continue;
    for (let attempt = 0; ; attempt++) {
      try {
        probe(node);
        break;
      } catch (error) {
        if (!(error instanceof CaptionPlacementError) || attempt === 2)
          throw error;
        const metrics = [
          printableTextMetrics(node.device.designation, 2.7, true),
          ...node.relationLabels.map((s) => printableTextMetrics(s, 2.3)),
        ];
        node.width +=
          Math.max(...metrics.map((m) => m.right - m.left)) + 2 * gap;
        if (!vertical)
          for (const p of node.pins) if (p.side === "EAST") p.x = node.width;
      }
    }
  }
}

/** The tag lane is disjoint from the existing pin, symbol and caption lanes. */
export function circuitTagReservation(
  width: number,
  height: number,
  tag: { widthMm: number; heightMm: number },
  vertical: boolean,
) {
  return vertical
    ? {
        width: width + 2 + tag.widthMm,
        height: Math.max(height, tag.heightMm),
        tagX: width + 2,
        tagY: 0,
        bodyX: 0,
        bodyY: 0,
      }
    : {
        width: Math.max(width, tag.widthMm),
        height: height + 2 + tag.heightMm,
        tagX: 0,
        tagY: 0,
        bodyX: 0,
        bodyY: tag.heightMm + 2,
      };
}

export function reserveCircuitDeviceTag<
  Node extends {
    device: IrDevice;
    type: IrDeviceType;
    width: number;
    height: number;
    bodyHeight: number;
    rows: { center: number }[];
    pins: { x: number; y: number; side: string }[];
  },
>(node: Node, vertical: boolean) {
  if (!vertical) {
    // The old primary designation band moves into the tag lane.
    node.height -= 4;
    node.bodyHeight -= 4;
    node.rows = node.rows.map((row) => ({ ...row, center: row.center - 4 }));
    node.pins = node.pins.map((pin) => ({ ...pin, y: pin.y - 4 }));
  }
  const plan = drawingDeviceTag(
    node.device,
    node.type,
    vertical
      ? deviceTagFields(node.device, node.type).length === 1
        ? 7
        : 34
      : deviceTagFields(node.device, node.type).length === 1
        ? Math.min(50, node.width)
        : Math.max(42, Math.min(50, node.width)),
    1,
  );
  const geometry = circuitTagReservation(
    node.width,
    node.height,
    plan,
    vertical,
  );
  const body = { ...node };
  return Object.assign(node, {
    tagLane: { body, plan, geometry },
    width: geometry.width,
    height: geometry.height,
    pins: body.pins.map((p) => ({
      ...p,
      x: p.side === "EAST" ? geometry.width : p.x + geometry.bodyX,
      y: p.side === "SOUTH" ? geometry.height : p.y + geometry.bodyY,
    })),
  });
}
