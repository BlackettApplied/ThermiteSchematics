import { straightPath } from "./path.mjs";
// Browser-free predicates. Inputs are measured DOM geometry, PDF text/raster
// observations, and unchanged compiled IR. No renderer layout estimator is used.
export const ANISOTROPY_EPSILON = 1e-9; // numerical comparison only, dimensionless
export const INK_ACCURACY_MM = 0.17; // two pixels at 300 dpi, rounded outwards
export const inside = (a, b, t = INK_ACCURACY_MM) =>
  a.x >= b.x - t &&
  a.y >= b.y - t &&
  a.x + a.w <= b.x + b.w + t &&
  a.y + a.h <= b.y + b.h + t;
export const overlap = (a, b, t = 2 * INK_ACCURACY_MM) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > t &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > t;
export const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
export function distance(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l = dx * dx + dy * dy,
    t = l
      ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l))
      : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
const issue = (kind, item, measurement = {}) => ({
  element: item.element ?? "sheet",
  ...(item.medium ? { medium: item.medium } : {}),
  ...(item.boxKind ? { boxKind: item.boxKind } : {}),
  designation: item.designation ?? item.text ?? item.deviceUid ?? "sheet",
  ...(item.bbox ? { bbox: item.bbox } : { sheetLevel: true }),
  ...(item.emBbox ? { emBbox: item.emBbox } : {}),
  ...measurement,
  kind,
});
export function labelParity(labels) {
  return labels
    .filter((l) => l.svgInk >= 8 && l.pdfInk < Math.max(2, l.svgInk * 0.18))
    .map((l) =>
      issue("missing-raster-label", l, {
        backend: l.backend,
        svgInk: l.svgInk,
        pdfInk: l.pdfInk,
        text: l.text,
      }),
    );
}
export function textBounds(g) {
  const out = [];
  for (const t of g.texts) {
    for (const [kind, b] of [
      ["sheet", { x: 0, y: 0, w: g.width, h: g.height }],
      ["frame", g.frame],
      ["viewport", t.viewport],
      ["cell", t.cell],
      ["clip", t.clip],
    ])
      if (b && !inside(t.bbox, b)) {
        out.push(
          issue(`text-outside-${kind}`, t, {
            text: t.text,
            container: b,
            overflowMm: Math.max(
              b.x - t.bbox.x,
              b.y - t.bbox.y,
              t.bbox.x + t.bbox.w - b.x - b.w,
              t.bbox.y + t.bbox.h - b.y - b.h,
            ),
          }),
        );
        break;
      }
  }
  // Pairwise text extents; fully invisible tiled copies were removed in Chromium.
  for (let i = 0; i < g.texts.length; i++)
    for (let j = i + 1; j < g.texts.length; j++) {
      const a = g.texts[i],
        b = g.texts[j];
      if (a.painted === false || b.painted === false) continue;
      if (overlap(a.bbox, b.bbox))
        out.push(
          issue("text-text-overlap", a, {
            text: a.text,
            otherElement: b.element,
            otherText: b.text,
            otherBbox: b.bbox,
          }),
        );
    }
  return out;
}
function polyDistance(a, b) {
  let best = Infinity;
  for (const p of a.points)
    for (let i = 1; i < b.points.length; i++)
      best = Math.min(best, distance(p, b.points[i - 1], b.points[i]));
  return best;
}
function solidContains(shape, p) {
  if (!shape.points.length) return false;
  let hit = false;
  const pts = shape.points;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i],
      b = pts[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      hit = !hit;
  }
  return hit;
}
const dark = (fill) =>
  fill &&
  ![
    "none",
    "rgb(255, 255, 255)",
    "rgba(0, 0, 0, 0)",
    "white",
    "#fff",
    "#ffffff",
  ].includes(fill);
export function symbolIsolation(symbols) {
  const out = [];
  for (const symbol of symbols) {
    const shapes = symbol.shapes.filter(
      (s) =>
        s.points.length && (s.stroke > 0 || dark(s.fill)) && s.dash === "none",
    );
    const parent = shapes.map((_, i) => i),
      find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < shapes.length; i++)
      for (let j = i + 1; j < shapes.length; j++) {
        const a = shapes[i],
          b = shapes[j];
        if (
          !overlap(
            {
              x: a.bbox.x - 0.5,
              y: a.bbox.y - 0.5,
              w: a.bbox.w + 1,
              h: a.bbox.h + 1,
            },
            b.bbox,
            -0.01,
          )
        )
          continue;
        if (
          polyDistance(a, b) <= (a.stroke + b.stroke) / 2 + 0.02 ||
          (dark(a.fill) && b.points.some((p) => solidContains(a, p))) ||
          (dark(b.fill) && a.points.some((p) => solidContains(b, p)))
        )
          parent[find(i)] = find(j);
      }
    const touching = new Map();
    for (const p of symbol.ports)
      for (let i = 0; i < shapes.length; i++) {
        const s = shapes[i];
        if (
          s.points.some(
            (q, j) =>
              j > 0 &&
              distance(p.point, s.points[j - 1], q) <= s.stroke / 2 + 0.03,
          ) ||
          (dark(s.fill) && solidContains(s, p.point))
        ) {
          const k = find(i);
          if (!touching.has(k)) touching.set(k, []);
          touching.get(k).push(p);
        }
      }
    for (const ports of touching.values()) {
      const nets = [...new Set(ports.map((p) => p.net).filter(Boolean))];
      if (nets.length > 1)
        out.push(
          issue("symbol-joins-independent-ports", symbol, {
            ports: ports.map((p) => ({
              terminal: p.terminal,
              net: p.net,
              point: p.point,
            })),
            nets,
          }),
        );
    }
  }
  return out;
}
const facts = new Set([
  "coil",
  "motor",
  "source",
  "load",
  "contact",
  "supply",
  "input",
  "output",
  "signal",
  "probe",
  "power",
  "bond",
  "ground",
  "common",
  "return",
]);
export function functionKeys(g, ir) {
  const keys = new Set(
    ir.functions.map((f) => f.id.functionKey).filter((k) => !facts.has(k)),
  );
  // Aggregate IDs also belong to the engine's internal vocabulary.
  for (const k of ["three-phase-source", "dc_output", "pnp-sensor"])
    keys.add(k);
  return g.texts
    .filter(
      (t) =>
        !t.row &&
        !t.role?.includes("label-terminal") &&
        !ir.terminals?.some(
          (p) => p.id.deviceUid === t.deviceUid && p.id.terminalKey === t.text,
        ) &&
        !(
          !/label-(function|aggregate)/.test(t.role ?? "") &&
          ir.devices
            .find((d) => d.uid === t.deviceUid)
            ?.description?.includes(t.text)
        ) &&
        [...keys].some((k) => t.text === k || t.text.startsWith(k + " ")),
    )
    .map((t) =>
      issue("printed-function-key", t, {
        text: t.text,
        key: [...keys].find((k) => t.text === k || t.text.startsWith(k + " ")),
      }),
    );
}
export function deviceTags(g, ir, references, schematic) {
  if (!schematic) return [];
  const text = g.texts
      .map((t) => t.text)
      .join(" ")
      .replace(/\s+/g, " "),
    out = [];
  for (const uid of [...new Set(references.map((r) => r.deviceUid))]) {
    const d = ir.devices.find((d) => d.uid === uid);
    if (!d) throw Error(`Unknown drawing device ${uid}`);
    const missing = [];
    const type = ir.deviceTypes?.find((t) => t.id === d.typeId),
      part = type?.catalog?.orderNumber,
      description = d.description ?? type?.description;
    if (part && !text.includes(part)) missing.push(`authored part ${part}`);
    if (
      !g.texts.some(
        (t) =>
          t.text === d.designation || t.text.startsWith(d.designation + " "),
      )
    )
      missing.push("designation");
    if (description && !text.includes(description.replace(/\s+/g, " ")))
      missing.push("authored description");
    for (const field of ["partNumber", "rating"])
      if (typeof d[field] === "string" && !text.includes(d[field]))
        missing.push(field);
    if (missing.length) {
      const ref = references.find((r) => r.deviceUid === uid);
      out.push(
        issue(
          "missing-device-tag-fields",
          {
            deviceUid: uid,
            designation: d.designation,
            bbox: g.devices.find((x) => x.deviceUid === uid)?.bbox,
          },
          { missing, description: d.description ?? null },
        ),
      );
    }
  }
  return out;
}
export function phaseOrder(g, flow) {
  const out = [],
    axis = flow === "top-to-bottom" ? "x" : "y";
  for (const uid of new Set(g.terminals.map((t) => t.deviceUid)))
    for (const sequence of [
      ["L1", "L2", "L3", "PE"],
      ["U", "V", "W", "PE"],
      ["1/L1", "3/L2", "5/L3"],
      ["2/T1", "4/T2", "6/T3"],
    ]) {
      const ports = sequence.map((key) =>
        g.terminals.find((t) => t.deviceUid === uid && t.terminal === key),
      );
      if (!ports.slice(0, 3).every(Boolean)) continue;
      const ps = ports.filter(Boolean);
      if (ps.some((p, i) => i && p.point[axis] <= ps[i - 1].point[axis] + 0.05))
        out.push(
          issue("reversed-phase-order", ps[0], {
            axis,
            sequence: ps.map((p) => p.terminal),
            positions: ps.map((p) => p.point[axis]),
          }),
        );
    }
  for (const t of g.texts)
    if (["~", "=", "⎓", "3~"].includes(t.text) && Math.abs(t.angle) > 0.5)
      out.push(issue("rotated-qualifier", t, { text: t.text, angle: t.angle }));
  return out;
}
export function strokesAndDots(g) {
  const out = [],
    conductors = g.shapes.filter((s) => s.conductor && s.stroke > 0),
    outlines = g.shapes.filter((s) => s.outline && s.stroke > 0);
  if (conductors.length && outlines.length) {
    const min = Math.min(...conductors.map((s) => s.stroke));
    for (const s of outlines)
      if (s.stroke > min + 0.01)
        out.push(
          issue("outline-heavier-than-conductor", s, {
            outlineMm: s.stroke,
            conductorMm: min,
          }),
        );
  }
  const segments = conductors.flatMap((s) => {
    const points = routePoints(s) ?? [];
    return points.slice(1).map((p, i) => [points[i], p]);
  });
  for (const s of g.shapes.filter(
    (s) => s.cls.includes("junction-dot") || (s.terminal && dark(s.fill)),
  )) {
    const p = center(s.bbox),
      rays = new Set();
    for (const [a, b] of segments)
      if (distance(p, a, b) < 0.3)
        for (const q of [a, b])
          if (Math.hypot(q.x - p.x, q.y - p.y) > 0.1)
            rays.add(
              (Math.round(
                (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI / 10,
              ) *
                10 +
                360) %
                360,
            );
    if (rays.size < 3)
      out.push(
        issue("filled-dot-without-three-way-junction", s, {
          incidentRays: rays.size,
        }),
      );
  }
  return out;
}
export function terminalText(g) {
  const ts = g.texts.filter(
      (t) => t.role.includes("label-terminal") || t.terminal,
    ),
    out = [];
  for (let i = 0; i < ts.length; i++) {
    const a = ts[i];
    if (/^(\S+)\s+\1$/.test(a.text))
      out.push(issue("duplicate-terminal-caption", a, { text: a.text }));
    for (let j = i + 1; j < ts.length; j++) {
      const b = ts[j];
      if (
        overlap(a.bbox, b.bbox) ||
        (a.deviceUid === b.deviceUid &&
          a.terminal === b.terminal &&
          a.text === b.text &&
          Math.hypot(a.bbox.x - b.bbox.x, a.bbox.y - b.bbox.y) < 15)
      )
        out.push(
          issue("duplicate-or-overlapping-terminal-text", a, {
            text: a.text,
            otherText: b.text,
            otherElement: b.element,
            otherBbox: b.bbox,
          }),
        );
    }
    for (const t of g.terminals)
      if (overlap(a.bbox, t.bbox, 0.15))
        out.push(
          issue("terminal-text-over-marker", a, {
            text: a.text,
            terminal: t.terminal,
            markerBbox: t.bbox,
          }),
        );
  }
  return out;
}
export function titleFields(g) {
  const title = g.texts
    .filter((t) => t.bbox.y > g.height * 0.7)
    .map((t) => t.text)
    .join(" ");
  const fields = {
    drawingNumber: /drawing\s*(no\.?|number)|dwg\s*no/i,
    drawn: /drawn/i,
    checked: /checked/i,
    approved: /approved/i,
    customerOrSite: /customer|site|company/i,
    revision: /\bREV\b(?!\s+UNSPECIFIED)/,
    revisionHistory: /revision\s+(history|table)|rev\s+date/i,
  };
  const missing = Object.keys(fields).filter((k) => !fields[k].test(title));
  return missing.length
    ? [issue("incomplete-title-block", {}, { missing })]
    : [];
}
export function packetStyle(geometries) {
  const fonts = [
      ...new Set(geometries.flatMap((g) => g.texts.map((t) => t.font))),
    ].sort(),
    catalogs = [...new Set(geometries.flatMap((g) => g.catalogs))].sort();
  return fonts.length > 1 || catalogs.length > 1
    ? [issue("mixed-fonts-or-symbol-catalogs", {}, { fonts, catalogs })]
    : [];
}
export function fontMetrics(texts, pdf) {
  const out = [];
  const used = new Set();
  for (const t of texts) {
    const candidates = pdf
      .map((p, i) => ({ p, i }))
      .filter(
        ({ p, i }) =>
          !used.has(i) &&
          p.text.replace(/\s+/g, " ") === t.text.replace(/\s+/g, " "),
      )
      .sort(
        (a, b) =>
          Math.hypot(a.p.bbox.x - t.bbox.x, a.p.bbox.y - t.bbox.y) -
          Math.hypot(b.p.bbox.x - t.bbox.x, b.p.bbox.y - t.bbox.y),
      );
    const item = candidates[0];
    if (!item) continue;
    used.add(item.i);
    const advance = t.advance ?? t.bbox.w;
    const delta = Math.abs(item.p.bbox.w - advance);
    if (delta > Math.max(0.15, advance * 0.02))
      out.push(
        issue("pdf-svg-advance-difference", t, {
          text: t.text,
          svgWidthMm: advance,
          advanceRatio: item.p.bbox.w / advance,
          fontPair: `${t.font ?? "unknown"}/${item.p.fontFamily ?? "unknown"}`,
          columnIndex: t.columnIndex,
          role: t.role,
          pdfWidthMm: item.p.bbox.w,
          deltaMm: delta,
        }),
      );
  }
  return out;
}
export function zones(g, refs) {
  const top = g.texts.filter((t) => /^\d$/.test(t.text) && t.bbox.y < 30),
    bottom = g.texts.filter(
      (t) => /^\d$/.test(t.text) && t.bbox.y > g.height - 50,
    ),
    left = g.texts.filter((t) => /^[A-D]$/.test(t.text) && t.bbox.x < 20),
    right = g.texts.filter(
      (t) => /^[A-D]$/.test(t.text) && t.bbox.x > g.width - 20,
    );
  const sides = {
      top: top.length,
      bottom: bottom.length,
      left: left.length,
      right: right.length,
    },
    out = [];
  if (
    top.length < 6 ||
    bottom.length < 6 ||
    left.length < 4 ||
    right.length < 4
  )
    out.push(issue("incomplete-four-side-zones", {}, { sides }));
  for (const r of refs) {
    // A device may have several boundary/routing-table appearances with the
    // same UID. Their per-appearance anchors are not exported; never guess.
    if (refs.filter((x) => x.deviceUid === r.deviceUid).length !== 1) continue;
    const device = g.devices?.find((d) => d.deviceUid === r.deviceUid);
    const expected = device && zoneAt(g, center(device.bbox));
    const candidates = device ? zonesForBox(g, device.bbox) : [];
    if (expected && r.zone !== expected && !candidates.includes(r.zone))
      out.push(
        issue(
          "wrong-reference-zone",
          {
            designation: r.designation,
            element: r.deviceUid,
            bbox: device.bbox,
          },
          { printed: r.zone, expected, expectedZones: candidates },
        ),
      );
    else if (!/^[A-D][1-6]$/.test(r.zone))
      out.push(
        issue(
          "unresolved-reference-zone",
          { designation: r.designation },
          { zone: r.zone },
        ),
      );
  }
  return out;
}
export function continuations(sheet, packet, g, geometries = []) {
  const out = [],
    used = new Map();
  for (const c of sheet.continuations ?? []) {
    const target = packet.sheets.find((s) => s.number === c.toSheet),
      back = target?.continuations?.some(
        (r) =>
          r.id === c.id &&
          r.toSheet === sheet.number &&
          r.conductor === c.conductor &&
          r.netId === c.netId,
      );
    const occurrence = used.get(c.id) ?? 0;
    used.set(c.id, occurrence + 1);
    const printed = g.texts.filter((t) => t.text.startsWith(c.id + " /"))[
      occurrence
    ];
    const destination = printed?.text.match(/\/\s*(\d+)[. :/]([A-D][1-6])/);
    const missing = [];
    if (!back) missing.push("reciprocal peer");
    if (!destination || Number(destination[1]) !== c.toSheet)
      missing.push("printed sheet.zone");
    const targetGeometry = geometries[packet.sheets.indexOf(target)];
    const anchor = targetGeometry?.connectors?.filter(
      (p) => p.id === c.id && p.toSheet === sheet.number,
    )[occurrence]?.anchor;
    const expectedZone = anchor && zoneAt(targetGeometry, anchor);
    if (destination && expectedZone && destination[2] !== expectedZone)
      missing.push("printed destination zone");
    if (!printed?.text.includes(c.conductor))
      missing.push("conductor label on connector");
    if (missing.length)
      out.push(
        issue("incomplete-off-page-reference", printed ?? {}, {
          id: c.id,
          toSheet: c.toSheet,
          conductor: c.conductor,
          missing,
        }),
      );
  }
  return out;
}
export function routePoints(s) {
  if (!s.routePath) return s.points;
  const points = straightPath(s.routePath);
  if (!points) return null;
  const [a, b, c, d, e, f] = s.routeMatrix;
  return points.map((p) => ({
    x: a * p.x + c * p.y + e,
    y: b * p.x + d * p.y + f,
  }));
}
export function doubleLandings(g) {
  const out = [];
  for (const t of g.terminals) {
    const routes = g.shapes.filter(
      (s) =>
        s.conductor &&
        s.wire &&
        s.endpoints?.some(
          (p) => p.deviceUid === t.deviceUid && p.terminalKey === t.terminal,
        ),
    );
    const rays = new Map();
    for (const s of routes) {
      const ps = routePoints(s);
      if (!ps || ps.length < 2) continue;
      for (const [p, q] of [
        [ps[0], ps[1]],
        [ps.at(-1), ps.at(-2)],
      ])
        if (Math.hypot(p.x - t.point.x, p.y - t.point.y) < 0.2) {
          const length = Math.hypot(q.x - p.x, q.y - p.y);
          if (length > 0.5)
            rays.set(s.wire, {
              x: (q.x - p.x) / length,
              y: (q.y - p.y) / length,
              wire: s.wire,
              length,
            });
        }
    }
    const list = [...rays.values()];
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i],
          b = list[j];
        if (a.x * b.x + a.y * b.y > 0.9999)
          out.push(
            issue("merged-double-landing", t, {
              wires: [a.wire, b.wire].sort(),
              sharedLengthMm: Math.min(a.length, b.length),
            }),
          );
      }
  }
  return out;
}
export function routeQuality(g) {
  const out = [];
  for (const s of g.shapes.filter((s) => s.conductor && s.points.length > 1)) {
    // Collapse sampled straight segments; curve samples do not invent jogs.
    const source = routePoints(s);
    if (!source) continue;
    const frame = intersectBox(
      s.viewport ?? {
        x: 0,
        y: 0,
        w: g.width ?? Infinity,
        h: g.height ?? Infinity,
      },
      { x: 0, y: 0, w: g.width ?? Infinity, h: g.height ?? Infinity },
    );
    for (const raw of clipRoute(source, frame)) {
      const points = [];
      for (const p of raw) {
        while (
          points.length >= 2 &&
          distance(points.at(-1), points.at(-2), p) < 0.01
        )
          points.pop();
        points.push(p);
      }
      const lengths = points
        .slice(1)
        .map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
      const short = lengths
        .map((l, i) => ({ lengthMm: l, segment: i }))
        .filter(
          (x, i) =>
            i > 0 &&
            i < lengths.length - 1 &&
            x.lengthMm > 0.05 &&
            x.lengthMm < 3,
        );
      const start = points[0],
        end = points.at(-1),
        manhattan = Math.abs(end.x - start.x) + Math.abs(end.y - start.y),
        total = lengths.reduce((a, b) => a + b, 0);
      if (short.length)
        out.push(
          issue(
            "jog-under-3mm",
            { ...s, bbox: routeBox(points) },
            { segments: short },
          ),
        );
      if (total > 2 * manhattan + 20)
        out.push(
          issue(
            "route-detour",
            { ...s, bbox: routeBox(points) },
            { lengthMm: total, manhattanMm: manhattan, clippedToSheet: true },
          ),
        );
    }
  }
  return out;
}
export function utilisation(g) {
  const shapes = g.shapes.filter(
    (s) =>
      (s.conductor || s.symbol || s.mark) &&
      s.bbox.x >= 20 &&
      s.bbox.y >= 25 &&
      s.bbox.y + s.bbox.h < g.height - 35,
  );
  if (!shapes.length) return null;
  const x = Math.min(...shapes.map((s) => s.bbox.x)),
    y = Math.min(...shapes.map((s) => s.bbox.y)),
    right = Math.max(...shapes.map((s) => s.bbox.x + s.bbox.w)),
    bottom = Math.max(...shapes.map((s) => s.bbox.y + s.bbox.h));
  const bbox = { x, y, w: right - x, h: bottom - y },
    area = (g.width - 56) * (g.height - 80),
    fraction = (bbox.w * bbox.h) / area;
  return { bbox, fraction };
}
export function wirePlacement(g) {
  const routes = g.shapes.filter((s) => s.conductor && s.wire),
    out = [];
  for (const t of g.texts.filter((t) => t.wire)) {
    // The rule measures separation from ink, not a font/bbox centre. A label
    // above its wire can have its centre >2 mm away while the ink is adjacent.
    const box = t.bbox,
      corners = [
        { x: box.x, y: box.y },
        { x: box.x + box.w, y: box.y },
        { x: box.x, y: box.y + box.h },
        { x: box.x + box.w, y: box.y + box.h },
      ],
      toBox = (p) =>
        Math.hypot(
          Math.max(box.x - p.x, 0, p.x - box.x - box.w),
          Math.max(box.y - p.y, 0, p.y - box.y - box.h),
        ),
      dist = (s) =>
        s.points.slice(1).reduce((best, q, i) => {
          const p = s.points[i];
          if (throughBox(p, q, box, 0) || toBox(p) === 0 || toBox(q) === 0)
            return 0;
          return Math.min(
            best,
            toBox(p),
            toBox(q),
            ...corners.map((c) => distance(c, p, q)),
          );
        }, Infinity),
      own = routes.filter((s) => s.wire === t.wire),
      others = routes.filter((s) => s.wire !== t.wire);
    if (!own.length) continue;
    const block = t.wireBlock
      ? g.texts.filter((q) => q.wireBlock === t.wireBlock && q.wire === t.wire)
      : [t];
    const inline = block.some(
      (q) =>
        q.plate &&
        inside(t.bbox, q.plate.bbox) &&
        own.some((w) =>
          w.points
            .slice(1)
            .some((p, i) => throughBox(w.points[i], p, q.plate.bbox, 0)),
        ),
    );
    const inkDistance = (s) => Math.max(0, dist(s) - (s.stroke ?? 0) / 2);
    const d = inline ? 0 : Math.min(...own.map(inkDistance)),
      other = Math.min(...others.map(inkDistance));
    // Rooted-label offsets near 2.17 mm are threshold-sensitive: 2.147 passes,
    // 2.195 fails. These distance-only hits do not establish visual ambiguity.
    // See README; keep the calibrated uncertainty rather than moving the limit.
    if (d > 2 + INK_ACCURACY_MM || other + INK_ACCURACY_MM < d)
      out.push(
        issue("ambiguous-wire-label", t, {
          ownDistanceMm: d,
          reason:
            other + INK_ACCURACY_MM < d
              ? "nearer-foreign-wire"
              : "own-wire-distance",
          nearestOtherMm: Number.isFinite(other) ? other : null,
          wire: t.wire,
          text: t.text,
        }),
      );
  }
  return out;
}
export function reports(g, sheet, packet, table) {
  const out = [];
  if (
    !g.reportRows.length &&
    !["index", "references"].includes(sheet.view?.kind)
  )
    return out;
  const cells = new Map();
  for (const t of g.texts.filter((t) => t.row)) {
    const key = JSON.stringify([t.row, t.cell ?? t.element]);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(t);
  }
  for (const fragments of cells.values()) {
    const text = fragments
      .map((t) => t.text)
      .join(" ")
      .trim();
    const literal = /^(None|Unspecified|null)$/i;
    const sourceCell = table?.rows.find((r) => r.key === fragments[0].row)
      ?.cells[fragments[0].columnIndex];
    // Query newlines are semantic field boundaries; SVG line wraps are not.
    // Retain null-location subfields beside real endpoints, while a sentence
    // such as "No assembly; mapping unspecified" is not a null field.
    const placeholders =
      sourceCell === undefined
        ? literal.test(text)
          ? [text]
          : []
        : sourceCell
            .split("\n")
            .map((s) => s.trim())
            .filter((s) => literal.test(s));
    for (const placeholder of placeholders)
      if (
        text
          .replace(/\s/g, "")
          .toLowerCase()
          .includes(placeholder.toLowerCase())
      )
        out.push(
          issue(
            "report-null-placeholder",
            fragments.find((t) => literal.test(t.text)) ?? fragments[0],
            { text, placeholder, columnIndex: fragments[0].columnIndex },
          ),
        );
  }
  if (
    sheet.view?.kind === "wires" &&
    !g.texts.some((t) => /from.*sheet|to.*sheet|sheet.zone/i.test(t.text))
  )
    out.push(
      issue(
        "wire-schedule-without-sheet-zones",
        {},
        { viewKind: sheet.view.kind },
      ),
    );
  return out;
}
export function reportInventory(table, packet, geometries) {
  const actual = packet.sheets.flatMap((s, i) =>
      s.view.kind === table.kind ? geometries[i].reportRows : [],
    ),
    expected = table.rows.map((r) => r.key);
  const counts = (items) => {
      const m = new Map();
      for (const id of items) m.set(id, (m.get(id) ?? 0) + 1);
      return m;
    },
    a = counts(actual),
    e = counts(expected);
  const differences = [...new Set([...a.keys(), ...e.keys()])]
    .sort()
    .filter((k) => a.get(k) !== e.get(k))
    .map((key) => ({
      key,
      expected: e.get(key) ?? 0,
      actual: a.get(key) ?? 0,
    }));
  return differences.length
    ? [
        issue(
          "report-row-inventory-mismatch",
          {
            element: "report-table",
            designation: table.kind,
            sheetLevel: true,
          },
          {
            expectedRows: expected.length,
            actualRows: actual.length,
            differences,
          },
        ),
      ]
    : [];
}
export function requireReportCells(g) {
  if (g.texts.some((t) => t.row && !t.cell))
    throw Error("Report text lacks an independently measured cell bbox");
}

// Zone boundaries are reconstructed from the printed grid anchors. No renderer
// xMm/yMm or zone estimate participates in this calculation.
export function zoneAt(g, p) {
  const top = g.texts
    .filter((t) => /^[1-6]$/.test(t.text) && t.anchor && t.bbox.y < 30)
    .sort((a, b) => +a.text - +b.text);
  const left = g.texts
    .filter((t) => /^[A-D]$/.test(t.text) && t.anchor && t.bbox.x < 20)
    .sort((a, b) => (a.text < b.text ? -1 : 1));
  if (top.length !== 6 || left.length !== 4) return null;
  const dx = (top[5].anchor.x - top[0].anchor.x) / 5,
    dy = (left[3].anchor.y - left[0].anchor.y) / 3;
  if (dx <= 0 || dy <= 0) return null;
  const col = Math.max(
    0,
    Math.min(5, Math.floor((p.x - top[0].anchor.x + dx / 2) / dx)),
  );
  const row = Math.max(
    0,
    Math.min(3, Math.floor((p.y - left[0].anchor.y + dy / 2) / dy)),
  );
  return "ABCD"[row] + (col + 1);
}
export function legibility(g) {
  const out = [];
  for (const t of g.texts.filter((t) => t.painted !== false)) {
    const minimumMm = t.secondaryReference ? 2.3 : 2.5;
    if (
      !t.furniture &&
      t.fontSize !== undefined &&
      t.fontSize < minimumMm - 0.03
    )
      out.push(
        issue("text-below-minimum-em", t, {
          text: t.text,
          fontSizeMm: t.fontSize,
          minimumMm,
          role: t.role,
          font: t.font,
        }),
      );
    // One symmetric physical glyph-scale rule for SVG, HTML and PDF.
    const scales = [
      t.advanceRatio,
      t.capReferenceEmMm > 0 && t.fontSize > 0
        ? t.capReferenceEmMm / t.fontSize
        : undefined,
    ].filter((s) => s !== undefined);
    if (scales.some((s) => !Number.isFinite(s) || s <= 0))
      throw Error(
        `Drawing measurement infrastructure: invalid glyph scale [${scales.map(String).join(", ")}] for ${t.element ?? "unknown element"}, text ${JSON.stringify(t.text ?? "")}, medium ${t.medium ?? "unknown"}; expected finite positive horizontal scales.`,
      );
    const anisotropy = Math.max(1, ...scales.map((s) => Math.max(s, 1 / s)));
    if (anisotropy > 1.1 + ANISOTROPY_EPSILON)
      out.push(
        issue("distorted-glyphs", t, {
          text: t.text,
          anisotropy,
          horizontalScales: scales,
          advanceRatio: t.advanceRatio,
          emAspectRatio:
            t.capReferenceEmMm > 0
              ? t.fontSize / t.capReferenceEmMm
              : undefined,
          naturalAdvanceMm: t.naturalAdvanceMm,
          measurements: ["anisotropy"],
          font: t.font,
          role: t.role,
        }),
      );
  }
  return out;
}
export function capPolicy(texts, medium = "svg") {
  const groups = new Map();
  for (const t of texts.filter(
    (t) =>
      t.painted !== false &&
      t.capHeightMm !== undefined &&
      t.capHeightMm < 2.5 - 0.03,
  )) {
    const key = t.font;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  return [...groups].map(([font, list]) =>
    issue("iso-cap-height-policy", list[0], {
      font,
      medium,
      boxKind: medium === "pdf" ? "PDF em" : "SVG ink",
      policy: true,
      policySheet: list[0].policySheet,
      policyGap: "ISO capital-height reading requires a renderer/user decision",
      instanceCount: list.length,
      capHeightRangeMm: [
        Math.min(...list.map((t) => t.capHeightMm)),
        Math.max(...list.map((t) => t.capHeightMm)),
      ],
      capHeightMm: list[0].capHeightMm,
      fontMeasured: list[0].fontMeasured,
    }),
  );
}
function lineCross(a, b, c, d) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    ex = d.x - c.x,
    ey = d.y - c.y,
    det = dx * ey - dy * ex;
  if (Math.abs(det) < 1e-8) return null;
  const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / det,
    u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / det;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
    ? { x: a.x + t * dx, y: a.y + t * dy }
    : null;
}
function throughBox(a, b, box, pad = 0.08) {
  const r = {
    x: box.x + pad,
    y: box.y + pad,
    w: box.w - 2 * pad,
    h: box.h - 2 * pad,
  };
  const within = (p) =>
    p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
  if (r.w <= 0 || r.h <= 0) return false;
  const p = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
  return (
    within(a) ||
    within(b) ||
    p.some((q, i) => lineCross(a, b, q, p[(i + 1) % 4]))
  );
}
export function conductorInterference(g) {
  const out = [];
  const bodies = g.shapes.filter(
    (s) =>
      !s.conductor &&
      !s.outline &&
      !s.terminal &&
      !s.cls?.includes("symbol-terminal") &&
      (s.dash === undefined || s.dash === "none") &&
      (s.symbol || s.mark),
  );
  for (const wire of g.shapes.filter((s) => s.conductor || s.lead)) {
    const ps = routePoints(wire);
    if (!ps) continue;
    // A route through foreign terminal markers can visually join independent
    // nets even when it misses the open contact's short interior strokes.
    const touched = wire.conductor
      ? g.terminals.filter(
          (t) =>
            t.bbox &&
            ps.some(
              (q, i) =>
                i &&
                distance(t.point, ps[i - 1], q) <=
                  Math.max(t.bbox.w, t.bbox.h) / 2,
            ) &&
            (!wire.viewport ||
              inside(
                { x: t.point.x, y: t.point.y, w: 0, h: 0 },
                wire.viewport,
                0,
              )),
        )
      : [];
    const touchedNets = [
      ...new Set(touched.map((t) => t.net).filter(Boolean)),
    ].sort();
    for (const t of touched) {
      const endpoint = [ps[0], ps.at(-1)].some(
        (p) => Math.hypot(p.x - t.point.x, p.y - t.point.y) < 0.6,
      );
      const own = wire.net && t.net === wire.net;
      if (!endpoint && !own && t.net && (wire.net || touchedNets.length > 1))
        out.push(
          issue("conductor-through-symbol", t, {
            terminal: t.terminal,
            conductor: wire.wire ?? wire.element,
            conductorElement: wire.element,
            crossedNetIds: touchedNets,
            foreignNet: t.net,
          }),
        );
    }
    for (const body of wire.conductor ? bodies : []) {
      const ports = g.terminals
        .filter((t) => t.deviceUid === body.deviceUid)
        .map((t) => t.point);
      const near = (p) =>
        ports.some((q) => {
          const touchesEndpoint = [ps[0], ps.at(-1)].some(
            (end) => Math.hypot(end.x - q.x, end.y - q.y) < 0.12,
          );
          const owned = g.terminals.some(
            (t) =>
              t.deviceUid === body.deviceUid &&
              t.point === q &&
              wire.endpoints?.some(
                (e) =>
                  e.deviceUid === t.deviceUid && e.terminalKey === t.terminal,
              ),
          );
          return (
            (touchesEndpoint || owned) && Math.hypot(p.x - q.x, p.y - q.y) < 0.6
          );
        });
      let collision = false;
      for (let i = 1; i < ps.length && !collision; i++) {
        const a = ps[i - 1],
          b = ps[i];
        for (let j = 1; j < body.points.length; j++) {
          const p = lineCross(a, b, body.points[j - 1], body.points[j]);
          const painted = (p, s) =>
            !s.viewport ||
            (p.x >= s.viewport.x &&
              p.y >= s.viewport.y &&
              p.x <= s.viewport.x + s.viewport.w &&
              p.y <= s.viewport.y + s.viewport.h);
          if (p && painted(p, body) && painted(p, wire) && !near(p)) {
            collision = true;
            break;
          }
        }
        const closed =
          body.points.length > 3 &&
          Math.hypot(
            body.points[0].x - body.points.at(-1).x,
            body.points[0].y - body.points.at(-1).y,
          ) < 0.1;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (
          closed &&
          solidContains(body, mid) &&
          !near(mid) &&
          [body, wire].every(
            (s) =>
              !s.viewport ||
              inside({ x: mid.x, y: mid.y, w: 0, h: 0 }, s.viewport, 0),
          )
        )
          collision = true;
      }
      if (collision)
        out.push(
          issue("conductor-through-symbol", body, {
            conductor: wire.wire ?? wire.element,
            conductorElement: wire.element,
          }),
        );
    }
    const seenPlates = new Set();
    for (const t of g.texts.filter(
      (t) =>
        t.painted !== false && t.plate && !(t.wire && t.wire === wire.wire),
    )) {
      if (seenPlates.has(t.plate.element)) continue;
      seenPlates.add(t.plate.element);
      const plate = t.plate.bbox;
      const visible = intersectBox(
        plate,
        wire.viewport ?? { x: 0, y: 0, w: g.width, h: g.height },
      );
      if (
        visible.w > 0 &&
        visible.h > 0 &&
        ps.some((q, i) => i && throughBox(ps[i - 1], q, visible, 0.08))
      )
        out.push(
          issue(
            "plate-over-foreign-conductor",
            { ...t, bbox: plate },
            {
              text: t.text,
              plate: t.plate.element,
              conductor: wire.wire ?? wire.element,
              conductorElement: wire.element,
            },
          ),
        );
    }
    for (const t of g.texts.filter(
      (t) => t.painted !== false && !(t.wire && t.wire === wire.wire),
    )) {
      let ink = t.bbox;
      for (const clip of [wire.viewport, t.viewport])
        if (clip) {
          const x = Math.max(ink.x, clip.x),
            y = Math.max(ink.y, clip.y);
          ink = {
            x,
            y,
            w: Math.min(ink.x + ink.w, clip.x + clip.w) - x,
            h: Math.min(ink.y + ink.h, clip.y + clip.h) - y,
          };
        }
      if (
        ink.w > 0 &&
        ink.h > 0 &&
        ps.some(
          (b, i) =>
            i &&
            throughBox(
              ps[i - 1],
              b,
              {
                x: ink.x - wire.stroke / 2,
                y: ink.y - wire.stroke / 2,
                w: ink.w + wire.stroke,
                h: ink.h + wire.stroke,
              },
              0,
            ),
        )
      )
        out.push(
          issue("text-across-conductor", t, {
            text: t.text,
            conductor: wire.wire ?? wire.element,
            conductorElement: wire.element,
          }),
        );
    }
  }
  return out;
}

export function zonesForBox(g, b) {
  const lo = zoneAt(g, { x: b.x, y: b.y }),
    hi = zoneAt(g, { x: b.x + b.w, y: b.y + b.h });
  if (!lo || !hi) return [];
  const cells = [];
  for (let r = lo.charCodeAt(0); r <= hi.charCodeAt(0); r++)
    for (let c = +lo[1]; c <= +hi[1]; c++)
      cells.push(String.fromCharCode(r) + c);
  return cells;
}
export function printedReferenceZones(packet, geometries) {
  const out = [];
  for (const [i, sheet] of packet.sheets.entries()) {
    if (sheet.view.kind !== "references") continue;
    for (const t of geometries[i].texts.filter(
      (t) => t.row && t.columnIndex === 2,
    )) {
      let key;
      try {
        key = JSON.parse(t.row);
      } catch {
        continue;
      }
      const uid = Array.isArray(key) ? key[0] : key;
      for (const match of t.text.matchAll(/(\d+)\s*[/.:]\s*([A-D][1-6])/g)) {
        const index = packet.sheets.findIndex((s) => s.number === +match[1]);
        if (index < 0) continue;
        const target = geometries[index],
          refs = packet.sheets[index].references.filter(
            (r) => r.deviceUid === uid,
          );
        if (refs.length !== 1) continue;
        const body = target.devices.find((d) => d.deviceUid === uid);
        if (!body) continue;
        const expected = zoneAt(target, center(body.bbox)),
          allowed = zonesForBox(target, body.bbox);
        if (expected && !allowed.includes(match[2]))
          out.push({
            sheet: sheet.number,
            finding: issue("wrong-printed-reference-zone", t, {
              text: t.text,
              targetSheet: +match[1],
              printed: match[2],
              expected,
              expectedZones: allowed,
              targetBbox: body.bbox,
            }),
          });
      }
    }
  }
  return out;
}

export function intersectBox(a, b) {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x),
    h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y),
  };
}
export function plateOcclusion(g) {
  const out = [],
    seen = new Set();
  for (const owner of g.texts.filter((t) => t.painted !== false && t.plate)) {
    const p = owner.plate;
    if (seen.has(p.element)) continue;
    seen.add(p.element);
    for (const other of g.texts.filter(
      (t) =>
        t.painted !== false &&
        t.element !== owner.element &&
        t.plate?.element !== p.element,
    ))
      if (
        p.order > (other.order ?? Infinity) &&
        overlap(p.bbox, other.bbox, 0.12)
      )
        out.push(
          issue("plate-hides-text", owner, {
            text: owner.text,
            plate: p.element,
            otherText: other.text,
            otherElement: other.element,
            otherBbox: other.bbox,
          }),
        );
  }
  return out;
}

function routeBox(points) {
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y));
  return {
    x,
    y,
    w: Math.max(...points.map((p) => p.x)) - x,
    h: Math.max(...points.map((p) => p.y)) - y,
  };
}
export function clipRoute(points, box) {
  const pieces = [];
  let piece = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dx = b.x - a.x,
      dy = b.y - a.y;
    let lo = 0,
      hi = 1,
      valid = true;
    for (const [p, q] of [
      [-dx, a.x - box.x],
      [dx, box.x + box.w - a.x],
      [-dy, a.y - box.y],
      [dy, box.y + box.h - a.y],
    ]) {
      if (Math.abs(p) < 1e-12) {
        if (q < 0) valid = false;
      } else {
        const r = q / p;
        if (p < 0) lo = Math.max(lo, r);
        else hi = Math.min(hi, r);
      }
    }
    if (!valid || lo > hi) {
      if (piece.length > 1) pieces.push(piece);
      piece = [];
      continue;
    }
    const c = { x: a.x + lo * dx, y: a.y + lo * dy },
      d = { x: a.x + hi * dx, y: a.y + hi * dy };
    if (
      !piece.length ||
      Math.hypot(piece.at(-1).x - c.x, piece.at(-1).y - c.y) > 0.001
    ) {
      if (piece.length > 1) pieces.push(piece);
      piece = [c];
    }
    piece.push(d);
  }
  if (piece.length > 1) pieces.push(piece);
  return pieces;
}

export function pdfGeometryTexts(svg, pdf) {
  const used = new Set();
  return pdf.flatMap((p) => {
    const candidates = svg
      .filter(
        (t) =>
          t.painted !== false &&
          !used.has(t.element) &&
          t.text.replace(/\s+/g, " ") === p.text.replace(/\s+/g, " ") &&
          Math.hypot(t.bbox.x - p.bbox.x, t.bbox.y - p.bbox.y) <=
            2 * Math.max(t.fontSize ?? 2.5, p.fontSize ?? 2.5),
      )
      .sort(
        (a, b) =>
          Math.hypot(a.bbox.x - p.bbox.x, a.bbox.y - p.bbox.y) -
          Math.hypot(b.bbox.x - p.bbox.x, b.bbox.y - p.bbox.y),
      );
    const t = candidates[0];
    if (!t) return [];
    used.add(t.element);
    return [
      {
        ...t,
        ...p,
        element: t.element,
        role: t.role,
        furniture: t.furniture,
        secondaryReference: t.secondaryReference,
        medium: "pdf",
        boxKind: "PDF em",
        emBbox: p.bbox,
        advanceRatio: undefined,
      },
    ];
  });
}
