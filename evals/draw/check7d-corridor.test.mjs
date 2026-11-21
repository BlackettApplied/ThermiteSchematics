import { expect, it } from "vitest";
import { observation } from "./evaluate.mjs";
import { rootedFixture, eraseProtection } from "./check7b-fixture.mjs";
import {
  busFixture,
  addSecondSupply,
  addUntraversableStage,
} from "./check7d-fixture.mjs";
import { navigationStrictObservations } from "./navigation-strict.mjs";

function rows({ packet, geometries, ir, request }) {
  return navigationStrictObservations(
    { id: "check7d" },
    packet,
    geometries,
    ir,
    request,
    observation,
  ).filter((r) => r.owner === "#396");
}

it.each([false, true])(
  "FU1 a downstream bus excludes a sibling branch when erased=%s",
  (erased) => {
    const x = busFixture();
    if (erased) eraseProtection(x);
    const judged = rows(x);
    expect(judged.map((r) => r.status)).toEqual(
      erased ? ["fail"] : ["pass", "pass"],
    );
    if (erased)
      expect(judged[0].evidence.findings.map((f) => f.deviceUid)).toEqual([
        "D",
        "D",
        "D",
      ]);
  },
);

it("FU1 a loop attached at only one bus junction is outside the corridor", () => {
  expect(rows(busFixture(true)).map((r) => r.status)).toEqual(["pass", "pass"]);
});

it.each([false, true])(
  "FU1 multi-supply needs are mandatory exactly when no source bypasses them (%s)",
  (bypass) => {
    const x = busFixture();
    addSecondSupply(x.ir, bypass);
    expect(rows(x).map((r) => r.status)).toEqual(["pass", "pass"]);
    eraseProtection(x);
    const judged = rows(x);
    expect(judged.map((r) => r.status)).toEqual([
      bypass ? "infrastructure-error" : "fail",
    ]);
    const gaps = bypass
      ? judged[0].evidence.failures
      : judged[0].evidence.findings;
    expect(gaps.map((f) => f.deviceUid)).toEqual(["D", "D", "D"]);
    for (const gap of gaps) {
      expect(gap.nativeWitness.mandatory).toBe(!bypass);
      expect(gap.nativeWitness.sources).toHaveLength(2);
    }
  },
);

it.each(["transformer", "drive"])(
  "FU1 an undeclared %s stage leaves a connected load without protection needs unjudged",
  (kind) => {
    const x = rootedFixture();
    addUntraversableStage(x.ir, kind, false);
    x.ir.functions = x.ir.functions.filter((f) => f.id.deviceUid !== "D");
    x.ir.internalRelations = [];
    x.request.views = x.request.views.slice(0, 1);
    x.packet.sheets = x.packet.sheets.slice(0, 1);
    x.geometries = x.geometries.slice(0, 1);
    eraseProtection(x);
    expect(rows(x)).toEqual([]);
  },
);

it("FU1 an undeclared stage leaves reachable protection explicitly unresolved", () => {
  const x = rootedFixture();
  addUntraversableStage(x.ir, "drive", true);
  eraseProtection(x);
  const judged = rows(x);
  expect(judged.map((r) => r.status)).toEqual(["infrastructure-error"]);
  expect(judged[0].evidence.failures[0].reason).toBe(
    "Native root-to-source topology unavailable",
  );
});
