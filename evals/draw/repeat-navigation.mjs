import { finding, painted, groupBy } from "./review-geometry.mjs";
import {
  repeatAppearances,
  centroid,
  measuredZone,
  boxExtent,
} from "./repeat-appearances.mjs";
import { distance } from "./checks.mjs";
const EPS = 0.01;
const token = (a) => `${String(a.sheet).padStart(2, "0")}.${a.zone}`;
const unique = (xs) =>
  [...new Set(xs)].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
const equal = (a, b) =>
  JSON.stringify(unique(a)) === JSON.stringify(unique(b)) &&
  a.length === unique(a).length;
import {
  boxGap as gap,
  anchorDistance as boxDistance,
  nearestOwner,
} from "./navigation-geometry.mjs";
function labels(g) {
  // Marker/export disappearance never exempts visible repeat wording.
  return [
    ...groupBy(
      g.texts.filter(
        (t) =>
          painted(t) &&
          (t.navigationAnnotation || /Also shown|Repeat of/.test(t.text)),
      ),
      (t) => t.navigationAnnotation ?? t.textContainer ?? t.element,
    ),
  ]
    .filter(([, rows]) => rows.some((t) => /Also shown|Repeat of/.test(t.text)))
    .map(([id, rows]) => ({
      id,
      rows,
      bbox: boxExtent(rows),
      element: rows[0].element,
      text: rows.map((t) => t.text).join(" "),
    }));
}
function repeatTargets(a, allMembers) {
  const also = [],
    repeats = [],
    repeatMembers = [];
  for (const m of a.members) {
    const peers = allMembers
      .filter((n) => n.uid === m.uid && n.functionKey === m.functionKey)
      .sort(
        (x, y) =>
          x.order - y.order ||
          x.sheet - y.sheet ||
          x.zone?.localeCompare(y.zone),
      );
    const first = peers[0];
    if (first.view === m.view && first.sheet === m.sheet)
      also.push(
        ...peers
          .filter((n) => n.view !== m.view || n.sheet !== m.sheet)
          .map(token),
      );
    else {
      repeats.push(token(first));
      repeatMembers.push(m);
    }
  }
  const expected = {
    "Also shown": unique(also),
    "Repeat of": unique(repeats),
  };
  return { expected, repeatMembers };
}
function verifyRepeatTargets(label, expected, repeatMembers, emit) {
  const sections = [
    ...label.text.matchAll(
      /(Also shown|Repeat of)\s+(.*?)(?=Also shown|Repeat of|$)/g,
    ),
  ];
  for (const role of Object.keys(expected)) {
    const lines = sections.filter((m) => m[1] === role),
      targets = lines.flatMap((m) =>
        [...m[2].matchAll(/\b(\d+)\.([A-Z]+\d+)\b/g)].map(
          (x) => `${x[1].padStart(2, "0")}.${x[2]}`,
        ),
      );
    if (
      lines.length !== (expected[role].length ? 1 : 0) ||
      !equal(targets, expected[role])
    )
      emit("repeat-targets", label, {
        role,
        expected: expected[role],
        actual: targets,
      });
    if (role === "Repeat of" && expected[role].length) {
      const noun =
        unique(repeatMembers.map((m) => m.functionKey)).length > 1
          ? "functions"
          : repeatMembers[0]?.kind === "contact"
            ? "contact"
            : "function";
      if (
        lines.length !== 1 ||
        lines[0][2].match(/\(same ([^)]+)\)/)?.[1] !== noun
      )
        emit("repeat-qualifier", label, { expected: noun });
    }
  }
}
function repeatClearance(g, label, emit) {
  for (const t of g.texts.filter(painted)) {
    if (label.rows.includes(t)) continue;
    for (const row of label.rows) {
      const d = gap(row.bbox, t.bbox);
      if (
        d.y === 0 &&
        Math.min(row.bbox.y + row.bbox.h, t.bbox.y + t.bbox.h) >
          Math.max(row.bbox.y, t.bbox.y) &&
        d.x < 4 - EPS
      )
        emit("repeat-text-clearance", row, {
          otherElement: t.element,
          gapMm: d.x,
          minimumMm: 4,
        });
    }
  }
  for (const s of g.shapes) {
    const segments = s.navigationInkSegments ?? s.inkSegments ?? [];
    let minimum = Infinity;
    for (const row of label.rows)
      for (const [p, q] of segments) {
        const b = row.bbox;
        // A segment intersects the label or approaches a corner/edge.
        const corners = [
          { x: b.x, y: b.y },
          { x: b.x + b.w, y: b.y },
          { x: b.x + b.w, y: b.y + b.h },
          { x: b.x, y: b.y + b.h },
        ];
        const d =
          Math.min(
            boxDistance(p, b),
            boxDistance(q, b),
            ...corners.map((c) => distance(c, p, q)),
          ) -
          s.stroke / 2;
        minimum = Math.min(minimum, d);
      }
    if (minimum < 1.5 - 0.05)
      emit("repeat-ink-clearance", label, {
        otherElement: s.element,
        gapMm: minimum,
        minimumMm: 1.5,
      });
  }
}

/** @returns {import('./navigation-contracts').RepeatAudit} */
export function repeatNavigation(packet, geometries, ir, request) {
  const appearances = repeatAppearances(packet, geometries, ir, request);
  const findings = [],
    measurements = [];
  const allMembers = appearances.flatMap((a) => a.members);
  const obligations = appearances.flatMap((a) => {
    const members = a.members.filter(
      (m) =>
        new Set(
          allMembers
            .filter((n) => n.uid === m.uid && n.functionKey === m.functionKey)
            .map((n) => n.view),
        ).size > 1,
    );
    return members.length ? [{ ...a, members }] : [];
  });
  const annotations = packet.navigation?.annotations ?? [];
  const occurrences = packet.navigation?.occurrences ?? [];
  for (const [i, sheet] of packet.sheets.entries()) {
    const g = geometries[i];
    if (!g) continue;
    const local = obligations.filter((a) => a.sheet === sheet.number),
      actual = labels(g),
      assigned = new Map(local.map((a) => [a, []]));
    for (const label of actual) {
      const exported = annotations.find(
        (a) =>
          a.id === label.id ||
          a.primitiveIds?.some((id) =>
            label.rows.some((t) => t.primitiveIds?.includes(id)),
          ),
      );
      const located = occurrences.find(
        (o) => o.id === exported?.ownerOccurrence,
      );
      const byTag = local.filter(
        (a) =>
          label.text.startsWith(
            (ir.devices.find((d) => d.uid === a.uid)?.designation ?? "") + ":",
          ) ||
          label.text.startsWith(
            (ir.devices.find((d) => d.uid === a.uid)?.designation ?? "") + " (",
          ),
      );
      const candidates = located
        ? local.filter(
            (a) =>
              a.uid === located.source.deviceUid &&
              a.members.some(
                (m) => m.functionKey === located.source.functionKey,
              ) &&
              (located.provenance.view.key
                ? a.viewKey === located.provenance.view.key
                : a.order === located.provenance.view.authoredOrder),
          )
        : byTag;
      const owner = candidates.length === 1 ? candidates[0] : undefined;
      if (!owner) {
        findings.push({
          sheet: sheet.number,
          ...finding("repeat-label-unresolved-owner", label),
        });
        continue;
      }
      if (
        !exported ||
        !located ||
        !label.rows.every((t) => t.navigationAnnotation === exported.id)
      )
        findings.push({
          sheet: sheet.number,
          ...finding("repeat-label-locator-mismatch", label),
        });
      assigned.get(owner).push(label);
    }
    for (const a of local) {
      const found = assigned.get(a);
      const emit = (kind, item, extra = {}) =>
        findings.push({
          sheet: a.sheet,
          ...finding(kind, item, { deviceUid: a.uid, view: a.view, ...extra }),
        });
      if (found.length !== 1) {
        emit("repeat-label-count", found[0] ?? a, {
          expected: 1,
          actual: found.length,
          functions: unique(a.members.map((m) => m.functionKey)),
        });
        continue;
      }
      const designation = ir.devices.find((d) => d.uid === a.uid)?.designation;
      if (
        !found[0].text.startsWith(designation + ":") &&
        !found[0].text.startsWith(designation + " (")
      )
        emit("repeat-owner-text", found[0], { expected: designation });
      const label = found[0],
        { expected, repeatMembers } = repeatTargets(a, allMembers);
      verifyRepeatTargets(label, expected, repeatMembers, emit);
      const anchor = centroid(a.ports),
        ownZone = measuredZone(g, anchor);
      const {
        ownerNearest,
        nearestDeviceUid,
        nearestFrameGapMm,
        ownerFrameGapMm,
      } = nearestOwner(g, a, label.bbox);
      const distanceMm = boxDistance(anchor, label.bbox);
      const localLabel = distanceMm <= 60 + EPS + 1e-9 && ownerNearest;
      const prefix = label.text.match(/^.*?\((\d+)\.([A-Z]+\d+)\):/);
      const selfLocated =
        prefix && Number(prefix[1]) === a.sheet && prefix[2] === ownZone;
      if ((!localLabel && !selfLocated) || (prefix && !selfLocated))
        emit("repeat-locality", label, {
          distanceMm,
          nearestDeviceUid,
          nearestFrameGapMm,
          ownerFrameGapMm,
          expectedPrefix: token({ sheet: a.sheet, zone: ownZone }),
        });
      measurements.push({
        sheet: a.sheet,
        deviceUid: a.uid,
        view: a.view,
        functions: unique(a.members.map((m) => m.functionKey)),
        anchor,
        zone: ownZone,
        distanceMm,
        ownerNearest,
        nearestFrameGapMm,
        ownerFrameGapMm,
        selfLocated: !!selfLocated,
        bbox: label.bbox,
      });
      repeatClearance(g, label, emit);
    }
  }
  return {
    findings,
    measurements,
    appearanceCount: appearances.length,
    repeatCount: obligations.length,
  };
}
