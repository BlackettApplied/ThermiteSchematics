import { beforeAll, expect, it } from "vitest";
import {
  compileProject,
  type ElectricalIr,
  type IrDevice,
  type IrDeviceType,
} from "@thermite/compiler";
import {
  deviceTagFields,
  planDeviceTag,
  validateDeviceTagSources,
} from "../src/device-tags.js";
import { preflightDeviceTagSources } from "../src/svg/escape.js";
import { printableTextMetrics } from "../src/text-metrics.js";
let ir: ElectricalIr, device: IrDevice, type: IrDeviceType;
beforeAll(async () => {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  ir = c.ir;
  device = structuredClone(c.ir.devices[0]!);
  type = structuredClone(c.ir.deviceTypes.find((t) => t.id === device.typeId)!);
});
const sample = () => ({
  ...type,
  description: "Type fallback",
  catalog: { ...type.catalog!, orderNumber: "EXACT / 1-A" },
});
it("orders source-backed fields and treats blank descriptions as absent", () => {
  const d = { ...device, description: "Instance description" },
    t = sample();
  expect(deviceTagFields(d, t).map((f) => [f.field, f.value])).toEqual([
    ["designation", d.designation],
    ["description", d.description],
    ["part", "EXACT / 1-A"],
  ]);
  for (const description of [undefined, "", " \t\n "])
    expect(deviceTagFields({ ...d, description }, t)[1]!.source.field).toBe(
      "type.description",
    );
  expect(
    deviceTagFields(
      { ...d, description: "" },
      { ...t, description: " ", catalog: undefined },
    ).map((f) => f.field),
  ).toEqual(["designation"]);
  expect(deviceTagFields(d, t)[2]!.sourceRef.jsonPointer).toBe(
    type.source.jsonPointer + "/catalog/orderNumber",
  );
});
it("measures complete literal rows and ink with existing pinned metrics", () => {
  const d = {
    ...device,
    description:
      "Long authored description with Ω and e\u0301; engineering limits remain unchanged",
  };
  const t = {
    ...sample(),
    catalog: { ...sample().catalog!, orderNumber: "X".repeat(80) + "/Ω-A" },
  };
  const r = planDeviceTag(d, t, 30);
  if (!r.ok) throw Error(r.error.message);
  const plan = r.value;
  expect(plan.ownerUid).toBe(d.uid);
  for (const field of plan.fields) {
    const rows = plan.rows.filter((row) => row.field === field.field);
    const displayed =
      field.field === "part"
        ? field.value
        : field.value.replace(/\s+/gu, " ").trim();
    expect(
      rows.map((row) => displayed.slice(row.start, row.end)).join(""),
    ).toBe(displayed);
    expect(rows[0]!.start).toBe(0);
    expect(rows.at(-1)!.end).toBe(displayed.length);
    for (const row of rows) {
      expect(row.text).toBe(displayed.slice(row.start, row.end).trimEnd());
      expect(row.emMm).toBeGreaterThanOrEqual(2.5);
      const m = printableTextMetrics(row.text, row.emMm, row.bold, true);
      expect(row.ink.w).toBeCloseTo(m.right - m.left, 9);
      expect(row.ink.x).toBeGreaterThanOrEqual(3);
      expect(row.ink.x + row.ink.w).toBeLessThanOrEqual(27.001);
      expect(row.ink.y + row.ink.h).toBeLessThanOrEqual(
        plan.heightMm - 1.5 + 0.001,
      );
      expect(row.text).not.toMatch(/^\p{M}/u);
    }
  }
  expect(planDeviceTag(d, t, 30)).toEqual(r);
  expect(JSON.stringify(ir.devices)).not.toContain("Long authored");
});
it("refuses an unbroken designation instead of truncating or shrinking", () => {
  const r = planDeviceTag(
    { ...device, designation: "W".repeat(80) },
    sample(),
    20,
  );
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error.code).toBe("R006");
    expect(r.error.message).toContain("designation");
  }
});
it("validates exact UID-owned provenance and retains R005 text diagnostics", () => {
  const fields = deviceTagFields(device, type),
    sources = fields.map((f) => f.source);
  expect(() => validateDeviceTagSources(ir, sources)).not.toThrow();
  const description = sources.find((s) => s.field === "device.description")!;
  expect(() =>
    validateDeviceTagSources(ir, [
      { ...description, value: "another device's fact" },
    ]),
  ).toThrow("Invalid device tag source");
  expect(() =>
    validateDeviceTagSources(ir, [{ ...description, ownerId: "foreign" }]),
  ).toThrow();
  const view = {
    format: "schematic-view/0.1",
    family: "power",
    root: { deviceUid: device.uid, designation: device.designation },
    flow: "left-to-right",
  } as const;
  for (const field of [
    "device.description",
    "type.description",
    "type.catalog.orderNumber",
  ] as const) {
    const result = preflightDeviceTagSources(view, [
      { ...description, field, value: "bad\ud800" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("R005");
      expect(result.error.field).toBe(field);
    }
  }
});
