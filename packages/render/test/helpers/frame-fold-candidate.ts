import { sideCandidate } from "./side-candidate.js";
import { required } from "../fixtures.js";
import { normalizePaperPage } from "../../src/packet/page.js";
import { useCompactFrame } from "../../src/packet/frame-profile.js";
import { rootedSpace } from "../../src/packet/rooted-build.js";
import {
  bankBounds,
  continuationBanks,
} from "../../src/packet/continuation-bank.js";
import { beginFramePlanning } from "../../src/packet/frame-budget.js";

/** Three routed strips, two sheets, and asymmetric per-sheet reference fields. */
export function frameFoldCandidate() {
  const reference = sideCandidate(3),
    p = reference.prepared;
  const normalized = normalizePaperPage({
    size: "a4",
    orientation: "portrait",
  });
  if (!normalized.ok) throw Error(normalized.error.message);
  const page = normalized.value;
  useCompactFrame(page);
  p.layout.width = 1500;
  p.layout.height = 450;
  p.layout.nodes.forEach((n, i) => {
    n.x = 100 + i * 600;
    n.y = 40;
    n.height = 330;
  });
  required(p.layout.edges[0]).points = [
    { x: 120, y: 200 },
    { x: 1320, y: 200 },
  ];
  required(p.graph.edges[0]).conductor = {
    kind: "wire",
    uid: "w1",
    designation: "W1",
  };
  const { b } = rootedSpace(p, page, false),
    scale = 0.25;
  const bank = required(
    continuationBanks(p, b, scale, 0, true).find(
      (bank) => !bank.single && bank.extra?.left === 3.5,
    ),
  );
  const field = bankBounds(b, bank);
  // The first reference sheet has a right cut only; its unused left reservation
  // is released. The second sheet's two cut sides retain their reservations.
  reference.drafts = reference.drafts.slice(0, 2).map((d, i) => ({
    ...d,
    links: [],
    drawingBounds: { ...field, w: field.w + (i === 0 ? 3.5 : 0) },
  }));
  beginFramePlanning(page, reference);
  const grid = { xs: [0, 520, 1040, 1540], ys: [0, 490] };
  return { reference, p, page, b, scale, bank, grid };
}
