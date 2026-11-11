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
  const message = deviceTags.length
    ? ` Device tags ${deviceTags.map((t) => `${t.designation} (${t.fields.join(", ")}; ${t.requiredWidthMm.toFixed(2)} × ${t.requiredHeightMm.toFixed(2)} mm)`).join("; ")} require an owner drawing ${drawing.width.toFixed(2)} × ${drawing.height.toFixed(2)} mm; ${availableWidth.toFixed(2)} × ${availableHeight.toFixed(2)} mm available. Try another flow or a narrower selection.`
    : "";
  return { deviceTags, dimensions, message };
}
