// Native cable/core + device/terminal identities establish each end. Circle
// order, exported locator values and renderer planners establish no identity.
import { painted, finding, extent } from "./review-geometry.mjs";
const compact = (s) =>
  String(s ?? "")
    .normalize("NFC")
    .replace(/\s+/gu, "");
const pair = (p) => (Array.isArray(p) ? p : [p?.deviceUid, p?.terminalKey]);
const same = (a, b) => JSON.stringify(pair(a)) === JSON.stringify(pair(b));
const valid = (p) =>
  pair(p).length === 2 &&
  pair(p).every((s) => typeof s === "string" && s.length > 0);
function captionBox(labels, expected) {
  for (const first of labels) {
    const lines = labels
      .filter(
        (t) =>
          Math.abs(
            (t.anchor?.x ?? t.bbox.x) - (first.anchor?.x ?? first.bbox.x),
          ) < 0.05 && t.bbox.y >= first.bbox.y,
      )
      .sort((a, b) => a.bbox.y - b.bbox.y);
    const used = [];
    let value = "";
    for (const t of lines) {
      used.push(t);
      value += compact(t.text);
      if (value === expected)
        return extent(
          used.flatMap((t) => [
            t.bbox,
            { x: t.bbox.x + t.bbox.w, y: t.bbox.y + t.bbox.h },
          ]),
        );
      if (!expected.startsWith(value)) break;
    }
  }
}
function distance(a, b) {
  return Math.hypot(
    Math.max(0, a.x - b.x - b.w, b.x - a.x - a.w),
    Math.max(0, a.y - b.y - b.h, b.y - a.y - a.h),
  );
}
function endCaption(row, end, labels, ir, add) {
  const endpoint = row.ends[end],
    devices = ir.devices.filter((d) => d.uid === endpoint.deviceUid);
  if (devices.length !== 1) return;
  const expected = compact(`${devices[0].designation}.${endpoint.terminalKey}`);
  const declared = labels.filter((t) => t.tagTerminalDeclared || t.tagTerminal);
  if (!declared.length) {
    // Historical ink can identify an end only if that printed identity is unique.
    if (
      row.ends
        .filter(Boolean)
        .filter(
          (p) =>
            compact(
              `${ir.devices.find((d) => d.uid === p.deviceUid)?.designation}.${p.terminalKey}`,
            ) === expected,
        ).length !== 1
    )
      return;
    return captionBox(labels, expected);
  }
  const selected = declared.filter((t) => same(t.tagTerminal, endpoint));
  const role = `${row.element.cableUid}/${row.element.conductorId}/${end === 0 ? "a" : "z"}`;
  for (const t of declared) {
    const sourceEnd = row.ends.findIndex((p) => p && same(p, t.tagTerminal));
    const blockRole = ["a", "z"].findIndex(
      (s) =>
        t.tagBlock ===
        `${row.element.cableUid}/${row.element.conductorId}/${s}`,
    );
    if (
      !valid(t.tagTerminal) ||
      sourceEnd < 0 ||
      t.tagOwnerUid !== pair(t.tagTerminal)[0] ||
      t.tagOwnershipValid === false ||
      (blockRole >= 0 && blockRole !== sourceEnd)
    )
      add(
        "cable-end-identity-mismatch",
        t,
        "caption disagrees with native cable end",
        { declared: t.tagTerminal, sourceEnds: row.ends },
      );
  }
  if (!selected.length) return;
  const groups = new Map();
  for (const t of selected) {
    const id = t.tagContainer ?? t.tagBlock ?? role;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(t);
  }
  const boxes = [...groups.values()]
    .map((ts) => captionBox(ts, expected))
    .filter(Boolean);
  if (boxes.length !== 1) {
    add(
      "cable-end-identity-mismatch",
      selected[0],
      "native endpoint caption is missing, foreign or ambiguous",
      { endpoint, expected },
    );
    return;
  }
  return boxes[0];
}
function bindCore(row, markers, g, ir, sheet, result) {
  const labels = g.texts.filter(
    (t) =>
      painted(t) &&
      t.tagPainted !== false &&
      t.cableScope === markers[0].cableScope,
  );
  const seen = new Set();
  const add = (kind, item, reason, extra = {}) =>
    result.findings.push(
      finding(kind, item, {
        sheet,
        row: row.key,
        cableUid: row.element.cableUid,
        conductorId: row.element.conductorId,
        reason,
        ...extra,
      }),
    );
  for (const end of [0, 1]) {
    const endpoint = row.ends[end];
    if (!endpoint) continue;
    const box = endCaption(row, end, labels, ir, add);
    const nearest =
      box &&
      markers.filter(
        (m) =>
          !markers.some(
            (other) =>
              other !== m &&
              distance(box, other.bbox) <= distance(box, m.bbox) + 0.01,
          ),
      );
    if (!box || nearest.length !== 1 || seen.has(nearest[0])) {
      result.notMeasured.push({
        sheet,
        row: row.key,
        end,
        endpoint,
        reason: "cable end lacks unique native printed identity and circle",
      });
      continue;
    }
    const item = nearest[0];
    seen.add(item);
    if (item.terminal && !same(item.terminal, endpoint))
      add(
        "cable-end-identity-mismatch",
        item,
        "circle disagrees with native printed endpoint",
        { end, endpoint, declared: item.terminal },
      );
    result.owners.set(item, pair(endpoint));
  }
}
export function cableEndBindings(packet, geometries, ir, rows) {
  const result = { owners: new Map(), findings: [], notMeasured: [] };
  for (const [i, g] of geometries.entries()) {
    const groups = new Map();
    for (const item of g?.wireTerminals ?? [])
      if (item.cableUid && item.conductorId) {
        const scope = JSON.stringify([
          item.cableUid,
          item.conductorId,
          item.cableScope,
        ]);
        if (!groups.has(scope)) groups.set(scope, []);
        groups.get(scope).push(item);
      }
    for (const markers of groups.values()) {
      const item = markers[0],
        candidates = rows.filter(
          (r) =>
            r.element.kind === "cable_conductor" &&
            r.element.cableUid === item.cableUid &&
            r.element.conductorId === item.conductorId,
        );
      if (candidates.length !== 1) {
        result.findings.push(
          finding("cable-end-identity-mismatch", item, {
            sheet: packet.sheets[i].number,
            reason: "missing or ambiguous native cable/core identity",
          }),
        );
        continue;
      }
      bindCore(candidates[0], markers, g, ir, packet.sheets[i].number, result);
    }
  }
  return result;
}
