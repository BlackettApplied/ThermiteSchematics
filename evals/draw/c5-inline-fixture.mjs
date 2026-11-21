import { createHash } from "node:crypto";
import { contractCandidate, inlineCandidate } from "./c5-contract-fixture.mjs";
import { fixture } from "./m3-fixture.mjs";
import { viewBindings } from "./tranche4-views.mjs";
// An independently declared communication need must survive an inline inventory
// on the preceding native assembly view. No nativeNeeds output builds exports.
export function twoViewInline(ir, view, relation, table) {
  const other = fixture(),
    native = structuredClone(ir);
  native.devices.push(...other.ir.devices);
  native.deviceTypes.push(...other.ir.deviceTypes);
  const x = inlineCandidate(contractCandidate(native, view, relation, table));
  x.request.views.push({
    format: "communication-view-request/0.1",
    devices: ["a"],
  });
  const viewKey = viewBindings(x.request, native)[1],
    dep = other.packet.navigation.dependencies[0],
    id = `dependency/1/${createHash("sha256")
      .update(JSON.stringify([viewKey, dep.owner.noteId]))
      .digest("hex")}`;
  other.source.navigationViews = [viewKey];
  dep.id = id;
  dep.owner = { ...dep.owner, sheet: 2, viewKey };
  dep.caption.text = dep.caption.text.replace("02.", "03.");
  other.source.texts[0].text = dep.caption.text;
  Object.assign(dep, x.binding);
  const doc = other.packet.navigation.documents[0];
  Object.assign(doc, x.binding);
  doc.autoOrigin.dependencyIds = [id];
  doc.rows[0].sheet = 3;
  const auto = other.packet.navigation.autoDocuments[0];
  auto.dependencyIds = [id];
  auto.sheets = [3];
  x.packet.navigation.documents.push(doc);
  x.packet.navigation.dependencies.push(dep);
  x.packet.navigation.autoDocuments.push(auto);
  x.packet.sheets.push(
    { number: 2, view: { kind: "communication" } },
    { number: 3, view: { kind: "network" } },
  );
  x.geometries.push(other.source, other.report);
  x.tables.push(...other.tables);
  return x;
}
