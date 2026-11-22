import { nativePortInk } from "./native-port-ink.mjs";
import { device } from "./tranche4-source.mjs";
import { finding, painted } from "./review-geometry.mjs";
import { inView, viewBindings } from "./tranche4-views.mjs";
function communicationInk(g, links, ir, seen, sheet, part) {
  const findings = [];
  for (const p of (g.tranche4?.ports ?? []).filter(
    (p) => p.kind === "communication",
  ))
    if (
      !ir.deviceTypes.find((t) => t.id === device(ir, p.deviceUid)?.typeId)
        ?.ports?.[p.key] ||
      !p.point
    )
      findings.push({
        ...finding("native-part-port-owner-unavailable", p),
        sheet,
      });
  for (const edge of g.tranche4?.communicationLinks ?? []) {
    const r = links.find((r) => r.uid === edge.uid),
      ends = r && [
        { deviceUid: r.fromDeviceUid, portKey: r.connection.fromPort },
        { deviceUid: r.toDeviceUid, portKey: r.connection.toPort },
      ];
    if (
      !r ||
      JSON.stringify(edge.ends) !== JSON.stringify(ends) ||
      !nativePortInk(edge, g.tranche4?.ports ?? [], "communication")
    )
      findings.push({
        ...finding("native-part-port-link-disagrees", edge),
        sheet,
      });
    if (!seen.has(edge.uid)) seen.set(edge.uid, new Set());
    seen.get(edge.uid).add(JSON.stringify([sheet, part]));
  }
  return findings;
}
function communicationSheet(s, g, x) {
  if (s.view.kind !== "communication" || !inView(g, x.key)) return null;
  const headings = g.texts
    .filter(painted)
    .map((t) => t.text)
    .join(" ");
  const matches = [...headings.matchAll(/\bPart\s+(\d+)\s*\/\s*(\d+)/gi)];
  const part = Number(matches[0]?.[1] ?? 1),
    total = Number(matches[0]?.[2] ?? 1);
  if (
    new Set(matches.map((m) => `${m[1]}/${m[2]}`)).size > 1 ||
    part < 1 ||
    part > total
  )
    x.findings.push({
      ...finding("native-part-identity-unavailable"),
      sheet: s.number,
    });
  x.findings.push(
    ...communicationInk(g, x.links, x.ir, x.seen, s.number, part),
  );
  return {
    kind: "communication",
    view: x.view,
    group: "communication",
    part,
    total,
    sheet: s.number,
    ports: (g.tranche4?.ports ?? []).filter((p) => p.kind === "communication"),
    geometry: g,
  };
}
export function communicationParts(packet, geometries, request, ir, findings) {
  const result = [],
    keys = viewBindings(request, ir);
  for (const [view, v] of request.views.entries()) {
    if (v.format !== "communication-view-request/0.1") continue;
    const own = ir.devices
      .filter((d) => v.devices?.some((n) => n === d.uid || n === d.designation))
      .map((d) => d.uid);
    const links = ir.relations.filter(
      (r) =>
        r.connection?.medium === v.medium &&
        (!v.devices ||
          own.includes(r.fromDeviceUid) ||
          own.includes(r.toDeviceUid)),
    );
    const x = { view, key: keys[view], ir, links, findings, seen: new Map() };
    const parts = packet.sheets
      .map((s, i) => communicationSheet(s, geometries[i], x))
      .filter(Boolean);
    result.push(...parts);
    for (const r of links)
      if (x.seen.get(r.uid)?.size !== 1)
        findings.push({
          ...finding(
            "native-part-whole-link-not-once",
            {},
            { link: r.uid, appearances: x.seen.get(r.uid)?.size ?? 0 },
          ),
          sheet: parts[0]?.sheet ?? packet.sheets[0].number,
        });
  }
  return result;
}
