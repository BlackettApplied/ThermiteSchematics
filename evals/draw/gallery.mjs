import { criteria } from "./criteria.mjs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { escapeHtml as esc, json } from "./support.mjs";
export async function gallery(dest, results, rows) {
  const sheets = results.flatMap((r) =>
    (r.sheets ?? []).map((s) => ({ case: r.case, ...s })),
  );
  const form = {
    format: "thermite-draw-review/1.0",
    reviewers: ["Claude", "Codex"],
    instructions:
      "Independently review every sheet at 100% on matching paper. Fixed DQ-01…DQ-24 checklist; focus DQ-03 visual, DQ-04 and DQ-22. Material: could cause mis-wiring, misreading or OEM rejection. Coarse sheet/class markers can merge indistinguishable new defects; inspect individual instance counts, all changed areas and the full sheet even when a coarse marker remains xfail. Blind review: do not read the other reviewer’s results.",
    reviews: ["Claude", "Codex"].map((reviewer) => ({
      reviewer,
      persona:
        "Industrial controls drafter and checker; assess drawing fidelity, not engineering adequacy",
      completed: false,
      printScalePercent: 100,
      selectedStandard:
        "not exported; reviewer must record the source of any selected standard",
      checklist: Object.entries(criteria).map(([dq, check]) => ({
        dq,
        check,
        status: "pending",
        notes: "",
      })),
      sheets: sheets.map((s) => ({
        case: s.case,
        sheet: s.number,
        reviewed: false,
      })),
      redLines: [],
      redLineTemplate: {
        severity: "material | minor",
        case: "",
        sheet: 1,
        zone: "A1",
        sheetZone: "1.A1",
        dq: "DQ-04",
        elementOrDesignation: "",
        description: "",
        evidencePath: "",
      },
    })),
  };
  await writeFile(join(dest, "reviewer-form.json"), json(form));
  const failures = rows.filter((r) =>
    ["fail", "xfail", "xpass"].includes(r.status),
  );
  await writeFile(
    join(dest, "gallery.html"),
    `<!doctype html><meta charset="utf-8"><title>D-draw gallery</title><style>body{font:15px system-ui;margin:24px;background:#eee}article{background:white;padding:16px;margin:16px 0}img{max-width:100%;height:auto}a{color:#1656a3}.sheet{width:100%}@media print{article{break-after:page}}</style><h1>D-draw gallery</h1><p><a href="summary.md">Report</a> · <a href="summary.json">JSON</a> · <a href="reviewer-form.json">Blind reviewer JSON form</a>. Open the original SVG or PDF and print at 100% on matching paper. Gallery thumbnails are scaled.</p><h2>Failing observations and 300 dpi crops</h2>${failures.map((r) => `<article id="${esc(r.id)}"><h3>${esc(r.id)} · ${r.status}</h3><p>${esc(r.reason ?? r.evidence?.findings?.[0]?.kind ?? "Retire stale marker")}</p>${r.evidence?.crop ? `<a href="${esc(r.evidence.crop)}"><img loading="lazy" src="${esc(r.evidence.crop)}"></a>${r.evidence.referenceCrop ? `<p>SVG reference</p><img loading="lazy" src="${esc(r.evidence.referenceCrop)}">` : ""}` : "<p>Sheet-level, clipped or off-sheet finding: inspect the SVG and measured evidence; no crop is invented.</p>"}</article>`).join("")}<h2>Every sheet (${sheets.length})</h2>${sheets.map((s) => `<article><h3>${esc(s.case)} / ${s.number}</h3><p><a href="${esc(s.svg)}">SVG at print size</a> · <a href="${esc(s.pdf)}#page=${s.number}">Direct PDF</a> · <a href="${esc(s.html)}">CLI HTML${s.html.endsWith(".gz") ? " (gzip)" : ""}</a>${s.pdfPng ? ` · <a href="${esc(s.pdfPng)}">pdf.js raster</a>` : ""}${s.nativePng ? ` · <a href="${esc(s.nativePng)}">Apple PDFKit raster</a>` : ""}</p><img class="sheet" loading="lazy" src="${esc(s.png)}"></article>`).join("")}`,
  );
}
