import { mkdir, writeFile } from "node:fs/promises";
const S = 300 / 25.4;
export async function bottomDigitClearance(
  p,
  { hide, pixels, mask },
  { artifactDir, tag },
) {
  // Bottom digits: expose the glyph even if the title rule would overpaint it.
  const b = p.bottom,
    band = {
      x: Math.min(...b.map((z) => z.bbox.x)) - 0.3,
      y: Math.min(...b.map((z) => z.bbox.y)) - 0.3,
      w: 0,
      h: 0,
    };
  band.w = Math.max(...b.map((z) => z.bbox.x + z.bbox.w)) + 0.3 - band.x;
  band.h = p.T + 0.3 - band.y;
  await hide([], [], true);
  const A = await pixels(band);
  await hide(
    b.map((z) => z.id),
    [],
    true,
  );
  const B = await pixels(band),
    bm = mask(A, B);
  let max = -1,
    rawMax = -1,
    outside = 0;
  for (let i = 0; i < bm.length; i++)
    if (bm[i]) {
      rawMax = Math.max(rawMax, Math.floor(i / A.w));
      const x = band.x + ((i % A.w) + 0.5) / S,
        y = band.y + (Math.floor(i / A.w) + 0.5) / S;
      if (
        b.some(
          (z) =>
            x >= z.bbox.x - 1 / S &&
            x <= z.bbox.x + z.bbox.w + 1 / S &&
            y >= z.bbox.y - 1 / S &&
            y <= z.bbox.y + z.bbox.h + 1 / S,
        )
      )
        max = Math.max(max, Math.floor(i / A.w));
      else outside++;
    }
  if (max < 0) throw Error("Bottom digits do not paint");
  const inkBottom = band.y + (max + 1) / S,
    bottomRuleClearanceMm = p.T - 0.15 - inkBottom;
  if (bottomRuleClearanceMm < 0.5 && artifactDir) {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(artifactDir + "/" + tag + "-bottom-A.png", A.buf);
    await writeFile(artifactDir + "/" + tag + "-bottom-B.png", B.buf);
    await writeFile(
      artifactDir + "/" + tag + "-bottom-debug.json",
      JSON.stringify(
        { titleTop: p.T, band, max, inkBottom, bottom: b },
        null,
        2,
      ),
    );
  }
  return {
    bottomRuleClearanceMm,
    rawBottomRuleClearanceMm: p.T - 0.15 - (band.y + (rawMax + 1) / S),
    bottomMaskOutsideBBoxPixels: outside,
    bottomDigits: b.length,
  };
}
