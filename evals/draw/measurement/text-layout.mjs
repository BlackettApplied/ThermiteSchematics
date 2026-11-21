// Browser-only measurement helpers; dependencies arrive explicitly from the caller.
export function textClipAndOwner(c) {
  const { e, identity, m, point, ref, terminalDescriptionOwner } = c;
  let { clip } = c;
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
  id.terminalDescriptionKey = terminalDescriptionOwner(e, id.deviceUid);
  const semantic = e
    .getAttribute("clip-path")
    ?.match(/(?:#|-)clip-([a-f0-9]+)\)/)?.[1];
  Object.assign(c, { id, semantic, clip });
}

export function textSemanticOwner(c) {
  const { e, id, ids, semantic, terminalCaptionOwners } = c;
  if (semantic) {
    try {
      const key = JSON.parse(
        semantic
          .match(/.{4}/g)
          .map((h) => String.fromCharCode(parseInt(h, 16)))
          .join(""),
      );
      if (key[0] !== "label") throw Error("Not a semantic label key");
      id.labelRole = key[3];
      id.labelOwnerKind = key[1];
      // Retain the declared role even if the inner owner key is malformed.
      // DQ-17 must reject that declaration instead of falling back to class.
      const entity = typeof key[2] === "string" ? JSON.parse(key[2]) : key[2];
      id.labelOwnerKey = entity;
      if (entity?.[0] === "wire" && /conductor|net/.test(key[3] ?? ""))
        id.wire ??= entity[1];
      if (entity?.[0] === "port" && key[1] === "port") {
        const owner = terminalCaptionOwners.get(
          JSON.stringify([ids.get(e.closest("svg")), entity[1], entity[2]]),
        );
        id.deviceUid = owner?.deviceUid;
        id.terminal = owner?.terminal;
        id.terminalAppearance = owner?.terminalAppearance;
      }
      if (key[3] === "net" && key[1] === "edge") id.terminal = undefined;
    } catch {}
  }
  const role =
    e.getAttribute("class") ?? e.closest("text")?.getAttribute("class") ?? "";
  if (id.terminal && !id.terminalAppearance)
    id.terminalAppearance = ids.get(
      e.closest("[data-terminal-id],[data-loop-terminal]"),
    );
  const nestedRoot = e.parentElement.closest(
    "svg:not(body>svg):not(section>svg)",
  );
  Object.assign(c, { role, nestedRoot });
}

export function textSourcePath(c) {
  const { e, nestedRoot, root } = c;
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
  Object.assign(c, { sourceRoot, sourcePath });
}

export function textSourceKey(c) {
  const { attr, e, id, renderedString, sourcePath, sourceRoot } = c;
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
  Object.assign(c, { sourceTextKey });
}

export function textRow(c) {
  const { e, visible, h } = c;
  if (!e.textContent.trim()) return [];
  const v = visible(e, true);
  if (!v) return [];
  const s = { ...c, v };
  h.textFontMetrics(s);
  h.textNativeBaseline(s);
  h.textInkGeometry(s);
  h.textReportCell(s);
  h.textBackground(s);
  h.textClipAndOwner(s);
  h.textSemanticOwner(s);
  h.textSourcePath(s);
  h.textSourceKey(s);
  return [{ ...h.textFields1(s), ...h.textFields2(s), ...h.textFields3(s) }];
}
