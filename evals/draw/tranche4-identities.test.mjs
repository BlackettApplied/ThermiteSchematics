import { expect, it } from "vitest";
import { identityFixture, wire4, end, text } from "./tranche4-fixtures.mjs";
import { conductorIdentityAudit } from "./conductor-identity-oracle.mjs";
import { nativeConductors4 } from "./tranche4-source.mjs";
const audit = (x) => conductorIdentityAudit(x.sheet, x.g, x.ir, x.rows);
it.each(["101", "W-A (101)", "101 (W-A)", "W-A / 101"])(
  "N8 positive: source primary and paired identity %s",
  (value) => {
    const x = identityFixture();
    x.g.tranche4.cards[0].texts[0].text = `${value} → K2.T`;
    expect(audit(x).findings).toEqual([]);
  },
);
it("N8 positive: explicit native alias, wrapped primary and inventory alias", () => {
  const x = identityFixture();
  x.ir.wires[0].aliases = ["Control"];
  x.g.tranche4.cards[0].texts = [text("Con"), text("trol → K2.T")];
  x.rows[0].cells[0] = "Control";
  expect(audit(x).findings).toEqual([]);
});
it.each([
  [
    "same-net card swap",
    (x) => (x.g.tranche4.cards[0].conductors[0].uid = "B"),
  ],
  [
    "stripped card alias",
    (x) => (x.g.tranche4.cards[0].texts[0].text = "W-A → K2.T"),
  ],
  [
    "truncated protected designation",
    (x) => (x.g.tranche4.cards[0].texts[0].text = "W- (101) → K2.T"),
  ],
  [
    "wrong peer",
    (x) => (x.g.tranche4.cards[0].texts[0].text = "101 → K2.WRONG"),
  ],
  ["erased card text", (x) => (x.g.tranche4.cards[0].texts = [])],
  [
    "foreign native owner",
    (x) => (x.g.tranche4.cards[0].terminalId = end("FOREIGN")),
  ],
  ["same-net stroke swap", (x) => (x.g.texts.at(-1).wire = "B")],
  [
    "forged semantic owner",
    (x) => {
      x.g.texts.at(-1).labelOwnerKind = "edge";
      x.g.texts.at(-1).labelOwnerKey = ["wire", "B"];
    },
  ],
  [
    "native endpoints changed",
    (x) => (x.g.shapes[0].endpoints = [end("E"), end("FOREIGN")]),
  ],
  ["inventory alias stripped", (x) => (x.rows[0].cells[0] = "W-A")],
  ["missing visible inventory", (x) => (x.rows[0].visible = false)],
  ["source missing", (x) => delete x.ir.wires],
  ["missing private measurement", (x) => delete x.g.tranche4],
  ["erased stroke ink", (x) => (x.g.tranche3.routeInk = {})],
])("N8 mutation killed: %s", (_name, mutate) => {
  const x = identityFixture();
  expect(audit(x).findings).toEqual([]);
  mutate(x);
  expect(audit(x).findings.length).toBeGreaterThan(0);
});
it("N8 continuation positive and mutation: native alias is reconciled independently", () => {
  const x = identityFixture();
  x.sheet.continuations = [
    { id: "C001", toSheet: 2, provenance: { kind: "wire", uid: "A" } },
  ];
  x.g.connectors = [{ id: "C001", toSheet: 2, element: "link" }];
  x.g.texts.push(
    text("C001 / 02.A1 / 101", {
      continuationLink: "link",
      element: "continuation",
    }),
  );
  expect(audit(x).findings).toEqual([]);
  x.g.texts.at(-1).text = "C001 / 02.A1 / 102";
  expect(audit(x).findings.map((f) => f.kind)).toContain(
    "conductor-continuation-native-identity-disagrees",
  );
});
it("N8 cores: punctuation alias is allowed, native core UID substitution is killed", () => {
  const x = identityFixture();
  x.g.tranche4.cards = [];
  x.g.texts = x.g.texts.filter((t) => !t.wire);
  x.rows = [];
  x.ir.cables = [{ uid: "C", designation: "CBL", typeId: "ct" }];
  x.ir.cableTypes = [{ id: "ct", conductors: [{ id: "1" }, { id: "2" }] }];
  x.ir.cableConductors = [
    { id: { cableUid: "C", conductorId: "1" }, endpoints: wire4().endpoints },
  ];
  const key = JSON.stringify(["C", "1"]);
  x.rows = [
    {
      sheet: 1,
      kind: "wires",
      key,
      visible: true,
      cells: { 0: "CBL/1" },
      texts: [text("CBL/1")],
    },
  ];
  expect(audit(x).findings).toEqual([]);
  x.rows[0].key = JSON.stringify(["C", "2"]);
  expect(audit(x).findings.length).toBeGreaterThan(0);
  expect(nativeConductors4(x.ir).get(JSON.stringify(["C", "2"])).physical).toBe(
    false,
  );
});
it("N8 mutation killed: malformed terminal identity cannot turn an unassigned core into a spare card", () => {
  const x = identityFixture();
  x.rows = [];
  x.g.texts = x.g.texts.filter((t) => !t.wire);
  x.ir.cables = [{ uid: "C", designation: "CBL", typeId: "ct" }];
  x.ir.cableTypes = [{ id: "ct", conductors: [{ id: "1" }] }];
  const c = x.g.tranche4.cards[0];
  c.terminalId = {};
  c.conductors = [{ kind: "core", cableUid: "C", conductorId: "1" }];
  c.texts = [text("CBL.1 → unterminated (spare)")];
  expect(audit(x).findings.map((f) => f.kind)).toContain(
    "conductor-card-source-unavailable",
  );
});
it("N8 positive and mutation: a native self-loop peer remains its own terminal, not a spare", () => {
  const x = identityFixture();
  x.ir.wires[0].endpoints = wire4("A", "101", [end("D"), end("D")]).endpoints;
  x.g.shapes[0].endpoints = x.ir.wires[0].endpoints.map((e) => e.terminal);
  const t = x.g.tranche4.cards[0].texts[0];
  t.text = "101 → K1.T";
  expect(audit(x).findings).toEqual([]);
  t.text = "101 → unterminated (spare)";
  expect(audit(x).findings.length).toBeGreaterThan(0);
});
