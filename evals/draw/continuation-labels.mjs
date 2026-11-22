// Source-derived printed identities. Association fields select an IR element;
// they never supply the expected printed text or the destination zone.
export function printedConductor(c, ir = {}) {
  const candidates = [
    ...(ir.wires ?? []).map((w) => ({
      kind: "wire",
      uid: w.uid,
      text: w.properties?.label ?? w.designation,
      names: [w.uid, w.designation, w.properties?.label],
    })),
    ...(ir.jumpers ?? []).map((j) => ({
      kind: "jumper",
      uid: j.uid,
      text: j.designation ?? "JUMPER",
      undesignated: !j.designation,
      names: [j.uid, j.designation, "jumper:" + j.uid],
    })),
    ...(ir.cableConductors ?? []).map((core) => {
      const cable = ir.cables?.find((b) => b.uid === core.id.cableUid);
      const text =
        cable?.designation && cable.designation + "." + core.id.conductorId;
      return {
        kind: "core",
        cableUid: core.id.cableUid,
        conductorId: core.id.conductorId,
        text,
        names: [text],
      };
    }),
  ];
  const selected = candidates.filter((x) =>
    c.sourceElement
      ? x.kind === c.sourceElement.kind &&
        (x.kind === "core"
          ? x.cableUid === c.sourceElement.cableUid &&
            x.conductorId === c.sourceElement.conductorId
          : x.uid === c.sourceElement.uid)
      : x.names.some((n) => n && n === c.conductor),
  );
  if (selected.length !== 1) return null;
  const x = selected[0];
  if (x.undesignated)
    return typeof x.uid === "string" && x.uid.length ? x : null;
  return typeof x.text === "string" && x.text.length ? x : null;
}
// Semantic rows combine adjacent font runs; the individual runs remain intact
// for size/ink checks. Baselines use the existing geometry uncertainty.
export function labelRows(texts) {
  // Per-glyph baseline runs defeat positioned tspans hidden inside one text node.
  texts = texts.flatMap((t) =>
    t.medium !== "pdf" && t.continuationRuns?.length
      ? t.continuationRuns.map((run) => ({
          ...t,
          ...run,
          renderedString: run.text,
          // Preserve actual ink for an intact row; glyph extents are em boxes.
          bbox: t.continuationRuns.length === 1 ? t.bbox : run.bbox,
          emBbox: run.bbox,
        }))
      : [t],
  );
  const rows = [];
  const order = new Map();
  for (const t of texts)
    if (!order.has(t.continuationLink))
      order.set(t.continuationLink, order.size);
  const baseline = (t) => t.anchor?.y ?? (t.emBbox ?? t.bbox).y;
  const ordered = texts
    .slice()
    .sort(
      (a, b) =>
        order.get(a.continuationLink) - order.get(b.continuationLink) ||
        baseline(a) - baseline(b),
    );
  for (const t of ordered) {
    const y = t.anchor?.y ?? (t.emBbox ?? t.bbox).y,
      last = rows.at(-1);
    if (
      last &&
      last.continuationLink === t.continuationLink &&
      Math.abs(last.rowY - y) <= 0.17
    ) {
      last.text += t.text;
      if (t.continuationError) last.continuationError = t.continuationError;
      last.renderedString += t.renderedString ?? t.text;
      for (const key of ["bbox", "emBbox"]) {
        const a = last[key],
          b = t[key] ?? t.bbox,
          x = Math.min(a.x, b.x),
          yy = Math.min(a.y, b.y);
        last[key] = {
          x,
          y: yy,
          w: Math.max(a.x + a.w, b.x + b.w) - x,
          h: Math.max(a.y + a.h, b.y + b.h) - yy,
        };
      }
      last.fontSize = Math.max(last.fontSize ?? 0, t.fontSize ?? 0);
    } else
      rows.push({
        ...t,
        bbox: { ...t.bbox },
        emBbox: { ...(t.emBbox ?? t.bbox) },
        renderedString: t.renderedString ?? t.text,
        rowY: y,
      });
  }
  return rows;
}
export function requirePdfFont(p) {
  if (!Number.isFinite(p.fontSize) || p.fontSize <= 0)
    throw Error(
      "Continuation PDF measurement: missing or invalid actual font size for " +
        JSON.stringify(p.text),
    );
}
export function connectorRows(g, c, occurrence) {
  const source = g.connectors?.filter(
    (p) => p.id === c.id && p.toSheet === c.toSheet,
  )[occurrence];
  // Only measured connector links own rows; matching nearby text is not proof.
  const rows = source?.element
    ? g.texts.filter(
        (t) => t.painted !== false && t.continuationLink === source.element,
      )
    : [];
  return { source, rows: labelRows(rows) };
}
// Reference position is free, but exactly one owned row may name this ID.
export function referenceRow(rows, id) {
  const refs = rows.filter(
    (t) => (t.renderedString ?? t.text).match(/^([^\s/]+)\s*\//)?.[1] === id,
  );
  return refs.length === 1 ? refs[0] : undefined;
}
export function referenceHeader(row, id) {
  const m = (row?.renderedString ?? row?.text ?? "").match(
    /^([^\s/]+)\s*\/\s*(\d+)(?:[. :/]([A-D][1-6]))?(?:\s*\/\s*(.*))?$/,
  );
  return m?.[1] === id
    ? { page: Number(m[2]), zone: m[3], body: m[4] ?? "" }
    : undefined;
}
export function identityMatches(rows, c, expected) {
  if (!expected || !rows.length) return false;
  const reference = referenceRow(rows, c.id);
  if (!reference) return false;
  const header = referenceHeader(reference, c.id);
  if (!header) return false;
  const parts = rows
    .map((t) => (t === reference ? header.body : (t.renderedString ?? t.text)))
    .filter((t) => t.length);
  const body = parts.join("");
  return body === expected.text;
}
// Associate PDF fragments by physical row geometry, independently of their
// content. Text and every fragment's actual font size remain PDF measurements.
export function continuationPdfRows(rows, pdf) {
  rows = labelRows(rows);
  const assigned = new Map(rows.map((t) => [t, []]));
  const regions = new Map();
  for (const t of rows) {
    const b = t.emBbox ?? t.bbox,
      previous = regions.get(t.continuationLink);
    const x = Math.min(b.x, previous?.x ?? b.x),
      y = Math.min(b.y, previous?.y ?? b.y);
    regions.set(t.continuationLink, {
      x,
      y,
      w:
        Math.max(b.x + b.w, previous ? previous.x + previous.w : -Infinity) - x,
      h:
        Math.max(b.y + b.h, previous ? previous.y + previous.h : -Infinity) - y,
    });
  }
  for (const p of pdf) {
    const candidates = rows
      .map((t) => {
        const b = t.emBbox ?? t.bbox;
        const dy = Math.abs(p.bbox.y + p.bbox.h / 2 - (b.y + b.h / 2));
        const dx = Math.max(0, b.x - p.bbox.x, p.bbox.x - (b.x + b.w));
        return { t, dy, dx };
      })
      .filter((x) => x.dy < Math.max(0.8, x.t.fontSize * 0.65) && x.dx < 0.5)
      .sort((a, b) => a.dy - b.dy || a.dx - b.dx);
    if (candidates.length) {
      requirePdfFont(p);
      assigned.get(candidates[0].t).push(p);
    } else if (
      // The existing 0.17 mm geometry uncertainty pads only the owned text
      // envelope, never the connector stroke or its potentially long hit target.
      [...regions.values()].some(
        (b) =>
          p.bbox.x >= b.x - 0.17 &&
          p.bbox.x <= b.x + b.w + 0.17 &&
          p.bbox.y + p.bbox.h / 2 >= b.y - 0.17 &&
          p.bbox.y + p.bbox.h / 2 <= b.y + b.h + 0.17,
      )
    )
      throw Error(
        "Continuation PDF measurement: unassociated extra row " +
          JSON.stringify(p.text),
      );
  }
  return rows.flatMap((t) => {
    const runs = assigned.get(t).sort((a, b) => a.bbox.x - b.bbox.x);
    if (!runs.length)
      throw Error(
        "Continuation PDF measurement: missing or unassociated row " +
          t.element +
          " " +
          JSON.stringify(t.text),
      );
    return runs.map((p) => ({
      ...t,
      ...p,
      element: t.element,
      fontSize: p.fontSize,
      renderedString: p.renderedString ?? p.text,
      continuationLink: t.continuationLink,
      continuationRow: t.element,
      role: t.role,
      furniture: false,
      secondaryReference: false,
      medium: "pdf",
      boxKind: "PDF em",
      emBbox: p.bbox,
      advanceRatio: undefined,
    }));
  });
}
export function continuationMediaIssues(svg, measured, medium) {
  const links = [
    ...new Set(
      svg
        .filter((t) => t.continuationLink && t.painted !== false)
        .map((t) => t.continuationLink),
    ),
  ];
  return links.flatMap((link) => {
    const source = svg.filter(
      (t) => t.continuationLink === link && t.painted !== false,
    );
    // DOM ordinals are local to each medium. The stroke anchor and real href
    // identify the occurrence; the measured characters still supply its text.
    const anchor = source[0].continuationAnchor;
    const groups = new Map();
    for (const t of measured.filter(
      (t) => t.continuationLink && t.painted !== false,
    )) {
      if (!groups.has(t.continuationLink)) groups.set(t.continuationLink, []);
      groups.get(t.continuationLink).push(t);
    }
    const candidates = [...groups.values()].filter((xs) =>
      anchor
        ? xs[0].continuationAnchor &&
          xs[0].continuationDestination === source[0].continuationDestination &&
          Math.hypot(
            xs[0].continuationAnchor.x - anchor.x,
            xs[0].continuationAnchor.y - anchor.y,
          ) <= 0.17
        : xs[0].continuationLink === link,
    );
    const actual = candidates.length === 1 ? candidates[0] : [];
    const refusal = [...source, ...actual].find((t) => t.continuationError);
    if (refusal)
      return [
        {
          kind: "continuation-measurement-refused",
          medium,
          element: refusal.element,
          bbox: refusal.bbox,
          reason: refusal.continuationError,
        },
      ];
    const rowText = (xs) =>
      labelRows(xs).map((t) =>
        (t.renderedString ?? t.text).replace(
          /^(\S+)\s*\/\s*(\d+)(?:[. :/]([A-D][1-6]))?/,
          (_, id, page, zone) => id + "/" + page + (zone ? "." + zone : ""),
        ),
      );
    const a = rowText(source),
      b = rowText(actual);
    return a.length === b.length && a.every((s, i) => s === b[i])
      ? []
      : [
          {
            kind: "continuation-medium-row-mismatch",
            medium,
            element: source[0].element,
            designation: source[0].text,
            bbox: source[0].bbox,
            expectedRows: a,
            actualRows: b,
          },
        ];
  });
}
