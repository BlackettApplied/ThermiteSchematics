import { expect, it } from "vitest";
import { netLabelRepetition } from "./checks.mjs";
import { evaluateSheet } from "./evaluate.mjs";
import { summary } from "./assessment.mjs";
import { box, netLabelFixture as fixture } from "./net-label-fixture.mjs";
function observation(g) {
  const sheet = {
    number: 1,
    view: { format: "documentation-view/0.1", kind: "bom" },
    references: [],
    continuations: [],
  };
  return evaluateSheet(
    { id: "synthetic", flow: "left-to-right" },
    sheet,
    { sheets: [sheet] },
    g,
    { devices: [], functions: [], nets: [] },
    [],
    [],
    [],
  ).find((r) => r.dq === "DQ-17");
}
it("222.1 keyless historical route ownership is not-measured, never pass", () => {
  const { g, route } = fixture();
  route.landingOwners[0].landingEnd = "unknown";
  route.ownedLandings = [{ end: "source", reason: "missing-route-port-owner" }];
  const row = observation(g);
  expect(row.status).toBe("not-measured");
  expect(row.reason).toMatch(/ownership/i);
  expect(summary([row])["DQ-17"]["not-measured"]).toBe(1);
});
it("222.2 normalizes padded native names and printed captions with synthetic checker input", () => {
  const { g, caption, label } = fixture();
  caption.text = "  L1 \t";
  label.text = "\tL1  ";
  expect(netLabelRepetition(g).map((f) => f.kind)).toContain(
    "net-label-repeats-terminal-caption",
  );
  label.omitted = true;
  g.texts = [caption];
  g.omittedNetLabels = [label];
  g.shapes[0].potentialName = "  L1\t";
  expect(netLabelRepetition(g)).toEqual([]);
  caption.text = " N\t \nL1 ";
  label.omitted = false;
  label.text = "N L1";
  g.texts = [caption, label];
  g.omittedNetLabels = [];
  expect(netLabelRepetition(g).map((f) => f.kind)).toContain(
    "net-label-repeats-terminal-caption",
  );
  label.omitted = true;
  g.texts = [caption];
  g.omittedNetLabels = [label];
  g.shapes[0].potentialName = " N\n  L1 ";
  expect(netLabelRepetition(g)).toEqual([]);
});
it("222.3 checks the painted TAIL position against path direction independently of sourcePortId", () => {
  const { g, label } = fixture();
  g.texts = [label];
  expect(netLabelRepetition(g)).toEqual([]);
  label.bbox = box(170);
  expect(netLabelRepetition(g).map((f) => f.kind)).toContain(
    "net-label-not-at-route-source",
  );
});
it("222.3 coherent false source ownership cannot substitute a far-end caption", () => {
  const { g, label, route } = fixture();
  label.omitted = true;
  g.texts[0].bbox = box(180);
  g.texts = [g.texts[0]];
  g.omittedNetLabels = [label];
  expect(netLabelRepetition(g)).toEqual([]);
  route.ownedLandings[0].anchor = { x: 190, y: 20 };
  expect(netLabelRepetition(g).map((f) => f.kind)).toContain(
    "net-label-source-geometry-mismatch",
  );
});
it("DQ-17 credits only a painted rail at the measured native potential source", () => {
  const { g, label, route } = fixture();
  const ir = {
    potentials: [
      {
        name: "L1",
        netId: "native",
        terminal: { deviceUid: "a", terminalKey: "L1" },
      },
    ],
  };
  route.net = "native";
  route.ownedLandings[0].appearanceScope = "drawing";
  g.shapes.push({
    element: "marker-a",
    symbol: "ais:rail-source",
    appearanceScope: "drawing",
  });
  const rail = {
    ...g.texts[0],
    labelRole: "rail",
    labelOwnerKind: "rail",
    labelOwnerKey: ["rail", "a", "L1", "potential"],
  };
  label.omitted = true;
  g.omittedNetLabels = [label];
  g.texts = [rail];
  expect(netLabelRepetition(g, ir)).toEqual([]);
  for (const mutation of [
    { ...rail, reviewPainted: false },
    { ...rail, labelOwnerKey: ["rail", "b", "L1", "potential"] },
    { ...rail, appearanceScope: "other" },
    { ...rail, text: "0VDC" },
  ]) {
    g.texts = [mutation];
    expect(netLabelRepetition(g, ir).map((f) => f.kind)).toContain(
      "net-label-suppressed-without-source-caption",
    );
  }
});
