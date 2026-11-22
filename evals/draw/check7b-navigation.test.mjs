import { expect, it } from "vitest";
import { rootedFixture, eraseProtection } from "./check7b-fixture.mjs";
import { portFixture } from "./check5-navigation-fixture.mjs";
import { nativePartAudit } from "./native-part-references.mjs";
import { navigationStrictObservations } from "./navigation-strict.mjs";
import { observation } from "./evaluate.mjs";
import { viewBindings } from "./tranche4-views.mjs";
import { terminalId } from "./tranche4-source.mjs";
const rows = (x) =>
  navigationStrictObservations(
    { id: "check7b" },
    x.packet,
    x.geometries,
    x.ir,
    x.request,
    observation,
  );
it("FU1 native rooted topology retains a judgment after the element and all locators vanish", () => {
  const x = rootedFixture();
  expect(
    rows(x)
      .filter((r) => r.owner === "#396")
      .every((r) => r.status === "pass"),
  ).toBe(true);
  eraseProtection(x);
  const judged = rows(x).filter((r) => r.owner === "#396");
  expect(
    judged.some((r) => ["fail", "infrastructure-error"].includes(r.status)),
  ).toBe(true);
  const gaps = judged.flatMap((r) => [
    ...(r.evidence.findings ?? []),
    ...(r.evidence.failures ?? []),
  ]);
  expect(gaps).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ deviceUid: "D", view: 0 }),
    ]),
  );
});
it.each([false, true])(
  "FU2 shared drawing defects preserve per-port judgment (bad pointer=%s)",
  (bad) => {
    const x = portFixture();
    x.geometries[0].tranche4.communicationLinks[0].ends.reverse();
    expect(
      nativePartAudit(x.packet, x.geometries, x.ir, x.request).findings.some(
        (f) => f.kind === "native-part-port-link-disagrees",
      ),
    ).toBe(true);
    if (bad)
      x.geometries[0].tranche4.partRefs[0].texts[0].text = "N05.IN → 01.A1";
    const judged = rows(x).filter((r) => r.owner === "#398");
    expect(judged.some((r) => r.status === "infrastructure-error")).toBe(false);
    expect(judged.find((r) => r.sheet === 1)?.status).toBe(
      bad ? "fail" : "pass",
    );
    expect(judged.flatMap((r) => r.evidence.obligations)).toHaveLength(10);
  },
);
it("FU2 unavailable native port measurement remains infrastructure", () => {
  const x = portFixture();
  x.geometries[0].tranche4.ports[0].deviceUid = "UNKNOWN";
  expect(
    rows(x).some(
      (r) => r.owner === "#398" && r.status === "infrastructure-error",
    ),
  ).toBe(true);
});
it("FU1 programming errors propagate instead of becoming measurement gaps", () => {
  const x = rootedFixture();
  let raised, thrown;
  Object.defineProperty(x.ir, "potentials", {
    get() {
      raised = new TypeError("programming probe inside native topology");
      throw raised;
    },
  });
  try {
    rows(x);
  } catch (error) {
    thrown = error;
  }
  expect(raised).toBeInstanceOf(TypeError);
  expect(raised.stack).toContain("nativePowerTopology");
  expect(raised.stack).toContain("rootedElementGaps");
  expect(raised.stack).not.toContain("fullCircuitAppearances");
  expect(thrown).toBe(raised);
});
it("FU1 unambiguous native coverage reports all three missing poles with source locators", () => {
  const x = rootedFixture();
  eraseProtection(x);
  x.packet.coverage = { functions: [], correct: true };
  const judged = rows(x).filter((r) => r.owner === "#396");
  expect(judged.every((r) => r.status === "fail")).toBe(true);
  const gaps = judged.flatMap((r) => r.evidence.findings);
  expect(gaps.map((f) => f.sourceFunction).sort()).toEqual([
    "pole1",
    "pole2",
    "pole3",
  ]);
  expect(
    gaps.every(
      (f) =>
        f.locator.requestView === 0 &&
        f.locator.function.deviceUid === "D" &&
        f.sheet === 1,
    ),
  ).toBe(true);
});
it.each(["supply terminal", "potential source"])(
  "FU1 a shared %s bounds the rooted corridor",
  (boundary) => {
    const x = rootedFixture();
    const { ir } = x;
    const other = { ...ir.devices[0], uid: "D2", designation: "OL2" };
    ir.devices.push(other);
    const source = ir.functions.find((f) => f.kind === "source");
    if (boundary === "potential source") {
      ir.functions = ir.functions.filter((f) => f !== source);
      ir.potentials = source.terminals.map((terminal) => ({ terminal }));
    }
    const otherFunctions = ir.functions
      .filter((f) => f.id.deviceUid === "D")
      .map((f) => ({
        ...f,
        id: { ...f.id, deviceUid: other.uid },
        terminals: f.terminals.map((t) => ({ ...t, deviceUid: other.uid })),
      }));
    ir.functions.push(...otherFunctions);
    for (const [i, terminal] of source.terminals.entries()) {
      const pole = otherFunctions.find(
        (f) => f.id.functionKey === `pole${i + 1}`,
      );
      ir.wires.push({
        uid: `other-${i}`,
        endpoints: [terminal, pole.terminals[0]].map((t) => ({ terminal: t })),
      });
      const beyond = { deviceUid: "S", terminalKey: `reserve-${i}` };
      ir.potentials ??= [];
      ir.potentials.push({ terminal: beyond });
      ir.wires.push({
        uid: `reserve-${i}`,
        endpoints: [terminal, beyond].map((t) => ({ terminal: t })),
      });
    }
    const judged = () => rows(x).filter((r) => r.owner === "#396");
    expect(judged().map((r) => r.status)).toEqual(["pass", "pass"]);
    eraseProtection(x);
    const omissions = judged();
    expect(omissions.map((r) => r.status)).toEqual(["fail"]);
    expect(omissions[0].evidence.findings.map((f) => f.deviceUid)).toEqual([
      "D",
      "D",
      "D",
    ]);
    expect(
      omissions[0].evidence.findings
        .flatMap((f) => f.nativeWitness.sources)
        .sort(),
    ).toEqual(source.terminals.map(terminalId).sort());
  },
);
it("FU1 parallel native paths stay explicit infrastructure instead of inventing a selected branch", () => {
  const x = rootedFixture();
  eraseProtection(x);
  x.ir.wires.push(
    ...x.ir.functions
      .filter((f) => f.id.functionKey.startsWith("pole"))
      .map((f, i) => ({
        uid: `B${i}`,
        endpoints: f.terminals.map((terminal) => ({ terminal })),
      })),
  );
  const judged = rows(x).filter((r) => r.owner === "#396");
  expect(judged).toHaveLength(1);
  expect(judged[0].status).toBe("infrastructure-error");
  expect(judged[0].evidence.failures).toHaveLength(3);
});
it.each(["conductors", "source", "root", "issued view", "disconnected root"])(
  "FU1 missing %s fails closed",
  (kind) => {
    const x = rootedFixture();
    eraseProtection(x);
    if (kind === "conductors") delete x.ir.wires;
    if (kind === "source")
      x.ir.functions = x.ir.functions.filter((f) => f.kind !== "source");
    if (kind === "root") x.request.views[0].root.value = "UNKNOWN";
    if (kind === "issued view") {
      x.geometries[0].navigationViews = [];
      x.packet.sheets[0].view = {};
    }
    if (kind === "disconnected root") x.ir.wires = [];
    expect(
      rows(x).some(
        (r) => r.owner === "#396" && r.status === "infrastructure-error",
      ),
    ).toBe(true);
  },
);
it("FU2 an unavailable part identity alone remains infrastructure", () => {
  const x = portFixture();
  x.geometries[0].texts.find((t) => t.text === "Part 1/3").text = "Part 0/3";
  expect(
    rows(x)
      .filter((r) => r.owner === "#398")
      .flatMap((r) => r.evidence.failures ?? [])
      .some(
        (f) => f.kind === "port-navigation-native-part-identity-unavailable",
      ),
  ).toBe(true);
});
it("FU2 missing every issued part diagnoses selected ink instead of dropping obligations silently", () => {
  const x = portFixture();
  x.geometries.forEach((g) => {
    g.navigationViews = [];
  });
  const failures = rows(x)
    .filter((r) => r.owner === "#398")
    .flatMap((r) => r.evidence.failures ?? []);
  expect(
    failures.some((f) => f.kind === "port-navigation-selected-ink-unavailable"),
  ).toBe(true);
  expect(failures.some((f) => f.kind.endsWith("whole-link-not-once"))).toBe(
    false,
  );
});
it("FU1 another authored view cannot lend its complete protection appearance", () => {
  const x = rootedFixture();
  x.request.views.push(structuredClone(x.request.views[0]));
  x.packet.sheets.push({ ...structuredClone(x.packet.sheets[0]), number: 3 });
  x.geometries.push(structuredClone(x.geometries[0]));
  const key = viewBindings(x.request, x.ir)[2];
  x.geometries[2].navigationViews = [key];
  [...x.geometries[2].shapes, ...x.geometries[2].terminals].forEach((s) => {
    s.navigationView = key;
  });
  eraseProtection(x);
  expect(
    rows(x).some(
      (r) =>
        r.owner === "#396" &&
        r.status === "fail" &&
        r.sheet === 1 &&
        r.evidence.findings.some((f) => f.view === 0),
    ),
  ).toBe(true);
});
