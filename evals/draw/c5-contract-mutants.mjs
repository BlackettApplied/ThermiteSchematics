const reasonKey = (x) =>
  x.expected.find((d) => d.need === "assembly-pin-map").rowKey;
const state = (x) =>
  x.packet.navigation.dependencies.find(
    (d) => d.requiredFacts[0]?.portKey === "X3",
  );
const changeCaption = (x, d, value) => {
  d.caption.text = value;
  x.geometries[0].texts.find((t) =>
    t.primitiveIds?.includes(d.caption.primitiveId),
  ).text = value;
};
function removeNeed(x, dep, hide = false) {
  const nav = x.packet.navigation;
  nav.dependencies = nav.dependencies.filter((d) => d !== dep);
  for (const d of nav.documents)
    d.autoOrigin.dependencyIds = d.autoOrigin.dependencyIds.filter(
      (id) => id !== dep.id,
    );
  for (const a of nav.autoDocuments)
    a.dependencyIds = a.dependencyIds.filter((id) => id !== dep.id);
  if (!hide) return;
  x.geometries[0].texts = x.geometries[0].texts.filter(
    (t) => !t.primitiveIds?.includes(dep.caption.primitiveId),
  );
  const removed = nav.documents[0].rows.filter((r) =>
    dep.resolution[0].rows.includes(r.id),
  );
  nav.documents[0].rows = nav.documents[0].rows.filter(
    (r) => !removed.includes(r),
  );
  for (const g of x.geometries) {
    g.texts = g.texts.filter(
      (t) => !removed.some((r) => r.nativeKey === t.row),
    );
    g.reportCells = g.reportCells.filter(
      (t) => !removed.some((r) => r.nativeKey === t.row),
    );
  }
}
function alterReason(x, value) {
  for (const t of x.geometries[1].texts.filter(
    (t) => t.row === reasonKey(x) && t.columnIndex === 4,
  ))
    t.text = value;
}
export const contractMutants = {
  "missing need": (x) => removeNeed(x, state(x)),
  "missing selected assembly need": (x) =>
    removeNeed(
      x,
      x.packet.navigation.dependencies.find(
        (d) => d.need === "assembly-pin-map",
      ),
    ),
  "cap given a pin map": (x) =>
    alterReason(x, "documented Pin mapping: mapped 1 → 2"),
  "unoccupied port given a cable": (x) => {
    x.packet.navigation.documents[0].rows.find((r) =>
      r.nativeKey.includes("X3"),
    ).facts = [
      { kind: "core-inventory", cableUid: "invented", conductorId: "1" },
    ];
  },
  "unoccupied port printed as a cable": (x) => {
    const key = x.packet.navigation.documents[0].rows.find((r) =>
      r.nativeKey.includes("X3"),
    ).nativeKey;
    for (const t of x.geometries[1].texts.filter((t) => t.row === key)) {
      if (t.columnIndex === 0) t.text = "CBL1";
      if (t.columnIndex === 3) t.text = "Connected";
    }
  },
  "wrong port": (x) => {
    state(x).requiredFacts[0].portKey = "X2";
  },
  "hidden dependency": (x) => removeNeed(x, state(x), true),
  "missing reason": (x) =>
    alterReason(x, "documented Pin mapping: not-applicable"),
  "wrong named subject": (x) => {
    const d = state(x);
    changeCaption(x, d, d.caption.text.replace("R1.X3", "R1.X2"));
  },
  "communication substitution": (x) => {
    state(x).requiredFacts[0].kind = "port-link-status";
  },
  "unoccupied port given an assembly": (x) => {
    state(x).requiredFacts = [
      { kind: "assembly-pin-map", relationUid: reasonKey(x) },
    ];
  },
};
