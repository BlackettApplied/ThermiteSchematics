import { n, line } from "./svg.js";
import { zone } from "./page.js";
import { tagAttributes } from "../device-tag-ownership.js";
import { escapeXmlAttribute as attr } from "../svg/escape.js";
import type { buildCableSchedule } from "@thermite/query";
type Core = ReturnType<typeof buildCableSchedule>["cores"][number];

/** Only the endpoint caption owns the qualified terminal identity. */
export function cableEndpointOwnership(
  rows: string[],
  core: Core,
  cableUid: string,
  leftRows: number,
  rightRows: number,
): void {
  for (const [end, start, count, side] of [
    [core.endpoints[0], 0, leftRows, "a"],
    [core.endpoints[1], leftRows, rightRows, "z"],
  ] as const) {
    if (!end) continue;
    const metadata = tagAttributes(
      end.terminal.deviceUid,
      "designation",
      "reference",
      `${cableUid}/${core.id}/${side}`,
    );
    rows[start] =
      `<g ${metadata} data-tag-terminal-id="${attr(JSON.stringify(end.terminal))}">${rows[start]}`;
    rows[start + count - 1] += "</g>";
  }
}

export function cableTerminations(
  ir: Readonly<import("@thermite/compiler").ElectricalIr>,
  core: Core,
  b: import("./types.js").DrawingBounds,
  left: number,
  right: number,
  midY: number,
) {
  const content: string[] = [],
    references: import("./types.js").SheetReference[] = [];
  for (const [end, x] of [
    [core.endpoints[0], left + 1],
    [core.endpoints[1], right - 1],
  ] as const) {
    if (end === null)
      content.push(
        line(x - 1, midY - 1, x + 1, midY + 1),
        line(x - 1, midY + 1, x + 1, midY - 1),
      );
    else {
      const device = ir.devices.find((d) => d.uid === end.terminal.deviceUid);
      if (!device) throw Error("Missing cable endpoint device");
      references.push({
        deviceUid: end.terminal.deviceUid,
        designation: device.designation,
        functions: [],
        zone: zone(x, midY, b),
      });
      content.push(
        `<circle cx="${n(x)}" cy="${n(midY)}" r="0.8" fill="white" stroke="#344054" stroke-width="0.3"/>`,
      );
    }
  }
  return { content, references };
}
