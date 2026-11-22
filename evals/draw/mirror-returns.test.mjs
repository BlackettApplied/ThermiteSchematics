import { expect, it } from "vitest";
import { mirrorReturns } from "./mirror-returns.mjs";
import { mirrorFixture, bbox, text } from "./mirror-fixture.mjs";
const audit = (f) => mirrorReturns(f.packet, f.geometries, f.ir, f.request);
const kinds = (f) => audit(f).findings.map((f) => f.kind);
it("DQ-07 one observation per full coil/contact with native NO/NC, terminals, drawn and not-drawn destinations", () => {
  const result = audit(mirrorFixture());
  expect(result.findings).toEqual([]);
  expect(result.coilAppearances).toHaveLength(1);
  expect(result.contactAppearances).toHaveLength(1);
  expect(result.contactAppearances[0].measurements[0]).toMatchObject({
    assessment: "measured-no-threshold",
  });
});
it.each([
  "drop",
  "state",
  "terminal",
  "destination",
  "foreign",
  "non-coil",
  "unspecified",
  "locator",
  "heading-zone",
  "distant",
  "duplicate",
  "obsolete",
])("DQ-07 forged %s fails", (kind) => {
  const f = mirrorFixture(),
    g = f.geometries[0],
    row = g.texts.at(-2);
  if (kind === "drop") g.texts.splice(-2, 1);
  if (kind === "state") row.text = row.text.replace("NO", "NC");
  if (kind === "terminal") row.text = row.text.replace("13–14", "13–15");
  if (kind === "destination") row.text = row.text.replace("02.A1", "02.D6");
  if (kind === "foreign")
    row.mirrorRow = JSON.stringify({ deviceUid: "foreign", functionKey: "no" });
  if (kind === "non-coil") f.ir.functions[0].kind = "source";
  if (kind === "unspecified")
    g.texts.push({
      ...row,
      text: "Contact associations unspecified",
      mirrorRow: undefined,
      mirrorRowScope: undefined,
    });
  if (kind === "locator") {
    f.packet.navigation.annotations.shift();
    for (const t of g.texts.filter((t) => t.navigationAnnotation)) {
      t.navigationContainer = "stripped";
      delete t.navigationAnnotation;
    }
  }
  if (kind === "heading-zone") g.texts.at(-3).text = "K1 /01.D6";
  if (kind === "distant")
    for (const t of g.texts.filter((t) => t.navigationAnnotation))
      t.bbox = { ...t.bbox, x: 150, y: t.bbox.y + 80 };
  if (kind === "duplicate")
    g.texts.push({ ...row, mirrorRowScope: "duplicate" });
  if (kind === "obsolete") f.ir.internalRelations.shift();
  expect(audit(f).findings.length).toBeGreaterThan(0);
});
it("DQ-07 no transitive, trips, device-level or foreign-device actuation credit", () => {
  for (const alter of [
    (r) => (r.verb = "trips"),
    (r) => (r.from = { deviceUid: "k", functionKey: "other" }),
    (r) => (r.to = { deviceUid: "foreign", functionKey: "no" }),
    (r) => (r.deviceUid = "foreign"),
  ]) {
    const f = mirrorFixture();
    alter(f.ir.internalRelations[0]);
    expect(kinds(f)).toContain("mirror-extra-row");
  }
});
it("DQ-07 unspecified is limited to own-device contacts and no eligible relation", () => {
  const f = mirrorFixture(),
    g = f.geometries[0];
  f.ir.internalRelations = [];
  g.texts = g.texts.filter((t) => !t.mirrorRow);
  g.texts.push(
    text("Contact associations unspecified", 30, 76, {
      navigationAnnotation: "a0",
      navigationRole: "mirror",
    }),
  );
  f.geometries[1].texts.at(-1).text =
    "Actuating coil not specified in device data";
  expect(audit(f).findings).toEqual([]);
  expect(
    audit(f).records.every((r) => r.assessment === "associations-unspecified"),
  ).toBe(true);
  f.ir.functions = f.ir.functions.filter((fn) => fn.kind !== "contact");
  expect(kinds(f)).toContain("mirror-block-count");
});
it("DQ-07 frameless body fallback, 60 mm Q=0.01 band and verified distant heading", () => {
  const f = mirrorFixture(),
    g = f.geometries[0];
  g.shapes = g.shapes.filter((s) => !s.outline);
  const labels = g.texts.filter((t) => t.navigationAnnotation);
  for (const t of g.texts.filter(
    (t) => t.sheetText && /^[1-6]$/.test(t.text),
  )) {
    t.anchor.x *= 2;
    t.bbox.x *= 2;
  }
  // Centroid (35,40); table left edge (94.49,40) is 59.49 mm away.
  for (const t of labels) t.bbox = { ...t.bbox, x: 94.49, y: t.bbox.y - 30 };
  expect(audit(f).findings).toEqual([]);
  for (const t of labels) t.bbox.x = 95.01;
  expect(audit(f).findings).toEqual([]);
  for (const t of labels) t.bbox.x = 95.02;
  expect(kinds(f)).toContain("mirror-locality");
  labels[0].text = "K1 /01.A1";
  expect(audit(f).findings).toEqual([]);
  labels[0].text = "K1 /01.A2";
  expect(kinds(f)).toContain("mirror-locality");
});
it("DQ-07 zone adjacency and foreign-frame ties require a self-located heading", () => {
  const f = mirrorFixture(),
    g = f.geometries[0];
  g.shapes.push({
    outline: true,
    deviceUid: "foreign",
    bbox: bbox(30, 87, 20, 10),
  });
  expect(kinds(f)).toContain("mirror-locality");
  g.texts.at(-3).text = "K1 /01.A1";
  expect(audit(f).findings).toEqual([]);
  const headings = g.texts.filter((t) => t.navigationAnnotation);
  for (const t of headings) t.bbox.x += 80;
  headings[0].text = "K1";
  expect(kinds(f)).toContain("mirror-locality");
});
it("DQ-07 returns name every coil destination and have no distance threshold", () => {
  const f = mirrorFixture(),
    row = f.geometries[1].texts.at(-1);
  row.bbox = bbox(180, 180);
  expect(audit(f).findings).toEqual([]);
  row.text = "K1 /01.D6";
  expect(kinds(f)).toContain("return-coil-set");
  row.text = "K9 /01.A1";
  expect(kinds(f)).toContain("return-coil-set");
});
it("DQ-07 full-appearance reconciliation rejects dropped seeds and fake boundary roles", () => {
  const f = mirrorFixture();
  f.packet.navigation.seeds = [];
  expect(kinds(f)).toContain("navigation-seed-reconciliation");
  f.packet.navigation.occurrences[0].role = "boundary-fragment";
  expect(kinds(f)).toContain("navigation-appearance-reconciliation");
  f.packet.navigation.occurrences.shift();
  expect(kinds(f)).toContain("navigation-appearance-reconciliation");
  const selected = mirrorFixture();
  selected.request.views[0].groups = [
    { functions: [{ device: { by: "uid", value: "k" }, key: "coil" }] },
  ];
  selected.packet.navigation.occurrences = [];
  for (const s of selected.geometries[0].shapes) delete s.deviceUid;
  for (const t of selected.geometries[0].terminals) delete t.deviceUid;
  expect(kinds(selected)).toContain("navigation-selected-appearance-missing");
});
it("DQ-07 drawings may never print not assessed", () => {
  const f = mirrorFixture();
  f.geometries[0].texts.push(text("not assessed", 100, 100));
  expect(kinds(f)).toContain("navigation-forbidden-assessment-text");
});
function gangFixture() {
  const f = mirrorFixture(),
    g = f.geometries[1],
    nc = f.ir.functions[2];
  f.ir.gangedGroups.push({
    id: "gang",
    functionIds: [f.ir.functions[1].id, nc.id],
  });
  g.shapes.push({
    ...g.shapes[0],
    functionKey: "nc",
    functionScope: "nc-body",
    bbox: bbox(60, 36, 10, 8),
  });
  g.terminals.push(
    ...nc.terminals.map((t, j) => ({
      ...g.terminals[j],
      terminal: t.terminalKey,
      functionScope: "nc-body",
      point: { x: 60 + j * 10, y: 40 },
      bbox: bbox(60 + j * 10, 40, 1, 1),
    })),
  );
  f.packet.navigation.occurrences.push({
    ...structuredClone(f.packet.navigation.occurrences[1]),
    id: "o2",
    source: nc.id,
  });
  f.packet.navigation.occurrences.at(-1).appearance = "gang-nc";
  f.packet.navigation.seeds.push({ source: nc.id, appearance: "gang-nc" });
  f.packet.navigation.annotations[1].ownerOccurrences.push("o2");
  g.shapes.push({
    element: "gang-link",
    stroke: 0.2,
    mechanicalAssociation: "ganged",
    gangedFunctions: JSON.stringify([f.ir.functions[1].id, nc.id]),
    bbox: bbox(35, 40, 30, 0),
  });
  f.geometries[0].texts.at(-1).text = "NC 21–22 02.A2";
  return f;
}
it("DQ-07 gang captions need native membership and visible association for every issued member", () => {
  const f = gangFixture();
  expect(audit(f).findings).toEqual([]);
  expect(audit(f).contactAppearances).toHaveLength(2);
  expect(
    audit(f).contactAppearances.every((r) => r.measurements.length === 1),
  ).toBe(true);
  f.geometries[1].shapes.pop();
  expect(kinds(f)).toContain("return-gang-membership");
  expect(kinds(f)).toContain("return-caption-count");
  const foreign = gangFixture();
  foreign.ir.gangedGroups[0].functionIds.pop();
  expect(kinds(foreign)).toContain("return-gang-membership");
});
it("DQ-07 gang returns are mapped per issued fragment, never across sheets", () => {
  const f = gangFixture(),
    second = f.geometries[1];
  const third = structuredClone(second);
  third.shapes = third.shapes.filter(
    (s) => s.functionScope === "nc-body" || s.outline,
  );
  third.terminals = third.terminals.filter(
    (t) => t.functionScope === "nc-body",
  );
  second.shapes = second.shapes.filter((s) => s.functionScope !== "nc-body");
  second.terminals = second.terminals.filter(
    (t) => t.functionScope !== "nc-body",
  );
  f.geometries.push(third);
  f.packet.sheets.push({ number: 3, view: { title: "Contacts" } });
  f.packet.navigation.occurrences[2].destination.sheet = 3;
  f.geometries[0].texts.at(-1).text = "NC 21–22 03.A2";
  f.packet.navigation.annotations.push({
    id: "a2",
    role: "return",
    ownerOccurrence: "o2",
    ownerOccurrences: ["o2"],
  });
  third.texts.at(-1).navigationAnnotation = "a2";
  expect(kinds(f)).toContain("return-gang-membership");
  f.packet.navigation.annotations[1].ownerOccurrences = ["o1"];
  expect(audit(f).findings).toEqual([]);
});
it("DQ-07 every repeated full coil destination is required in returns", () => {
  const f = mirrorFixture(),
    third = structuredClone(f.geometries[0]);
  f.request.views.push({ title: "Repeat coil" });
  f.packet.sheets.push({ number: 3, view: { title: "Repeat coil" } });
  third.shapes = third.shapes.map((s) => ({ ...s, navigationView: "v2" }));
  for (const t of third.texts.filter((t) => t.navigationAnnotation))
    t.navigationAnnotation = "a2";
  f.geometries.push(third);
  f.packet.navigation.occurrences.push({
    ...structuredClone(f.packet.navigation.occurrences[0]),
    id: "o2",
    destination: { sheet: 3 },
    provenance: { view: { key: "v2", authoredOrder: 2 } },
  });
  f.packet.navigation.occurrences.at(-1).appearance = "repeated-coil";
  f.packet.navigation.seeds.push({
    source: f.ir.functions[0].id,
    appearance: "repeated-coil",
  });
  f.packet.navigation.annotations.push({
    id: "a2",
    role: "mirror",
    ownerOccurrence: "o2",
    ownerOccurrences: ["o2"],
  });
  expect(kinds(f)).toContain("return-coil-set");
  f.geometries[1].texts.at(-1).text = "K1 /01.A1, /03.A1";
  expect(audit(f).findings).toEqual([]);
});
it("DQ-07 single return locator must include its actual primary contact", () => {
  const f = mirrorFixture();
  f.packet.navigation.annotations[1].ownerOccurrences = ["forged"];
  expect(kinds(f)).toContain("mirror-return-locator-mismatch");
});
it("DQ-07 adjacent-zone clause is independent of the 60 mm ceiling", () => {
  const f = mirrorFixture(),
    labels = f.geometries[0].texts.filter((t) => t.navigationAnnotation);
  for (const t of labels) t.bbox = { ...t.bbox, x: 80, y: t.bbox.y - 30 };
  expect(audit(f).coilAppearances[0].measurements[0].distanceMm).toBeLessThan(
    60,
  );
  expect(kinds(f)).toContain("mirror-locality");
  labels[0].text = "K1 /01.A1";
  expect(audit(f).findings).toEqual([]);
});
it("DQ-07 foreign-device and non-coil native relations add no rows or return coils", () => {
  const f = mirrorFixture();
  f.ir.devices.push({ uid: "foreign", designation: "K1" });
  f.ir.functions.push({
    ...structuredClone(f.ir.functions[1]),
    id: { deviceUid: "foreign", functionKey: "foreign-contact" },
  });
  f.ir.internalRelations.push(
    {
      deviceUid: "k",
      verb: "actuates",
      from: f.ir.functions[3].id,
      to: f.ir.functions[1].id,
    },
    {
      deviceUid: "k",
      verb: "actuates",
      from: f.ir.functions[0].id,
      to: f.ir.functions.at(-1).id,
    },
  );
  expect(audit(f).findings).toEqual([]);
});
it("DQ-07 clipped full bodies cannot discharge a full occurrence locator", () => {
  const f = mirrorFixture();
  f.geometries[0].shapes[0].viewport = { x: 30, y: 36, w: 5, h: 4 };
  expect(kinds(f)).toContain("navigation-unexplained-full-occurrence");
});
it("DQ-07 row count and retained-export stripped ink locators are explicit findings", () => {
  const extra = mirrorFixture();
  extra.geometries[0].texts.push({
    ...extra.geometries[0].texts.at(-1),
    mirrorRowScope: "invented",
  });
  expect(kinds(extra)).toContain("mirror-row-count");
  const f = mirrorFixture();
  f.packet.navigation.annotations[0].primitiveIds = ["mirror-ink"];
  for (const t of f.geometries[0].texts.filter((t) => t.navigationAnnotation)) {
    t.navigationContainer = "a0";
    t.primitiveIds = ["mirror-ink"];
    delete t.navigationAnnotation;
  }
  expect(kinds(f)).toContain("mirror-return-locator-mismatch");
});
it("#247 L-R3-2 mirror anchor quantization preserves legal 59.49 mm placements", () => {
  const f = mirrorFixture(),
    g = f.geometries[0];
  for (const p of g.terminals) p.point.x += 0.005;
  for (const t of g.texts.filter(
    (t) => t.sheetText && /^[1-6]$/.test(t.text),
  )) {
    t.anchor.x *= 2;
    t.bbox.x *= 2;
  }
  for (const t of g.texts.filter((t) => t.navigationAnnotation))
    t.bbox = { ...t.bbox, x: 94.5, y: t.bbox.y - 30 };
  const measured = audit(f).coilAppearances[0].measurements[0];
  expect(measured.anchor.x).toBe(35.01);
  expect(measured.distanceMm).toBeCloseTo(59.49, 6);
  expect(audit(f).findings).toEqual([]);
  for (const t of g.texts.filter((t) => t.navigationAnnotation))
    t.bbox.x = 95.031;
  expect(kinds(f)).toContain("mirror-locality");
});
it("DQ-07 actual native body visibility cannot be replaced by a claimed full role", () => {
  const f = mirrorFixture();
  f.geometries[0].shapes[0].nativeBodyPainted = false;
  expect(kinds(f)).toContain("navigation-unexplained-full-occurrence");
});
it("DQ-07 primitive locators distinguish same-function full placements on one sheet", () => {
  const f = mirrorFixture(),
    g = f.geometries[1];
  g.shapes[0].primitiveIds = ["body1"];
  f.packet.navigation.occurrences[1].primitiveIds = ["body1"];
  g.shapes.push({
    ...g.shapes[0],
    element: "body2",
    primitiveIds: ["body2"],
    functionScope: "second-body",
    bbox: { ...g.shapes[0].bbox, x: 100 },
  });
  g.terminals.push(
    ...g.terminals.map((p) => ({
      ...p,
      functionScope: "second-body",
      point: { ...p.point, x: p.point.x + 70 },
      bbox: { ...p.bbox, x: p.bbox.x + 70 },
    })),
  );
  const o = {
    ...structuredClone(f.packet.navigation.occurrences[1]),
    id: "second-o",
    appearance: "second-appearance",
    primitiveIds: ["body2"],
  };
  f.packet.navigation.occurrences.push(o);
  f.packet.navigation.seeds.push({
    source: o.source,
    appearance: o.appearance,
  });
  f.packet.navigation.annotations.push({
    id: "second-a",
    role: "return",
    ownerOccurrence: o.id,
    ownerOccurrences: [o.id],
  });
  g.texts.push({
    ...g.texts.at(-1),
    navigationAnnotation: "second-a",
    bbox: { ...g.texts.at(-1).bbox, x: 100 },
  });
  f.geometries[0].texts.at(-2).text = "NO 13–14 02.A1 02.A4";
  expect(audit(f).findings).toEqual([]);
  f.packet.navigation.occurrences[1].primitiveIds = ["forged"];
  expect(kinds(f)).toContain("navigation-appearance-reconciliation");
});

function outOfScopeContactFixture(trips) {
  const f = mirrorFixture();
  f.ir.devices[0].designation = "PB1";
  f.ir.functions = f.ir.functions.filter((fn) => fn.kind !== "coil");
  f.ir.internalRelations = trips
    ? [
        {
          deviceUid: "k",
          verb: "trips",
          from: { deviceUid: "k", functionKey: "other" },
          to: { deviceUid: "k", functionKey: "no" },
        },
      ]
    : [];
  f.packet.navigation.occurrences = f.packet.navigation.occurrences.filter(
    (o) => o.id === "o1",
  );
  f.packet.navigation.seeds = f.packet.navigation.seeds.filter(
    (s) => s.source.functionKey === "no",
  );
  f.packet.navigation.annotations = [];
  f.geometries[0].shapes = [];
  f.geometries[0].terminals = [];
  for (const g of f.geometries)
    g.texts = g.texts.filter((t) => !t.navigationAnnotation);
  return f;
}
function addContactCaption(f, caption, role = "return") {
  f.packet.navigation.annotations.push({
    id: "contact-caption",
    role,
    ownerOccurrence: "o1",
    ownerOccurrences: ["o1"],
  });
  f.geometries[1].texts.push(
    text(caption, 30, 70, {
      navigationAnnotation: "contact-caption",
      navigationRole: role,
    }),
  );
}
it.each([false, true])(
  "S1 out-of-scope contact permits no return caption (trips-only: %s)",
  (trips) => {
    const f = outOfScopeContactFixture(trips);
    expect(audit(f).findings).toEqual([]);
    expect(audit(f).contactAppearances).toMatchObject([
      { assessment: "outside-direct-actuation-scope", measurements: [] },
    ]);
    addContactCaption(f, "K1 /02.B3");
    // The zero-caption rule must fire, independently of caption text checks.
    expect(audit(f).findings).toContainEqual(
      expect.objectContaining({
        kind: "return-caption-count",
        deviceUid: "k",
        functionKey: "no",
        expected: 0,
        actual: 1,
      }),
    );
  },
);
it("S1b a local mirror heading must name its native coil", () => {
  const f = mirrorFixture();
  expect(audit(f).findings).toEqual([]);
  expect(audit(f).coilAppearances[0].measurements[0]).toMatchObject({
    ownerNearest: true,
    selfLocated: false,
  });
  f.geometries[0].texts.at(-3).text = "K2";
  expect(audit(f).findings).toContainEqual(
    expect.objectContaining({
      kind: "mirror-locality",
      deviceUid: "k",
      functionKey: "coil",
      actual: "K2",
      expectedHeading: "K1 /01.A1",
    }),
  );
});
function unspecifiedFixture() {
  const f = mirrorFixture();
  f.ir.internalRelations = [];
  f.geometries[0].texts = f.geometries[0].texts.filter((t) => !t.mirrorRow);
  f.geometries[0].texts.push(
    text("Contact associations unspecified", 30, 76, {
      navigationAnnotation: "a0",
      navigationRole: "mirror",
    }),
  );
  f.geometries[1].texts.at(-1).text =
    "Actuating coil not specified in device data";
  return f;
}
function stripMirrorRoles(f) {
  delete f.packet.navigation.annotations.find((a) => a.id === "a0").role;
  for (const t of f.geometries[0].texts)
    if (t.navigationAnnotation === "a0") delete t.navigationRole;
}
it.each(["native row locator", "unspecified wording"])(
  "S1c valid role-stripped mirror is discovered through %s",
  (discovery) => {
    const f =
      discovery === "native row locator"
        ? mirrorFixture()
        : unspecifiedFixture();
    stripMirrorRoles(f);
    expect(audit(f).findings).toEqual([]);
    expect(audit(f).coilAppearances[0].blocks).toHaveLength(1);
  },
);
it.each(["native row locator", "unspecified wording"])(
  "S1c role-stripped stray mirror cannot disappear (%s)",
  (discovery) => {
    const f =
      discovery === "native row locator"
        ? mirrorFixture()
        : unspecifiedFixture();
    f.ir.functions = f.ir.functions.filter((fn) => fn.kind !== "contact");
    f.ir.internalRelations = [];
    f.geometries[1].shapes = [];
    f.geometries[1].terminals = [];
    f.geometries[1].texts = f.geometries[1].texts.filter(
      (t) => !t.navigationAnnotation,
    );
    f.packet.navigation.occurrences = f.packet.navigation.occurrences.filter(
      (o) => o.id === "o0",
    );
    f.packet.navigation.seeds = f.packet.navigation.seeds.filter(
      (s) => s.source.functionKey === "coil",
    );
    f.packet.navigation.annotations = f.packet.navigation.annotations.filter(
      (a) => a.id === "a0",
    );
    stripMirrorRoles(f);
    const stray = f.geometries[0].texts.filter((t) => t.navigationAnnotation);
    f.geometries[0].texts = f.geometries[0].texts.filter(
      (t) => !t.navigationAnnotation,
    );
    expect(audit(f).findings).toEqual([]);
    f.geometries[0].texts.push(...stray);
    expect(audit(f).findings).toContainEqual(
      expect.objectContaining({
        kind: "mirror-block-count",
        expected: 0,
        actual: 1,
      }),
    );
  },
);
function tripsContactWithCoilFixture() {
  const f = unspecifiedFixture();
  f.ir.internalRelations = [
    {
      deviceUid: "k",
      verb: "trips",
      from: { deviceUid: "k", functionKey: "other" },
      to: { deviceUid: "k", functionKey: "no" },
    },
  ];
  f.geometries[1].texts = f.geometries[1].texts.filter(
    (t) => !t.navigationAnnotation,
  );
  f.packet.navigation.annotations = f.packet.navigation.annotations.filter(
    (a) => a.id === "a0",
  );
  return f;
}
it("L2 trips suppresses unspecified for a contact whose own device has a coil", () => {
  const f = tripsContactWithCoilFixture();
  expect(audit(f).findings).toEqual([]);
  expect(audit(f).contactAppearances[0]).toMatchObject({
    assessment: "outside-direct-actuation-scope",
    blocks: [],
  });
});
it("L2 a trips contact must reject an unspecified-coil caption", () => {
  const f = tripsContactWithCoilFixture();
  addContactCaption(
    f,
    "Actuating coil not specified in device data",
    "association-unspecified",
  );
  expect(audit(f).findings).toContainEqual(
    expect.objectContaining({
      kind: "return-caption-count",
      expected: 0,
      actual: 1,
    }),
  );
});
it("L2 removing the trips relation restores the unspecified-coil obligation", () => {
  const f = tripsContactWithCoilFixture();
  f.ir.internalRelations = [];
  expect(audit(f).findings).toContainEqual(
    expect.objectContaining({
      kind: "return-caption-count",
      expected: 1,
      actual: 0,
    }),
  );
  addContactCaption(
    f,
    "Actuating coil not specified in device data",
    "association-unspecified",
  );
  expect(audit(f).findings).toEqual([]);
});
