import { fitContinuations } from "../src/packet/continuation-fit.js";
import { navigationZone } from "../src/packet/navigation-location.js";
import { perSideBankBounds } from "../src/packet/rooted-build.js";
import { expect, it } from "vitest";
import {
  compactFramePlan,
  headerRecovery,
  compactLegendBounds,
} from "../src/packet/frame-plan.js";
import {
  admitFinalBanks,
  continuationInk,
  cutGap,
} from "../src/packet/frame-banks.js";
import {
  continuationLabel,
  continuationHeaderWidth,
} from "../src/packet/continuation-label.js";
import { compactFrame } from "../src/packet/frame-compact.js";
import { printableTextMetrics } from "../src/text-metrics.js";
import { normalizePaperPage, bounds, frame } from "../src/packet/page.js";
import { useCompactFrame } from "../src/packet/frame-profile.js";
import type { Draft, Link } from "../src/packet/types.js";
const pageResult = normalizePaperPage();
if (!pageResult.ok) throw Error("Synthetic page failed");
const page = pageResult.value;
function draft(lines: string[] = []): Draft {
  return {
    title: {
      projectName: "Synthetic project",
      revision: "UNSPECIFIED",
      backgroundColor: "#ffffff",
      toolVersion: "test",
      lines: [
        {
          ownerKind: "view",
          ownerId: "report",
          field: "title.view-line",
          value: "Synthetic sheet",
        },
        ...lines.map((value) => ({
          ownerKind: "presentation" as const,
          ownerId: "presentation",
          field: "title.authored-line",
          value,
        })),
      ],
    },
    view: {
      format: "documentation-view/0.1",
      kind: "bom",
      title: "Synthetic sheet",
    },
    content: "",
    links: [],
    note: "Synthetic fixture",
  };
}
it("freezes geometry and reserves continuous lanes at every margin", () => {
  for (const marginMm of [5, 10, 25]) {
    const p = { ...page, marginMm },
      plan = compactFramePlan(draft().title, p);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.title.rows)).toBe(true);
    expect(plan.grid).toEqual({ columns: 6, rows: 4 });
    expect(plan.service.x).toBe(marginMm + 2.9);
    expect(plan.lanes).toHaveLength(4);
    expect(plan.lanes[0]?.w).toBe(2.6);
    expect(plan.service.y + plan.service.h).toBeCloseTo(
      plan.title.top - 3.3,
      8,
    );
  }
});
it.each([2, 3])(
  "grows a %s-note title using actual descenders and recovers safe header space",
  (n) => {
    const d = draft(Array.from({ length: n }, () => "gjpqy"));
    const plan = compactFramePlan(d.title, page);
    expect(plan.title.height).toBe(plan.title.legacyHeight + 2);
    expect(plan.title.headerRecovery).toBe(2);
    const last = plan.title.rows.at(-1);
    if (!last) throw Error("Missing row");
    const baseline = plan.title.top + 5 + 4 * (plan.title.rows.length - 1);
    const inkBottom =
      baseline - printableTextMetrics(last.value, last.size, last.bold).bottom;
    expect(
      page.heightMm - page.marginMm - 13 - 0.125 - inkBottom,
    ).toBeGreaterThanOrEqual(1);
    const legacy = bounds(d.title, page);
    expect(plan.drawing.h).toBe(legacy.h);
    expect(plan.drawing.y).toBe(legacy.y - 2);
  },
);
it("does not reclaim space occupied by a header or notice", () => {
  expect(headerRecovery(31, 28.5, 2)).toBe(1.5);
  expect(headerRecovery(31, 30.5, 2)).toBe(0);
  expect(compactFramePlan(draft().title, page).title.headerRecovery).toBe(0);
});
it("limits both legend extension axes to shared service bounds", () => {
  const base = compactFramePlan(draft().title, page);
  const plan = { ...base, service: { ...base.service, w: 100, h: 100 } },
    area = { x: plan.service.x - 1, y: plan.service.y - 1, w: 999, h: 999 };
  const b = compactLegendBounds(area, plan, page);
  expect(b.x).toBe(plan.service.x);
  expect(b.y).toBe(plan.service.y);
  expect(b.x + b.w).toBeLessThanOrEqual(plan.service.x + plan.service.w);
  expect(b.y + b.h).toBeLessThanOrEqual(plan.service.y + plan.service.h);
});
function link(side: Link["side"] = "right", y = 80): Link {
  const l: Link = {
    id: "C011",
    to: 4,
    toZone: "B1",
    conductor: "SYNTHETIC-WIRE",
    netId: "synthetic-net",
    x: 200,
    y,
    side,
    end: 0,
  };
  l.label = continuationLabel(l, 60, continuationHeaderWidth(11), true);
  return l;
}
it("keeps a complete fitting bank unchanged despite oversized reservations", () => {
  const d = draft();
  d.links = [link(), link("right", 95)];
  for (const l of d.links)
    if (l.label) {
      l.label.bounds.w = 1000;
      for (const row of l.label.rows) row.ink.w = 1000;
    }
  const before = structuredClone(d.links);
  admitFinalBanks(d, compactFramePlan(d.title, page));
  expect(d.links).toEqual(before);
});
it("admits actual final ink while rejecting a changed final peer address", () => {
  const d = draft();
  const l = link();
  d.links = [l];
  const boxes = continuationInk(l, true);
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const base = compactFramePlan(d.title, page);
  const plan = {
    ...base,
    service: { ...base.service, w: right - base.service.x + 0.001 },
  };
  admitFinalBanks(d, plan);
  l.to = 100;
  l.toZone = "D6";
  expect(() => admitFinalBanks(d, plan)).toThrow(/Final continuation/);
});
it("corrects a quantized gap rigidly, keeps peers ordered, and is idempotent", () => {
  const d = draft();
  d.links = [link("bottom", 100), link("bottom", 100)];
  d.links[1]!.x = 260;
  d.links[1]!.id = "C010";
  for (const l of d.links.slice(0, 1))
    if (l.label)
      for (const r of l.label.rows) {
        r.y -= 0.0005;
        r.ink.y -= 0.0005;
      }
  const before = structuredClone(d.links);
  admitFinalBanks(d, compactFramePlan(d.title, page));
  for (const [i, l] of d.links.entries())
    expect(l.label!.rows[0]!.y - before[i]!.label!.rows[0]!.y).toBeCloseTo(
      0.001,
      8,
    );
  for (const l of d.links)
    for (const b of continuationInk(l, true))
      expect(cutGap(l, b)).toBeGreaterThanOrEqual(3.15 - 1e-8);
  const final = structuredClone(d.links);
  admitFinalBanks(d, compactFramePlan(d.title, page));
  expect(d.links).toEqual(final);
});
it("refuses a bank that cannot fit without pushing it onto its stub", () => {
  const d = draft();
  const l = link();
  d.links = [l];
  if (l.label) for (const r of l.label.rows) r.x -= 1.7;
  expect(() => admitFinalBanks(d, compactFramePlan(d.title, page))).toThrow(
    /3.15 mm/,
  );
});
it.each([9, 10, 99, 100])(
  "prints consistent unpadded n-of-N at %s",
  (total) => {
    const svg = compactFrame(draft(), page, total, total);
    expect(svg).toContain(`SHEET ${total} OF ${total}`);
    expect(svg).toContain(`>${total} of ${total}</text>`);
    expect(svg.match(/>Sheet:</g)).toHaveLength(1);
    expect(svg).toContain("REV:");
    expect(svg).toContain("UNSPECIFIED");
  },
);
it("keeps the public page path legacy and opts in by private page identity only", () => {
  const d = draft(),
    legacy = frame(d, page, 1, 1);
  expect(legacy).toContain("SHEET 01 / 01");
  const p = { ...page };
  useCompactFrame(p);
  expect(frame(d, p, 1, 1)).toContain("SHEET 1 OF 1");
  expect(frame(d, page, 1, 1)).toBe(legacy);
});

it("extends outer grid cells over the legal service bands, rejecting the zone lanes", () => {
  const p = { ...page };
  useCompactFrame(p);
  const area = bounds(draft().title, p),
    s = area.frameService;
  if (!s) throw Error("Missing compact service area");
  expect(navigationZone(s.x, area.y + area.h / 8, area)).toBe("A1");
  expect(navigationZone(s.x + s.w, area.y + (area.h * 7) / 8, area)).toBe("D6");
  expect(navigationZone(area.x + area.w / 12, s.y, area)).toBe("A1");
  expect(navigationZone(area.x + (area.w * 11) / 12, s.y + s.h, area)).toBe(
    "D6",
  );
  expect(() => navigationZone(s.x - 1, s.y, area)).toThrow();
});
it("classifies anchors just before, on and after printed zone boundaries", () => {
  const area = {
    x: 28,
    y: 31,
    w: 120,
    h: 100,
    frameService: { x: 12.9, y: 23.3, w: 184.2, h: 232.4 },
  };
  expect([47.99, 48, 48.01].map((x) => navigationZone(x, 40, area))).toEqual([
    "A1",
    "A2",
    "A2",
  ]);
  expect([55.99, 56, 56.01].map((y) => navigationZone(35, y, area))).toEqual([
    "A1",
    "B1",
    "B1",
  ]);
});
it.each([1.7, 3.5])(
  "releases the %s mm fallback independently on sides without cuts",
  (extra) => {
    const bank = {
      width: 60,
      headerWidth: 30,
      single: false,
      left: extra,
      right: extra,
      top: 0,
      bottom: 0,
      extra: { left: extra, right: extra },
    };
    const area = { x: 30, y: 40, w: 300, h: 200 },
      d = draft();
    d.links = [link("right")];
    expect(perSideBankBounds(area, bank, d)).toEqual({
      x: 30 - extra,
      y: 40,
      w: 300 + extra,
      h: 200,
    });
    d.links = [link("left")];
    expect(perSideBankBounds(area, bank, d)).toEqual({
      x: 30,
      y: 40,
      w: 300 + extra,
      h: 200,
    });
    d.links = [link("left"), link("right")];
    expect(perSideBankBounds(area, bank, d)).toEqual(area);
    d.links = [];
    expect(perSideBankBounds(area, bank, d)).toEqual({
      x: 30 - extra,
      y: 40,
      w: 300 + 2 * extra,
      h: 200,
    });
  },
);

it("uses the glyph-envelope term when mathematical descenders exceed the nominal growth", () => {
  const d = draft(["Authored line", "⨋"]),
    plan = compactFramePlan(d.title, page);
  expect(plan.title.height).toBeGreaterThan(plan.title.legacyHeight + 2);
  expect(plan.title.height).toBe(32.175);
});
it("repairs the real 3.1495 mm serialization case even when unrounded geometry passes", () => {
  const d = draft(),
    l = link("bottom", 100.0005);
  d.links = [l];
  const raw = continuationInk(l).map((b) => b.y - l.y);
  expect(Math.min(...raw)).toBeCloseTo(3.15, 8);
  expect(
    Math.min(...continuationInk(l, true).map((b) => cutGap(l, b))),
  ).toBeCloseTo(3.1495, 8);
  const before = l.label!.rows[0]!.y;
  admitFinalBanks(d, compactFramePlan(d.title, page));
  expect(l.label!.rows[0]!.y - before).toBeCloseTo(0.001, 8);
});
it("keeps value descenders clear of the next right-cell rule", () => {
  const d = draft();
  d.title = { ...d.title, revision: "gjpqy gjpqy gjpqy" };
  const svg = compactFrame(d, page, 1, 1);
  const value = /<text[^>]* y="([^"]+)"[^>]*>gjpqy gjpqy gjpqy<\/text>/.exec(
    svg,
  );
  if (!value) throw Error("Missing supplied revision paint");
  const plan = compactFramePlan(d.title, page),
    nextRule = plan.title.top + (3 * plan.title.height) / 4;
  expect(
    nextRule -
      (Number(value[1]) -
        printableTextMetrics("gjpqy gjpqy gjpqy", 2.7).bottom) -
      0.125,
  ).toBeGreaterThanOrEqual(1.5);
  expect(svg).toContain('x="10.6"');
  expect(svg).toContain('x="421.2"');
});
it("rejects final glyphs in every reserved zone lane", () => {
  for (const side of ["left", "right", "top", "bottom"] as const) {
    const d = draft(),
      l = link(side);
    d.links = [l];
    const base = compactFramePlan(d.title, page);
    const b = continuationInk(l, true)[0]!;
    const service = { ...base.service, x: b.x + 0.1, w: b.w - 0.2 };
    expect(() => admitFinalBanks(d, { ...base, service })).toThrow(
      /Final continuation/,
    );
  }
});
it("runs final bank admission at the frame boundary", () => {
  const d = draft(),
    l = link();
  d.links = [l];
  if (l.label) for (const r of l.label.rows) r.x -= 1.7;
  expect(() => compactFrame(d, page, 1, 1)).toThrow(/cut-to-ink/);
});

it("wraps bold wide title glyphs before the neighbouring column", () => {
  const d = draft();
  const projectName = "M".repeat(160);
  d.title = { ...d.title, projectName };
  const rows = compactFramePlan(d.title, page).title.rows.filter(
    (row) => row.field === "project",
  );
  const width = page.widthMm - 2 * page.marginMm - 76;
  expect(rows.length).toBeGreaterThan(1);
  expect(rows.map((row) => row.value).join("")).toBe(projectName);
  const svg = compactFrame(d, page, 1, 1);
  for (const row of rows) {
    expect(
      printableTextMetrics(row.value, row.size, row.bold).right,
    ).toBeLessThanOrEqual(width);
    expect(svg).toContain(`>${row.value}</text>`);
  }
});

it("checks continuous zone lanes after isotonic packing, even if both labels initially fit", () => {
  const p = { ...page };
  useCompactFrame(p);
  const d = draft();
  d.links = [link("right", 25), link("right", 25.1)];
  d.links[1]!.id = "C010";
  const bank = {
    width: 60,
    headerWidth: continuationHeaderWidth(11),
    single: true,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  };
  const failure = fitContinuations([d], p, bank);
  expect(typeof failure).toBe("string");
  expect(failure).toMatch(/sheet clearance is short/);
});
it("keeps every row and member in order through a rigid quantization correction", () => {
  const d = draft(),
    l = link("bottom", 100.0005);
  l.descriptor = "JUMPER";
  l.label = continuationLabel(l, 60, continuationHeaderWidth(11), false);
  d.links = [l];
  const before = structuredClone(l.label.rows);
  admitFinalBanks(d, compactFramePlan(d.title, page));
  expect(l.label.rows.map((r) => r.text)).toEqual(before.map((r) => r.text));
  l.label.rows.forEach((r, i) => {
    expect(r.x).toBe(before[i]!.x);
    expect(r.y - before[i]!.y).toBeCloseTo(0.001, 8);
  });
});

it.each(["a4", "letter"] as const)(
  "keeps literal four/five-line descenders clear in both %s portrait flows",
  (size) => {
    for (const flow of ["left-to-right", "top-to-bottom"] as const)
      for (const notes of [2, 3]) {
        const normalized = normalizePaperPage({
          size,
          orientation: "portrait",
          marginMm: 25,
        });
        if (!normalized.ok) throw Error("Synthetic portrait page failed");
        const p = normalized.value,
          d = draft(Array.from({ length: notes }, () => "gjpqy"));
        d.view = {
          format: "schematic-view/0.1",
          root: { deviceUid: "synthetic-portrait", designation: "X1" },
          family: "control",
          flow,
        };
        const plan = compactFramePlan(d.title, p, d.view),
          svg = compactFrame(d, p, 1, 1);
        expect(plan.title.rows).toHaveLength(notes + 2);
        expect(plan.title.headerRecovery).toBe(2);
        expect(svg.match(/>gjpqy<\/text>/g)).toHaveLength(notes);
        const lastBaseline = plan.title.top + 5 + 4 * (notes + 1);
        expect(
          p.heightMm -
            p.marginMm -
            13 -
            0.125 -
            (lastBaseline - printableTextMetrics("gjpqy", 2.5).bottom),
        ).toBeGreaterThanOrEqual(1);
      }
  },
);
