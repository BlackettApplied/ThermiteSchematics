import { afterAll, beforeAll, expect, it } from "vitest";
import { offViewFixture, parseSvg } from "./off-view-fixtures.js";
import {
  mirrorFixture,
  type MirrorPlacement,
} from "./packet-mirror-fixture.js";
import { coilUid } from "./packet-navigation-fixture.js";
import { finalizeNavigation } from "../src/packet/navigation-finalize.js";
import { parallelCircuitFixture } from "./circuit-fixture.js";
import { loadSchemaRegistry, parseJson } from "@thermite/schema";
import type { ElectricalIr, IrFunction } from "@thermite/compiler";

let source: Awaited<ReturnType<typeof offViewFixture>>;
beforeAll(async () => {
  source = await offViewFixture();
});
afterAll(async () => {
  await source.dispose();
});
const placement = (key: string, x = 100, y = 100): MirrorPlacement => ({
  uid: coilUid,
  key,
  x,
  y,
});
const finish = (f: ReturnType<typeof mirrorFixture>) => {
  const result = finalizeNavigation(f.ir, f.drafts, f.sheets);
  if (!result.ok) throw Error(JSON.stringify(result.error));
  return result.value;
};
const mirror = (r: ReturnType<typeof finish>) =>
  r.navigation.annotations.filter((a) => a.role === "mirror");

it("omits tables and the contact-table notice for a coil-only device", () => {
  const f = mirrorFixture(source.ir, [[placement("coil")]]);
  f.ir.functions = f.ir.functions.filter(
    (fn) => fn.id.deviceUid !== coilUid || fn.kind !== "contact",
  );
  f.ir.internalRelations = f.ir.internalRelations.filter(
    (r) => r.deviceUid !== coilUid,
  );
  const r = finish(f);
  expect(
    r.navigation.occurrences.filter((o) => o.role === "full-function"),
  ).toHaveLength(1);
  expect(r.navigation.annotations).toEqual([]);
});

it("retains authored NC and changeover common-terminal sets", async () => {
  const relay = await parallelCircuitFixture();
  try {
    const uid = relay.ir.devices.find((d) => d.designation === "K1")!.uid;
    const f = mirrorFixture(relay.ir, [[{ uid, key: "coil", x: 100, y: 100 }]]);
    const r = finish(f);
    expect(
      mirror(r)[0]!.mirror!.rows.map((row) => [row.state, row.terminals]),
    ).toEqual([
      ["NO", ["11", "14"]],
      ["NC", ["11", "12"]],
    ]);
    expect(
      [
        ...parseSvg(r.sheets[0]!.svg).querySelectorAll(
          "[data-navigation-mirror-row]",
        ),
      ].map((n) => n.textContent),
    ).toEqual(["NO11 / 14not drawn", "NC11–12not drawn"]);
  } finally {
    await relay.dispose();
  }
});

it.each([undefined, "invalid", "NO"])(
  "strictly rejects contact normal_state %s",
  async (state) => {
    const registry = await loadSchemaRegistry();
    const value = {
      kind: "device_type",
      id: "synthetic:relay",
      terminals: { a: {}, b: {} },
      functions: {
        contact: {
          kind: "contact",
          terminals: ["a", "b"],
          ...(state === undefined ? {} : { normal_state: state }),
        },
      },
    };
    const parsed = parseJson(JSON.stringify(value), "synthetic.json");
    const diagnostics = registry.validateEntity("device-type", parsed.value!, {
      file: "synthetic.json",
      nodes: parsed.nodes,
    });
    expect(
      diagnostics.some(
        (d) =>
          d.code === (state === undefined ? "E010" : "E014") &&
          (d.message.includes("normal_state") ||
            d.jsonPointer.includes("normal_state")),
      ),
    ).toBe(true);
  },
);

it.each([
  "channel",
  "mechanism",
  "trips",
  "foreign-uid",
  "device-level",
  "transitive",
])("does not infer coil rows for %s", (kind) => {
  const ir = structuredClone(source.ir);
  if (kind === "channel" || kind === "mechanism") {
    ir.functions = ir.functions.map((f) =>
      f.id.deviceUid === coilUid && f.kind === "coil"
        ? {
            id: f.id,
            source: f.source,
            terminals: f.terminals,
            ...(kind === "channel"
              ? { kind: "channel" as const, direction: "output" as const }
              : { kind: "mechanism" as const }),
          }
        : f,
    );
  } else if (kind === "trips") {
    for (const r of ir.internalRelations)
      if (r.deviceUid === coilUid && r.verb === "actuates") r.verb = "trips";
  } else if (kind === "foreign-uid") {
    const target = structuredClone(
      ir.functions.find(
        (f) => f.id.deviceUid === coilUid && f.kind === "contact",
      )!,
    );
    target.id.deviceUid = "foreign";
    ir.functions.push(target);
    for (const r of ir.internalRelations)
      if (r.deviceUid === coilUid && r.verb === "actuates")
        r.to.deviceUid = "foreign";
  } else if (kind === "transitive") {
    const coil = ir.functions.find(
      (f) => f.id.deviceUid === coilUid && f.kind === "coil",
    )!;
    ir.functions.push({
      ...coil,
      id: { deviceUid: coilUid, functionKey: "link" },
      kind: "mechanism",
    });
    for (const r of ir.internalRelations)
      if (r.deviceUid === coilUid && r.verb === "actuates")
        r.from.functionKey = "link";
    ir.internalRelations.push({
      deviceUid: coilUid,
      verb: "actuates",
      from: coil.id,
      to: { deviceUid: coilUid, functionKey: "link" },
      sourceOrigins: [coil.source],
    });
  } else {
    ir.internalRelations = ir.internalRelations.filter(
      (r) => r.deviceUid !== coilUid || r.verb !== "actuates",
    );
    ir.relations.push({
      uid: "86000000-0000-4000-8000-000000000001",
      verb: "actuates",
      from: { kind: "device", uid: coilUid },
      to: { kind: "device", uid: coilUid },
      source: ir.devices[0]!.source,
    } as ElectricalIr["relations"][number]);
  }
  const r = finish(mirrorFixture(ir, [[placement("coil")]]));
  expect(mirror(r).flatMap((a) => a.mirror!.rows)).toEqual([]);
  expect(r.sheets.map((s) => s.svg).join("")).not.toMatch(
    /0 contacts|not assessed/,
  );
});

it.each(["no-coil", "no-relation", "non-coil-actuator", "device-level"])(
  "limits the unspecified contact note: %s",
  (kind) => {
    const ir = structuredClone(source.ir);
    ir.internalRelations = ir.internalRelations.filter(
      (r) => r.verb !== "actuates" || r.deviceUid !== coilUid,
    );
    if (kind === "no-coil")
      ir.functions = ir.functions.filter(
        (f) => f.id.deviceUid !== coilUid || f.kind !== "coil",
      );
    if (kind === "non-coil-actuator") {
      const f = ir.functions.find(
        (f) => f.id.deviceUid === coilUid && f.kind === "coil",
      )!;
      ir.functions.push({
        ...f,
        id: { deviceUid: coilUid, functionKey: "mechanism" },
        kind: "mechanism",
      });
      ir.internalRelations.push({
        deviceUid: coilUid,
        verb: "actuates",
        from: { deviceUid: coilUid, functionKey: "mechanism" },
        to: { deviceUid: coilUid, functionKey: "pole1" },
        sourceOrigins: [f.source],
      });
    }
    const r = finish(mirrorFixture(ir, [[placement("pole1")]]));
    expect(
      r.navigation.annotations.filter(
        (a) => a.role === "association-unspecified",
      ),
    ).toHaveLength(["no-relation", "device-level"].includes(kind) ? 1 : 0);
  },
);

it("lists each direct target once with all relation origins and every final destination", () => {
  const ir = structuredClone(source.ir);
  const relation = ir.internalRelations.find(
    (r) =>
      r.deviceUid === coilUid &&
      r.verb === "actuates" &&
      r.to.functionKey === "pole1",
  )!;
  ir.internalRelations.push({
    ...structuredClone(relation),
    sourceOrigins: [
      { ...relation.sourceOrigins[0]!, jsonPointer: "/second-origin" },
    ],
  });
  const r = finish(
    mirrorFixture(ir, [
      [placement("coil"), placement("pole1", 200, 100)],
      [placement("pole1", 200, 160)],
    ]),
  );
  const rows = mirror(r)[0]!.mirror!.rows;
  expect(rows).toHaveLength(4);
  expect(rows[0]!.destinations).toEqual(["01.B4", "02.C4"]);
  expect(rows[0]!.sourceOrigins).toHaveLength(2);
  expect(rows[0]!.targets).toHaveLength(2);
  expect(rows.slice(1).every((row) => !row.destinations.length)).toBe(true);
  const returns = r.navigation.annotations.filter((a) => a.role === "return");
  expect(returns.map((a) => a.text)).toEqual(["K1 /01.B2", "K1 /01.B2"]);
});

it("returns every repeated coil and only each coil's direct authored rows", () => {
  const ir = structuredClone(source.ir);
  const coil = ir.functions.find(
    (f) => f.id.deviceUid === coilUid && f.kind === "coil",
  )!;
  ir.functions.push({
    ...coil,
    id: { deviceUid: coilUid, functionKey: "coil two" },
  });
  const relation = ir.internalRelations.find(
    (r) =>
      r.deviceUid === coilUid &&
      r.verb === "actuates" &&
      r.to.functionKey === "pole1",
  )!;
  ir.internalRelations.push({
    ...relation,
    from: { deviceUid: coilUid, functionKey: "coil two" },
  });
  const r = finish(
    mirrorFixture(ir, [
      [
        placement("coil", 60, 100),
        placement("coil two", 160, 100),
        placement("pole1", 260, 160),
      ],
      [placement("coil", 60, 100)],
    ]),
  );
  expect(mirror(r).map((a) => a.mirror!.rows.length)).toEqual([4, 1, 4]);
  expect(r.navigation.annotations.find((a) => a.role === "return")!.text).toBe(
    "K1 /01.B2, /02.B2; K1 /01.B3",
  );
});

it("marks terminal contexts and report-only contacts as not drawn", () => {
  const f = mirrorFixture(source.ir, [
    [placement("coil")],
    [placement("pole1", 200, 160)],
  ]);
  f.drafts[1]!.navigationSeeds = f.drafts[1]!.navigationSeeds!.map((s) => ({
    ...s,
    representation: "terminal",
  }));
  f.drafts[1]!.view = {
    format: "documentation-view/0.1",
    kind: "references",
    title: "Report only",
  };
  f.sheets[1]!.view = f.drafts[1]!.view;
  const r = finish(f);
  expect(
    mirror(r)[0]!.mirror!.rows.every((row) => row.targets.length === 0),
  ).toBe(true);
  expect(
    [
      ...parseSvg(r.sheets[0]!.svg).querySelectorAll(
        "[data-navigation-mirror-row]",
      ),
    ].every((n) => n.textContent!.endsWith("not drawn")),
  ).toBe(true);
});

it.each([true, false])(
  "requires native gang membership and a visible association, grouped=%s",
  (linked) => {
    const f = mirrorFixture(
      source.ir,
      [
        [
          placement("coil", 100, 40),
          placement("pole1", 100, 100),
          placement("pole2", 160, 100),
          placement("pole3", 220, 100),
        ],
      ],
      linked,
    );
    const r = finish(f),
      returns = r.navigation.annotations.filter((a) => a.role === "return");
    expect(returns).toHaveLength(linked ? 1 : 3);
    expect(returns.flatMap((a) => a.ownerOccurrences)).toHaveLength(3);
    if (linked)
      expect(returns[0]!.gangId).toBe(
        source.ir.gangedGroups.find((g) =>
          g.functionIds.some((f) => f.deviceUid === coilUid),
        )!.id,
      );
  },
);

it("issues a separate return for every split gang fragment, never a nonmember", () => {
  const f = mirrorFixture(
    source.ir,
    [
      [
        placement("coil", 100, 40),
        placement("pole1", 100, 100),
        placement("pole2", 160, 100),
        placement("aux13", 220, 160),
      ],
      [placement("pole3", 100, 100)],
    ],
    true,
  );
  const r = finish(f),
    returns = r.navigation.annotations.filter((a) => a.role === "return");
  expect(returns.map((a) => a.ownerOccurrences.length)).toEqual([2, 1, 1]);
  expect(
    returns.map(
      (a) =>
        r.navigation.occurrences.find((o) => o.id === a.ownerOccurrence)!
          .destination.sheet,
    ),
  ).toEqual([1, 1, 2]);
});

it("does not group an authored gang whose members have different coil sets", () => {
  const ir = structuredClone(source.ir);
  ir.internalRelations = ir.internalRelations.filter(
    (r) =>
      !(
        r.deviceUid === coilUid &&
        r.verb === "actuates" &&
        r.to.functionKey === "pole2"
      ),
  );
  const r = finish(
    mirrorFixture(
      ir,
      [[placement("pole1", 100, 100), placement("pole2", 160, 100)]],
      true,
    ),
  );
  expect(
    r.navigation.annotations
      .filter((a) => a.role === "return")
      .map((a) => a.ownerOccurrences.length),
  ).toEqual([1]);
  expect(
    r.navigation.annotations.filter(
      (a) => a.role === "association-unspecified",
    ),
  ).toHaveLength(1);
});

it("supports arbitrary function, terminal and tag identities without inferring state", () => {
  const ir = structuredClone(source.ir),
    old = { deviceUid: coilUid, functionKey: "pole1" },
    name = 'contact / Ω " <';
  const contact = ir.functions.find(
    (f) => f.id.deviceUid === coilUid && f.id.functionKey === "pole1",
  )!;
  contact.id.functionKey = name;
  contact.terminals = ["+", "-", "S/Ω"].map((terminalKey) => ({
    deviceUid: coilUid,
    terminalKey,
  }));
  for (const r of ir.internalRelations)
    if (
      r.to.deviceUid === old.deviceUid &&
      r.to.functionKey === old.functionKey
    )
      r.to.functionKey = name;
  for (const [i, terminal] of contact.terminals.entries()) {
    ir.indexes.netIdByTerminal.push({
      key: terminal,
      value: `synthetic-net-${i}`,
    });
    ir.nets.push({
      id: `synthetic-net-${i}`,
      terminalIds: [terminal],
      conductiveElementIds: [],
      potentialUids: [],
    } as unknown as ElectricalIr["nets"][number]);
  }
  ir.devices.find((d) => d.uid === coilUid)!.designation = 'K "<& Ω';
  const r = finish(
    mirrorFixture(ir, [[placement("coil"), placement(name, 200, 160)]]),
  );
  const rows = [
    ...parseSvg(r.sheets[0]!.svg).querySelectorAll(
      "[data-navigation-mirror-row]",
    ),
  ];
  expect(rows[0]!.textContent).toBe("NO+, -, S/Ω01.C4");
  expect(mirror(r)[0]!.mirror!.heading).toContain('K "<& Ω');
});

it("is pure and deterministic across repeated finalization with unchanged source and nets", () => {
  const f = mirrorFixture(source.ir, [
      [placement("coil"), placement("pole1", 200, 100)],
      [placement("coil")],
    ]),
    before = JSON.stringify(f);
  expect(finish(f)).toEqual(finish(f));
  expect(JSON.stringify(f)).toBe(before);
});

it("rejects invalid legacy IR state instead of printing an inferred NO row", () => {
  const f = mirrorFixture(source.ir, [[placement("coil")]]);
  const contact = f.ir.functions.find(
    (f) => f.id.deviceUid === coilUid && f.kind === "contact",
  )!;
  delete (contact as Partial<Extract<IrFunction, { kind: "contact" }>>)
    .normal_state;
  const r = finalizeNavigation(f.ir, f.drafts, f.sheets);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.message).toContain("authored contact normal_state");
});

import { compileProject } from "@thermite/compiler";
it("tries a whole eight-row table before premeasured 4+4 fragments in a genuinely blocked tall field", async () => {
  const compiled = await compileProject(
    "libraries/releco-pilot/examples/c4-a40x-230vac",
  );
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const coil = compiled.ir.functions.find((f) => f.kind === "coil")!;
  const f = mirrorFixture(compiled.ir, [
    [{ uid: coil.id.deviceUid, key: coil.id.functionKey, x: 170, y: 34 }],
  ]);
  const whole = finish(f);
  expect(mirror(whole)).toHaveLength(1);
  expect(
    whole.navigation.reservations.find((r) =>
      r.profileId.startsWith("mirror-"),
    )!.inkMm,
  ).toEqual({ x: 0, y: 0, w: 55, h: 43 });
  f.drafts[0]!.drawingBounds = { x: 0, y: 0, w: 360, h: 80 };
  f.sheets[0]!.svg = f.sheets[0]!.svg.replace(
    "</svg>",
    '<rect x="0" y="0" width="360" height="28" fill="black"/><rect x="0" y="60" width="360" height="20" fill="black"/></svg>',
  );
  const split = finish(f),
    blocks = mirror(split);
  expect(blocks).toHaveLength(2);
  expect(blocks.map((a) => a.mirror!.rows.length)).toEqual([4, 4]);
  expect(
    split.navigation.reservations
      .filter((r) => r.profileId.startsWith("mirror-"))
      .map((r) => r.inkMm),
  ).toEqual([
    { x: 0, y: 0, w: 55, h: 25 },
    { x: 0, y: 0, w: 55, h: 25 },
  ]);
  const rows = blocks.flatMap((a) =>
    a.mirror!.rows.map((r) => r.source.functionKey),
  );
  expect(new Set(rows).size).toBe(8);
  expect(rows.sort()).toEqual(
    compiled.ir.functions
      .filter(
        (f) => f.id.deviceUid === coil.id.deviceUid && f.kind === "contact",
      )
      .map((f) => f.id.functionKey)
      .sort(),
  );
});

it("reserves native preselection capacity even when a target becomes a boundary fragment", () => {
  const f = mirrorFixture(source.ir, [
    [placement("coil"), placement("pole1", 200, 100)],
    [placement("pole1", 200, 160)],
  ]);
  f.drafts[1]!.navigationSeeds = f.drafts[1]!.navigationSeeds!.map((s) => ({
    ...s,
    fragmentEndpoints: ["authored-cut-end"],
  }));
  const r = finish(f),
    a = mirror(r)[0]!;
  expect(a.mirror!.rows[0]!.targets).toHaveLength(1);
  expect(
    r.navigation.reservations.find((s) => s.id === a.reservationId)!.inkMm,
  ).toEqual({ x: 0, y: 0, w: 55, h: 29.5 });
});

it("resolves both mirror and return tokens after inserted issued sheets", () => {
  const f = mirrorFixture(source.ir, [
    [placement("coil")],
    [placement("pole1", 200, 160)],
  ]);
  const before = finish(f);
  f.drafts.unshift({
    ...structuredClone(f.drafts[0]!),
    navigationSeeds: [],
    navigationView: undefined,
    content: "",
  });
  f.sheets.unshift({
    ...structuredClone(f.sheets[0]!),
    number: 0,
    svg: '<svg viewBox="0 0 360 240"/>',
  });
  f.sheets.forEach((s, i) => {
    s.number = i + 1;
  });
  const after = finish(f);
  expect(mirror(after)[0]!.mirror!.rows[0]!.destinations).toEqual(["03.C4"]);
  expect(
    after.navigation.annotations.find((a) => a.role === "return")!.text,
  ).toBe("K1 /02.B2");
  expect(after.navigation.occurrences.map((o) => o.id)).toEqual(
    before.navigation.occurrences.map((o) => o.id),
  );
});

import { sameViewSplitGangFixture } from "./packet-mirror-fixture.js";
it("keeps each same-authored-view cut gang caption on its own issued fragment", () => {
  const f = sameViewSplitGangFixture(source.ir, coilUid),
    r = finish(f);
  expect(
    new Set(r.navigation.occurrences.map((o) => o.provenance.view.key)).size,
  ).toBe(1);
  const contacts = r.navigation.occurrences.filter((o) =>
    o.source.functionKey.startsWith("pole"),
  );
  expect(
    contacts.map((o) => [
      o.source.functionKey,
      o.destination.sheet,
      o.destination.anchorMm,
    ]),
  ).toEqual([
    ["pole1", 1, { x: 110, y: 106 }],
    ["pole2", 1, { x: 170, y: 106 }],
    ["pole3", 2, { x: 30, y: 106 }],
  ]);
  const returns = r.navigation.annotations.filter((a) => a.role === "return");
  expect(returns.map((a) => a.ownerOccurrences.length)).toEqual([2, 1]);
  for (const a of returns) {
    const sheet = r.navigation.reservations.find(
      (s) => s.id === a.reservationId,
    )!.allocatedMm!.sheet;
    expect(
      a.ownerOccurrences.every(
        (id) => contacts.find((o) => o.id === id)!.destination.sheet === sheet,
      ),
    ).toBe(true);
    expect(a.text).toBe("K1 /01.A2");
    expect(a.returnLocality!.sheet).toBe(sheet);
    expect(a.returnLocality!.owners.map((o) => o.occurrenceId)).toEqual(
      a.ownerOccurrences,
    );
    for (const measured of a.returnLocality!.owners) {
      const anchor = contacts.find((o) => o.id === measured.occurrenceId)!
        .destination.anchorMm;
      const box = r.navigation.reservations.find(
        (s) => s.id === a.reservationId,
      )!.allocatedMm!.rect;
      expect(measured.anchorMm).toEqual(anchor);
      expect(measured.distanceMm).toBe(
        Math.hypot(
          Math.max(box.x - anchor.x, anchor.x - box.x - box.w, 0),
          Math.max(box.y - anchor.y, anchor.y - box.y - box.h, 0),
        ),
      );
    }
  }
});
