import { measurementHelpers } from "../measurement-helpers.mjs";
import { boxGap as measuredBoxGap } from "../peer-owner-ink.mjs";

const boxGap = measuredBoxGap;

const terminalKey = ({ deviceUid, terminalKey }) =>
  JSON.stringify([deviceUid, terminalKey]);

const conductorKey = ({ uid, cableUid, conductorId }) =>
  cableUid ? JSON.stringify([cableUid, conductorId]) : uid;

function glyphBounds(c, element) {
  const visible = c.visible(element);
  if (!visible || !element.getNumberOfChars()) return;
  const paint = c.fillPaint(element);
  if (paint.alpha < 0.2 || paint.background) return;
  const style = getComputedStyle(element);
  const canvas = c.glyphCanvas;
  // Measure bigger than the SVG user-unit font size to avoid canvas pixel
  // quantization. Map the ink back to the authored glyph advance and baseline.
  const magnification = 32;
  const fontSize = parseFloat(style.fontSize) * magnification;
  canvas.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
  const text = element.textContent.trim().replace(/\s+/gu, " ");
  const ink = canvas.measureText(text);
  const scale = element.getComputedTextLength() / ink.width;
  const start = element.getStartPositionOfChar(0);
  const bounds = c.bounds(element, {
    x: start.x - ink.actualBoundingBoxLeft * scale,
    y: start.y - ink.actualBoundingBoxAscent / magnification,
    width: (ink.actualBoundingBoxLeft + ink.actualBoundingBoxRight) * scale,
    height:
      (ink.actualBoundingBoxAscent + ink.actualBoundingBoxDescent) /
      magnification,
  });
  return c.intersect(bounds, visible.clip);
}

function union(boxes) {
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  return { x, y, w: right - x, h: bottom - y };
}

function strokeBounds(c, element) {
  const visible = c.visible(element);
  if (!visible) return;
  const matrix = element.getScreenCTM();
  const width = parseFloat(getComputedStyle(element).strokeWidth);
  const radius =
    (width / 2) *
    Math.max(
      Math.hypot(matrix.a * c.sx, matrix.b * c.sy),
      Math.hypot(matrix.c * c.sx, matrix.d * c.sy),
    );
  const widen = (box) =>
    c.intersect(
      {
        x: box.x - radius,
        y: box.y - radius,
        w: box.w + 2 * radius,
        h: box.h + 2 * radius,
      },
      visible.clip,
    );
  let ink;
  return {
    bounds: widen(visible.b),
    boxes: () =>
      (ink ??= c.strokeInk(element, visible.clip, matrix, true).map(([a, b]) =>
        widen({
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          w: Math.abs(a.x - b.x),
          h: Math.abs(a.y - b.y),
        }),
      )),
  };
}

function paintedMark(c, element) {
  const measured = element && strokeBounds(c, element);
  if (measured)
    return {
      bounds: measured.bounds,
      boxes: () => (measured.boxes().length ? [measured.bounds] : []),
    };
}

function routeKey(c, element) {
  const cable = c.attr(element, "data-cable-uid");
  const core = c.attr(element, "data-conductor-id");
  if (cable && core) return JSON.stringify([cable, core]);
  const wire =
    c.attr(element, "data-wire-uid") ??
    c.attr(element, "data-jumper-uid") ??
    c.attr(element, "data-circuit-conductor") ??
    c.attr(element, "data-wiring-conductor");
  return wire?.startsWith("{") ? conductorKey(JSON.parse(wire)) : wire;
}

function terminalAnchors(c) {
  const anchors = [];
  for (const element of c.root.querySelectorAll(
    "circle.terminal-marker,[data-terminal-id] > circle,circle[data-terminal-key]",
  )) {
    const raw = c.attr(element, "data-terminal-id");
    const position = raw && JSON.parse(raw);
    const terminal = Array.isArray(position)
      ? JSON.stringify(position)
      : terminalKey(
          position || {
            deviceUid: c.attr(element, "data-device-uid"),
            terminalKey: c.attr(element, "data-terminal-key"),
          },
        );
    const mark = paintedMark(c, element);
    if (mark) anchors.push({ ...mark, terminal, kind: "terminal" });
  }
  for (const element of c.root.querySelectorAll(
    "[data-off-view-terminal-id]",
  )) {
    const terminal = terminalKey(
      JSON.parse(element.getAttribute("data-off-view-terminal-id")),
    );
    const conductors = JSON.parse(
      element.getAttribute("data-off-view-conductors") ?? "[]",
    ).map(conductorKey);
    const mark = paintedMark(c, element.querySelector("rect.off-view-card"));
    if (mark) anchors.push({ ...mark, terminal, conductors, kind: "card" });
  }
  return anchors;
}

function routeAnchors(c, wires) {
  const runs = new Map();
  for (const element of c.root.querySelectorAll("path,line,polyline")) {
    const wire = routeKey(c, element);
    if (!wires.has(wire)) continue;
    const measured = strokeBounds(c, element);
    if (!measured) continue;
    if (!runs.has(wire)) runs.set(wire, []);
    runs.get(wire).push({ ...measured, wire, kind: "run" });
  }
  return runs;
}

function continuationAnchors(c, runs, continuations) {
  const claims = new Map(
    continuations
      .filter(({ provenance }) => provenance)
      .map(({ id, provenance }) => [id, conductorKey(provenance)]),
  );
  const anchors = [];
  for (const link of c.root.querySelectorAll("a[data-continuation-id]")) {
    const wire = claims.get(link.getAttribute("data-continuation-id"));
    const tip = link.querySelector("path,line");
    if (!tip || !runs.has(wire)) continue;
    const point = tip.getPointAtLength(0).matrixTransform(tip.getScreenCTM());
    const anchor = { ...c.point(point.x, point.y), w: 0, h: 0 };
    // The ID can locate the caption, but credit its text only when the
    // continuation is visibly attached to the same conductor's painted ink.
    const attached = () =>
      runs
        .get(wire)
        .some(
          (run) =>
            boxGap(anchor, run.bounds) <= 0.6 &&
            run.boxes().some((box) => boxGap(anchor, box) <= 0.6),
        );
    for (const text of link.querySelectorAll("text")) {
      const bounds = glyphBounds(c, text);
      if (bounds?.w > 0 && bounds.h > 0)
        anchors.push({
          bounds,
          boxes: () => (attached() ? [bounds] : []),
          wire,
          kind: "continuation",
        });
    }
  }
  return anchors;
}

function nearest(box, anchors, cutoff = Infinity) {
  let distance = cutoff;
  let kind;
  for (const anchor of anchors) {
    if (boxGap(box, anchor.bounds) >= distance) continue;
    for (const ink of anchor.boxes()) {
      const gap = boxGap(box, ink);
      if (gap < distance) {
        distance = gap;
        kind = anchor.kind;
      }
    }
  }
  return { distance: kind ? distance : Infinity, kind };
}

function measureNote(c, element, anchors, wires, names) {
  const source = JSON.parse(element.getAttribute("data-peer-source"));
  const [from, conductor, to] = source;
  const wire = conductorKey(conductor);
  const terminal = terminalKey(from);
  const endpoints = wires.get(wire);
  if (!endpoints?.includes(terminal) || !endpoints.includes(terminalKey(to)))
    throw Error("Unbound conductor peer: " + JSON.stringify(source));
  const lines = element.matches("text")
    ? [element]
    : [...element.querySelectorAll("text")];
  const glyphs = lines.map((line) => glyphBounds(c, line));
  if (!glyphs.length || !glyphs.every((box) => box?.w > 0 && box.h > 0))
    throw Error("Missing painted note: " + element.textContent);
  const text = lines.map((line) => line.textContent.trim()).join(" ");
  const sourceName = `${names.get(from.deviceUid)}.${from.terminalKey}`;
  const printedSource = text.split("→")[0].trim();
  const named =
    printedSource === sourceName || printedSource.endsWith(" · " + sourceName);
  const box = union(glyphs);
  const ownsTerminal = (a) =>
    a.terminal === terminal &&
    (a.kind === "terminal" || a.conductors?.includes(wire));
  const owner = nearest(
    box,
    anchors.filter((a) => ownsTerminal(a) || (named && a.wire === wire)),
  );
  const rival = named
    ? undefined
    : nearest(
        box,
        anchors.filter((a) => !ownsTerminal(a) && a.wire !== wire),
        owner.distance,
      );
  return { text, named, owner, rival };
}

function measureSheet(
  h,
  glyphCanvas,
  selector,
  { sheet, continuations },
  wires,
  names,
) {
  const c = { h, glyphCanvas, options: { selector } };
  h.prepareGeometry(c);
  h.paintCanvas(c);
  h.install(c, ["colour", "fillPaint"]);
  h.collectOccluders(c);
  h.install(c, ["contains", "strokeInk"]);
  const runs = routeAnchors(c, wires);
  const anchors = [
    ...terminalAnchors(c),
    ...[...runs.values()].flat(),
    ...continuationAnchors(c, runs, continuations),
  ];
  const notes = [
    ...c.root.querySelectorAll('[data-peer-reference="conductor-peer"]'),
  ];
  return {
    sheet,
    notes: notes.map((note) => measureNote(c, note, anchors, wires, names)),
  };
}

function measurePacket(h, sheets, native) {
  const embedded = [...document.fonts].some(
    (face) => /Thermite Sans/u.test(face.family) && face.status === "loaded",
  );
  if (!embedded) throw Error("Missing loaded embedded Thermite Sans");
  const glyphCanvas = document.createElement("canvas").getContext("2d");
  const wires = new Map(
    native.wires.map((row) => [
      conductorKey(row.element),
      row.ends.map((end) => end && terminalKey(end)),
    ]),
  );
  const names = new Map(native.devices);
  return sheets.map((sheet, index) =>
    measureSheet(
      h,
      glyphCanvas,
      `body > svg:nth-of-type(${index + 1})`,
      sheet,
      wires,
      names,
    ),
  );
}

// Browser-side checks share the draw evaluator's paint geometry. Only the
// printed ink and native identities are inputs, never candidates from placement.
const helpers = Object.fromEntries(
  Object.entries(measurementHelpers).map(([name, value]) => [
    name,
    typeof value === "function"
      ? "(" + value.toString() + ")"
      : JSON.stringify(value),
  ]),
);
const browserSource = `(sheets,native) => {
  const h = {${Object.entries(helpers)
    .map(([key, source]) => `${JSON.stringify(key)}:${source}`)
    .join(",")}};
  const terminalKey = ${terminalKey};
  const conductorKey = ${conductorKey};
  ${[
    boxGap,
    glyphBounds,
    union,
    strokeBounds,
    paintedMark,
    routeKey,
    terminalAnchors,
    routeAnchors,
    continuationAnchors,
    nearest,
    measureNote,
    measureSheet,
    measurePacket,
  ].join("\n")}
  return measurePacket(h, sheets, native);
}`;

export async function peerOwnerMeasurements(page, packet, native) {
  const selected = packet.sheets.filter((sheet) =>
    sheet.svg.includes('data-peer-reference="conductor-peer"'),
  );
  const font = packet.html.match(
    /<style data-thermite-font="[^"]+">[^<]*<\/style>/u,
  )?.[0];
  if (!selected.length || !font)
    throw Error("Expected issued peer notes and their embedded print font");
  const svg = selected
    .map((sheet) => sheet.svg.replace(/^<\?xml[^>]*>/u, ""))
    .join("");
  await page.setContent(
    `<html><head>${font}<style>html,body{margin:0}body>svg{display:block;max-width:none}</style></head><body>${svg}</body></html>`,
  );
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(
    ({ source, sheets, native }) => (0, eval)(source)(sheets, native),
    {
      source: browserSource,
      sheets: selected.map(({ number, continuations }) => ({
        sheet: number,
        continuations,
      })),
      native,
    },
  );
}
