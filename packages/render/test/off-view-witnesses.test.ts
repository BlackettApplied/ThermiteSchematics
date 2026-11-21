import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { renderSchematic } from "../src/renderer.js";
import { dolFixture } from "./dol-control-junctions-fixture.js";
import {
  cards,
  control,
  flows,
  p6Fixture,
  parseSvg,
  required,
} from "./off-view-fixtures.js";

it.each(flows)(
  "discloses P6's exact six rows without changing its selected wires (%s)",
  async (flow) => {
    const f = await p6Fixture();
    try {
      const before = JSON.stringify(f.ir),
        r = await renderSchematic(f.ir, control(flow));
      if (!r.ok) throw Error(JSON.stringify(r));
      expect(
        cards(r.value.svg).sort((a, b) =>
          String(a.terminal).localeCompare(String(b.terminal)),
        ),
      ).toEqual([
        { terminal: "K1.A1", rows: ["W38 → R1.A1", "W39 → H1.X1"] },
        { terminal: "OL1.96", rows: ["W35 → R1.11"] },
        { terminal: "PS1.-", rows: ["W40 → R1.A2", "W42 → H1.X2"] },
        { terminal: "S2.14", rows: ["W37 → R1.14"] },
      ]);
      expect(
        r.value.summary.conductiveElementIds
          .map(
            (id) =>
              required(f.ir.wires.find((w) => w.uid === id.uid)).designation,
          )
          .sort(),
      ).toEqual(["W30", "W32", "W33", "W34", "W36", "W41"]);
      const doc = parseSvg(r.value.svg);
      expect(doc.querySelectorAll("[data-selected-view-notice]")).toHaveLength(
        1,
      );
      expect(
        doc.querySelectorAll(".off-view-card[fill=none][stroke-width='0.75']"),
      ).toHaveLength(4);
      expect(
        doc.querySelectorAll(".off-view-heading[font-weight='700']"),
      ).toHaveLength(4);
      expect(
        doc.querySelectorAll(
          ".off-view-annotation [clip-path], .off-view-annotation [textLength]",
        ),
      ).toHaveLength(0);
      expect(JSON.stringify(f.ir)).toBe(before);
    } finally {
      await f.dispose();
    }
  },
);

it.each(flows)(
  "distinguishes the shorter fuse branch from the fully selected equal-length branch (%s)",
  async (flow) => {
    for (const name of ["fuse-short", "fuse-equal"] as const) {
      const f = await dolFixture(name);
      try {
        const r = await renderSchematic(f.ir, control(flow));
        if (!r.ok) throw Error(JSON.stringify(r));
        expect(
          cards(r.value.svg).sort((a, b) =>
            String(a.terminal).localeCompare(String(b.terminal)),
          ),
        ).toEqual(
          name === "fuse-equal"
            ? []
            : [
                { terminal: "K1.A1", rows: ["W5 → S2.12"] },
                { terminal: "PS1.+", rows: ["W3 → S1.11"] },
              ],
        );
        expect(
          parseSvg(r.value.svg).querySelectorAll("[data-selected-view-notice]"),
        ).toHaveLength(1);
      } finally {
        await f.dispose();
      }
    }
  },
);

it.each(flows)(
  "names W5/W6 at the drawn transformer secondary without claiming a primary connection (%s)",
  async (flow) => {
    const c = await compileProject(
      "packages/core-library/test/fixtures/transformer-control",
    );
    if (!c.ok) throw Error(JSON.stringify(c));
    const r = await renderSchematic(c.ir, {
      ...control(flow),
      root: { by: "designation", value: "R1" },
    });
    if (!r.ok) throw Error(JSON.stringify(r));
    expect(cards(r.value.svg)).toEqual([
      { terminal: "T1.X1", rows: ["W5 → H1.X1"] },
      { terminal: "T1.X2", rows: ["W6 → H1.X2"] },
    ]);
    expect(
      r.value.summary.conductiveElementIds
        .map(
          (id) =>
            required(c.ir.wires.find((w) => w.uid === id.uid)).designation,
        )
        .sort(),
    ).toEqual(["W3", "W4"]);
    const text = [
      ...parseSvg(r.value.svg).querySelectorAll(".selected-view-notice text"),
    ]
      .map((t) => t.textContent)
      .join(" ")
      .replace(/\s+/gu, " ");
    expect(text).toContain(
      "Selected path only; other authored connections may be outside this view.",
    );
    expect(text).not.toContain("primary and parallel");
  },
);

it("does not turn a projected coil terminal or its reference leader into an omitted conductor", async () => {
  const c = await compileProject(
    "packages/core-library/test/fixtures/dol-starter",
  );
  if (!c.ok) throw Error(JSON.stringify(c));
  const r = await renderSchematic(c.ir, control());
  if (!r.ok) throw Error(JSON.stringify(r));
  const doc = parseSvg(r.value.svg);
  expect(doc.querySelectorAll('[data-representation="terminal"]')).toHaveLength(
    1,
  );
  expect(cards(r.value.svg).some((c) => c.terminal === "R1.A1")).toBe(false);
  expect(
    r.value.summary.functionIds.some(
      (id) =>
        id.deviceUid ===
          c.ir.devices.find((d) => d.designation === "R1")?.uid &&
        id.functionKey === "coil",
    ),
  ).toBe(false);
});
