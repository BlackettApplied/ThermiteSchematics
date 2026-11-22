import { compileProject } from "@thermite/compiler";
import { buildConnectorAssemblyInventory } from "@thermite/query";
import { dependencyDraft, documentPaper } from "./document-fixture.js";

export async function pointerFixture(width = 40, blocked = false, count = 3) {
  const c = await compileProject("examples/assembly-note-bounds");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const owner = c.ir.devices.find((d) => d.designation === "R1");
  if (!owner) throw Error("Missing connector owner");
  const ports = buildConnectorAssemblyInventory(c.ir).ports.filter(
    (p) => p.deviceUid === owner.uid,
  );
  const drafts = ports.slice(0, count).map((_, i) => {
    const draft = dependencyDraft(c.ir);
    draft.view = {
      format: "documentation-view/0.1",
      kind: "connector-assembly",
      title: "Pointer slot control",
    };
    draft.drawingBounds = { x: 0, y: 0, w: i ? 120 : width, h: 120 };
    return draft;
  });
  const sheets = drafts.map((draft, i) => {
    const port = ports[i];
    if (!port) throw Error("Missing native port");
    const x = [10, 50, 100][i] ?? (i + 1) * 10,
      y = [15, 45, 90][i] ?? (i + 1) * 10;
    return {
      number: i + 1,
      view: draft.view,
      references: [],
      continuations: [],
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="120mm" viewBox="0 0 120 120">${blocked && !i ? '<rect x="0" y="0" width="120" height="120" fill="black"/>' : ""}<g data-device-uid="${owner.uid}"><g data-connector-port="${port.key}"><circle cx="${x}" cy="${y}" r="1.1" fill="white" stroke="black" stroke-width=".4"/></g></g></svg>`,
    };
  });
  return { ir: c.ir, drafts, sheets, page: documentPaper() };
}
