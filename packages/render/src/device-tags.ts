import type { ElectricalIr, IrDevice, IrDeviceType } from "@thermite/compiler";
import type { RenderOutcome, RenderTextSource } from "./types.js";
import { svgSemanticId } from "./svg/escape.js";
import { printableTextMetrics } from "./symbols/printable-font.js";
import { wrapDeviceTagText } from "./device-tag-wrap.js";

export type DeviceTagField = "designation" | "description" | "part";
export interface DeviceTagSource {
  readonly field: DeviceTagField;
  readonly value: string;
  readonly source: RenderTextSource;
  readonly sourceRef: IrDevice["source"];
}
export interface DeviceTagRow {
  readonly field: DeviceTagField;
  readonly text: string;
  /** UTF-16 offsets in the displayed field, preserving literal wrap boundaries. */
  readonly start: number;
  readonly end: number;
  readonly x: number;
  readonly baseline: number;
  readonly emMm: number;
  readonly bold: boolean;
  readonly ink: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
}
export interface DeviceTagPlan {
  readonly ownerUid: string;
  readonly fields: readonly DeviceTagSource[];
  readonly rows: readonly DeviceTagRow[];
  readonly widthMm: number;
  readonly heightMm: number;
  readonly ink: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
}

/** Authored fields only. Capability ratings are not device-level tag facts. */
export function deviceTagFields(
  device: IrDevice,
  type: IrDeviceType,
): DeviceTagSource[] {
  const result: DeviceTagSource[] = [];
  const add = (
    field: DeviceTagField,
    value: string | undefined,
    sourceField: RenderTextSource["field"],
    sourceRef: IrDevice["source"],
  ) => {
    if (value?.trim())
      result.push({
        field,
        value,
        sourceRef: {
          ...sourceRef,
          jsonPointer:
            sourceRef.jsonPointer +
            (sourceField === "type.catalog.orderNumber"
              ? "/catalog/orderNumber"
              : field === "designation"
                ? "/designation"
                : "/description"),
        },
        source: {
          ownerKind: "device",
          ownerId: svgSemanticId("device", [device.uid]),
          field: sourceField,
          value,
        },
      });
  };
  if (!device.designation.trim())
    throw Error("Device tag requires an authored designation.");
  if (device.typeId !== type.id)
    throw Error("Device tag type does not match its owner.");
  add("designation", device.designation, "device.designation", device.source);
  if (device.description?.trim())
    add("description", device.description, "device.description", device.source);
  else add("description", type.description, "type.description", type.source);
  add(
    "part",
    type.catalog?.orderNumber,
    "type.catalog.orderNumber",
    type.source,
  );
  return result;
}

interface RowSpec {
  field: DeviceTagField;
  text: string;
  start: number;
  end: number;
  emMm: number;
  bold: boolean;
  metrics: ReturnType<typeof printableTextMetrics>;
}
const metricWidth = (m: RowSpec["metrics"]) =>
  Math.max(m.advance, m.right) - Math.min(0, m.left);

function fieldRows(field: DeviceTagSource, widthMm: number): RowSpec[] {
  const bold = field.field === "designation",
    emMm = bold ? 2.7 : 2.5;
  const value =
    field.field === "part"
      ? field.value
      : field.value.replace(/\s+/gu, " ").trim();
  const metrics = (text: string) =>
    printableTextMetrics(text, emMm, bold, true);
  const lines = bold
    ? [value]
    : wrapDeviceTagText(
        value,
        widthMm - 6,
        (text) => metricWidth(metrics(text)),
        field.field === "description",
      );
  let start = 0;
  return lines.map((text) => {
    const row = {
      field: field.field,
      text,
      start,
      end: start + text.length,
      emMm,
      bold,
      metrics: metrics(text),
    };
    start += text.length;
    return row;
  });
}
function positionRows(specs: readonly RowSpec[]): DeviceTagRow[] {
  let baseline = 1.5,
    previousBottom = 0;
  return specs.map((spec, index) => {
    const { metrics: m, ...row } = spec;
    baseline = index
      ? Math.max(baseline + 3.7, previousBottom + m.top + 0.5)
      : baseline + m.top;
    previousBottom = baseline - m.bottom;
    const x = 3 - Math.min(0, m.left);
    return {
      ...row,
      x,
      baseline,
      ink: {
        x: x + m.left,
        y: baseline - m.top,
        w: m.right - m.left,
        h: m.top - m.bottom,
      },
    };
  });
}
function tagBounds(rows: readonly DeviceTagRow[]) {
  const x = Math.min(...rows.map((r) => r.ink.x)),
    y = Math.min(...rows.map((r) => r.ink.y));
  return {
    x,
    y,
    w: Math.max(...rows.map((r) => r.ink.x + r.ink.w)) - x,
    h: Math.max(...rows.map((r) => r.ink.y + r.ink.h)) - y,
  };
}
/** Millimetres at natural glyph width; this plan is not emitted until rollout. */
export function planDeviceTag(
  device: IrDevice,
  type: IrDeviceType,
  widthMm = 50,
): RenderOutcome<DeviceTagPlan> {
  if (!Number.isFinite(widthMm) || widthMm <= 6)
    throw Error("Device tag width must exceed its 6 mm padding.");
  const fields = deviceTagFields(device, type),
    specs = fields.flatMap((f) => fieldRows(f, widthMm));
  const overflow = specs.find(
    (s) => metricWidth(s.metrics) > widthMm - 6 + 0.001,
  );
  if (overflow)
    return {
      ok: false,
      error: {
        code: "R006",
        reason: "unprintable-layout",
        root: device.designation,
        message: `Device tag ${device.designation} ${overflow.field} needs ${metricWidth(overflow.metrics).toFixed(2)} mm; ${(widthMm - 6).toFixed(2)} mm available. Use a wider tag or page.`,
        details: {
          deviceUid: device.uid,
          field: overflow.field,
          requiredMm: metricWidth(overflow.metrics),
          availableMm: widthMm - 6,
        },
      },
    };
  const rows = positionRows(specs),
    ink = tagBounds(rows);
  return {
    ok: true,
    value: {
      ownerUid: device.uid,
      fields,
      rows,
      widthMm,
      heightMm: ink.y + ink.h + 1.5,
      ink,
    },
  };
}

/** Validate new provenance fields without changing legacy caption inventories. */
export function validateDeviceTagSources(
  ir: Readonly<ElectricalIr>,
  sources: readonly RenderTextSource[],
): void {
  const fields = new Set([
    "device.description",
    "type.description",
    "type.catalog.orderNumber",
  ]);
  for (const source of sources.filter((s) => fields.has(s.field))) {
    const device = ir.devices.find(
      (d) => source.ownerId === svgSemanticId("device", [d.uid]),
    );
    const type = ir.deviceTypes.find((t) => t.id === device?.typeId);
    const expected =
      device && type
        ? deviceTagFields(device, type).find(
            (f) => f.source.field === source.field,
          )?.value
        : undefined;
    if (
      source.ownerKind !== "device" ||
      expected === undefined ||
      source.value !== expected
    )
      throw Error(
        `Invalid device tag source ${source.ownerId} ${source.field}.`,
      );
  }
}
