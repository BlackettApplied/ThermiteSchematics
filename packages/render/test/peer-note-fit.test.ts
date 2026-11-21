import { expect, it } from "vitest";
import {
  emitPeerReferences,
  type PeerReference,
} from "../src/packet/peer-reference-ink.js";
import { parseSvg } from "./off-view-fixtures.js";
import { peerNoteFitFixture } from "./peer-note-fit-fixture.js";

it.each([
  "conductor-peer",
  "terminal-interface",
  "attachment",
  "assembly-inventory",
] as const)("fits %s with the first legal one-line form", (kind) => {
  for (const form of ["full", "compact", "locator"] as const) {
    const { sheet, field, entries } = peerNoteFitFixture(form);
    const entry = { ...entries[0]!, kind };
    const result = emitPeerReferences(sheet, field, [entry]);
    const note = parseSvg(result.svg).querySelector(
      `[data-peer-reference="${kind}"]`,
    );
    expect(note?.textContent).toBe(
      {
        full: entry.value,
        compact: entry.compact,
        locator: "→ 04.D3",
      }[form],
    );
    expect(note?.getAttribute("font-size")).toBe("2.5");
  }
});

it("keeps two measured lines when two notes make the bare address ambiguous", () => {
  const { sheet, field, entries } = peerNoteFitFixture("wrapped");
  const result = emitPeerReferences(sheet, field, entries);
  const notes = [
    ...parseSvg(result.svg).querySelectorAll("g[data-peer-reference]"),
  ];
  expect(notes).toHaveLength(2);
  notes.forEach((note, i) => {
    const lines = [...note.querySelectorAll("text")];
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.textContent).join(" ")).toBe(
      entries[i]!.value,
    );
    expect(
      lines.every((line) => line.getAttribute("font-size") === "2.5"),
    ).toBe(true);
    expect(lines[0]!.getAttribute("x")).toBe(lines[1]!.getAttribute("x"));
    expect(
      +lines[1]!.getAttribute("y")! - +lines[0]!.getAttribute("y")!,
    ).toBeCloseTo(3.5);
  });
  const overbooked: PeerReference[] = entries.map((entry) => ({ ...entry }));
  expect(() =>
    emitPeerReferences(sheet, { ...field, h: 4.7 }, overbooked),
  ).toThrow(/Navigation conductor-peer cannot fit/);
});
