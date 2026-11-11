import type { DeviceTagPlan } from "../device-tags.js";

/** Keep tag/owner dimensions in fit refusals instead of silently reducing em. */
export function deviceTagFitDetails(
  drawing: {
    width: number;
    height: number;
    deviceTags?: readonly DeviceTagPlan[];
  },
  availableWidth: number,
  availableHeight: number,
) {
  const deviceTags = (drawing.deviceTags ?? []).map((plan) => ({
    deviceUid: plan.ownerUid,
    designation: plan.fields.find((f) => f.field === "designation")?.value,
    fields: plan.fields.map((f) => f.field),
    requiredWidthMm: plan.widthMm,
    requiredHeightMm: plan.heightMm,
  }));
  const dimensions = {
    requiredWidthMm: drawing.width,
    requiredHeightMm: drawing.height,
    availableWidthMm: availableWidth,
    availableHeightMm: availableHeight,
  };
  const vertical =
    drawing.height / availableHeight >= drawing.width / availableWidth;
  const plans = [...(drawing.deviceTags ?? [])].sort((a, b) =>
    vertical ? b.heightMm - a.heightMm : b.widthMm - a.widthMm,
  );
  const plan = plans[0];
  const field = plan?.fields
    .map((f) => {
      const rows = plan.rows.filter((r) => r.field === f.field);
      const extent = vertical
        ? Math.max(...rows.map((r) => r.ink.y + r.ink.h)) -
          Math.min(...rows.map((r) => r.ink.y))
        : Math.max(...rows.map((r) => r.ink.x + r.ink.w));
      return { field: f.field, extent };
    })
    .sort((a, b) => b.extent - a.extent)[0]?.field;
  const deviceTag =
    plan && deviceTags.find((t) => t.deviceUid === plan.ownerUid);
  const message = deviceTag
    ? ` Device ${deviceTag.designation} ${field} has the largest tag reservation (${deviceTag.requiredWidthMm.toFixed(2)} × ${deviceTag.requiredHeightMm.toFixed(2)} mm); its owner drawing requires ${drawing.width.toFixed(2)} × ${drawing.height.toFixed(2)} mm, with ${availableWidth.toFixed(2)} × ${availableHeight.toFixed(2)} mm available. Try another flow or a narrower selection.`
    : "";
  return {
    deviceTag: deviceTag ? { ...deviceTag, field } : undefined,
    deviceTags,
    dimensions,
    message,
  };
}
