// Native M3 fact identities and semantic columns; no exported planner claims.
export const terminalKey = (t) =>
  JSON.stringify([t?.deviceUid, t?.terminalKey]);
export const compact = (s) =>
  String(s ?? "")
    .normalize("NFC")
    .replace(/\s/gu, "");
export const semanticColumns = {
  "conductor-incidence": ["identity", "endpoints", "status"],
  "terminal-inventory": ["identity", "connections", "status"],
  "port-link-status": ["identity", "endpoints", "protocol", "status"],
  "core-inventory": ["identity", "endpoints", "status"],
  "assembly-pin-map": ["identity", "endpoints", "status", "pin-map"],
  "connector-port-status": ["identity", "endpoints", "status"],
};
const exactKeys = (o, keys) =>
  o &&
  JSON.stringify(Object.keys(o).sort()) === JSON.stringify(keys.slice().sort());
export function factKey(f) {
  if (!f || !semanticColumns[f.kind]) throw Error("Unknown M3 fact kind");
  if (f.kind === "conductor-incidence") {
    if (
      !exactKeys(f, ["kind", "element", "end", "terminal"]) ||
      ![0, 1].includes(f.end) ||
      !exactKeys(f.terminal, ["deviceUid", "terminalKey"])
    )
      throw Error("Invalid M3 incidence");
    const e = f.element,
      core = e?.kind === "cable_conductor";
    if (
      !exactKeys(
        e,
        core ? ["kind", "cableUid", "conductorId"] : ["kind", "uid"],
      ) ||
      !["wire", "jumper", "cable_conductor"].includes(e.kind)
    )
      throw Error("Invalid M3 element");
    return JSON.stringify([
      f.kind,
      e.kind,
      core ? [e.cableUid, e.conductorId] : e.uid,
      f.end,
      f.terminal.deviceUid,
      f.terminal.terminalKey,
    ]);
  }
  if (f.kind === "terminal-inventory") {
    if (
      !exactKeys(f, ["kind", "terminal"]) ||
      !exactKeys(f.terminal, ["deviceUid", "terminalKey"])
    )
      throw Error("Invalid M3 terminal");
    return JSON.stringify([
      f.kind,
      f.terminal.deviceUid,
      f.terminal.terminalKey,
    ]);
  }
  const fields = ["port-link-status", "connector-port-status"].includes(f.kind)
    ? ["deviceUid", "portKey"]
    : f.kind === "core-inventory"
      ? ["cableUid", "conductorId"]
      : ["relationUid"];
  if (
    !exactKeys(f, ["kind", ...fields]) ||
    fields.some(
      (k) =>
        typeof f[k] !== "string" ||
        (f.kind === "connector-port-status" && !f[k].trim()),
    )
  )
    throw Error("Invalid M3 fact fields");
  return JSON.stringify([f.kind, ...fields.map((k) => f[k])]);
}
export function factKeys(facts) {
  try {
    const keys = facts.map(factKey);
    return new Set(keys).size === keys.length ? keys.sort() : null;
  } catch {
    return null;
  }
}
