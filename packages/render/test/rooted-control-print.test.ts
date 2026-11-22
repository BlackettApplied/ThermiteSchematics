import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileProject, lockProject } from "@thermite/compiler";
import { afterEach, expect, it, vi } from "vitest";
import { renderSchematicPacket, renderSchematicSheets } from "../src/index.js";
import {
  renderSchematicPacket as ordinaryPacket,
  renderSchematicSheets as ordinarySheets,
} from "../src/sheets.js";
import * as elkRuntime from "../src/layout/elk-runtime.js";
import * as deviceLegend from "../src/packet/device-legend.js";
import * as clippedRoutes from "../src/packet/rooted-clipped-routes.js";
import { improvesRoutes } from "../src/packet/rooted-control-print.js";
import type { NormalizedSchematicLayout } from "../src/types.js";

afterEach(() => vi.restoreAllMocks());

const page = {
  size: "tabloid",
  orientation: "landscape",
  marginMm: 10,
} as const;
const uid = (n: number) =>
  `75127a81-3dad-45cb-988d-${String(n).padStart(12, "0")}`;
const deviceTypes = {
  V1: "psu-24vdc",
  F2: "fuse-1p",
  B1: "estop-nc",
  B2: "pushbutton-nc",
  X1: "overload-3p-1nc",
  B3: "pushbutton-no",
  Y1: "relay-1co",
  Y2: "contactor-3p-1no",
  P1: "pilot-light",
};
const pairs = [
  ["V1.+", "F2.1/L1"],
  ["F2.2/T1", "B1.11"],
  ["B1.12", "B2.11"],
  ["B2.12", "X1.95"],
  ["X1.96", "B3.13"],
  ["X1.96", "Y1.11"],
  ["B3.14", "Y1.A1"],
  ["Y1.14", "Y1.A1"],
  ["Y1.A1", "Y2.A1"],
  ["Y2.A1", "P1.X1"],
  ["V1.-", "Y1.A2"],
  ["V1.-", "Y2.A2"],
  ["V1.-", "P1.X2"],
];
const devices = Object.entries(deviceTypes).map(([designation, type], i) => ({
  uid: uid(i + 1),
  kind: "device",
  designation,
  type: `core:${type}`,
  ...(designation === "Y1"
    ? {
        connectionReview: {
          terminals: {
            12: { status: "intentionally-unused", reason: "Unused throw." },
          },
        },
      }
    : {}),
}));

async function controlFixture(byPass = false) {
  const project = await mkdtemp(join(tmpdir(), "thermite-parallel-"));
  const dispose = () => rm(project, { recursive: true, force: true });
  try {
    const wires = pairs
      .map((ends, i) => ({
        uid: uid(i + 100),
        kind: "wire",
        designation: `L${10 + i}`,
        endpoints: ends.map((end) => {
          const [device, terminal] = end.split(".");
          return { device, terminal };
        }),
      }))
      .filter(
        ({ designation }) => !byPass || !["L15", "L17"].includes(designation),
      );
    await writeFile(
      join(project, "source.json"),
      JSON.stringify({ objects: [...devices, ...wires] }),
    );
    await writeFile(
      join(project, "system.json"),
      JSON.stringify({
        format: "electrical-system/0.1",
        project: { name: "Synthetic parallel control" },
        sources: ["source.json"],
        libraries: [{ name: "core", version: "0.2.0" }],
      }),
    );
    const lock = await lockProject(project);
    assert.ok(lock.ok, JSON.stringify(lock.diagnostics));
    const c = await compileProject(project);
    assert.ok(c.ok, JSON.stringify(c.diagnostics));
    return { ...c, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

function controlView(root: string, flow: "left-to-right" | "top-to-bottom") {
  return {
    format: "schematic-view-request/0.1",
    root: { by: "designation", value: root },
    family: "control",
    flow,
  } as const;
}
function wires(svg: string) {
  return new Map(
    [...svg.matchAll(/<path [^>]*data-wire-uid="([^"]+)"[^>]*>/g)].map(
      ([path, id]) => {
        assert.ok(id);
        const attr = (key: string) =>
          new RegExp(` ${key}="([^"]+)"`).exec(path)?.[1];
        return [
          id,
          {
            geometry: attr("d"),
            net: attr("data-net-id"),
            source: attr("data-route-source-port-key"),
            target: attr("data-route-target-port-key"),
          },
        ];
      },
    ),
  );
}
const connectivity = (svg: string) =>
  [...wires(svg)].map(([id, { geometry: _geometry, ...w }]) => [id, w]).sort();

it.each(["left-to-right", "top-to-bottom"] as const)(
  "routes a two-arm join before the receiving symbol in %s",
  async (flow) => {
    const c = await controlFixture();
    try {
      const view = controlView("Y1", flow);
      const request = {
        format: "schematic-packet-request/0.1",
        page,
        views: [view],
        index: false,
      } as const;
      const before = await ordinaryPacket(c.ir, request);
      const result = await renderSchematicPacket(c.ir, request);
      assert.ok(
        before.ok && result.ok,
        JSON.stringify({ before: before.ok, result: result.ok }),
      );
      const [base] = before.value.sheets;
      const [sheet] = result.value.sheets;
      assert.ok(base && sheet);
      expect(result.value.sheets).toHaveLength(1);
      expect(connectivity(sheet.svg)).toEqual(connectivity(base.svg));
      const original = wires(base.svg).get(uid(107))?.geometry;
      expect(original).toMatch(/ [VH] .* [VH] .* [VH] /);
      expect(wires(sheet.svg).get(uid(107))?.geometry).toMatch(
        flow === "left-to-right"
          ? /^M [\d.]+ [\d.]+ H [\d.]+$/
          : /^M [\d.]+ [\d.]+ V [\d.]+$/,
      );
      const standalone = await renderSchematicSheets(
        c.ir,
        view,
        undefined,
        page,
      );
      assert.ok(standalone.ok);
      expect(
        wires(standalone.value.sheets[0]?.svg ?? "").get(uid(107))?.geometry,
      ).toEqual(wires(sheet.svg).get(uid(107))?.geometry);
    } finally {
      await c.dispose();
    }
  },
);

it("leaves a single forward branch alone", async () => {
  const c = await controlFixture(true);
  try {
    const view = controlView("Y1", "top-to-bottom");
    const request = {
      format: "schematic-packet-request/0.1",
      page,
      views: [view],
    } as const;
    const before = await ordinaryPacket(c.ir, request);
    const after = await renderSchematicPacket(c.ir, request);
    assert.ok(before.ok && after.ok);
    expect(after.value.sheets).toEqual(before.value.sheets);
  } finally {
    await c.dispose();
  }
});

it("keeps printable sheets when a horizontal refold has no accepted saving", async () => {
  const c = await controlFixture();
  try {
    const view = controlView("Y2", "left-to-right");
    const request = {
      format: "schematic-packet-request/0.1",
      page,
      views: [view],
      index: false,
    } as const;
    const before = await ordinaryPacket(c.ir, request);
    const after = await renderSchematicPacket(c.ir, request);
    assert.ok(before.ok && after.ok);
    expect(before.value.sheets).toHaveLength(2);
    expect(after.value.sheets).toEqual(before.value.sheets);
  } finally {
    await c.dispose();
  }
});

it("returns the ordinary packet byte-identical when the alternate ELK layout rejects", async () => {
  const c = await controlFixture();
  try {
    const view = controlView("Y1", "left-to-right");
    const request = {
      format: "schematic-packet-request/0.1" as const,
      page,
      views: [view],
      index: false,
    };
    const realCreateElk = elkRuntime.createElkEngine;
    let ordinaryCalls = 0;
    vi.spyOn(elkRuntime, "createElkEngine").mockImplementation(() => {
      const engine = realCreateElk();
      const nativeLayout = engine.layout.bind(engine);
      engine.layout = (input, options) => {
        ordinaryCalls++;
        return nativeLayout(input, options);
      };
      return engine;
    });
    const before = await ordinaryPacket(c.ir, request);
    assert.ok(before.ok);
    vi.restoreAllMocks();

    let calls = 0;
    let rejected = 0;
    vi.spyOn(elkRuntime, "createElkEngine").mockImplementation(() => {
      const engine = realCreateElk();
      const nativeLayout = engine.layout.bind(engine);
      engine.layout = (input, options) => {
        calls++;
        if (calls > ordinaryCalls) {
          rejected++;
          return Promise.reject(new Error("alternate ELK rejection"));
        }
        return nativeLayout(input, options);
      };
      return engine;
    });
    const result = await renderSchematicPacket(c.ir, request);
    assert.ok(result.ok);
    expect(rejected).toBeGreaterThan(0);
    expect(result.value.sheets).toEqual(before.value.sheets);
    expect(result.value.html).toBe(before.value.html);
    expect(result.value.navigation).toEqual(before.value.navigation);
  } finally {
    await c.dispose();
  }
});

function callPacket(
  fn: typeof renderSchematicPacket,
  ir: Parameters<typeof renderSchematicPacket>[0],
  request: unknown,
  presentation?: Parameters<typeof renderSchematicPacket>[2],
): ReturnType<typeof renderSchematicPacket> {
  return Reflect.apply(fn, undefined, [ir, request, presentation]);
}

it("ignores custom views Symbol.iterator yielding 0 or 41 views and skips alternate", async () => {
  const c = await controlFixture();
  try {
    const view = controlView("Y1", "left-to-right");
    const ordinary = await ordinaryPacket(c.ir, {
      format: "schematic-packet-request/0.1",
      page,
      views: [view],
      index: false,
    });
    assert.ok(ordinary.ok);

    for (const count of [0, 41]) {
      let iterCalls = 0;
      const views = [view];
      Object.defineProperty(views, Symbol.iterator, {
        value: function* () {
          iterCalls++;
          for (let i = 0; i < count; i++) yield view;
        },
      });
      const result = await renderSchematicPacket(c.ir, {
        format: "schematic-packet-request/0.1",
        page,
        views,
        index: false,
      });
      assert.ok(result.ok);
      expect(iterCalls).toBe(0);
      expect(result.value.sheets).toHaveLength(1);
      expect(result.value.sheets).toEqual(ordinary.value.sheets);
      expect(result.value.html).toBe(ordinary.value.html);
    }
  } finally {
    await c.dispose();
  }
});

it("ignores custom views Symbol.iterator swapping an invalid view for a valid one", async () => {
  const c = await controlFixture();
  try {
    const view = controlView("Y1", "left-to-right");
    let swapIterCalls = 0;
    const swapViews: unknown[] = [{ format: "invalid-view/0.1" }];
    Object.defineProperty(swapViews, Symbol.iterator, {
      value: function* () {
        swapIterCalls++;
        yield view;
      },
    });
    const req = {
      format: "schematic-packet-request/0.1",
      page,
      views: swapViews,
      index: false,
    };
    const swapOrdinary = await callPacket(ordinaryPacket, c.ir, req);
    const swapResult = await callPacket(renderSchematicPacket, c.ir, req);
    expect(swapIterCalls).toBe(0);
    expect(swapResult).toEqual(swapOrdinary);
    assert.ok(!swapResult.ok);
    expect(swapResult.error.code).toBe("R001");
  } finally {
    await c.dispose();
  }
});

it("gives dev's R006 for invalid reference options alongside a throwing views iterator", async () => {
  const c = await controlFixture();
  try {
    const view = controlView("Y1", "left-to-right");
    let iterCalls = 0;
    const views = [view];
    Object.defineProperty(views, Symbol.iterator, {
      value() {
        iterCalls++;
        throw new Error("views iterator should not run");
      },
    });
    const request = {
      format: "schematic-packet-request/0.1" as const,
      page,
      views,
      index: false,
      references: false as const,
    };
    const ordinary = await ordinaryPacket(c.ir, request);
    const result = await renderSchematicPacket(c.ir, request);
    expect(iterCalls).toBe(0);
    expect(result).toEqual(ordinary);
    assert.ok(!result.ok);
    expect(result.error.code).toBe("R006");
    expect(result.error.reason).toBe("invalid-packet");
  } finally {
    await c.dispose();
  }
});

it("preserves dev validation order: invalid index short-circuits before throwing layout getter", async () => {
  const c = await controlFixture();
  try {
    const view = controlView("Y1", "left-to-right");
    let layoutReads = 0;
    const request = {
      format: "schematic-packet-request/0.1",
      page,
      views: [view],
      index: "bad",
      get layout() {
        layoutReads++;
        throw new Error("layout getter should not run");
      },
    };
    const ordinary = await callPacket(ordinaryPacket, c.ir, request);
    const result = await callPacket(renderSchematicPacket, c.ir, request);
    expect(layoutReads).toBe(0);
    expect(result).toEqual(ordinary);
    assert.ok(!result.ok);
    expect(result.error.code).toBe("R006");
    expect(result.error.reason).toBe("invalid-packet");
  } finally {
    await c.dispose();
  }
});

it("preserves compact dispatch rejection before reading format and single prototype check on missing format", async () => {
  const c = await controlFixture();
  try {
    let formatReads = 0;
    const nonPlain = Object.create({ custom: true });
    Object.defineProperty(nonPlain, "format", {
      enumerable: true,
      get() {
        formatReads++;
        throw new Error("format getter should not run");
      },
    });
    const presentation = {
      format: "project-presentation/0.3" as const,
      revision: "A",
      backgroundColor: "#ffffff",
      titleBlockLines: [],
    };
    const ordinary = await callPacket(
      ordinaryPacket,
      c.ir,
      nonPlain,
      presentation,
    );
    const result = await callPacket(
      renderSchematicPacket,
      c.ir,
      nonPlain,
      presentation,
    );
    expect(formatReads).toBe(0);
    expect(result).toEqual(ordinary);
    assert.ok(!result.ok);
    expect(result.error.code).toBe("R006");
    expect(result.error.reason).toBe("invalid-packet");

    let devProtoChecks = 0;
    const makeMissingFormat = (onProto: () => void) =>
      new Proxy(
        { views: [controlView("Y1", "left-to-right")] },
        {
          getPrototypeOf(target) {
            onProto();
            return Reflect.getPrototypeOf(target);
          },
        },
      );
    const devMissing = await callPacket(
      ordinaryPacket,
      c.ir,
      makeMissingFormat(() => {
        devProtoChecks++;
      }),
    );
    let publicProtoChecks = 0;
    const publicMissing = await callPacket(
      renderSchematicPacket,
      c.ir,
      makeMissingFormat(() => {
        publicProtoChecks++;
      }),
    );
    expect(publicProtoChecks).toBe(devProtoChecks);
    expect(publicMissing).toEqual(devMissing);
    assert.ok(!publicMissing.ok);
    expect(publicMissing.error.code).toBe("R006");
  } finally {
    await c.dispose();
  }
});

it("gives dev's R006 when a reference-options proxy exposes an invalid filter through get", async () => {
  const c = await controlFixture();
  try {
    const view = controlView("Y1", "left-to-right");
    const references = new Proxy(
      { appearances: "all" as const },
      {
        get(target, prop, receiver) {
          if (prop === "filter") return { unknown: true };
          return Reflect.get(target, prop, receiver);
        },
      },
    );
    const request = {
      format: "schematic-packet-request/0.1" as const,
      page,
      views: [view],
      index: true,
      references,
    };
    const ordinary = await ordinaryPacket(c.ir, request);
    const result = await renderSchematicPacket(c.ir, request);
    expect(result).toEqual(ordinary);
    assert.ok(!result.ok);
    expect(result.error.code).toBe("R006");
    expect(result.error.reason).toBe("invalid-packet");
  } finally {
    await c.dispose();
  }
});

it("skips the alternate for a one-shot index getter on renderSchematicSheets", async () => {
  const c = await controlFixture();
  try {
    const view = controlView("Y1", "left-to-right");
    const ordinaryStandalone = await ordinarySheets(
      c.ir,
      view,
      undefined,
      page,
      { index: false },
    );
    assert.ok(ordinaryStandalone.ok);

    let standaloneIndexReads = 0;
    const standalone = await renderSchematicSheets(
      c.ir,
      view,
      undefined,
      page,
      {
        get index() {
          if (++standaloneIndexReads > 1) throw new Error("index read twice");
          return false;
        },
      },
    );
    assert.ok(standalone.ok);
    expect(standaloneIndexReads).toBe(1);
    expect(standalone.value.sheets).toEqual(ordinaryStandalone.value.sheets);
    expect(standalone.value.html).toBe(ordinaryStandalone.value.html);
    expect(
      wires(standalone.value.sheets[0]?.svg ?? "").get(uid(107))?.geometry,
    ).toMatch(/ [VH] .* [VH] .* [VH] /);
  } finally {
    await c.dispose();
  }
});

it("skips the alternate for a one-shot index getter or transparent proxy on renderSchematicPacket", async () => {
  const c = await controlFixture();
  try {
    const view = controlView("Y1", "left-to-right");
    const plainRequest = {
      format: "schematic-packet-request/0.1" as const,
      page,
      views: [view],
      index: false,
    };
    const ordinary = await ordinaryPacket(c.ir, plainRequest);
    assert.ok(ordinary.ok);

    let ordinaryReads = 0;
    const makeOneShotRequest = (onRead: () => void) => {
      let calls = 0;
      return {
        format: "schematic-packet-request/0.1" as const,
        page,
        views: [view],
        get index() {
          onRead();
          return ++calls === 1 ? undefined : false;
        },
      };
    };
    const devOneShot = await ordinaryPacket(
      c.ir,
      makeOneShotRequest(() => {
        ordinaryReads++;
      }),
    );
    assert.ok(devOneShot.ok);
    let publicReads = 0;
    const publicOneShot = await renderSchematicPacket(
      c.ir,
      makeOneShotRequest(() => {
        publicReads++;
      }),
    );
    assert.ok(publicOneShot.ok);
    expect(publicReads).toBe(ordinaryReads);
    expect(publicOneShot.value.sheets).toEqual(devOneShot.value.sheets);
    expect(publicOneShot.value.html).toBe(devOneShot.value.html);
    expect(
      wires(publicOneShot.value.sheets[0]?.svg ?? "").get(uid(107))?.geometry,
    ).toMatch(/ [VH] .* [VH] .* [VH] /);

    const proxyResult = await renderSchematicPacket(
      c.ir,
      new Proxy(plainRequest, {}),
    );
    assert.ok(proxyResult.ok);
    expect(proxyResult.value.sheets).toEqual(ordinary.value.sheets);
    expect(proxyResult.value.html).toBe(ordinary.value.html);
  } finally {
    await c.dispose();
  }
});

it("returns the ordinary packet when an injected failure occurs in the optional draft snapshot", async () => {
  const c = await controlFixture();
  try {
    const view = controlView("Y1", "left-to-right");
    const request = {
      format: "schematic-packet-request/0.1" as const,
      page,
      views: [view],
      index: false,
    };
    const baseline = await ordinaryPacket(c.ir, request);
    assert.ok(baseline.ok);

    const realFit = deviceLegend.fitLegendDrafts;
    const realClone = globalThis.structuredClone;
    const runWithInjection = async (
      fn: () => ReturnType<typeof renderSchematicPacket>,
    ) => {
      let fittedDrafts: unknown;
      let injected = 0;
      const fitSpy = vi
        .spyOn(deviceLegend, "fitLegendDrafts")
        .mockImplementation((...args) => {
          const fitted = realFit(...args);
          if (fitted.ok) fittedDrafts = fitted.value;
          return fitted;
        });
      const cloneSpy = vi
        .spyOn(globalThis, "structuredClone")
        .mockImplementation((value, options) => {
          if (fittedDrafts !== undefined && value === fittedDrafts) {
            injected++;
            throw new Error("injected draft snapshot failure");
          }
          return realClone(value, options);
        });
      try {
        const outcome = await fn();
        return { outcome, injected };
      } finally {
        fitSpy.mockRestore();
        cloneSpy.mockRestore();
      }
    };

    const ordinaryRun = await runWithInjection(() =>
      ordinaryPacket(c.ir, request),
    );
    assert.ok(ordinaryRun.outcome.ok);
    expect(ordinaryRun.outcome.value.sheets).toEqual(baseline.value.sheets);

    const publicRun = await runWithInjection(() =>
      renderSchematicPacket(c.ir, request),
    );
    assert.ok(publicRun.outcome.ok);
    expect(publicRun.injected).toBe(1);
    expect(publicRun.outcome.value.sheets).toEqual(baseline.value.sheets);
    expect(publicRun.outcome.value.html).toBe(baseline.value.html);
  } finally {
    await c.dispose();
  }
});

it("rejects additional crossings on an already-crossing edge pair", () => {
  const layout = (
    crossings: readonly { edgeIds: readonly [string, string] }[],
  ): NormalizedSchematicLayout => ({
    format: "schematic-layout/0.1",
    layoutConfigVersion: "test",
    view: {
      format: "schematic-view/0.1",
      root: { deviceUid: uid(1), designation: "Y1" },
      family: "control",
      flow: "left-to-right",
    },
    width: 100,
    height: 100,
    nodes: [],
    ports: [],
    edges: [],
    labels: [],
    crossings: crossings.map((c, i) => ({
      edgeIds: c.edgeIds,
      point: { x: 10 + i * 5, y: 10 },
    })),
  });
  const base = layout([{ edgeIds: ["e1", "e2"] }]);
  const extraOnSamePair = layout([
    { edgeIds: ["e1", "e2"] },
    { edgeIds: ["e2", "e1"] },
  ]);
  expect(improvesRoutes(base, extraOnSamePair, undefined)).toBe(false);

  const twoPairsBase = layout([
    { edgeIds: ["e1", "e2"] },
    { edgeIds: ["e3", "e4"] },
    { edgeIds: ["e3", "e4"] },
  ]);
  const shiftedPairCount = layout([
    { edgeIds: ["e1", "e2"] },
    { edgeIds: ["e1", "e2"] },
    { edgeIds: ["e3", "e4"] },
  ]);
  expect(improvesRoutes(twoPairsBase, shiftedPairCount, undefined)).toBe(false);
  expect(improvesRoutes(extraOnSamePair, base, undefined)).toBe(true);
});

it("rejects an alternate when legend fitting breaks utilisation or clipped-route gates", async () => {
  const c = await controlFixture();
  try {
    const view = controlView("Y1", "left-to-right");
    const request = {
      format: "schematic-packet-request/0.1" as const,
      page,
      views: [view],
      index: false,
    };
    const before = await ordinaryPacket(c.ir, request);
    assert.ok(before.ok);

    // 1. Legend fitting that drops candidate utilisation below 40% is rejected.
    const realFit = deviceLegend.fitLegendDrafts;
    let fitCalls = 0;
    vi.spyOn(deviceLegend, "fitLegendDrafts").mockImplementation((...args) => {
      fitCalls++;
      const fitted = realFit(...args);
      if (fitCalls === 2 && fitted.ok) {
        const recut = structuredClone(fitted.value);
        const first = recut[0];
        assert.ok(first?.drawingBounds);
        first.rootedShapes = [
          { x: first.drawingBounds.x, y: first.drawingBounds.y, w: 10, h: 10 },
        ];
        return { ok: true, value: recut };
      }
      return fitted;
    });
    const lowUtil = await renderSchematicPacket(c.ir, request);
    assert.ok(lowUtil.ok);
    expect(fitCalls).toBe(2);
    expect(lowUtil.value.sheets).toEqual(before.value.sheets);
    vi.restoreAllMocks();

    // 2. Legend fitting that recuts onto extra sheets is rejected.
    fitCalls = 0;
    vi.spyOn(deviceLegend, "fitLegendDrafts").mockImplementation((...args) => {
      fitCalls++;
      const fitted = realFit(...args);
      if (fitCalls === 2 && fitted.ok) {
        const first = fitted.value[0];
        assert.ok(first);
        return {
          ok: true,
          value: [structuredClone(first), structuredClone(first)],
        };
      }
      return fitted;
    });
    const extraSheet = await renderSchematicPacket(c.ir, request);
    assert.ok(extraSheet.ok);
    expect(fitCalls).toBe(2);
    expect(extraSheet.value.sheets).toEqual(before.value.sheets);
  } finally {
    await c.dispose();
  }
});

it("rejects an alternate when legend fitting causes clipped-route growth", async () => {
  const c = await controlFixture();
  try {
    const view = controlView("Y1", "left-to-right");
    const request = {
      format: "schematic-packet-request/0.1" as const,
      page,
      views: [view],
      index: false,
    };
    const before = await ordinaryPacket(c.ir, request);
    assert.ok(before.ok);

    const realFit = deviceLegend.fitLegendDrafts;
    let fitCalls = 0;
    let recutNote = "";
    let sawRecutInClippedGate = false;
    const realRouteGrowth = clippedRoutes.routeGrowth;
    vi.spyOn(deviceLegend, "fitLegendDrafts").mockImplementation((...args) => {
      fitCalls++;
      const fitted = realFit(...args);
      if (fitCalls === 2 && fitted.ok) {
        const recut = structuredClone(fitted.value);
        const first = recut[0];
        assert.ok(first);
        recutNote = `${first.note} (legend recut)`;
        first.note = recutNote;
        return { ok: true, value: recut };
      }
      return fitted;
    });
    vi.spyOn(clippedRoutes, "routeGrowth").mockImplementation(
      (candidate, reference, clipped = true) => {
        if (clipped && candidate.drafts[0]?.note === recutNote) {
          sawRecutInClippedGate = true;
          return [1, 1, 0, 0];
        }
        return realRouteGrowth(candidate, reference, clipped);
      },
    );
    const badRoutes = await renderSchematicPacket(c.ir, request);
    assert.ok(badRoutes.ok);
    expect(fitCalls).toBe(2);
    expect(sawRecutInClippedGate).toBe(true);
    expect(badRoutes.value.sheets).toEqual(before.value.sheets);
  } finally {
    await c.dispose();
  }
});
