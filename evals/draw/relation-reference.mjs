// Source oracle shared by report and attachment checks.
export function nativeRelationReference(ir, relation, policy = {}) {
  const designation = relation.designation?.trim();
  if (designation) return { text: designation, units: [designation] };
  if (policy.relationIdentity === "legacy")
    return { text: relation.uid, units: [relation.uid] };
  const endpoints = relation.connection ?? relation.assembly;
  if (endpoints) {
    const separator = relation.connection ? ": " : ".";
    const units = [
      [relation.fromDeviceUid, endpoints.fromPort],
      [relation.toDeviceUid, endpoints.toPort],
    ].map(([uid, port]) => {
      const name = ir.devices.find((d) => d.uid === uid)?.designation;
      return name && port ? name + separator + port : "";
    });
    if (units.every(Boolean)) return { text: units.join(" ↔ "), units };
  }
  return { text: relation.description?.trim() ?? "", units: [] };
}
