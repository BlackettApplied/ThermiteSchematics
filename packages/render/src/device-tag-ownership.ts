import { escapeXmlAttribute as attr } from "./svg/escape.js";

/** Metadata only: never introduce device appearances or electrical terminals. */
export function tagAttributes(
  ownerUid: string,
  field?: string,
  kind = "body",
  block = ownerUid,
): string {
  return `data-tag-owner-uid="${attr(ownerUid)}" data-tag-kind="${attr(kind)}" data-tag-block="${attr(block)}"${field ? ` data-tag-field="${attr(field)}"` : ""}`;
}

export function ownedTagText(
  svg: string,
  ownerUid: string,
  field: string | undefined,
  block = ownerUid,
): string {
  return field
    ? svg.replace(
        "<text ",
        `<text ${tagAttributes(ownerUid, field, "body", block)} `,
      )
    : svg;
}

/** The already validated node centre remains the drawing's reference anchor. */
export function drawingDeviceReference(
  node: { x?: number; y?: number; width?: number; height?: number },
  device: { uid: string; designation: string },
) {
  const { x, y, width, height } = node;
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined
  )
    throw Error("Missing drawing reference geometry");
  return {
    deviceUid: device.uid,
    designation: device.designation,
    x: x + width / 2,
    y: y + height / 2,
  };
}

/** Source intervals include removed wrap whitespace, never omitted glyphs. */
export function tagRowAttributes(row: { start: number; end: number }): string {
  return `data-tag-row-start="${row.start}" data-tag-row-end="${row.end}"`;
}
