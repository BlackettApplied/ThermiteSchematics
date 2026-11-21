// Native identity catalog: source fields, not renderer/query print helpers.
export function wireRecord(w, kind) {
  return {
    key: w.uid,
    kind,
    designation: w.designation,
    primary: w.properties?.label ?? w.designation ?? "JUMPER",
    aliases: [
      ...(w.aliases ?? []).filter((x) => typeof x === "string"),
      ...(!w.designation && kind === "jumper" ? ["Jumper", "jumper"] : []),
    ],
    names: [
      w.uid,
      w.designation,
      w.properties?.label,
      ...(w.aliases ?? []),
    ].filter(Boolean),
    ends: w.endpoints?.map((e) => e?.terminal),
    source: w,
    physical: true,
  };
}
export function coreRecord(cable, id, source, physical) {
  if (!cable?.designation) throw Error("Native cable identity unavailable");
  const name = `${cable.designation}.${id}`;
  return {
    key: JSON.stringify([cable.uid, id]),
    kind: "core",
    primary: name,
    designation: name,
    aliases: [`${cable.designation}/${id}`],
    names: [
      name,
      `${cable.designation}/${id}`,
      JSON.stringify({ cableUid: cable.uid, conductorId: id }),
    ],
    ends: source?.endpoints?.map((e) => e?.terminal) ?? [undefined, undefined],
    source,
    physical,
  };
}
export function coreRecords(ir) {
  const result = ir.cableConductors.map((core) =>
    coreRecord(
      ir.cables.find((c) => c.uid === core.id.cableUid),
      core.id.conductorId,
      core,
      true,
    ),
  );
  for (const cable of ir.cables) {
    const definitions =
      ir.cableTypes?.find((t) => t.id === cable.typeId)?.conductors ?? [];
    for (const def of definitions) {
      const key = JSON.stringify([cable.uid, def.id]);
      if (!result.some((w) => w.key === key))
        result.push(
          coreRecord(
            cable,
            def.id,
            cable.assignments?.find((a) => a.id === def.id),
            false,
          ),
        );
    }
  }
  return result;
}
