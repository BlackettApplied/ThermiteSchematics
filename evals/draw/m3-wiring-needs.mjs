import { painted } from "./review-geometry.mjs";
import { terminalKey } from "./m3-facts.mjs";
const designation = (ir, uid) =>
  ir.devices?.find((d) => d.uid === uid)?.designation;
const endName = (ir, t) =>
  t ? `${designation(ir, t.deviceUid)}.${t.terminalKey}` : "Unterminated";
function wiringTerminals(sheet, g, ir, catalog, request) {
  const authored = (request?.views ?? []).filter(
    (v) =>
      v.format === "wiring-view-request/0.1" &&
      (!v.title || sheet.view.title?.startsWith(v.title)),
  );
  const sourceRows =
    authored.length === 1
      ? catalog.filter(
          (r) =>
            r.kind === "wires" &&
            (authored[0].conductors ?? []).some(
              (key) => key === r.key || key === r.name,
            ),
        )
      : [];
  const sourceTerminals = sourceRows
    .flatMap((r) => r.ends ?? [])
    .filter(Boolean);
  const terminals = [
    ...new Map(
      [
        ...(g.terminals ?? []).map((t) => ({
          deviceUid: t.deviceUid,
          terminalKey: t.terminal,
        })),
        ...sourceTerminals,
      ].map((t) => [terminalKey(t), t]),
    ).values(),
  ];
  return { terminals, sourceTerminals };
}
function addIncidences(g, ir, catalog, terminals, add) {
  const selected = new Set(
    (g.shapes ?? [])
      .filter((s) => s.conductor && s.nativeBodyPainted !== false && painted(s))
      .map((s) => s.wire),
  );
  for (const id of terminals) {
    const hidden = catalog.filter(
      (r) => r.kind === "wires" && !selected.has(r.key),
    );
    add(
      "conductor-incidence",
      `wiring-incidence/${terminalKey(id)}`,
      hidden.flatMap((r) =>
        r.facts.filter(
          (f) =>
            f.kind === "conductor-incidence" &&
            terminalKey(f.terminal) === terminalKey(id),
        ),
      ),
      { subject: endName(ir, id) },
    );
  }
}
function addInventories(ir, catalog, uids, terminals, add) {
  for (const uid of uids) {
    const drawn = new Set(
      terminals.filter((t) => t.deviceUid === uid).map((t) => t.terminalKey),
    );
    add(
      "terminal-inventory",
      `wiring-terminals/${uid}`,
      catalog
        .filter(
          (r) =>
            r.kind === "terminals" &&
            r.facts[0].terminal.deviceUid === uid &&
            !drawn.has(r.facts[0].terminal.terminalKey),
        )
        .flatMap((r) => r.facts),
      { subject: designation(ir, uid) },
    );
  }
}
export function addWiringNeeds(sheet, g, ir, catalog, request, uids, own, add) {
  const { terminals, sourceTerminals } = wiringTerminals(
    sheet,
    g,
    ir,
    catalog,
    request,
  );
  for (const t of sourceTerminals)
    if (!own.has(t.deviceUid)) {
      uids.push(t.deviceUid);
      own.add(t.deviceUid);
    }
  addIncidences(g, ir, catalog, terminals, add);
  addInventories(ir, catalog, uids, terminals, add);
}
