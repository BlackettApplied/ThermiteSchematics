// Shared print-capture environment: no page scripts, service workers or network.
export const drawingContextOptions = Object.freeze({
  deviceScaleFactor: 300 / 96,
  viewport: { width: 1800, height: 1800 },
  offline: true,
  serviceWorkers: "block",
  javaScriptEnabled: false,
});
import { classifyTextGeometry } from "./text-classification.mjs";
import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { chromium } from "playwright-core";
// Preserve the calibrated path: software rasterization broke a retained binding.
// The repeat-capture check supplies explicit candidate arguments for experiments.
export const drawingLaunchArgs = Object.freeze([]);
export async function browserPath() {
  if (process.env.THERMITE_DRAW_CHROMIUM) {
    try {
      await access(process.env.THERMITE_DRAW_CHROMIUM);
    } catch {
      throw Error(
        `Drawing eval infrastructure: THERMITE_DRAW_CHROMIUM does not name an accessible executable: ${process.env.THERMITE_DRAW_CHROMIUM}. Set it to an installed Chromium executable or run bunx playwright-core install chromium. No checks were skipped.`,
      );
    }
    return process.env.THERMITE_DRAW_CHROMIUM;
  }
  const roots =
    process.platform === "darwin"
      ? [join(homedir(), "Library/Caches/ms-playwright")]
      : [join(homedir(), ".cache/ms-playwright")];
  for (const root of roots) {
    let entries = [];
    try {
      entries = await readdir(root);
    } catch {}
    for (const e of entries
      .filter((x) => /^chromium-/.test(x))
      .sort()
      .reverse())
      for (const suffix of [
        "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        "chrome-linux64/chrome",
        "chrome-linux/chrome",
        "chrome-win/chrome.exe",
      ]) {
        const path = join(root, e, suffix);
        try {
          await access(path);
          return path;
        } catch {}
      }
  }
  throw Error(
    "Drawing eval infrastructure: Chromium missing. Install the local Chromium build with bunx playwright-core install chromium, or set THERMITE_DRAW_CHROMIUM to its executable. No checks were skipped.",
  );
}
export async function launch(args = drawingLaunchArgs) {
  return chromium.launch({
    executablePath: await browserPath(),
    headless: true,
    args,
  });
}
// Executed inside Chromium. All positions are transformed to outer-sheet mm.
// Neither text advances nor layout estimates are read from the engine.
export function measureSheet(options = {}) {
  const root = document.querySelector(options.selector ?? "svg"),
    rr = root.getBoundingClientRect(),
    vb = root.viewBox.baseVal;
  const sx = vb.width / rr.width,
    sy = vb.height / rr.height;
  const point = (x, y) => ({ x: (x - rr.x) * sx, y: (y - rr.y) * sy });
  const screenBox = (r) => ({
    x: (r.x - rr.x) * sx,
    y: (r.y - rr.y) * sy,
    w: r.width * sx,
    h: r.height * sy,
  });
  const bounds = (e, box) => {
    const b = box ?? e.getBBox(),
      m = e.getScreenCTM();
    const pts = [
      [b.x, b.y],
      [b.x + b.width, b.y],
      [b.x, b.y + b.height],
      [b.x + b.width, b.y + b.height],
    ]
      .map(([x, y]) => new DOMPoint(x, y).matrixTransform(m))
      .map((p) => point(p.x, p.y));
    const xs = pts.map((p) => p.x),
      ys = pts.map((p) => p.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  };
  const intersect = (a, b) => ({
    x: Math.max(a.x, b.x),
    y: Math.max(a.y, b.y),
    w: Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
    h: Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y),
  });
  const visible = (e, keepHidden = false) => {
    if (
      e.closest("defs,clipPath,mask,symbol,pattern,marker") ||
      getComputedStyle(e).display === "none" ||
      getComputedStyle(e).visibility === "hidden"
    )
      return null;
    let clip = { x: 0, y: 0, w: vb.width, h: vb.height };
    for (let p = e.parentElement; p && p !== root; p = p.parentElement)
      if (
        p.tagName.toLowerCase() === "svg" &&
        getComputedStyle(p).overflow !== "visible"
      ) {
        const v = p.viewBox.baseVal,
          m = p.getScreenCTM();
        const a = new DOMPoint(v.x, v.y).matrixTransform(m),
          b = new DOMPoint(v.x + v.width, v.y + v.height).matrixTransform(m);
        const aa = point(a.x, a.y),
          bb = point(b.x, b.y);
        clip = intersect(clip, {
          x: Math.min(aa.x, bb.x),
          y: Math.min(aa.y, bb.y),
          w: Math.abs(aa.x - bb.x),
          h: Math.abs(aa.y - bb.y),
        });
      }
    const b = bounds(e),
      v = intersect(
        { ...b, w: Math.max(b.w, 0.02), h: Math.max(b.h, 0.02) },
        clip,
      );
    return keepHidden || (v.w > 0.001 && v.h > 0.001)
      ? { b, clip, painted: v.w > 0.001 && v.h > 0.001 }
      : null;
  };
  const attr = (e, name) => e.closest(`[${name}]`)?.getAttribute(name);
  const all = Array.from(root.querySelectorAll("*"));
  const ids = new Map(
    all.map((e, i) => [e, `${e.tagName.toLowerCase()}-${i}`]),
  );
  const elementsById = new Map([...ids].map(([e, id]) => [id, e]));
  const tagIdentity = (e) => {
    const owner = attr(e, "data-tag-owner-uid"),
      kind = attr(e, "data-tag-kind");
    if (!owner) return { tagField: attr(e, "data-tag-field") };
    let terminal;
    try {
      terminal = JSON.parse(attr(e, "data-tag-terminal-id") ?? "null");
    } catch {}
    let rootedOwner;
    if (e.classList.contains("label-device")) {
      try {
        const hex = e.getAttribute("clip-path").match(/-clip-([a-f0-9]+)\)/)[1];
        const label = JSON.parse(
          hex
            .match(/.{4}/g)
            .map((h) => String.fromCharCode(parseInt(h, 16)))
            .join(""),
        );
        const identity = JSON.parse(label[2]);
        if (
          label[0] === "label" &&
          label[1] === "device" &&
          identity[0] === "device"
        )
          rootedOwner = identity[1];
      } catch {}
    }
    const parent = attr(e, "data-device-uid");
    return {
      tagOwnerUid: owner,
      tagField: attr(e, "data-tag-field"),
      tagKind: kind,
      tagBlock: attr(e, "data-tag-block"),
      tagContainer:
        ids.get(
          kind === "body"
            ? e.closest("[data-device-uid]")
            : e.closest(
                'g[data-tag-kind="reference"][data-tag-block],.off-view-annotation',
              ),
        ) ?? rootedOwner,
      tagTerminal: terminal,
      tagTerminalDeclared: attr(e, "data-tag-terminal-id") != null,
      tagRef: attr(e, "data-tag-ref"),
      tagOwnershipValid:
        kind === "body"
          ? (parent ?? rootedOwner) === owner &&
            !e.closest('[data-tag-kind="reference"],.off-view-annotation')
          : kind === "reference" && (!parent || parent === owner),
    };
  };
  const identity = (e) => ({
    element: ids.get(e),
    deviceUid: attr(e, "data-device-uid"),
    designation: attr(e, "data-designation"),
    terminal: attr(e, "data-terminal-key"),
    row: attr(e, "data-report-row"),
    wire:
      attr(e, "data-wire-label") ??
      attr(e, "data-wire-uid") ??
      attr(e, "data-circuit-conductor") ??
      attr(e, "data-wiring-conductor"),
    net: attr(e, "data-net-id"),
  });
  // Per-character SVG positions expose tspan/dy breaks even when one parent
  // text node contains the entire identifier. These are measured line boxes.
  function reportRuns(e, rendered, matrix) {
    if (!e.closest("[data-report-row]")) return undefined;
    const count = e.getNumberOfChars(),
      points = Array.from(rendered);
    const utf16 = count === rendered.length;
    if (!utf16 && count !== points.length)
      throw Error(
        "Identifier measurement: SVG character inventory differs from rendered text",
      );
    const runs = [];
    let offset = 0;
    for (let index = 0; index < points.length; index++) {
      const char = points[index],
        position = utf16 ? offset : index;
      const start = e.getStartPositionOfChar(position).matrixTransform(matrix);
      const anchor = point(start.x, start.y),
        bbox = bounds(e, e.getExtentOfChar(position));
      const last = runs.at(-1);
      if (last && Math.abs(last.anchor.y - anchor.y) <= 0.17) {
        last.text += char;
        const right = Math.max(last.bbox.x + last.bbox.w, bbox.x + bbox.w);
        const bottom = Math.max(last.bbox.y + last.bbox.h, bbox.y + bbox.h);
        last.bbox.x = Math.min(last.bbox.x, bbox.x);
        last.bbox.y = Math.min(last.bbox.y, bbox.y);
        last.bbox.w = right - last.bbox.x;
        last.bbox.h = bottom - last.bbox.y;
      } else runs.push({ text: char, anchor, bbox });
      offset += char.length;
    }
    return runs;
  }
  const terminals = Array.from(
    root.querySelectorAll(
      "circle.terminal-marker,[data-terminal-id] circle,circle[data-terminal-key]",
    ),
  ).flatMap((e) => {
    if (e.closest('[data-tag-kind="reference"],.off-view-annotation'))
      return [];
    const v = visible(e);
    if (!v) return [];
    const b = v.b;
    return [
      {
        ...identity(e),
        bbox: b,
        point: { x: b.x + b.w / 2, y: b.y + b.h / 2 },
        fill: getComputedStyle(e).fill,
      },
    ];
  });
  const continuationOwner = (e) => {
    const a = e.closest('a[href^="#sheet-"]');
    return a?.querySelector("path,line") ? a : null;
  };
  const continuationInfo = (e) => {
    const a = continuationOwner(e),
      line = a?.querySelector("path,line");
    if (!line || typeof line.getPointAtLength !== "function") return undefined;
    const p = line.getPointAtLength(0),
      m = line.getScreenCTM();
    const q = new DOMPoint(p.x, p.y).matrixTransform(m);
    return {
      anchor: point(q.x, q.y),
      toSheet: Number(a.getAttribute("href").slice(7)),
    };
  };
  const textCanvas = document.createElement("canvas").getContext("2d");
  const continuationErrors = new Map();
  const textCandidates = Array.from(root.querySelectorAll("text"))
    .flatMap((e) => {
      if (!continuationOwner(e) || !e.querySelector("tspan")) return [e];
      if (
        [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
      ) {
        continuationErrors.set(
          e,
          "Mixed direct text and positioned spans unsupported",
        );
        return [e];
      }
      const spans = [...e.querySelectorAll("tspan")];
      if (
        spans.some(
          (n) =>
            n.children.length &&
            [...n.childNodes].some(
              (q) => q.nodeType === 3 && q.textContent.trim(),
            ),
        )
      ) {
        continuationErrors.set(e, "Mixed nested span content unsupported");
        return [e];
      }
      return spans.filter((n) => !n.children.length);
    })
    .flatMap((e) => {
      if (!e.textContent.trim()) return [];
      const v = visible(e, true);
      if (!v) return [];
      const css = getComputedStyle(e),
        m = e.getScreenCTM();
      let hiddenContinuation = false;
      if (continuationOwner(e)) {
        for (let node = e; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (Number(style.opacity) === 0 || style.visibility === "collapse")
            hiddenContinuation = true;
          if (style.maskImage && style.maskImage !== "none")
            throw Error("Continuation measurement: unsupported mask");
        }
        if (
          (css.fill === "none" ||
            css.fill === "rgba(0, 0, 0, 0)" ||
            Number(css.fillOpacity) === 0) &&
          (css.stroke === "none" || Number(css.strokeOpacity) === 0)
        )
          hiddenContinuation = true;
      }
      const emBbox = v.b;
      textCanvas.font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
      textCanvas.textAlign = "left";
      textCanvas.textBaseline = "alphabetic";
      // SVG collapses XML whitespace unless CSS/xml:space preserves it.
      let spaceElement = e;
      while (spaceElement && !spaceElement.hasAttribute("xml:space"))
        spaceElement = spaceElement.parentElement;
      const preserve =
        /^(pre|pre-wrap|break-spaces)$/.test(css.whiteSpace) ||
        (!css.whiteSpace &&
          spaceElement?.getAttribute("xml:space") === "preserve");
      const renderedString = preserve
        ? e.textContent.replace(/\r\n?/g, "\n")
        : e.textContent.replace(/[ \t\r\n]+/g, " ").trim();
      const metrics = textCanvas.measureText(renderedString),
        cap = textCanvas.measureText("H");
      const naturalAdvance = metrics.width,
        actualAdvance = e.getComputedTextLength();
      const lengthScale =
        naturalAdvance > 0 ? actualAdvance / naturalAdvance : 1;
      const start = e.getStartPositionOfChar(0);
      // Chromium's start position uses the selected SVG baseline. Measure the
      // baseline displacement with an alphabetic clone in the same text context.
      const textRoot = e.closest("text"),
        alphabetic = textRoot.cloneNode(true);
      const part =
        e === textRoot
          ? alphabetic
          : [...alphabetic.querySelectorAll("tspan")][
              [...textRoot.querySelectorAll("tspan")].indexOf(e)
            ];
      alphabetic.style.setProperty(
        "dominant-baseline",
        "alphabetic",
        "important",
      );
      alphabetic.style.setProperty(
        "alignment-baseline",
        "alphabetic",
        "important",
      );
      part.style.setProperty("dominant-baseline", "alphabetic", "important");
      part.style.setProperty("alignment-baseline", "alphabetic", "important");
      textRoot.parentElement.appendChild(alphabetic);
      const baselineShift = e.getBBox().y - part.getBBox().y;
      alphabetic.remove();
      const local = {
        x: start.x - metrics.actualBoundingBoxLeft * lengthScale,
        y: start.y + baselineShift - metrics.actualBoundingBoxAscent,
        width:
          (metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight) *
          lengthScale,
        height:
          metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
      };
      v.b = bounds(e, local);
      const intersection = intersect(v.b, v.clip);
      v.painted =
        !hiddenContinuation && intersection.w > 0.001 && intersection.h > 0.001;
      const scaleX = Math.hypot(m.a * sx, m.b * sy),
        scaleY = Math.hypot(m.c * sx, m.d * sy);
      const anchor = new DOMPoint(
        e.x.baseVal[0]?.value ?? start.x,
        e.y.baseVal[0]?.value ?? start.y,
      ).matrixTransform(m);
      let cell,
        plate,
        columnIndex,
        knockout = false;
      const reportColumn = e.closest("[data-report-column]");
      if (reportColumn) {
        columnIndex =
          Number(reportColumn.getAttribute("data-report-column")) - 1;
        const rectangles = Array.from(
          reportColumn.parentElement.children,
        ).filter(
          (r) =>
            r.tagName.toLowerCase() === "rect" &&
            r.getAttribute("stroke") === "#9ba6b4",
        );
        const rectangle = rectangles[columnIndex];
        if (!rectangle)
          throw Error(
            "Report column has no independently measurable SVG cell rectangle",
          );
        cell = bounds(rectangle);
      }
      for (
        let prev = e.previousElementSibling;
        prev;
        prev = prev.previousElementSibling
      ) {
        if (prev.tagName.toLowerCase() === "rect") {
          const row = e.closest("[data-report-row]");
          if (row)
            columnIndex = Array.from(row.children)
              .filter((r) => r.tagName.toLowerCase() === "rect")
              .indexOf(prev);
          if (
            prev.classList.contains("label-background") ||
            e.closest("[data-report-row]") ||
            prev.getAttribute("stroke") === "#9ba6b4"
          )
            cell ??= bounds(prev);
          if (
            (prev.classList.contains("label-background") ||
              e.closest("[data-wire-label]")) &&
            ["white", "rgb(255, 255, 255)"].includes(
              getComputedStyle(prev).fill,
            )
          ) {
            knockout = true;
            plate = {
              element: ids.get(prev),
              order: all.indexOf(prev),
              bbox: bounds(prev),
            };
          }
          break;
        }
        if (!["text", "tspan"].includes(prev.tagName.toLowerCase())) break;
      }
      let clip;
      const ref = e.getAttribute("clip-path")?.match(/url\(#(.+)\)/)?.[1];
      if (ref) {
        const r = document.getElementById(ref)?.querySelector("rect");
        if (r) {
          const p = new DOMPoint(
            +r.getAttribute("x"),
            +r.getAttribute("y"),
          ).matrixTransform(m);
          const q = new DOMPoint(
            +r.getAttribute("x") + +r.getAttribute("width"),
            +r.getAttribute("y") + +r.getAttribute("height"),
          ).matrixTransform(m);
          const a = point(p.x, p.y),
            b = point(q.x, q.y);
          clip = {
            x: Math.min(a.x, b.x),
            y: Math.min(a.y, b.y),
            w: Math.abs(a.x - b.x),
            h: Math.abs(a.y - b.y),
          };
        }
      }
      const id = identity(e);
      const semantic = e
        .getAttribute("clip-path")
        ?.match(/-clip-([a-f0-9]+)\)/)?.[1];
      if (semantic) {
        try {
          const key = JSON.parse(
            semantic
              .match(/.{4}/g)
              .map((h) => String.fromCharCode(parseInt(h, 16)))
              .join(""),
          );
          const entity =
            typeof key[2] === "string" ? JSON.parse(key[2]) : key[2];
          if (entity?.[0] === "wire" && /conductor|net/.test(key[3] ?? ""))
            id.wire ??= entity[1];
        } catch {}
      }
      const role =
        e.getAttribute("class") ??
        e.closest("text")?.getAttribute("class") ??
        "";
      if (role.includes("label-terminal") || role.includes("label-net")) {
        const closest = terminals
          .filter(
            (t) =>
              !role.includes("label-net") ||
              t.terminal === e.textContent.trim(),
          )
          .map((t) => [
            t,
            Math.hypot(
              t.point.x - (v.b.x + v.b.w / 2),
              t.point.y - (v.b.y + v.b.h / 2),
            ),
          ])
          .sort((a, b) => a[1] - b[1])[0];
        if (closest && closest[1] < 15) {
          id.deviceUid = closest[0].deviceUid;
          id.terminal = closest[0].terminal;
        }
      }
      const nestedRoot = e.parentElement.closest(
        "svg:not(body>svg):not(section>svg)",
      );
      let sourceRoot = nestedRoot;
      for (
        let ancestor = e.parentElement;
        ancestor && ancestor !== root;
        ancestor = ancestor.parentElement
      )
        if (ancestor.tagName.toLowerCase() === "svg") sourceRoot = ancestor;
      sourceRoot =
        e.closest(
          "[data-device-uid],[data-function-id],[data-wire-uid],[data-report-row],[data-circuit-group]",
        ) ?? sourceRoot;
      const sourcePath = [];
      for (
        let q = e;
        sourceRoot && q?.parentElement && q !== sourceRoot;
        q = q.parentElement
      )
        sourcePath.unshift(
          [...q.parentElement.children]
            .filter(
              (c) =>
                !(
                  c.tagName.toLowerCase() === "g" &&
                  !c.children.length &&
                  !c.textContent.trim()
                ),
            )
            .indexOf(q),
        );
      const sourceTextKey = sourceRoot
        ? JSON.stringify([
            id.deviceUid,
            id.row,
            id.terminal,
            id.wire,
            attr(e, "data-function-key"),
            attr(e, "data-circuit-group"),
            sourcePath,
            renderedString,
            e.getAttribute("x"),
            e.getAttribute("y"),
          ])
        : undefined;
      return [
        {
          ...id,
          ...tagIdentity(e),
          ...(e.tagName.toLowerCase() === "tspan"
            ? { locatorElement: ids.get(e.closest("text")) }
            : {}),
          sourceTextKey,
          text: renderedString.trim(),
          renderedString,
          order: all.indexOf(e),
          baseline: css.dominantBaseline + "/" + css.alignmentBaseline,
          baselineShiftMm: baselineShift * scaleY,
          bbox: v.b,
          emBbox,
          painted: v.painted,
          semantic: e
            .getAttribute("clip-path")
            ?.match(/-clip-([a-f0-9]+)\)/)?.[1],
          nested: !!e.parentElement.closest(
            "svg:not(body>svg):not(section>svg)",
          ),
          anchor: point(anchor.x, anchor.y),
          capHeightMm: cap.actualBoundingBoxAscent * scaleY,
          naturalAdvanceMm: naturalAdvance * scaleX,
          advanceRatio: (lengthScale * scaleX) / scaleY,
          viewport: v.clip,
          cell,
          columnIndex,
          reportRuns: reportRuns(e, renderedString, m),
          knockout,
          plate,
          wireBlock: e.closest("[data-wire-label]")
            ? ids.get(e.closest("[data-wire-label]"))
            : undefined,
          sheetText: e.parentElement === root,
          continuation: !!e.closest('a[href^="#sheet-"]'),
          continuationError: continuationErrors.get(e.closest("text")),
          continuationAnchor: continuationInfo(e)?.anchor,
          continuationDestination: continuationInfo(e)?.toSheet,
          continuationLink: continuationOwner(e)
            ? ids.get(continuationOwner(e))
            : undefined,
          circuitText: e.parentElement.hasAttribute("data-circuit-functions")
            ? (() => {
                const owner = e.parentElement;
                const fn = [...owner.children].find((c) =>
                  c.hasAttribute("data-function-key"),
                );
                const key = fn?.getAttribute("data-function-key");
                const title = fn?.querySelector("title")?.textContent;
                return {
                  boundary:
                    JSON.parse(owner.getAttribute("data-circuit-functions"))
                      .length === 0,
                  related:
                    JSON.parse(
                      owner.getAttribute("data-related-functions") ?? "[]",
                    ).length > 0,
                  primaryDesignation:
                    key && title?.endsWith("/" + key)
                      ? title.slice(0, -key.length - 1)
                      : undefined,
                };
              })()
            : undefined,
          fontMeasured: "Chromium resolved " + css.fontFamily,
          clip,
          role,
          font: css.fontFamily,
          fontSize: parseFloat(css.fontSize) * scaleY,
          capReferenceEmMm: parseFloat(css.fontSize) * scaleX * lengthScale,
          angle: (Math.atan2(m.b, m.a) * 180) / Math.PI,
          advance: e.getComputedTextLength() * Math.hypot(m.a * sx, m.b * sy),
        },
      ];
    });
  const texts = textCandidates.filter((t) => t.painted);
  const hiddenTexts = textCandidates.filter((t) => !t.painted);
  const frameElement = [...root.children].find(
    (e) =>
      e.tagName.toLowerCase() === "rect" &&
      e.getAttribute("fill") === "none" &&
      getComputedStyle(e).stroke !== "none",
  );
  const frame = frameElement ? bounds(frameElement) : null;
  const horizontalRules = [...root.children]
    .filter((e) => e.tagName.toLowerCase() === "path")
    .map((e) => bounds(e))
    .filter((b) => b.h < 0.01 && frame && b.w > frame.w * 0.8)
    .sort((a, b) => a.y - b.y);
  const headerRule = horizontalRules.length > 1 ? horizontalRules[0] : null,
    titleRule = horizontalRules.length > 1 ? horizontalRules.at(-1) : null;
  const titleBlock =
    frame && titleRule
      ? {
          x: frame.x,
          y: titleRule.y,
          w: frame.w,
          h: frame.y + frame.h - titleRule.y,
        }
      : null;
  const connectors = [...root.querySelectorAll('a[href^="#sheet-"]')].flatMap(
    (a) => {
      const line = a.querySelector("path,line");
      const owned = texts.filter((t) => t.continuationLink === ids.get(a));
      const rows = [];
      for (const t of owned.slice().sort((a, b) => a.anchor.y - b.anchor.y)) {
        const last = rows.at(-1);
        if (last && Math.abs(last.y - t.anchor.y) <= 0.17)
          last.text += t.renderedString ?? t.text;
        else rows.push({ y: t.anchor.y, text: t.renderedString ?? t.text });
      }
      const references = rows
        .map((t) => t.text.match(/^([^\s/]+)\s*\//)?.[1])
        .filter(Boolean);
      const idsForLink = [...new Set(references)].filter(
        (id) => references.filter((r) => r === id).length === 1,
      );
      if (!line || typeof line.getPointAtLength !== "function") return [];
      const p = line.getPointAtLength(0),
        m = line.getScreenCTM(),
        q = new DOMPoint(p.x, p.y).matrixTransform(m);
      return idsForLink.map((id) => ({
        id,
        element: ids.get(a),
        toSheet: Number(a.getAttribute("href").slice(7)),
        anchor: point(q.x, q.y),
      }));
    },
  );
  // DQ-12 alone consumes clipped visible outline geometry (stroke centre lines).
  // Other predicates keep their original geometry. Generated clip paths are
  // axis-aligned rectangles. Refuse
  // unsupported masks instead of using their unclipped bounds.
  const shapeClips = (e) => {
    const clips = [];
    for (let owner = e; owner; owner = owner.parentElement) {
      const css = getComputedStyle(owner);
      if (
        css.display === "none" ||
        css.visibility === "hidden" ||
        Number(css.opacity) === 0
      )
        return null;
      if (css.maskImage && css.maskImage !== "none")
        throw Error("DQ-12 unsupported mask: " + css.maskImage);
      const ref = css.clipPath;
      if (ref && ref !== "none") {
        const id = ref.match(/url\(["']?(?:[^#]*#)([^"')]+)["']?\)/)?.[1],
          clip = id && root.querySelector(`#${CSS.escape(id)}`),
          rect = clip?.children[0];
        if (
          typeof owner.getScreenCTM !== "function" ||
          clip?.tagName.toLowerCase() !== "clippath" ||
          clip.children.length !== 1 ||
          rect?.tagName.toLowerCase() !== "rect" ||
          rect.rx.baseVal.value ||
          rect.ry.baseVal.value ||
          getComputedStyle(clip).clipPath !== "none"
        )
          throw Error("DQ-12 unsupported clip path: " + ref);
        let matrix = owner.getScreenCTM();
        if (clip.clipPathUnits.baseVal === 2) {
          const box = owner.getBBox();
          matrix = new DOMMatrix([
            matrix.a,
            matrix.b,
            matrix.c,
            matrix.d,
            matrix.e,
            matrix.f,
          ])
            .translate(box.x, box.y)
            .scale(box.width, box.height);
        }
        for (const node of [clip, rect]) {
          const transform = node.transform.baseVal.consolidate();
          if (transform) matrix = matrix.multiply(transform.matrix);
        }
        if (matrix.b !== 0 || matrix.c !== 0)
          throw Error("DQ-12 unsupported rotated clip path: " + ref);
        const length = (name) => {
          const value = rect[name].baseVal;
          return clip.clipPathUnits.baseVal === 2 && value.unitType === 2
            ? value.valueInSpecifiedUnits / 100
            : value.value;
        };
        const a = new DOMPoint(length("x"), length("y")).matrixTransform(
            matrix,
          ),
          b = new DOMPoint(
            length("x") + length("width"),
            length("y") + length("height"),
          ).matrixTransform(matrix),
          aa = point(a.x, a.y),
          bb = point(b.x, b.y);
        clips.push({
          x: Math.min(aa.x, bb.x),
          y: Math.min(aa.y, bb.y),
          w: Math.abs(aa.x - bb.x),
          h: Math.abs(aa.y - bb.y),
        });
      }
    }
    return clips;
  };
  const paintedShapeBounds = (
    e,
    bbox,
    viewport,
    clips,
    points,
    css,
    matrix,
  ) => {
    if (clips === null) return null;
    const masks = [viewport, ...clips];
    if (
      masks.every(
        (c) =>
          bbox.x >= c.x &&
          bbox.y >= c.y &&
          bbox.x + bbox.w <= c.x + c.w &&
          bbox.y + bbox.h <= c.y + c.h,
      )
    )
      return bbox;
    const clip = masks.reduce(intersect);
    if (clip.w <= 0 || clip.h <= 0) return null;
    const inverse = matrix.inverse(),
      candidates = [];
    const include = (p) => {
      if (
        p.x < clip.x ||
        p.y < clip.y ||
        p.x > clip.x + clip.w ||
        p.y > clip.y + clip.h
      )
        return;
      const local = new DOMPoint(
        p.x / sx + rr.x,
        p.y / sy + rr.y,
      ).matrixTransform(inverse);
      if (
        (css.fill !== "none" &&
          Number(css.fillOpacity) > 0 &&
          e.isPointInFill(local)) ||
        (css.stroke !== "none" &&
          Number(css.strokeOpacity) > 0 &&
          e.isPointInStroke(local))
      )
        candidates.push(p);
    };
    // Exact command endpoints retain corners and disjoint subpath ends which
    // need not coincide with the existing outline sampling phases.
    if (e.tagName.toLowerCase() === "path") {
      const d = e.getAttribute("d") ?? "",
        sizes = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };
      let i = 0,
        command = "",
        x = 0,
        y = 0,
        start;
      const skip = () => {
        while (i < d.length && /[\s,]/.test(d[i])) i++;
      };
      const parameter = (flag) => {
        skip();
        // Arc flags are single characters, including compact forms like 001.
        const token = d
          .slice(i)
          .match(
            flag ? /^[01]/ : /^[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/,
          );
        if (!token || !Number.isFinite(Number(token[0])))
          throw Error("DQ-12 invalid SVG path");
        i += token[0].length;
        return Number(token[0]);
      };
      while (i < d.length) {
        skip();
        if (i === d.length) break;
        if (/^[a-zA-Z]$/.test(d[i])) command = d[i++];
        const kind = command.toUpperCase(),
          relative = command !== kind;
        if (kind === "Z") {
          if (!start) throw Error("DQ-12 invalid SVG path");
          [x, y] = start;
          command = "";
        } else {
          const count = sizes[kind];
          if (!count) throw Error("DQ-12 invalid SVG path");
          const a = Array.from({ length: count }, (_, j) =>
            parameter(kind === "A" && (j === 3 || j === 4)),
          );
          if (kind === "H") x = relative ? x + a[0] : a[0];
          else if (kind === "V") y = relative ? y + a[0] : a[0];
          else {
            x = (relative ? x : 0) + a.at(-2);
            y = (relative ? y : 0) + a.at(-1);
          }
          if (kind === "M") {
            start = [x, y];
            command = relative ? "l" : "L";
          }
        }
        const p = new DOMPoint(x, y).matrixTransform(matrix);
        include(point(p.x, p.y));
      }
    }
    // Rectangles and ellipse extrema have exact native bbox points too.
    for (const x of [bbox.x, bbox.x + bbox.w / 2, bbox.x + bbox.w])
      for (const y of [bbox.y, bbox.y + bbox.h / 2, bbox.y + bbox.h])
        include({ x, y });
    // Clip the existing 0.2 mm outline samples. Native hit tests reject phantom
    // segments between SVG subpaths and respect fill holes and dashed strokes.
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        dx = b.x - a.x,
        dy = b.y - a.y;
      let low = 0,
        high = 1;
      for (const [p, q] of [
        [-dx, a.x - clip.x],
        [dx, clip.x + clip.w - a.x],
        [-dy, a.y - clip.y],
        [dy, clip.y + clip.h - a.y],
      ]) {
        if (p === 0) {
          if (q < 0) high = -1;
        } else if (p < 0) low = Math.max(low, q / p);
        else high = Math.min(high, q / p);
      }
      if (low <= high) {
        include({ x: a.x + low * dx, y: a.y + low * dy });
        include({ x: a.x + high * dx, y: a.y + high * dy });
      }
    }
    // A clip wholly inside a fill has no outline crossing it.
    if (css.fill !== "none" && Number(css.fillOpacity) > 0)
      for (const x of [clip.x, clip.x + clip.w])
        for (const y of [clip.y, clip.y + clip.h]) include({ x, y });
    if (!candidates.length) return null;
    const xs = candidates.map((p) => p.x),
      ys = candidates.map((p) => p.y),
      x = Math.min(...xs),
      y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  };
  // Let Chromium parse every supported CSS colour syntax into sRGB + alpha,
  // including hex alpha, percentages, HSL and modern colour spaces. Never let
  // canvas's invalid-colour fallback turn a paint server into black evidence.
  const paintCanvas = document.createElement("canvas");
  paintCanvas.width = paintCanvas.height = 1;
  const paintContext = paintCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  const colourCache = new Map();
  const colour = (fill) => {
    if (!colourCache.has(fill)) {
      let rgba = null;
      if (CSS.supports("color", fill)) {
        paintContext.clearRect(0, 0, 1, 1);
        paintContext.fillStyle = fill;
        paintContext.fillRect(0, 0, 1, 1);
        rgba = [...paintContext.getImageData(0, 0, 1, 1).data];
      }
      colourCache.set(fill, rgba);
    }
    return colourCache.get(fill);
  };
  const fillPaint = (e) => {
    const css = getComputedStyle(e),
      rgba = colour(css.fill);
    let alpha = rgba ? (rgba[3] / 255) * Number(css.fillOpacity) : 0;
    for (let node = e; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (
        style.display === "none" ||
        ["hidden", "collapse"].includes(style.visibility)
      )
        alpha = 0;
      alpha *= Number(style.opacity);
    }
    return {
      alpha,
      background: rgba?.slice(0, 3).every((c) => c === 255) ?? false,
    };
  };
  // Native fill geometry honours holes, transforms and rounded corners, unlike
  // bounding-box coverage. Strokes never occlude DQ-06 rows. Test all shapes,
  // including pointer-events:none, in SVG document paint order.
  const occluders = all
    .filter((e) => e.matches("path,polygon,polyline,rect,circle,ellipse"))
    .flatMap((e) => {
      const v = visible(e),
        paint = fillPaint(e);
      if (!v || paint.alpha < 0.95) return [];
      try {
        const clips = shapeClips(e);
        if (clips === null) return [];
        return [
          {
            e,
            bbox: v.b,
            clips: [v.clip, ...clips],
            inverse: e.getScreenCTM().inverse(),
            order: all.indexOf(e),
          },
        ];
      } catch {
        return [];
      }
    });
  const contains = (b, p) =>
    p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  const occlusion = (t) => {
    const candidates = occluders.filter(
      (o) =>
        o.order > t.order &&
        intersect(o.bbox, t.bbox).w > 0 &&
        intersect(o.bbox, t.bbox).h > 0,
    );
    if (!candidates.length) return 0;
    let covered = 0;
    // 45 interior samples across the ink box; majority coverage excludes small
    // crossings and isolated glyph overlaps. Coordinates may be off-viewport.
    for (let x = 0; x < 15; x++)
      for (let y = 0; y < 3; y++) {
        const p = {
          x: t.bbox.x + (t.bbox.w * (x + 0.5)) / 15,
          y: t.bbox.y + (t.bbox.h * (y + 0.5)) / 3,
        };
        if (
          candidates.some(
            (o) =>
              contains(o.bbox, p) &&
              o.clips.every((b) => contains(b, p)) &&
              o.e.isPointInFill(
                new DOMPoint(rr.x + p.x / sx, rr.y + p.y / sy).matrixTransform(
                  o.inverse,
                ),
              ),
          )
        )
          covered++;
      }
    return covered / 45;
  };
  // DQ-06 uses complete painted owned rows. The rectangular clip rules used
  // for native shape measurement also apply to the whole measured ink box.
  for (const t of texts.filter((t) => t.tagOwnerUid)) {
    const e = elementsById.get(t.element),
      paint = fillPaint(e);
    t.tagPaintAlpha = paint.alpha;
    t.tagOcclusion = occlusion(t);
    try {
      const clips = shapeClips(e);
      t.tagPainted =
        t.painted &&
        clips !== null &&
        paint.alpha >= 0.2 &&
        !paint.background &&
        t.tagOcclusion <= 0.5 &&
        [t.viewport, ...clips].every(
          (b) =>
            t.bbox.x >= b.x - 0.001 &&
            t.bbox.y >= b.y - 0.001 &&
            t.bbox.x + t.bbox.w <= b.x + b.w + 0.001 &&
            t.bbox.y + t.bbox.h <= b.y + b.h + 0.001,
        );
    } catch (error) {
      t.tagPainted = false;
      t.tagVisibilityError = error.message;
    }
  }
  const deviceReferences = texts
    .filter((t) => t.tagTerminalDeclared && t.painted)
    .map((t) => ({
      deviceUid: t.tagOwnerUid,
      terminalKey: t.tagTerminal?.terminalKey,
      tagBlock: t.tagBlock,
      tagContainer: t.tagContainer,
      tagRef: t.tagRef,
      bbox: t.bbox,
      element: t.element,
    }))
    .filter(
      (r, i, all) =>
        all.findIndex(
          (s) =>
            s.deviceUid === r.deviceUid &&
            s.tagBlock === r.tagBlock &&
            s.tagContainer === r.tagContainer,
        ) === i,
    );
  const utilisationErrors = [];
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
    // Table rules/backgrounds do not participate in symbol or conductor checks.
    // Their actual cell boxes are already measured above; avoid flattening ink
    // that no checker consumes, especially on long report packets.
    if (
      !conductor &&
      !lead &&
      !outline &&
      !symbol &&
      !mark &&
      !id.terminal &&
      !cls.includes("junction-dot") &&
      !e.hasAttribute("data-wiring-junction")
    )
      return [];
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
    if (conductor || symbol || mark) {
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
    return [
      {
        ...id,
        bbox: v.b,
        symbol,
        viewport: v.clip,
        ...utilisationGeometry,
        mark,
        conductor,
        lead,
        outline,
        stroke: css.stroke === "none" ? 0 : stroke,
        fill: css.fill,
        dash: css.strokeDasharray,
        points,
        routePath: conductor ? e.getAttribute("d") : undefined,
        routeMatrix: conductor
          ? [
              m.a * sx,
              m.b * sy,
              m.c * sx,
              m.d * sy,
              (m.e - rr.x) * sx,
              (m.f - rr.y) * sy,
            ]
          : undefined,
        endpoints: conductor
          ? (() => {
              const raw = attr(e, "data-endpoints");
              if (raw) return JSON.parse(raw);
              const source = e.getAttribute("data-source-device-uid"),
                target = e.getAttribute("data-target-device-uid");
              return source && target
                ? [
                    {
                      deviceUid: source,
                      terminalKey: e.getAttribute("data-source-terminal-key"),
                    },
                    {
                      deviceUid: target,
                      terminalKey: e.getAttribute("data-target-terminal-key"),
                    },
                  ]
                : [];
            })()
          : undefined,
        cls:
          cls + (e.hasAttribute("data-wiring-junction") ? " junction-dot" : ""),
      },
    ];
  });
  const devices = Array.from(root.querySelectorAll("[data-device-uid]"))
    .filter(
      (e) =>
        !e.closest('[data-tag-kind="reference"],.off-view-annotation') &&
        (e.matches(".device-group") ||
          e.hasAttribute("data-layout-width") ||
          (e.tagName.toLowerCase() === "g" &&
            !e.hasAttribute("data-symbol-id") &&
            Array.from(e.children).some(
              (c) => c.tagName.toLowerCase() === "rect",
            ))),
    )
    .flatMap((e) => {
      const v = visible(e);
      return v
        ? [{ ...identity(e), bbox: v.b, text: e.textContent.trim() }]
        : [];
    });
  return {
    width: vb.width,
    height: vb.height,
    texts,
    hiddenTexts,
    frame,
    titleBlock,
    headerRule,
    connectors,
    terminals,
    shapes,
    ...(utilisationErrors.length ? { utilisationErrors } : {}),
    devices,
    deviceReferences,
    catalogs: [
      ...(root.querySelector("[data-symbol-id]") ? ["ais"] : []),
      ...(root.querySelector("[data-circuit-mark]") ? ["circuit"] : []),
    ],
    reportCells: Array.from(
      root.querySelectorAll("[data-report-row] [data-report-column]"),
    ).map((column) => {
      const columnIndex = Number(column.getAttribute("data-report-column")) - 1;
      const rect = Array.from(column.parentElement.children).filter(
        (e) =>
          e.tagName.toLowerCase() === "rect" &&
          e.getAttribute("stroke") === "#9ba6b4",
      )[columnIndex];
      if (!rect)
        throw Error("Identifier measurement: report cell rectangle missing");
      return {
        row: attr(column, "data-report-row"),
        columnIndex,
        element: ids.get(column),
        bbox: bounds(rect),
      };
    }),
    reportRows: Array.from(root.querySelectorAll("[data-report-row]")).map(
      (e) => e.getAttribute("data-report-row"),
    ),
  };
}
export async function openSheet(page, svg) {
  await page.setContent(
    `<html><head><style>*{box-sizing:border-box}html,body{margin:0;background:white}body>svg{display:block;max-width:none}</style></head><body>${svg.replace(/^<\?xml[^>]*>/, "")}</body></html>`,
  );
  await page.evaluate(() => document.fonts.ready);
  return classifyTextGeometry(await page.evaluate(measureSheet));
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
