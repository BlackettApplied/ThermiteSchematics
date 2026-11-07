import { classifyTextGeometry } from "./text-classification.mjs";
import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { chromium } from "playwright-core";
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
export async function launch() {
  return chromium.launch({
    executablePath: await browserPath(),
    headless: true,
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
      e.closest("defs") ||
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
  const terminals = Array.from(
    root.querySelectorAll(
      "circle.terminal-marker,[data-terminal-id] circle,circle[data-terminal-key]",
    ),
  ).flatMap((e) => {
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
  const textCanvas = document.createElement("canvas").getContext("2d");
  const textCandidates = Array.from(root.querySelectorAll("text")).flatMap(
    (e) => {
      if (!e.textContent.trim()) return [];
      const v = visible(e, true);
      if (!v) return [];
      const css = getComputedStyle(e),
        m = e.getScreenCTM();
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
      const alphabetic = e.cloneNode(true);
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
      e.parentElement.appendChild(alphabetic);
      const baselineShift = e.getBBox().y - alphabetic.getBBox().y;
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
      v.painted = intersection.w > 0.001 && intersection.h > 0.001;
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
      const role = e.getAttribute("class") ?? "";
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
          knockout,
          plate,
          wireBlock: e.closest("[data-wire-label]")
            ? ids.get(e.closest("[data-wire-label]"))
            : undefined,
          sheetText: e.parentElement === root,
          continuation: !!e.closest('a[href^="#sheet-"]'),
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
    },
  );
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
      const line = a.querySelector("path,line"),
        id = a.textContent.trim().match(/^(\S+)\s*\//)?.[1];
      if (!line || !id || typeof line.getPointAtLength !== "function")
        return [];
      const p = line.getPointAtLength(0),
        m = line.getScreenCTM(),
        q = new DOMPoint(p.x, p.y).matrixTransform(m);
      return [
        {
          id,
          toSheet: Number(a.getAttribute("href").slice(7)),
          anchor: point(q.x, q.y),
        },
      ];
    },
  );
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
    return [
      {
        ...id,
        bbox: v.b,
        symbol,
        viewport: v.clip,
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
        e.matches(".device-group") ||
        e.hasAttribute("data-layout-width") ||
        (e.tagName.toLowerCase() === "g" &&
          !e.hasAttribute("data-symbol-id") &&
          Array.from(e.children).some(
            (c) => c.tagName.toLowerCase() === "rect",
          )),
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
    devices,
    catalogs: [
      ...(root.querySelector("[data-symbol-id]") ? ["ais"] : []),
      ...(root.querySelector("[data-circuit-mark]") ? ["circuit"] : []),
    ],
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
  await page.screenshot({
    path,
    clip,
    fullPage: true,
    scale: "device",
    timeout: 30000,
  });
}
