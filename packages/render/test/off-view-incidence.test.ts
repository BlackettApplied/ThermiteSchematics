import { expect, it } from "vitest";
import {
  authoredTerminalIncidence,
  omittedConnections,
} from "../src/off-view/incidence.js";
import { conductorKey } from "../src/presentation/util.js";
import { terminalIdKey } from "../src/ordering.js";
import { offViewFixture, required } from "./off-view-fixtures.js";

it("uses direct authored identity, including parallel wires, jumpers and every spare disposition", async () => {
  const f = await offViewFixture();
  try {
    const ps = required(f.ir.devices.find((d) => d.designation === "PS1"));
    const selected = new Set(
      f.ir.wires
        .filter((w) => ["W1", "W2"].includes(w.designation))
        .map((w) => conductorKey({ kind: "wire", uid: w.uid })),
    );
    const incidence = authoredTerminalIncidence(f.ir);
    const rows = (key: string) =>
      omittedConnections(
        incidence,
        { deviceUid: ps.uid, terminalKey: key },
        selected,
      )
        .map((c) => `${c.designation} → ${c.destination}`)
        .sort();
    expect(rows("+")).toEqual(["CBL1.1 → TB1.3", "W3 → H1.X1", "W3b → H1.X1"]);
    expect(rows("-")).toEqual(
      [
        "CBL1.2 → unterminated (spare)",
        "JP1 → TB1.1",
        "W4 → H1.X2",
        "Jumper → TB1.2",
      ].sort(),
    );
    expect(
      [...incidence.values()]
        .flat()
        .some((c) => c.designation === "CBL1.3" || c.designation === "CBL1.4"),
    ).toBe(false);
    expect(rows("-").some((r) => r.includes("Wfar"))).toBe(false);
    // A selected path elsewhere in the same view consumes the same identity once.
    const all = new Set([
      ...selected,
      ...required(
        incidence.get(terminalIdKey({ deviceUid: ps.uid, terminalKey: "+" })),
      ).map((c) => conductorKey(c.elementId)),
    ]);
    expect(
      omittedConnections(
        incidence,
        { deviceUid: ps.uid, terminalKey: "+" },
        all,
      ),
    ).toEqual([]);
  } finally {
    await f.dispose();
  }
});

it("discloses one physical self-loop while NAV inventories both endpoint ordinals", async () => {
  const f = await offViewFixture();
  try {
    const ir = structuredClone(f.ir),
      wire = required(ir.wires.find((w) => w.designation === "W3"));
    wire.endpoints[1] = structuredClone(wire.endpoints[0]);
    const found = required(
      authoredTerminalIncidence(ir).get(
        terminalIdKey(wire.endpoints[0].terminal),
      ),
    ).filter((c) => c.designation === "W3");
    expect(found).toHaveLength(1);
    expect(new Set(found.map((c) => conductorKey(c.elementId)))).toEqual(
      new Set([conductorKey({ kind: "wire", uid: wire.uid })]),
    );
    for (const end of found)
      expect(end.other).toEqual(wire.endpoints[0].terminal);
  } finally {
    await f.dispose();
  }
});
