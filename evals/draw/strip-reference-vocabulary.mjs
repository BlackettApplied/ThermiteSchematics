import { painted } from "./review-geometry.mjs";
import { stripTerminalBody } from "./terminal-strip-landing.mjs";
import { terminalKey } from "./terminal-strip-native.mjs";

const normalize = (value) =>
  value.normalize("NFC").replace(/\s+/gu, " ").trim();

function referenceRow(geometry, representations) {
  const first = representations[0];
  if (first.reportRowScope == null) return [];
  const belongs = (t) =>
    t.row === first.row &&
    t.reportRowScope === first.reportRowScope &&
    t.documentId === first.documentId;
  if (!representations.every((t) => painted(t) && belongs(t))) return [];
  return geometry.texts.filter(belongs);
}

function nativeBodyAt(context, device, terminals, address) {
  const target = /^(\d+)\s*\/\s*([A-D][1-6])$/u.exec(address.trim());
  if (!target) return false;
  const [, number, zone] = target;
  const index = context.packet?.sheets.findIndex(
    (sheet) =>
      sheet.number === Number(number) && sheet.view.kind === "terminal-strip",
  );
  const ink = context.geometries?.[index]?.terminalStripInk;
  if (!ink) return false;
  return terminals.some(({ key }) => {
    const body = stripTerminalBody(
      ink,
      terminalKey({ deviceUid: device.uid, terminalKey: key }),
      key,
      device.designation,
    );
    return body?.sheet === Number(number) && body.zone === zone;
  });
}

export function bindsStripReference(
  geometry,
  representations,
  context,
  ir,
  uid,
  keys,
  combine,
) {
  if (!Array.isArray(keys) || keys.length) return false;
  const device = ir.devices.find((d) => d.uid === uid);
  const type = ir.deviceTypes?.find((t) => t.id === device?.typeId);
  if (!type?.terminals?.length) return false;
  const row = referenceRow(geometry, representations);
  const field = (column) => {
    const texts = row.filter((t) => t.columnIndex === column);
    return texts.every(painted) ? normalize(combine(texts)) : "";
  };
  if (field(0) !== normalize(device.designation)) return false;
  const addresses = field(2);
  return (
    addresses.length > 0 &&
    addresses
      .split(";")
      .every((address) =>
        nativeBodyAt(context, device, type.terminals, address),
      )
  );
}
