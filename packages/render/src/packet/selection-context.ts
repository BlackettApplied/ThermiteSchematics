import type { ElectricalIr } from "@thermite/compiler";
import { record } from "./errors.js";

/** Known authored selections for errors raised before a topology drawing exists. */
export function topologySelectionContext(
  ir: Readonly<ElectricalIr>,
  request: unknown,
) {
  if (!record(request)) return {};
  const names = Array.isArray(request.devices) ? request.devices : [];
  const functions = [
    request.from,
    request.to,
    request.loopPower,
    ...(Array.isArray(request.via) ? request.via : []),
  ].filter(record);
  const conductors = Array.isArray(request.conductors)
    ? request.conductors
    : [];
  const selected = [...ir.wires, ...ir.jumpers].filter(
    (c) =>
      conductors.includes(c.uid) ||
      (c.designation && conductors.includes(c.designation)),
  );
  const cores = ir.cableConductors.filter((c) => {
    const cable = ir.cables.find((entry) => entry.uid === c.cableUid);
    return (
      conductors.includes(JSON.stringify(c.id)) ||
      (cable && conductors.includes(`${cable.designation}/${c.id.conductorId}`))
    );
  });
  const endpoints = [...selected, ...cores].flatMap((c) => c.endpoints);
  const devices = ir.devices.filter(
    (d) =>
      names.includes(d.uid) ||
      names.includes(d.designation) ||
      functions.some((f) => f.device === d.uid || f.device === d.designation) ||
      endpoints.some((e) => e.terminal.deviceUid === d.uid),
  );
  return devices.length
    ? {
        devices: devices.map((d) => ({
          deviceUid: d.uid,
          designation: d.designation,
          functions: functions
            .filter((f) => f.device === d.uid || f.device === d.designation)
            .map((f) => f.function),
          terminals: endpoints
            .filter((e) => e.terminal.deviceUid === d.uid)
            .map((e) => e.terminal.terminalKey),
        })),
      }
    : {};
}
