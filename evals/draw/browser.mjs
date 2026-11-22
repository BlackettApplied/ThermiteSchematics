import { measurementHelpers } from "./measurement-helpers.mjs";
import { IdentifierMeasurementError } from "./identifier-errors.mjs";
// Shared print-capture environment: no page scripts, service workers or network.
export const drawingContextOptions = Object.freeze({
  deviceScaleFactor: 300 / 96,
  viewport: { width: 1800, height: 1800 },
  offline: true,
  serviceWorkers: "block",
  javaScriptEnabled: false,
});
import { classifyTextGeometry } from "./text-classification.mjs";
import { browserPath } from "./chromium-path.mjs";
export { browserPath };
import {
  measureRelationDeclarations,
  attachRelationDeclarations,
  measureUnkeyedRelations,
  measureMarkerIdentityClaims,
} from "./relation-landing-browser.mjs";
import { chromium } from "playwright-core";
// Preserve the calibrated path: software rasterization broke a retained binding.
// The repeat-capture check supplies explicit candidate arguments for experiments.
export const drawingLaunchArgs = Object.freeze([]);
export async function launch(args = drawingLaunchArgs) {
  return chromium.launch({
    executablePath: await browserPath(),
    headless: true,
    args,
  });
}
// Executed inside Chromium. All positions are transformed to outer-sheet mm.
// Neither text advances nor layout estimates are read from the engine.
export function measureSheet(options = {}, h) {
  const c = { options, h };
  h.prepareGeometry(c);
  if (options.routesOnly) return h.routeGeometry(c);
  h.prepareTerminals(c);
  h.prepareText(c);
  h.preparePaint(c);
  const {
    attr,
    hasRepeatLabels,
    identity,
    landingOwners,
    ownedLandings,
    ownerKey,
    paintedShapeBounds,
    point,
    root,
    rr,
    shapeClips,
    strokeInk,
    sx,
    sy,
    utilisationErrors,
    visible,
  } = c;
  const shapes = Array.from(
    options.textOnly
      ? []
      : root.querySelectorAll("path,line,polyline,polygon,rect,circle,ellipse"),
  ).flatMap((e) => {
    const v = visible(e);
    if (!v) return [];
    const css = getComputedStyle(e),
      m = e.getScreenCTM(),
      stroke =
        parseFloat(css.strokeWidth) *
        Math.max(
          Math.hypot(m.a * sx, m.b * sy),
          Math.hypot(m.c * sx, m.d * sy),
        );
    const id = identity(e),
      symbol = attr(e, "data-symbol-id"),
      mark = attr(e, "data-circuit-mark"),
      functionInterface = attr(e, "data-function-interface"),
      cls = e.getAttribute("class") ?? "";
    const conductor =
      e.matches("path,line,polyline") &&
      !["none", "white", "rgb(255, 255, 255)", "rgba(0, 0, 0, 0)"].includes(
        css.stroke,
      ) &&
      (cls.includes("net-path") ||
        !!e.closest(
          "[data-circuit-conductor],[data-wiring-conductor],[data-wire-uid]",
        ));
    const lead =
      e.tagName.toLowerCase() === "line" &&
      !!e.closest("[data-function-interface]") &&
      !["none", "white", "rgb(255, 255, 255)"].includes(css.stroke);
    const outline =
      cls.includes("device-frame") ||
      !!e.closest("[data-source-enclosure]") ||
      (e.tagName.toLowerCase() === "rect" &&
        e.parentElement.hasAttribute("data-device-uid") &&
        !e.parentElement.hasAttribute("data-symbol-id") &&
        !conductor);
    const candidate = {
      e,
      id,
      conductor,
      lead,
      outline,
      symbol,
      mark,
      cls,
      hasRepeatLabels,
    };
    const included = h.sheetShapeCandidate(candidate);
    if (!included && !functionInterface) return [];
    let points = [];
    if (typeof e.getTotalLength === "function") {
      const length = e.getTotalLength(),
        count = Math.min(
          4000,
          Math.max(
            1,
            Math.ceil((length * Math.hypot(m.a * sx, m.b * sy)) / 0.2),
          ),
        );
      points = Array.from({ length: count + 1 }, (_, i) => {
        const q = e.getPointAtLength((length * i) / count),
          p = new DOMPoint(q.x, q.y).matrixTransform(m);
        return point(p.x, p.y);
      });
    }
    let utilisationGeometry = {};
    if (conductor || symbol || mark || id.loopConductor || id.loopCandidate) {
      try {
        const clips = shapeClips(e);
        utilisationGeometry = {
          clips,
          paintedBbox: paintedShapeBounds(
            e,
            v.b,
            v.clip,
            clips,
            points,
            css,
            m,
          ),
        };
      } catch (error) {
        if (!error.message.startsWith("DQ-12 ")) throw error;
        utilisationErrors.push({ element: id.element, reason: error.message });
      }
    }
    const endpoints = conductor
      ? (() => {
          const raw = attr(e, "data-endpoints");
          if (raw) return JSON.parse(raw);
          return ["source", "target"].map((end) => ({
            deviceUid: attr(e, `data-${end}-device-uid`),
            terminalKey: attr(e, `data-${end}-terminal-key`),
          }));
        })()
      : undefined;
    let edgeOwnerKey;
    try {
      const raw = attr(e, "data-edge-key");
      edgeOwnerKey = raw
        ? ownerKey(raw, "edge")
        : id.wire
          ? ["wire", id.wire]
          : undefined;
    } catch {}
    const nativeBody =
      !conductor &&
      !outline &&
      !id.terminal &&
      (symbol || id.functionKey || id.circuitFunctions?.length);
    const inkSegments =
      symbol ||
      mark ||
      nativeBody ||
      id.mechanicalAssociation ||
      id.attachment ||
      id.attachmentCandidate
        ? strokeInk(e, v.clip, m, !!nativeBody && css.stroke === "none")
        : undefined;
    return [
      {
        ...id,
        shapeTag: e.tagName.toLowerCase(),
        bbox: v.b,
        symbol,
        viewport: v.clip,
        ...utilisationGeometry,
        mark,
        faceOnly: !included || undefined,
        faceSegments: h.faceSegments(
          c,
          candidate,
          functionInterface,
          css,
          v.clip,
          m,
        ),
        conductor,
        lead,
        outline,
        navigationFrame: /(?:^|\s)(?:circuit-)?device-frame(?:\s|$)/.test(cls),
        stroke: css.stroke === "none" ? 0 : stroke,
        fill: css.fill,
        strokeColour: css.stroke,
        dash: css.strokeDasharray,
        points,
        inkSegments,
        nativeBodyPainted: nativeBody ? inkSegments.length > 0 : undefined,
        navigationInkSegments:
          hasRepeatLabels ||
          /(?:^|\s)(?:circuit-)?device-frame(?:\s|$)/.test(cls) ||
          id.navigationAnnotation
            ? strokeInk(e, v.clip, m, true)
            : undefined,
        routePath:
          conductor ||
          id.loopConductor ||
          id.loopCandidate ||
          id.attachment ||
          id.attachmentCandidate
            ? e.getAttribute("d")
            : undefined,
        routeMatrix:
          conductor ||
          id.loopConductor ||
          id.loopCandidate ||
          id.attachment ||
          id.attachmentCandidate
            ? [
                m.a * sx,
                m.b * sy,
                m.c * sx,
                m.d * sy,
                (m.e - rr.x) * sx,
                (m.f - rr.y) * sy,
              ]
            : undefined,
        ...h.circuitRouteFields(e, endpoints),
        edgeOwnerKey,
        potentialName: attr(e, "data-potential-name"),
        landingOwners: conductor ? landingOwners(e, endpoints) : undefined,
        ownedLandings: conductor
          ? ownedLandings(e, endpoints, v.clip)
          : undefined,
        cls:
          cls + (e.hasAttribute("data-wiring-junction") ? " junction-dot" : ""),
      },
    ];
  });
  c.shapes = shapes.filter((s) => !s.faceOnly);
  h.relationLandingRows(c);
  return h.sheetWithClearanceGeometry(c, shapes);
}
function bindMeasurement(measure, helpers) {
  return (options = {}) => measure(options, helpers);
}
const helperSource =
  "{" +
  Object.entries(measurementHelpers)
    .map(
      ([name, value]) =>
        JSON.stringify(name) +
        ":" +
        (typeof value === "function"
          ? "(" + value.toString() + ")"
          : JSON.stringify(value)),
    )
    .join(",") +
  "}";
// Serialize both the measurement function and every browser-only dependency.
export function sheetMeasurementSource(measure = measureSheet) {
  return `(${bindMeasurement})(${measure},${helperSource})`;
}
export async function evaluateSheetGeometry(page, options = {}) {
  const result = await page.evaluate(
    ({ source, options }) => {
      try {
        return { geometry: (0, eval)(source)(options) };
      } catch (error) {
        if (
          error.name !== "IdentifierMeasurementError" ||
          error.code !== "THERMITE_IDENTIFIER_MEASUREMENT"
        )
          throw error;
        return { identifierError: error.message };
      }
    },
    {
      source: sheetMeasurementSource(),
      options,
    },
  );
  if (result.identifierError !== undefined)
    throw new IdentifierMeasurementError(result.identifierError);
  return result.geometry;
}
export async function displaySheet(page, svg) {
  await page.setContent(
    `<html><head><style>*{box-sizing:border-box}html,body{margin:0;background:white}body>svg{display:block;max-width:none}</style></head><body>${svg.replace(/^<\?xml[^>]*>/, "")}</body></html>`,
  );
  await page.evaluate(() => document.fonts.ready);
}
export async function openSheet(page, svg) {
  await displaySheet(page, svg);
  const geometry = await evaluateSheetGeometry(page);
  const anchors = (geometry.relationLandings ?? [])
    .flatMap((r) => (r.ownedLandings ?? []).map((p) => p.anchorElement))
    .filter(Boolean);
  const declarations = await page.evaluate(measureRelationDeclarations, {
    anchors,
  });
  const claims = await page.evaluate(measureMarkerIdentityClaims, { anchors });
  attachRelationDeclarations(geometry, declarations, claims);
  const missing = await page.evaluate(measureUnkeyedRelations);
  const measured = new Set(geometry.relationLandings.map((r) => r.element));
  geometry.relationLandings.push(
    ...missing.filter((r) => !measured.has(r.element)),
  );
  return classifyTextGeometry(geometry);
}
export function cropBox(b, width, height, padding = 3) {
  const x = Math.max(0, b.x - padding),
    y = Math.max(0, b.y - padding);
  return {
    x,
    y,
    w: Math.max(0.1, Math.min(width, x + b.w + padding * 2) - x),
    h: Math.max(0.1, Math.min(height, y + b.h + padding * 2) - y),
  };
}
export async function screenshotCrop(page, b, path, selector = "body>svg") {
  const clip = await page.evaluate(
    ({ b, selector }) => {
      const e = document.querySelector(selector),
        r = e.getBoundingClientRect(),
        v = e.viewBox.baseVal;
      return {
        x: r.x + scrollX + (b.x * r.width) / v.width,
        y: r.y + scrollY + (b.y * r.height) / v.height,
        width: (b.w * r.width) / v.width,
        height: (b.h * r.height) / v.height,
      };
    },
    { b, selector },
  );
  return page.screenshot({
    path,
    clip,
    fullPage: true,
    scale: "device",
    timeout: 30000,
  });
}
