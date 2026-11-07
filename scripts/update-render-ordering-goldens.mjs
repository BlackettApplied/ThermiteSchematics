// Refresh only ordering-sensitive adapter and layout evidence. Build first.
import { compileProject } from "../packages/compiler/dist/index.js";
import { createMotorStarterPnpExperiment } from "../packages/render/test/motor-starter-pnp-fixture.ts";
import { buildPresentationGraph } from "../packages/render/dist/presentation.js";
import { normalizeSchematicView } from "../packages/render/dist/view-spec.js";
import * as select from "../packages/render/dist/selection.js";
import {
  buildElkAdapterGraph,
  layoutPresentationGraph,
  serializeElkAdapterForTest,
} from "../packages/render/dist/layout/elk-adapter.js";
import { createElkEngine } from "../packages/render/dist/layout/elk-runtime.js";
import { ELK_OPTIONS } from "../packages/render/dist/layout/options.js";
import { sideBranch } from "../packages/render/test/profile-side-branch-fixture.ts";
import { renderSchematic } from "../packages/render/dist/renderer.js";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { format } from "prettier";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const mode = process.argv[2];
if (!["--check", "--write"].includes(mode))
  throw Error(
    "Usage: bun scripts/update-render-ordering-goldens.mjs --check|--write",
  );
const sha = (x) => createHash("sha256").update(x).digest("hex");
const canonical = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(",")}}`
      : JSON.stringify(v);
async function stages(ir, request) {
  const n = normalizeSchematicView(ir, request);
  if (!n.ok) throw n;
  const p = n.value;
  const f =
    p.view.format === "schematic-view/0.1"
      ? select.selectSemanticSubgraph
      : p.view.intent === "trace"
        ? select.selectTraceSubgraph
        : p.view.intent === "loads"
          ? select.selectLoadsSubgraph
          : select.selectCableConductorSubgraph;
  const s = f({
    ir,
    view: p.view,
    engine: p.engine,
    mappings: p.mappings,
    root: p.rootSelector,
    target: p.view.target,
    includePower: p.view.includePower,
  });
  if (!s.ok) throw s;
  const g = buildPresentationGraph({ ir, selected: s.value });
  if (!g.ok) throw g;
  const adapter = buildElkAdapterGraph(g.value.graph);
  const l = await layoutPresentationGraph(g.value.graph);
  if (!l.ok) throw l;
  return { graph: g.value.graph, adapter, layout: l.value };
}
const point = (value) => ({ x: value.x, y: value.y });
const rounded = (v) =>
  typeof v === "number"
    ? Number(v.toFixed(3))
    : Array.isArray(v)
      ? v.map(rounded)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, v]) => [k, rounded(v)]))
        : v;
function crossing(a, b) {
  for (let i = 1; i < a.length; i++)
    for (let j = 1; j < b.length; j++) {
      const [p, q, r, t] = [a[i - 1], a[i], b[j - 1], b[j]];
      const between = (v, x, y) => v > Math.min(x, y) && v < Math.max(x, y);
      if (
        p.x === q.x &&
        r.y === t.y &&
        between(p.x, r.x, t.x) &&
        between(r.y, p.y, q.y)
      )
        return { x: p.x, y: r.y };
      if (
        p.y === q.y &&
        r.x === t.x &&
        between(r.x, p.x, q.x) &&
        between(p.y, r.y, t.y)
      )
        return { x: r.x, y: p.y };
    }
  throw Error("Expected the unprioritized trace crossing");
}
const by = (value) => ({ by: "designation", value });
const request = (name, flow) => ({
  flow,
  ...(name === "m1" || name === "k1"
    ? {
        format: "schematic-view-request/0.1",
        root: by(name === "m1" ? "M1" : "K1"),
        family: name === "m1" ? "power" : "control",
      }
    : {
        format: "schematic-view-request/0.2",
        root: by(
          name === "conductors" ? "CBL1" : name === "loads" ? "PS1" : "LS1",
        ),
        intent:
          name === "trace" || name === "signal-only-trace"
            ? { kind: "trace", to: by("PLC1"), includePower: name === "trace" }
            : { kind: name === "loads" ? "loads" : "conductors" },
      }),
});
const e = await createMotorStarterPnpExperiment();
const result = { sizes: {}, trace: {}, controls: {}, hashes: {} };
try {
  for (const state of ["baseline", "pnp"]) {
    if (state === "pnp") {
      await e.applyTypeOnlyEdit();
      await e.applyCompletedEdit();
    }
    const c = await compileProject(e.projectRoot);
    if (!c.ok) throw c;
    const builds = [];
    for (const name of [
      "m1",
      "k1",
      "conductors",
      "trace",
      "loads",
      "signal-only-trace",
    ])
      for (const flow of ["left-to-right", "top-to-bottom"]) {
        const s = await stages(c.ir, request(name, flow));
        result.sizes[`${state}:${name}:${flow}`] = [
          s.layout.width,
          s.layout.height,
        ];
        if (state === "baseline" && (name === "m1" || name === "k1"))
          builds.push(s.adapter);
        if (state === "pnp" && name === "trace") {
          const root = s.graph.nodes.find((n) => n.designation === "LS1");
          const signal = root.ports.find((p) => p.symbolPortId === "signal");
          const routes = Object.fromEntries(
            ["W-FLD-003", "CBL1.1-"].map((label) => {
              const edge = s.graph.edges.find(
                (edge) =>
                  edge.conductor?.designation === label ||
                  `${edge.conductor?.cableDesignation}.${edge.conductor?.conductorId}` ===
                    label,
              );
              return [
                label,
                s.layout.edges.find((e) => e.id === edge.id)?.points,
              ];
            }),
          );
          result.trace[flow] = {
            routes,
            node: point(s.layout.nodes.find((n) => n.id === root.id)),
            port: point(s.layout.ports.find((p) => p.id === signal.id)),
            label: point(s.layout.labels.find((l) => l.ownerId === signal.id)),
          };
          const control = structuredClone(s.adapter.graph);
          control.edges.forEach((edge) => {
            if (edge.layoutOptions)
              delete edge.layoutOptions[ELK_OPTIONS.priorityDirection];
          });
          const raw = await createElkEngine().layout(control);
          const rawRoutes = Object.fromEntries(
            ["W-FLD-003", "CBL1.1-"].map((label) => {
              const edge = s.graph.edges.find(
                (edge) =>
                  edge.conductor?.designation === label ||
                  `${edge.conductor?.cableDesignation}.${edge.conductor?.conductorId}` ===
                    label,
              );
              const e = raw.edges.find((e) => e.id === edge.id);
              return [
                label,
                e.sections.flatMap((s) => [
                  s.startPoint,
                  ...(s.bendPoints ?? []),
                  s.endPoint,
                ]),
              ];
            }),
          );
          result.controls[flow] = {
            size: [raw.width, raw.height],
            routes: rawRoutes,
            intersection: crossing(
              rawRoutes["W-FLD-003"],
              rawRoutes["CBL1.1-"],
            ),
          };
        }
      }
    if (state === "baseline") {
      const ordered = [builds[2], builds[3], builds[0], builds[1]];
      result.hashes = {
        adapterSha256: sha(ordered.map(serializeElkAdapterForTest).join("\n")),
        assignmentSha256: sha(
          canonical(ordered.map((b) => b.optionAssignments)),
        ),
        assignmentCounts: ordered.map((b) => b.optionAssignments.length),
        optionCount: new Set(
          ordered.flatMap((b) => b.optionAssignments.map((o) => o.option)),
        ).size,
      };
    }
  }
  result.sideBranches = {};
  for (const [device, terminal] of [
    ["M1", "PE"],
    ["SRC1", "PE"],
    ["TB1", "3"],
  ]) {
    const ir = await sideBranch(device, terminal);
    for (const flow of ["left-to-right", "top-to-bottom"])
      for (const power of device === "TB1" ? [false, true] : [false]) {
        const req =
          device === "TB1"
            ? {
                format: "schematic-view-request/0.2",
                root: by("LS1"),
                flow,
                intent: { kind: "trace", to: by("PLC1"), includePower: power },
              }
            : request("m1", flow);
        const r = await renderSchematic(ir, req);
        if (!r.ok) throw r;
        result.sideBranches[`${device}|${flow}|${power}`] = sha(
          JSON.stringify(r.value),
        );
      }
  }
  const owned = new Map([
    ["packages/render/test/elk-options.golden.json", result.hashes],
    [
      "packages/render/test/snapshots/semantic-ordering/layout-metrics.json",
      {
        sizes: result.sizes,
        trace: result.trace,
        controls: result.controls,
        sideBranches: result.sideBranches,
      },
    ],
  ]);
  for (const [path, value] of owned) {
    const bytes = await format(JSON.stringify(rounded(value)), {
      parser: "json",
    });
    if (mode === "--write") await writeFile(path, bytes);
    else if ((await readFile(path, "utf8")) !== bytes)
      throw Error("Ordering golden differs: " + path);
  }
  console.log(JSON.stringify({ mode, paths: [...owned.keys()] }));
} finally {
  await e.cleanup();
}
