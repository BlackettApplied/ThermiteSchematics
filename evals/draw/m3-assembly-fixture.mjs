import { fixture } from "./m3-fixture.mjs";
import { createHash } from "node:crypto";
const hashForTest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function assemblyFixture() {
  const f = fixture(),
    dep = f.packet.navigation.dependencies[0],
    doc = f.packet.navigation.documents[0],
    row = doc.rows[0];
  f.ir = {
    devices: [
      { uid: "a", designation: "A" },
      { uid: "b", designation: "B" },
    ],
    relations: [
      {
        uid: "rel",
        designation: "CB",
        fromDeviceUid: "a",
        toDeviceUid: "b",
        assembly: {
          kind: "cordset",
          fromPort: "J",
          toPort: "J",
          status: "planned",
          pinMapping: {
            status: "unresolved",
            reason: "Native mapping unknown",
          },
        },
      },
    ],
  };
  f.packet.sheets[0].view.kind = "signal-loop";
  f.request = { views: [{ format: "signal-loop-view-request/0.1" }] };
  doc.kind = f.packet.sheets[1].view.kind = "assemblies";
  doc.label = "assembly inventory";
  const fact = { kind: "assembly-pin-map", relationUid: "rel" };
  dep.need = "assembly-pin-map";
  dep.owner.noteId = "loop-assembly-pin-maps";
  dep.id = `dependency/1/${hashForTest([dep.owner.viewKey, dep.owner.noteId])}`;
  doc.autoOrigin.dependencyIds = [dep.id];
  f.packet.navigation.autoDocuments[0].dependencyIds = [dep.id];
  dep.requiredFacts = [fact];
  dep.requiredColumns = ["identity", "endpoints", "status", "pin-map"];
  dep.caption.text = "Assembly pin maps: assembly inventory 02.A3 (CB).";
  f.source.texts[0].text = dep.caption.text;
  row.nativeKey = "rel";
  row.displayName = "CB";
  row.facts = [
    fact,
    { kind: "connector-port-status", deviceUid: "a", portKey: "J" },
    { kind: "connector-port-status", deviceUid: "b", portKey: "J" },
  ];
  row.columns = dep.requiredColumns;
  const values = [
    "CB",
    "cordset",
    "A.J",
    "B.J",
    "planned Pin mapping: unresolved Native mapping unknown",
  ];
  for (const t of f.report.texts.filter((t) => t.row)) {
    t.row = "rel";
    t.text = values[t.columnIndex];
  }
  for (const c of f.report.reportCells) c.row = "rel";
  f.report.texts.find((t) => t.text === "network inventory").text =
    "assembly inventory";
  f.tables = [{ kind: doc.kind, documentId: doc.id, columns: [] }];
  return f;
}
