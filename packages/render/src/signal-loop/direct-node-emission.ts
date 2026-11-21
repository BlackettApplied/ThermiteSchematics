import { deviceHeaderSvg } from "../device-tag-svg.js";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import { escapeXmlAttribute as attr } from "../svg/escape.js";
import { fieldDeviceBody } from "../symbols/field-device.js";
import type { LoopNodeContext } from "./direct-types.js";
import { emitDirectLoopPorts } from "./direct-port-emission.js";
export function emitDirectLoopNodes(
  graph: ElkNode,
  enclosure: { minX: number; minY: number },
  out: string[],
  context: LoopNodeContext,
) {
  const { stages, devices, types, ports, selected } = context;
  const references = [];
  for (const node of graph.children ?? []) {
    const index = Number(node.id.slice(1)),
      uid = stages[index]!,
      device = devices.get(uid)!,
      type = types.get(device.typeId)!;
    emitDirectLoopNodeHeader(node, index, uid, type, out, context);
    const list = ports.get(uid)!;
    emitDirectLoopPorts({
      ...context,
      out,
      node,
      index,
      uid,
      device,
      type,
      list,
    });
    out.push("</g>");
    references.push({
      deviceUid: uid,
      designation: device.designation,
      functions: [
        ...new Set(
          [
            selected.from,
            selected.to,
            ...selected.auxiliary.flatMap((a) => [a.from, a.to]),
          ]
            .filter((e) => e.device.uid === uid)
            .map((e) => e.function.id.functionKey),
        ),
      ],
      x: node.x! + node.width! / 2 - enclosure.minX,
      y: node.y! + node.height! / 2 - enclosure.minY,
    });
  }

  return references;
}

export function emitDirectLoopNodeHeader(
  node: ElkNode,
  index: number,
  uid: string,
  type: LoopNodeContext["selected"]["to"]["type"],
  out: string[],
  context: LoopNodeContext,
) {
  const { vertical, tags, captions, pinRows, n } = context;
  out.push(
    `<g data-device-uid="${attr(uid)}" transform="translate(${n(node.x!)} ${n(node.y!)})">`,
    fieldDeviceBody(
      type.symbol ?? "",
      node.width!,
      node.height!,
      vertical ? 25 : node.width! / 2,
    ),
  );
  out.push(
    deviceHeaderSvg(
      tags.get(uid),
      captions.get(uid)!,
      index === 0 && type.symbol === "thermite:pressure-transmitter" ? 21 : 0,
      pinRows.get(uid),
    ),
  );
}
