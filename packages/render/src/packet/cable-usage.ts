import { labelMetrics, labelRows } from "./label-text.js";

export const CABLE_USAGE_EM = 2.5;
export const CABLE_USAGE_PITCH = 3.5;

/** Reserve usage ink before pagination and before placing either endpoint card. */
export function cableUsagePlan(usage: string, width: number) {
  const value =
    usage === "unspecified"
      ? "ASSIGNED / USAGE UNSPECIFIED"
      : usage.toUpperCase();
  const rows = labelRows(value, width, CABLE_USAGE_EM);
  const metrics = rows.map((r) => labelMetrics(r, CABLE_USAGE_EM));
  const descent = Math.max(0, ...metrics.map((m) => -m.bottom));
  const extraHeight = (rows.length - 1) * CABLE_USAGE_PITCH + descent;
  return {
    rows,
    extraHeight,
  };
}
