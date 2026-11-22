// Source attribution is descriptive only: no role exempts a run from the floor.
const render = "packages/render/src/";
export function textSource(run) {
  const attrs = Object.assign({}, ...(run.context ?? []).toReversed());
  const value = run.text.trim(),
    y = run.bbox?.y ?? 0;
  const source = (role, file) => ({ role, sourceSite: render + file });
  if (attrs["data-contact-caption"] !== undefined)
    return source("contact-caption", "symbols/circuit-caption.ts");
  if (value === "BOUNDARY")
    return source("boundary-caption", "circuit/node-emission.ts");
  if (attrs["data-continuation-id"] !== undefined)
    return source("continuation-reference", "packet/continuation-label.ts");
  if (attrs["data-circuit-continuation"] !== undefined)
    return source("circuit-reference", "packet/circuit-continuations.ts");
  if (
    attrs["data-device-tag-field"] !== undefined ||
    attrs["data-tag-field"] !== undefined
  )
    return source("device-tag", "device-tag-svg.ts");
  if (
    attrs["data-circuit-functions"] !== undefined ||
    attrs["data-circuit-body-width"] !== undefined
  )
    return source(
      run.emMm < 2.5 - 0.000001 ? "relation-footer" : "circuit-node-text",
      "circuit/node-emission.ts",
    );
  if (/^Thermite \d/u.test(value))
    return source("version-stamp", "packet/page.ts");
  if (/^(LETTER|TABLOID|A[34]) \/ /u.test(value))
    return source("paper-footer", "packet/page.ts");
  if (/^SHEET \d+ OF \d+$/u.test(value))
    return source("sheet-footer", "packet/page.ts");
  if (
    /^[A-D1-6]$/u.test(value) &&
    !(run.context ?? []).some((x) => Object.keys(x).length)
  )
    return source("zone", "packet/page.ts");
  if (!(run.context ?? []).some((x) => Object.keys(x).length))
    return source(
      y > 180 ? "frame-footer" : "frame-furniture",
      "packet/page.ts",
    );
  return source(
    "drawing-text",
    "svg/emitter.ts or drawing-specific emitter (see context)",
  );
}

export function attributePdfRuns(runs, svgRuns) {
  return runs.map((run) => {
    const candidates = svgRuns.filter(
      (s) =>
        s.sheet === run.sheet &&
        s.text.replace(/\s/gu, "").includes(run.text.replace(/\s/gu, "")) &&
        Math.abs(s.bbox.y - run.bbox.y) < 3 &&
        Math.abs(s.bbox.x - run.bbox.x) < 5,
    );
    const sources = [
      ...new Set(candidates.map((s) => JSON.stringify(textSource(s)))),
    ];
    return {
      ...run,
      ...(sources.length === 1
        ? JSON.parse(sources[0])
        : {
            role: "pdf-native-text",
            sourceSite: `PDF content stream page ${run.sheet}, item ${run.index}`,
          }),
    };
  });
}
