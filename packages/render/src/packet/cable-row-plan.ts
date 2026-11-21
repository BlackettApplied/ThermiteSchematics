import type { buildCableSchedule } from "@thermite/query";
import { cableUsagePlan } from "./cable-usage.js";
import { labelRows, labelMetrics } from "./label-text.js";
import { failure } from "./errors.js";
import {
  CABLE_ROW_PITCH,
  CABLE_ENDPOINT_BASELINE,
  CABLE_CORE_BASELINE,
  CABLE_USAGE_BASELINE,
} from "./cable-row-metrics.js";

type Core = ReturnType<typeof buildCableSchedule>["cores"][number];
export function cableRowPlan(
  core: Core,
  cable: string,
  b: { left: number; right: number; jacketL: number; jacketR: number },
) {
  const end = (e: Core["endpoints"][number], w: number) =>
    e === null
      ? [core.status === "unassigned" ? "? UNASSIGNED" : "X UNTERMINATED"]
      : labelRows(e.display, w, 2.7);
  const a = end(core.endpoints[0], b.jacketL - b.left - 8),
    z = end(core.endpoints[1], b.right - b.jacketR - 8);
  const centerRows = labelRows(
    `${core.id} / ${core.color}${core.size ? ` / ${core.size}` : ""}`,
    b.jacketR - b.jacketL - 6,
    2.6,
  );
  const usage = cableUsagePlan(core.usage, b.jacketR - b.jacketL - 6);
  const groups = [
    {
      rows: a,
      width: b.jacketL - b.left - 8,
      size: 2.7,
      base: CABLE_ENDPOINT_BASELINE,
    },
    {
      rows: z,
      width: b.right - b.jacketR - 8,
      size: 2.7,
      base: CABLE_ENDPOINT_BASELINE,
    },
    {
      rows: centerRows,
      width: b.jacketR - b.jacketL - 6,
      size: 2.6,
      base: CABLE_CORE_BASELINE,
    },
  ];
  const constraint = rowConstraint(
    [
      ...groups,
      {
        rows: usage.rows,
        width: b.jacketR - b.jacketL - 6,
        size: 2.5,
        base: CABLE_USAGE_BASELINE,
      },
    ],
    cable,
    core.id,
  );
  if (constraint) return failure("unprintable-layout", constraint);
  const oldMid =
    Math.max(a.length, z.length, centerRows.length) * CABLE_ROW_PITCH + 1;
  const midOffset = Math.max(oldMid, ...groups.map(groupBottom));
  const value = {
    a,
    z,
    centerRows,
    usage,
    midOffset,
    extraHeight: usage.extraHeight + midOffset - oldMid,
  };
  return { ok: true, value } as const;
}

function groupBottom(g: {
  rows: readonly string[];
  size: number;
  base: number;
}) {
  return Math.max(
    ...g.rows.map(
      (r, i) =>
        i * CABLE_ROW_PITCH + g.base - labelMetrics(r, g.size).bottom + 1.15,
    ),
  );
}

function rowConstraint(
  groups: readonly { rows: readonly string[]; width: number; size: number }[],
  cable: string,
  core: string,
) {
  for (const g of groups)
    for (const row of g.rows) {
      const required = labelMetrics(row, g.size).width;
      if (required > g.width + 0.001)
        return `Cable ${cable}.${core} label ${JSON.stringify(row)} needs ${required.toFixed(2)} mm; ${g.width.toFixed(2)} mm available, short by ${(required - g.width).toFixed(2)} mm. Use a larger sheet or landscape.`;
    }
}
