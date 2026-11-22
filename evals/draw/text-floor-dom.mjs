// Independent all-text inventory. No renderer metrics or strict-check policies.
function intersects(a, b) {
  return (
    a.right > b.left && b.right > a.left && a.bottom > b.top && b.bottom > a.top
  );
}
function clipBox(a, style) {
  const id = style.clipPath.match(/#([^)'"\s]+)/u)?.[1],
    clip = document.getElementById(id);
  if (
    !clip ||
    clip.getAttribute("clipPathUnits") !== "userSpaceOnUse" ||
    clip.children.length !== 1 ||
    clip.firstElementChild.tagName !== "rect"
  )
    throw Error("Unsupported text clip in all-text census");
  const r = clip.firstElementChild,
    m = a.getScreenCTM();
  if (clip.hasAttribute("transform") || r.hasAttribute("transform"))
    throw Error("Unsupported transformed text clip");
  const x = r.x.baseVal.value,
    y = r.y.baseVal.value,
    w = r.width.baseVal.value,
    h = r.height.baseVal.value;
  const points = [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}
function visibleNode(node, h) {
  const e = node.parentElement,
    value = node.textContent;
  if (
    !value.trim() ||
    e.closest(
      "script,style,title,desc,metadata,defs,clipPath,mask,pattern,symbol,head",
    )
  )
    return;
  if (getComputedStyle(e).visibility !== "visible") return;
  const range = document.createRange();
  range.selectNodeContents(node);
  const rect = range.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  for (let a = e; a; a = a.parentElement) {
    const style = getComputedStyle(a);
    if (style.display === "none" || Number(style.opacity) === 0) return;
    if (
      a instanceof SVGSVGElement &&
      style.overflow !== "visible" &&
      !h.intersects(rect, a.getBoundingClientRect())
    )
      return;
    if (style.clipPath !== "none" && !h.intersects(rect, h.clipBox(a, style)))
      return;
  }
  return { e, value, rect };
}
function physicalMatrix(e, root) {
  if (!(e instanceof SVGGraphicsElement)) {
    let matrix = new DOMMatrix();
    for (let a = e; a; a = a.parentElement) {
      const t = getComputedStyle(a).transform;
      if (t !== "none") matrix = new DOMMatrix(t).multiply(matrix);
    }
    return matrix;
  }
  // Correct only the 1/64-pixel outer viewport quantization, retaining CSS and
  // all nested SVG transforms. Never round the measured physical em itself.
  const vb = root.viewBox.baseVal,
    r = root.getCTM(),
    width = root.width.baseVal.value,
    height = root.height.baseVal.value,
    style = getComputedStyle(root);
  if (!vb.width || !vb.height || !r || r.b || r.c)
    throw Error("Unsupported outer SVG physical viewport");
  if (
    Math.abs(parseFloat(style.width) - width) > 0.02 ||
    Math.abs(parseFloat(style.height) - height) > 0.02
  )
    throw Error("CSS viewport differs from declared physical sheet");
  const none = root.preserveAspectRatio.baseVal.align === 1,
    scale = Math.min(width / vb.width, height / vb.height);
  const calibrated = new DOMMatrix().scale(
    none ? width / vb.width : scale,
    none ? height / vb.height : scale,
  );
  const dom = (m) => new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f]);
  return dom(root.getScreenCTM())
    .multiply(dom(r.inverse()))
    .multiply(calibrated)
    .multiply(dom(root.getScreenCTM()).inverse())
    .multiply(dom(e.getScreenCTM()));
}
function measureNode(candidate, h) {
  const { e, value, rect } = candidate,
    mm = 25.4 / 96;
  let root = e.closest("svg");
  while (root?.ownerSVGElement) root = root.ownerSVGElement;
  const matrix = h.physicalMatrix(e, root);
  if (!matrix) throw Error("Visible text has no physical transform");
  const emMm =
    parseFloat(getComputedStyle(e).fontSize) *
    Math.hypot(matrix.c, matrix.d) *
    mm;
  if (!(emMm > 0) || !Number.isFinite(emMm))
    throw Error("Unmeasured visible text");
  const context = [];
  for (let a = e; a && a !== root; a = a.parentElement)
    context.push(
      Object.fromEntries(
        Array.from(a.attributes)
          .filter((a) => a.name.startsWith("data-"))
          .map((a) => [a.name, a.value]),
      ),
    );
  const sheet =
      root?.getAttribute("data-sheet") ??
      root?.closest("section")?.id?.replace("sheet-", "") ??
      "1",
    origin = root?.getBoundingClientRect() ?? { x: 0, y: 0 };
  return {
    text: value,
    emMm,
    sheet: Number(sheet),
    context,
    bbox: {
      x: (rect.x - origin.x) * mm,
      y: (rect.y - origin.y) * mm,
      w: rect.width * mm,
      h: rect.height * mm,
    },
    element: e.tagName,
    svg: !!root,
  };
}
export const domFunctions = {
  intersects,
  clipBox,
  visibleNode,
  physicalMatrix,
  measureNode,
};
export function deliveredTextRuns(h) {
  const runs = [],
    walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const candidate = h.visibleNode(node, h);
    if (candidate) runs.push(h.measureNode(candidate, h));
  }
  // use shadow trees aren't walked. Refuse rather than silently omit their text.
  for (const use of document.querySelectorAll("use")) {
    const id = (
      use.getAttribute("href") ??
      use.getAttribute("xlink:href") ??
      ""
    ).slice(1);
    if (document.getElementById(id)?.querySelector("text,tspan"))
      throw Error("Text in SVG use requires shadow-tree census support");
  }
  return runs;
}
