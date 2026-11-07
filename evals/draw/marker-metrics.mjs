// Reference envelopes summarize scalar severity, never absolute geometry. The
// bands use the checker tolerances (README); unbanded counts are informational.
export function measurements(f) {
  const values = {};
  if (f.fontSizeMm !== undefined) values.fontSizeMm = f.fontSizeMm;
  if (f.capHeightMm !== undefined) values.capHeightMm = f.capHeightMm;
  if (f.kind === "distorted-glyphs") {
    if (!Number.isFinite(f.anisotropy))
      throw Error(
        "Missing anisotropy measurement; rerun with the current checker",
      );
    values.anisotropy = f.anisotropy;
  }
  if (f.overflowMm !== undefined) values.overflowMm = f.overflowMm;
  if (
    f.kind === "text-text-overlap" ||
    f.kind === "duplicate-or-overlapping-terminal-text"
  )
    if (f.otherBbox) {
      const a = f.bbox,
        b = f.otherBbox;
      values.overlapMm = Math.max(
        0,
        Math.min(
          Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
          Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y),
        ),
      );
    }
  if (f.advanceRatio !== undefined && f.kind !== "distorted-glyphs")
    values.advanceRatio = f.advanceRatio;
  else if (f.deltaMm !== undefined) values.advanceDeltaMm = f.deltaMm;
  if (f.outlineMm !== undefined)
    values.strokeExcessMm = f.outlineMm - f.conductorMm;
  if (f.incidentRays !== undefined) values.incidentRays = f.incidentRays;
  if (f.angle !== undefined) values.angleDegrees = Math.abs(f.angle);
  if (f.kind === "jog-under-3mm")
    values.shortestJogMm = Math.min(...f.segments.map((s) => s.lengthMm));
  if (f.kind === "route-detour")
    values.detourExcessMm = f.lengthMm - 2 * f.manhattanMm - 20;
  if (f.ownDistanceMm !== undefined) values.ownDistanceMm = f.ownDistanceMm;
  if (f.median !== undefined) values.utilisation = f.median;
  if (f.svgInk !== undefined) values.retainedInk = f.pdfInk / f.svgInk;
  return values;
}
export function tolerance(metric, findings) {
  const values = {
    overflowMm: 0.17,
    advanceRatio: 0.05,
    capHeightMm: 0.03,
    fontSizeMm: 0.03,
    anisotropy: 0.03,
    overlapMm: 0.34,
    strokeExcessMm: 0.01,
    incidentRays: 0,
    angleDegrees: 0.5,
    shortestJogMm: 0.05,
    detourExcessMm: 0.01,
    ownDistanceMm: 0.17,
  };
  return metric === "advanceDeltaMm"
    ? Math.max(0.15, ...findings.map((f) => (f.svgWidthMm ?? 0) * 0.02))
    : values[metric];
}
export function envelope(items) {
  const out = {};
  for (const item of items)
    for (const [key, value] of Object.entries(item)) {
      if (!out[key]) out[key] = [value, value];
      else {
        out[key][0] = Math.min(out[key][0], value);
        out[key][1] = Math.max(out[key][1], value);
      }
    }
  return out;
}
export function bands(findings, population = findings) {
  const reference = envelope(findings.map(measurements)),
    result = {};
  for (const [metric, [low, high]] of Object.entries(reference)) {
    if (
      metric === "capHeightMm" &&
      findings.every((f) => f.kind === "iso-cap-height-policy")
    )
      result[metric] = [0, low, high, 2.47];
    else if (metric === "retainedInk") result[metric] = [0, low, high, 0.18];
    else if (metric === "utilisation") result[metric] = [0, low, high, 0.4];
    else {
      const pad = tolerance(metric, findings);
      if (pad !== undefined)
        result[metric] = [Math.max(0, low - pad), low, high, high + pad];
    }
  }
  if (
    result.advanceRatio &&
    findings.every((f) => f.kind === "pdf-svg-advance-difference")
  ) {
    const pair = findings[0].fontPair;
    const values = population
      .filter(
        (f) =>
          f.kind === "pdf-svg-advance-difference" &&
          f.fontPair === pair &&
          Number.isFinite(f.advanceRatio),
      )
      .map((f) => f.advanceRatio);
    if (!values.length)
      throw Error("Missing complete DQ-21 font-pair population");
    result.advanceRatio[0] = Math.max(0, Math.min(...values) - 0.05);
    result.advanceRatio[3] = Math.max(...values) + 0.05;
  }
  return result;
}
