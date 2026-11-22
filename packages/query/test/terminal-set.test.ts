import { expect, it } from "vitest";
import { formatTerminalSet, printedPort } from "../src/index.js";
it.each([
  [[], ""],
  [["3"], "3"],
  [["13", "14"], "13–14"],
  [["A1", "A2"], "A1–A2"],
  [["9", "13"], "9 / 13"],
  [["AI3", "AI7"], "AI3 / AI7"],
  [["L1", "L3"], "L1 / L3"],
  [["X2", "X5"], "X2 / X5"],
  [["X5", "X2"], "X5 / X2"],
  [["9", "10"], "9–10"],
  [["H1", "H2"], "H1–H2"],
  [["X1", "X2"], "X1–X2"],
  [["L", "N"], "L–N"],
  [["PE", "N"], "PE–N"],
  [["A1", "B7"], "A1–B7"],
  [["AI3", "ai7"], "AI3–ai7"],
  [["Α1", "Α3"], "Α1 / Α3"],
  [["01", "04"], "01 / 04"],
  [["A1", "A1"], "A1–A1"],
  [
    ["9007199254740992", "9007199254740995"],
    "9007199254740992 / 9007199254740995",
  ],
  [["14", "13"], "14–13"],
  [["01", "02"], "01–02"],
  [
    ["9007199254740992", "9007199254740993"],
    "9007199254740992–9007199254740993",
  ],
  [["PE", "+24V"], "PE / +24V"],
  [["+", "-", "S"], "+ / - / S"],
  [["+", "-"], "+ / -"],
  [["1/2", "3<&>"], "1/2–3<&>"],
  [["1/L1", "2/T1"], "1/L1–2/T1"],
  [["X10.1", "X10.2"], "X10.1–X10.2"],
  [["DC-IN.1", "DC-IN.2"], "DC-IN.1 / DC-IN.2"],
  [["L+", "M"], "L+ / M"],
  [["a–b", "c"], "a–b / c"],
  [["a−b", "c"], "a−b / c"],
  [["a-b", "c/d"], "a-b, c/d"],
  [["a/b", "c", "d"], "a/b, c, d"],
  [
    Array.from({ length: 12 }, (_, i) => String(i + 1)),
    "1 / 2 / 3 / 4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12",
  ],
] as const)("formats authored terminal set %j as %s", (names, expected) => {
  expect(formatTerminalSet(names)).toBe(expected);
});
it("keeps distinct port markings even when descriptions and connector metadata repeat", () => {
  const type = {
    ports: {
      P1: {
        medium: "ethernet" as const,
        description: "Ethernet",
        connector: "RJ45",
      },
      P2: {
        medium: "ethernet" as const,
        description: "Ethernet",
        connector: "RJ45",
      },
      P3: { medium: "ethernet" as const, description: "P3" },
    },
  };
  expect(["P1", "P2", "P3"].map((p) => printedPort(type, p))).toEqual([
    "P1 — Ethernet",
    "P2 — Ethernet",
    "P3",
  ]);
});

it("checks the actual printed names when qualifying native terminal identities", () => {
  expect(formatTerminalSet(["13", "14"], (t) => `K1.${t}`)).toBe("K1.13–K1.14");
  expect(formatTerminalSet(["13", "14"], (t) => `-K1.${t}`)).toBe(
    "-K1.13 / -K1.14",
  );
  expect(formatTerminalSet(["9", "13"], (t) => `K/1.${t}`)).toBe(
    "K/1.9, K/1.13",
  );
  expect(formatTerminalSet(["13", "14"], (t) => `-K/1.${t}`)).toBe(
    "-K/1.13, -K/1.14",
  );
  expect(formatTerminalSet(["+", "-", "S"], (t) => `K1.${t}`)).toBe(
    "K1.+ / K1.- / K1.S",
  );
});

it("parses the terminal part while using printed qualified strings for punctuation", () => {
  expect(formatTerminalSet(["9", "13"], (t) => `K1.${t}`)).toBe("K1.9 / K1.13");
  expect(formatTerminalSet(["AI3", "AI7"], (t) => `K1.${t}`)).toBe(
    "K1.AI3 / K1.AI7",
  );
  expect(formatTerminalSet(["A1", "A2"], (t) => `K1.${t}`)).toBe("K1.A1–K1.A2");
  expect(formatTerminalSet(["A1", "A2"], (t) => `-K1.${t}`)).toBe(
    "-K1.A1 / -K1.A2",
  );
});
