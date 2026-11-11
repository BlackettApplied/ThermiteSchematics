import type { IrDevice, IrDeviceType } from "@thermite/compiler";
import { planDeviceTag, type DeviceTagPlan } from "./device-tags.js";
import { ownedTagText } from "./device-tag-ownership.js";
import { CircuitRenderError } from "./render-error-context.js";
import { printableTextMetrics } from "./symbols/printable-font.js";
import { text } from "./packet/svg.js";

/** Topology packets may scale by 2.5/2.7; reserve the corresponding larger ink. */
export function drawingDeviceTag(
  device: IrDevice,
  type: IrDeviceType,
  preferredWidth: number,
  emScale = 2.7 / 2.5,
): DeviceTagPlan {
  const m = printableTextMetrics(device.designation, 2.7, true, true);
  const width = Math.max(
    preferredWidth / emScale,
    m.advance + 6,
    m.right - Math.min(0, m.left) + 6,
  );
  const result = planDeviceTag(device, type, width);
  if (!result.ok) {
    if (result.error.code === "R006")
      throw new CircuitRenderError(result.error);
    throw new Error(result.error.message);
  }
  const scaleBox = (b: DeviceTagPlan["ink"]) => ({
    x: b.x * emScale,
    y: b.y * emScale,
    w: b.w * emScale,
    h: b.h * emScale,
  });
  return {
    ...result.value,
    widthMm: width * emScale,
    heightMm: result.value.heightMm * emScale,
    ink: scaleBox(result.value.ink),
    rows: result.value.rows.map((r) => ({
      ...r,
      x: r.x * emScale,
      baseline: r.baseline * emScale,
      emMm: r.emMm * emScale,
      ink: scaleBox(r.ink),
    })),
  };
}

/** Emit the exact measured rows, with natural glyph width and literal spaces. */
export function deviceTagSvg(plan: DeviceTagPlan, x = 0, y = 0): string {
  return plan.rows
    .map((row) =>
      ownedTagText(
        text(
          x + row.x,
          y + row.baseline,
          row.text,
          row.emMm,
          "start",
          row.bold ? 700 : 400,
          row.field === "part",
        ),
        plan.ownerUid,
        row.field,
      ),
    )
    .join("");
}

/** Context is outside the three owned fields and starts below the measured ink. */
export function deviceHeaderSvg(
  plan: DeviceTagPlan | undefined,
  context: readonly string[],
  y = 0,
): string {
  if (!plan) throw new Error("Missing measured device tag.");
  return (
    deviceTagSvg(plan, 0, y) +
    context
      .map((s, i) => text(3, y + plan.heightMm + 2.7 + i * 3.7, s, 2.7))
      .join("")
  );
}

export function deviceHeaderHeight(
  plan: DeviceTagPlan,
  context: readonly string[],
): number {
  return plan.heightMm + context.length * 3.7;
}
