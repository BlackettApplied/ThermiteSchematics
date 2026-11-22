// An issued circuit appearance must resolve to an authored circuit group and
// native function. Planner kind and glyph/group markers alone cannot prove it.
export function authoredCircuitShapes(sheet, geometry, ir, request) {
  if (sheet.view?.root) return [];
  const views =
    request?.format === "circuit-view-request/0.1"
      ? [request]
      : (request?.views ?? []);
  const circuits = views.filter(
    (v) =>
      v.format === "circuit-view-request/0.1" && v.title === sheet.view?.title,
  );
  const functions = circuits.flatMap((v) =>
    (v.groups ?? []).flatMap((group) =>
      (group.functions ?? []).flatMap((f) => {
        const devices = (ir.devices ?? []).filter((d) =>
          f.device?.by === "uid"
            ? d.uid === f.device.value
            : f.device?.by === "designation" &&
              d.designation === f.device.value,
        );
        if (
          devices.length !== 1 ||
          !(ir.functions ?? []).some(
            (native) =>
              native.id.deviceUid === devices[0].uid &&
              native.id.functionKey === f.key,
          )
        )
          return [];
        return [{ group: group.id, uid: devices[0].uid, key: f.key }];
      }),
    ),
  );
  return (geometry?.shapes ?? []).filter((s) =>
    functions.some(
      (f) =>
        s.circuitGroup === f.group &&
        s.deviceUid === f.uid &&
        s.functionKey === f.key,
    ),
  );
}
