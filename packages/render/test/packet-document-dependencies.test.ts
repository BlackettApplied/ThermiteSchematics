import { expect, it } from "vitest";
import { renderSchematicPacket } from "../src/sheets.js";
import { offViewFixture, parseSvg } from "./off-view-fixtures.js";

it("issues the missing physical inventory for a selected wiring appearance", async () => {
  const source = await offViewFixture();
  try {
    const result = await renderSchematicPacket(source.ir, {
      format: "schematic-packet-request/0.1",
      views: [
        {
          format: "wiring-view-request/0.1",
          title: "One wire",
          conductors: ["W1"],
        },
      ],
    });
    if (!result.ok) throw Error(JSON.stringify(result.error));
    // Source facts, independently enumerated: W3, W3b and CBL1/1 share PS1.+.
    const rows = result.value.sheets.flatMap((s) =>
      [...parseSvg(s.svg).querySelectorAll("[data-report-row]")].map((r) =>
        r.getAttribute("data-report-row"),
      ),
    );
    for (const name of ["W3", "W3b"])
      expect(rows).toContain(
        source.ir.wires.find((w) => w.designation === name)!.uid,
      );
    expect(rows).toContain(JSON.stringify([source.ir.cables[0]!.uid, "1"]));
    expect(result.value.sheets[0]!.svg).not.toContain("see wire schedule");
    expect(result.value.sheets[0]!.svg).toContain("wire inventory");
    expect(result.value.sheets.length).toBeGreaterThan(1);
  } finally {
    await source.dispose();
  }
});

it("selects precisely the omitted native terminals on non-strip devices", async () => {
  const source = await offViewFixture();
  try {
    const result = await renderSchematicPacket(source.ir, {
      format: "schematic-packet-request/0.1",
      views: [
        {
          format: "wiring-view-request/0.1",
          title: "Explicit non-strip scope",
          conductors: ["W1"],
        },
      ],
    });
    if (!result.ok) throw Error(JSON.stringify(result.error));
    const ps = source.ir.devices.find((d) => d.designation === "PS1")!.uid,
      k = source.ir.devices.find((d) => d.designation === "K1")!.uid;
    const expected = source.ir.terminals
      .filter(
        (t) =>
          (t.id.deviceUid === ps && t.id.terminalKey !== "+") ||
          (t.id.deviceUid === k && t.id.terminalKey !== "A1"),
      )
      .map((t) => JSON.stringify([t.id.deviceUid, t.id.terminalKey]))
      .sort();
    const actual = result.value.sheets
      .filter((s) => "kind" in s.view && s.view.kind === "terminals")
      .flatMap((s) =>
        [...parseSvg(s.svg).querySelectorAll("[data-report-row]")].map((r) =>
          r.getAttribute("data-report-row"),
        ),
      )
      .sort();
    expect(actual).toEqual(expected);
    expect(actual).toHaveLength(12);
  } finally {
    await source.dispose();
  }
});
