import assert from "node:assert/strict";
import { cp } from "node:fs/promises";
import { join } from "node:path";
import {
  compileProject,
  publicPackage,
  engineRoot,
  renderFaultEngine,
} from "./engine.mjs";
import {
  corpus,
  readJson,
  probe,
  temporary,
  edit,
  cli,
  request,
  streams,
} from "./support.mjs";
import { assess } from "./assessment.mjs";
const { renderSchematic, renderSchematicPacket } =
  await publicPackage("render");
const actuation = {
  format: "schematic-view-request/0.1",
  family: "control",
  root: { by: "designation", value: "K1" },
};
const loads = {
  format: "schematic-view-request/0.2",
  root: { by: "designation", value: "PS1" },
  intent: { kind: "loads" },
};
const circuit = {
  format: "circuit-view-request/0.1",
  title: "Output circuit",
  groups: [
    {
      id: "coil",
      conductors: ["W-CTL-007"],
      functions: [
        { device: { by: "designation", value: "PLC1" }, key: "do0" },
        { device: { by: "designation", value: "K1" }, key: "coil" },
      ],
    },
  ],
};
const packet = (views) => ({ format: "schematic-packet-request/0.1", views });
export async function renderDiagnostics() {
  const core = await compileProject(join(engineRoot, "examples/motor-starter"));
  assert(core.ok);
  const rows = [];
  for (const scenario of (
    await readJson(join(corpus, "render-diagnostics.json"))
  ).cases) {
    const id = `diag/render/${scenario.id}`;
    rows.push(
      await probe(id, async () => {
        const ir = structuredClone(core.ir);
        let result,
          passed = false,
          extra = {};
        if (
          ["profile", "root-profile", "circuit-profile"].includes(
            scenario.probe,
          )
        ) {
          const device = ir.devices.find(
              (d) => d.designation === scenario.designation,
            ),
            type = ir.deviceTypes.find((t) => t.id === device.typeId);
          type.symbol = scenario.profile;
          result =
            scenario.probe === "circuit-profile"
              ? await renderSchematicPacket(ir, packet([circuit]))
              : await renderSchematic(ir, actuation);
          assert(!result.ok);
          const e = result.error;
          passed =
            (scenario.code === "R006"
              ? e.reason === "unprintable-layout"
              : e.reason === "unsupported-symbol-profile") &&
            e.details?.reason === "unsupported-symbol-profile" &&
            e.details?.unsupportedDeviceUid === device.uid &&
            e.unsupported?.typeId === type.id &&
            e.unsupported?.functionKey === scenario.functionKey &&
            e.details?.designation === device.designation &&
            e.details?.profile === scenario.profile &&
            e.details?.family === scenario.family &&
            [
              device.designation,
              type.id,
              scenario.profile,
              scenario.functionKey,
              scenario.family,
            ].every((s) => e.message.includes(s));
        } else if (scenario.probe === "disconnected") {
          result = await temporary(async (project) => {
            await cp(join(engineRoot, "examples/motor-starter"), project, {
              recursive: true,
            });
            await edit(project, "connections/control-chain.json", (v) => {
              v.objects = v.objects.filter(
                (o) => o.designation !== "W-CTL-007",
              );
            });
            const { report } = streams(
              await cli("create-view", request(project, { spec: actuation })),
              "create-view",
              1,
            );
            return { ok: false, error: report.error };
          }, null);
          passed =
            result.error.reason !== "unsupported-symbol-profile" &&
            result.error.details?.designation === "K1" &&
            result.error.message.includes("coil") &&
            result.error.details?.stoppedAt?.length > 0;
        } else if (scenario.probe === "trace-root") {
          result = await renderSchematic(ir, {
            format: "schematic-view-request/0.2",
            root: { by: "designation", value: "K1" },
            intent: {
              kind: "trace",
              to: { by: "designation", value: "PLC1" },
              includePower: false,
            },
          });
          const accepted = result.error?.details?.acceptedTraceRoots;
          passed =
            result.error?.reason === scenario.reason &&
            result.error?.details?.reason === scenario.reason &&
            result.error?.details?.rootFamilies?.includes("control") &&
            result.error?.message.includes("Choose another root or family") &&
            accepted?.length > 0 &&
            accepted.every(
              (r) =>
                result.error.message.includes(r.profile) &&
                r.functions.every((f) =>
                  result.error.message.includes(`${f.kind}/${f.terminalCount}`),
                ),
            );
        } else if (scenario.probe === "layout") {
          const machine = await compileProject(
            join(engineRoot, "examples/machine-demo"),
          );
          assert(machine.ok);
          // #60 makes the old machine-demo refusal drawable. Exercise the
          // actual validator with a moved conductor anchor instead of depending
          // on an incidental routing failure. Keep the authored R004 predicate.
          const { createElkEngine, createSchematicRendererWithDependencies } =
            await renderFaultEngine();
          const missing = machine.ir.wires.find(
            (w) => w.designation === "W-RIO2-L+",
          );
          const engine = createElkEngine(),
            layout = engine.layout.bind(engine);
          engine.layout = async (...args) => {
            const output = await layout(...args);
            output.edges.find(
              (e) => e.id === JSON.stringify(["wire", missing.uid]),
            ).sections[0].startPoint.x += 1;
            return output;
          };
          result = await createSchematicRendererWithDependencies({
            layoutEngine: engine,
          }).render(machine.ir, loads);
          passed =
            result.error?.message.includes("W-RIO2-L+") &&
            result.error.message.includes("RIO2.L+") &&
            result.error.details?.conductors?.every((c) =>
              c.terminals.every(
                (t) =>
                  t.designation &&
                  t.terminalKey &&
                  Array.isArray(t.functionKeys),
              ),
            ) &&
            !/[a-f0-9]{8}-[a-f0-9]{4}-/.test(result.error.message);
        } else if (scenario.probe === "packet-view") {
          const bad = structuredClone(circuit);
          bad.groups[0].functions[0].key = "ABSENT";
          result = await renderSchematicPacket(
            ir,
            packet([
              { format: "documentation-view-request/0.1", kind: "bom" },
              bad,
            ]),
          );
          passed =
            result.error?.details?.viewIndex === 1 &&
            result.error?.details?.viewTitle === bad.title &&
            result.error.message.includes("ABSENT");
        } else if (scenario.probe === "circuit-keys") {
          ir.wires.find((w) => w.designation === "W-CTL-007").properties = {
            label: "LONG".repeat(300),
          };
          result = await renderSchematicPacket(ir, packet([circuit]));
          passed =
            result.error?.message.includes("W-CTL-007") &&
            result.error.message.includes("coil") &&
            (
              result.error.details?.conductorKeys ??
              result.error.details?.circuitGroups?.flatMap(
                (g) => g.conductorKeys,
              )
            )?.includes("W-CTL-007");
        } else if (scenario.probe === "compact") {
          const req = {
            ...packet([
              {
                format: "schematic-view-request/0.1",
                family: "power",
                root: { by: "designation", value: "M1" },
                flow: "top-to-bottom",
              },
            ]),
            page: { size: scenario.paper },
          };
          result = await renderSchematicPacket(ir, req);
          const compact = await renderSchematicPacket(ir, {
            ...req,
            layout: "compact",
          });
          extra = { compactSucceeded: compact.ok };
          passed =
            !result.ok &&
            compact.ok === scenario.rescued &&
            result.error.message.includes("--layout compact") ===
              scenario.rescued &&
            result.error.details?.viewIndex === 0 &&
            result.error.details?.viewTitle.includes("M1");
        } else if (scenario.probe === "coverage") {
          result = await renderSchematicPacket(
            ir,
            packet([
              circuit,
              { format: "documentation-view-request/0.1", kind: "bom" },
            ]),
          );
          assert(result.ok);
          const d = result.value.coverage.diagnostics?.find(
            (d) => d.code === "W906",
          );
          passed =
            d?.devices.length > 0 &&
            !d.devices.some((d) => ["PLC1", "K1"].includes(d.designation)) &&
            d.devices.every((d) => d.appearance === "reports-only");
          result = { ok: false, error: d };
        } else assert.fail(`Unknown render scenario ${scenario.probe}`);
        assert(!result.ok, "A refusal scenario must not produce a drawing");
        assert.equal(result.error.code, scenario.code);
        return assess(
          id,
          {
            error: result.error,
            predicate: scenario.probe,
            provenance: ["P2; PU F3; CO F1/F3/F4; DQ F7; #44 trace root"],
            actionable: passed,
            ...extra,
          },
          passed,
        );
      }),
    );
  }
  return rows;
}
