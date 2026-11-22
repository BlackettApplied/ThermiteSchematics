import { compileProject } from "@thermite/compiler";
import { prepareSchematicDrawing } from "../../src/renderer.js";
import { emitSchematicSvg } from "../../src/svg/emitter.js";
import { parseHTML } from "linkedom";
export async function motorLabelFixture(
  flow: "left-to-right" | "top-to-bottom",
) {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const p = await prepareSchematicDrawing(
    c.ir,
    {
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "LS1" },
      intent: {
        kind: "trace",
        to: { by: "designation", value: "PLC1" },
        includePower: true,
      },
      flow,
    },
    c.presentation,
  );
  if (!p.ok) throw Error(JSON.stringify(p.error));
  const { graph, layout, titleContext } = p.value;
  const emitted = emitSchematicSvg(
    graph,
    layout,
    titleContext,
    undefined,
    false,
    0.25,
    c.ir,
  );
  if (!emitted.ok) throw Error(JSON.stringify(emitted.error));
  const doc = parseHTML(emitted.value).document;
  return { layout, doc };
}
