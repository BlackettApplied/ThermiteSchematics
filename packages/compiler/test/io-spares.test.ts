import { describe, expect, it } from "vitest";
import { analyzeCompleteness, compileProject } from "../src/index.js";
import { device, node, project, wire } from "./validation-fixture.js";

describe("I/O spare completeness", () => {
  it("does not ask for a second unused disposition on explicit spare channel terminals", async () => {
    const root = await project(
      [
        {
          ...device(1, "PLC"),
          io: {
            addressSpace: "iec",
            channels: {
              spare: { usage: "spare" },
              active: { usage: "in-use" },
            },
          },
        },
      ],
      [
        node(
          { a: {}, b: {}, c: {} },
          {
            spare: { kind: "channel", direction: "input", terminals: ["a"] },
            active: { kind: "channel", direction: "input", terminals: ["b"] },
          },
        ),
      ],
    );
    const r = await compileProject(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const report = analyzeCompleteness(r.ir);
    expect(
      report.findings.filter((f) => f.code === "I001").map((f) => f.key),
    ).toEqual(["b", "c"]);
    expect(report.findings.filter((f) => f.code === "I003")).toHaveLength(1);
  });
  it("retains required and deferred findings despite spare usage", async () => {
    const root = await project(
      [
        {
          ...device(1, "PLC"),
          io: { addressSpace: "iec", channels: { spare: { usage: "spare" } } },
          connectionReview: {
            terminals: { b: { status: "deferred", reason: "Wire later." } },
          },
        },
      ],
      [
        node(
          { a: { required: true }, b: {} },
          {
            spare: {
              kind: "channel",
              direction: "input",
              terminals: ["a", "b"],
            },
          },
        ),
      ],
    );
    const r = await compileProject(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(analyzeCompleteness(r.ir).findings.map((f) => f.code)).toEqual(
      expect.arrayContaining(["W903", "W905"]),
    );
  });
});

it("keeps a dangling spare visible in the inventory without denying its disposition", async () => {
  const root = await project(
    [
      {
        ...device(1, "PLC"),
        io: { addressSpace: "iec", channels: { spare: { usage: "spare" } } },
      },
      {
        uid: "7f000000-0000-4000-8000-000000000002",
        kind: "cable",
        designation: "CBL",
        type: "assessment:cable",
        conductors: [
          {
            id: "1",
            endpoints: [{ device: "PLC", terminal: "a" }, null],
            usage: "spare",
          },
        ],
      },
    ],
    [
      node(
        { a: {} },
        { spare: { kind: "channel", direction: "input", terminals: ["a"] } },
      ),
      {
        kind: "cable_type",
        id: "assessment:cable",
        conductors: [{ id: "1", color: "black" }],
      },
    ],
  );
  const r = await compileProject(root);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  const report = analyzeCompleteness(r.ir);
  expect(report.counts.dangling).toBe(1);
  expect(report.findings.filter((f) => f.code === "I001")).toEqual([]);
});

it.each(["in-use", undefined, "spare"] as const)(
  "exempts a shared common only when every channel is spare (other=%s)",
  async (usage) => {
    const root = await project(
      [
        {
          ...device(1, "PLC"),
          io: {
            addressSpace: "iec",
            channels: {
              ch0: { usage: "spare" },
              ...(usage === undefined ? {} : { ch1: { usage } }),
            },
          },
        },
        wire(
          2,
          { device: "PLC", terminal: "y" },
          { device: "PLC", terminal: "z" },
        ),
      ],
      [
        node(
          { x: {}, y: {}, com: {}, z: {} },
          {
            ch0: {
              kind: "channel",
              direction: "input",
              terminals: ["x", "com"],
            },
            ch1: {
              kind: "channel",
              direction: "input",
              terminals: ["y", "com"],
            },
          },
        ),
      ],
    );
    const r = await compileProject(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(
      analyzeCompleteness(r.ir)
        .findings.filter((f) => f.code === "I001")
        .map((f) => f.key),
    ).toEqual(usage === "spare" ? [] : ["com"]);
  },
);
