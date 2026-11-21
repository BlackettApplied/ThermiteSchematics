import { afterAll, beforeAll, expect, it } from "vitest";
import { launch, drawingContextOptions, openSheet } from "./browser.mjs";
import { doubleLandings } from "./checks.mjs";
let browser, page;
beforeAll(async () => {
  browser = await launch();
  page = await (await browser.newContext(drawingContextOptions)).newPage();
});
afterAll(async () => {
  await browser?.close();
});
const end = (deviceUid, terminalKey) => ({ deviceUid, terminalKey });
const a = end("A", "1"),
  b = end("B", "2");
const coreId = JSON.stringify({ cableUid: "cable", conductorId: "core" });
const ir = {
  devices: [
    { uid: "A", typeId: "t" },
    { uid: "B", typeId: "t" },
  ],
  deviceTypes: [{ id: "t", ports: { P: {} }, connectorPorts: { C: {} } }],
  terminals: [{ id: a }, { id: b }],
  wires: [{ uid: "wire", endpoints: [{ terminal: a }, { terminal: b }] }],
  cables: [{ uid: "cable" }],
  cableConductors: [
    {
      id: JSON.parse(coreId),
      cableUid: "cable",
      endpoints: [{ terminal: a }, { terminal: b }],
    },
  ],
  relations: [
    {
      uid: "link",
      fromDeviceUid: "A",
      toDeviceUid: "B",
      connection: { fromPort: "P", toPort: "P" },
    },
    {
      uid: "assembly",
      fromDeviceUid: "A",
      toDeviceUid: "B",
      assembly: { fromPort: "C", toPort: "C" },
    },
  ],
};
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="0 0 200 100">${body}</svg>`;
function marker(family, uid, port, x, key) {
  const identity =
    family === "loop"
      ? `data-loop-terminal='${JSON.stringify([uid, key])}'`
      : `data-${family === "communication" ? "communication" : "connector"}-port="${key}"`;
  return `<g data-device-uid="${uid}"><g data-layout-port="${port}" ${identity}><circle cx="${x}" cy="20" r=".7" fill="white" stroke="black"/></g></g>`;
}
function fixture(family, { uid = "B", key, relationKey, claims = true } = {}) {
  const field =
    family === "loop"
      ? "loop-conductor"
      : family === "communication"
        ? "communication-link"
        : "connector-assembly";
  const rkey =
    relationKey ??
    (family === "loop"
      ? "wire"
      : family === "communication"
        ? "link"
        : "assembly");
  const start =
    family === "loop" ? "1" : family === "communication" ? "P" : "C";
  const target = key ?? (family === "loop" ? "2" : start);
  const attr =
    family === "loop"
      ? "terminal-ends"
      : family === "communication"
        ? "communication-endpoints"
        : "assembly-endpoints";
  const endpoints =
    family === "loop"
      ? [a, b]
      : [
          { deviceUid: "A", portKey: start },
          { deviceUid: "B", portKey: start },
        ];
  return `<g data-${field}='${rkey}' data-layout-source-port="a" data-layout-target-port="b" ${claims ? `data-${attr}='${JSON.stringify(endpoints)}'` : ""}><path d="M10 20 H90" stroke="black" fill="none"/></g>${marker(family, "A", "a", 10, start)}${marker(family, uid, "b", 90, target)}`;
}
async function audit(body, source = ir) {
  const g = await openSheet(page, svg(body));
  return { g, findings: doubleLandings(g, source) };
}
it.each(["loop", "communication", "assembly"])(
  "measures and source-binds %s landing identities",
  async (family) => {
    const result = await audit(fixture(family));
    expect(result.g.relationLandings).toHaveLength(1);
    expect(result.g.relationLandings[0].relationFamily).toBe(family);
    expect(result.findings).toEqual([]);
  },
);
it.each(["loop", "communication", "assembly"])(
  "rejects a coherent foreign %s owner exactly once",
  async (family) => {
    const { findings } = await audit(fixture(family, { uid: "FOREIGN" }));
    expect(findings).toEqual([
      expect.objectContaining({
        kind: "endpoint-landing-source-mismatch",
        reason: "source-owner-mismatch",
        end: "target",
      }),
    ]);
  },
);
it.each(["loop", "communication", "assembly"])(
  "rejects a wrong %s terminal on the right device exactly once",
  async (family) => {
    const { findings } = await audit(fixture(family, { key: "WRONG" }));
    expect(findings).toEqual([
      expect.objectContaining({
        reason: "source-terminal-mismatch",
        end: "target",
      }),
    ]);
  },
);
it.each(["loop", "communication", "assembly"])(
  "retains historical %s keys and markers without self-declared endpoint arrays",
  async (family) => {
    expect((await audit(fixture(family, { claims: false }))).findings).toEqual(
      [],
    );
  },
);
it.each(["loop", "communication", "assembly"])(
  "refuses an unknown %s relation key once",
  async (family) => {
    expect(
      (await audit(fixture(family, { relationKey: "wrong" }))).findings,
    ).toEqual([expect.objectContaining({ reason: "unknown-source-relation" })]);
  },
);
it.each(["loop", "communication", "assembly"])(
  "fails closed on missing %s target identity once",
  async (family) => {
    const body = fixture(family).replace(
      family === "loop"
        ? `data-loop-terminal='["B","2"]'`
        : `data-${family === "communication" ? "communication" : "connector"}-port="${family === "communication" ? "P" : "C"}"`,
      "",
    );
    // Remove the target's identity, preserving the source marker in port families.
    const targetOnly =
      family === "loop"
        ? body
        : fixture(family).replace(/(<g data-device-uid="B">[\s\S]*)$/, (s) =>
            s.replace(/data-(?:communication|connector)-port="[^"]*"/, ""),
          );
    expect((await audit(targetOnly)).findings).toEqual([
      expect.objectContaining({
        reason: "missing-drawn-identity",
        end: "target",
      }),
    ]);
  },
);
it("does not borrow duplicate device/port IDs from a sibling nested drawing", async () => {
  const body = `<svg width="200" height="100" viewBox="0 0 200 100">${fixture("loop", { uid: "FOREIGN" })}</svg><svg width="200" height="100" viewBox="0 0 200 100">${marker("loop", "B", "b", 90, "2")}</svg>`;
  expect((await audit(body)).findings).toEqual([
    expect.objectContaining({ reason: "source-owner-mismatch", end: "target" }),
  ]);
});
it("accepts correct duplicate IDs across nested drawings and circuit-group scopes", async () => {
  for (const body of [
    `<svg width="200" height="100" viewBox="0 0 200 100">${fixture("loop")}</svg><svg width="200" height="100" viewBox="0 0 200 100">${fixture("loop")}</svg>`,
    `<g data-circuit-group="one">${fixture("loop")}</g><g data-circuit-group="two">${fixture("loop")}</g>`,
  ])
    expect((await audit(body)).findings).toEqual([]);
});
it("refuses two target markers in the same scope once", async () => {
  expect(
    (await audit(fixture("loop") + marker("loop", "B", "b", 90, "2"))).findings,
  ).toEqual([
    expect.objectContaining({
      reason: "ambiguous-owned-anchor",
      end: "target",
    }),
  ]);
});
it("fails closed on historical endpoint-only exports without a source relation key", async () => {
  const body = fixture("loop").replace(
    "data-loop-conductor='wire'",
    'data-net-id="net"',
  );
  expect((await audit(body)).findings).toEqual([
    expect.objectContaining({ reason: "missing-source-relation-identity" }),
  ]);
});
it.each(["loop", "communication", "assembly"])(
  "does not drop visible %s routes when their relation key is missing",
  async (family) => {
    const body = fixture(family).replace(
      /data-(?:loop-conductor|communication-link|connector-assembly)='[^']*'/,
      "",
    );
    expect((await audit(body)).findings).toEqual([
      expect.objectContaining({ reason: "missing-source-relation-identity" }),
    ]);
  },
);
it("refuses conflicting marker identity declarations instead of taking the last one", async () => {
  const body = fixture("loop").replace(
    `data-loop-terminal='["B","2"]'`,
    `data-loop-terminal='["B","WRONG"]' data-terminal-attachment='["B","2"]'`,
  );
  expect((await audit(body)).findings).toEqual([
    expect.objectContaining({
      reason: "ambiguous-drawn-identity",
      end: "target",
    }),
  ]);
});
it("accepts agreeing historical marker identity declarations", async () => {
  const body = fixture("loop").replace(
    `data-loop-terminal='["B","2"]'`,
    `data-loop-terminal='["B","2"]' data-terminal-attachment='["B","2"]'`,
  );
  expect((await audit(body)).findings).toEqual([]);
});
it("refuses a malformed marker identity even alongside an otherwise valid declaration", async () => {
  const body = fixture("loop").replace(
    `data-loop-terminal='["B","2"]'`,
    `data-loop-terminal='not-json' data-terminal-attachment='["B","2"]'`,
  );
  expect((await audit(body)).findings).toEqual([
    expect.objectContaining({
      reason: "invalid-drawn-identity",
      end: "target",
    }),
  ]);
});
const bundlePort = (uid, port, x) =>
  `<g data-device-uid="${uid}"><g data-layout-port="${port}"><g data-connector-interface="assembly"><rect x="${x - 1}" y="19" width="2" height="2" stroke="black" fill="white"/></g></g></g>`;
function bundle() {
  return `<g data-cable-assembly="cable" data-layout-source-port="n0_out_assembly:cable" data-layout-target-port="n1_in_assembly:cable"><desc>${JSON.stringify([{ id: coreId, ends: [a, b] }])}</desc><path d="M10 20 H90" stroke="black" fill="none"/></g>${bundlePort("A", "n0_out_assembly:cable", 10)}${bundlePort("B", "n1_in_assembly:cable", 90)}`;
}
it("binds a bundled interface to its native cable and full member terminal set", async () => {
  const result = await audit(bundle());
  expect(result.g.relationLandings[0].relationFamily).toBe("loop-bundle");
  expect(result.findings).toEqual([]);
});
it("rejects a coherent bundle moved to a different cable interface once", async () => {
  expect(
    (
      await audit(
        bundle().replaceAll("n1_in_assembly:cable", "n1_in_assembly:foreign"),
      )
    ).findings,
  ).toEqual([
    expect.objectContaining({
      reason: "source-terminal-mismatch",
      end: "target",
    }),
  ]);
});
it("rejects a coherent bundled route on a foreign device once", async () => {
  expect(
    (
      await audit(
        bundle().replace('data-device-uid="B"', 'data-device-uid="FOREIGN"'),
      )
    ).findings,
  ).toEqual([
    expect.objectContaining({ reason: "source-owner-mismatch", end: "target" }),
  ]);
});
it("rejects bundle/member confusion at one endpoint", async () => {
  const body = bundle().replace(
    bundlePort("B", "n1_in_assembly:cable", 90),
    marker("loop", "B", "n1_in_assembly:cable", 90, "2"),
  );
  expect((await audit(body)).findings).toEqual([
    expect.objectContaining({
      reason: "source-port-kind-mismatch",
      end: "target",
    }),
  ]);
});
it("rejects an incorrect or missing native bundle member identity once", async () => {
  for (const desc of [
    JSON.stringify([{ id: coreId, ends: [a, end("B", "WRONG")] }]),
    "[]",
    "not-json",
  ]) {
    expect(
      (
        await audit(
          bundle().replace(/<desc>.*?<\/desc>/, `<desc>${desc}</desc>`),
        )
      ).findings,
    ).toEqual([
      expect.objectContaining({ reason: "drawn-relation-endpoints-mismatch" }),
    ]);
  }
});
it("keeps historical series members separate from their outer bundle wrapper", async () => {
  const body = `<g data-cable-assembly="cable">${fixture("loop", { relationKey: coreId })}</g>`;
  const result = await audit(body);
  expect(result.g.relationLandings[0].relationFamily).toBe("loop");
  expect(result.findings).toEqual([]);
});
