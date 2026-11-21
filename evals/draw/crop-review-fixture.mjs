// Synthetic mixed rename; its unchanged instance is the row's representative crop.
import { assemble, it0 } from "./repin-fixture.mjs";
import { instanceInventory } from "./repin-core.mjs";
import { hash, json } from "./support.mjs";
import { cropHeader, sourcePath } from "./crop-report.mjs";
export function mixedCropFixture({ reverse = false, changedBox = true } = {}) {
  const c = assemble({
    registryItems: [],
    baselineItems: [
      it0("shared", { text: "W-C11", src: "wire/unchanged" }),
      it0("shared", { text: "OLD", src: "wire/changed" }),
    ],
    currentItems: [
      it0("shared", {
        text: "W-C11",
        src: "wire/unchanged",
        bbox: { x: 1, y: 1, w: 1, h: 1 },
      }),
      it0("shared", {
        text: "CHANGED",
        src: "wire/changed",
        ...(changedBox ? { bbox: { x: 20, y: 20, w: 2, h: 2 } } : {}),
      }),
    ],
    entries: () => [],
  });
  const report = c.report,
    source = "<svg><text>W-C11</text></svg>";
  report.sourceHashes = {
    format: "thermite-draw-sources/1.0",
    sheets: [
      {
        case: report.cases[0],
        sheet: 1,
        svg: { path: report.cases[0] + "/sheet-001.svg", sha256: hash(source) },
        html: {
          path: report.cases[0] + "/packet.html.gz",
          sha256: hash("html"),
        },
      },
    ],
  };
  const row = report.results.find((r) => r.evidence?.findings?.length);
  row.evidence.crop = "case/row.png";
  row.evidence.cropBbox = { x: 0, y: 0, w: 3, h: 3 };
  const sha = hash(json(report)),
    inv = instanceInventory(report, sha),
    a = inv.instances.find((t) => t.facts.text === "W-C11"),
    b = inv.instances.find((t) => t.facts.text === "CHANGED");
  const pairs = [
    {
      from: c.before.instances.find((t) => t.facts.text === "W-C11").token,
      to: a.token,
    },
    {
      from: c.before.instances.find((t) => t.facts.text === "OLD").token,
      to: b.token,
      text: { from: "OLD", to: "CHANGED" },
    },
  ];
  if (reverse) pairs.reverse();
  const crop = {
      path: "evals/out/draw-samples/review.png",
      sha256: hash("png"),
    },
    entry = {
      action: "rename",
      pairs,
      to: { markerId: a.markerId, scope: a.scope },
      crop,
    };
  const file = {
      summarySha256: sha,
      baselineSha256: c.decisions[0].baselineSha256,
      entries: [entry],
    },
    reports = new Map([...c.baselines, [sha, report]]);
  function indexFor(t) {
    const box = t.bbox;
    return {
      crops: [
        {
          capture: "fresh-source",
          path: crop.path,
          sha256: crop.sha256,
          reportSha256: sha,
          token: t.token,
          markerId: t.markerId,
          scope: t.scope,
          row: t.row,
          text: t.facts.text,
          physicalSheet: t.physicalSheet,
          instanceBbox: box,
          sourceBbox: {
            x: box.x - 1,
            y: box.y - 1,
            w: box.w + 2,
            h: box.h + 2,
          },
          headerPixels: 86,
          headerLines: cropHeader(t),
          sourceRender: {
            medium: "svg",
            svg: sourcePath(t),
            svgSha256: hash(source),
          },
        },
      ],
    };
  }
  return { file, entry, report, reports, a, b, indexFor, source, sha };
}
