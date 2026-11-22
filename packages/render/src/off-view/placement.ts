import { required } from "../presentation/util.js";
import { contactCaptionRegion } from "../presentation/contact-caption.js";
import type {
  PresentationLabel,
  PresentationPort,
  SymbolPresentationNode,
  RailPresentationNode,
} from "../types.js";
import { CARD_GAP } from "./card.js";
import { cardInkFits } from "./ink.js";
import { gangReservationBand } from "../symbols/gang-geometry.js";
import {
  LABEL_PORT_HORIZONTAL_SPACING as H,
  LABEL_PORT_VERTICAL_SPACING as V,
} from "../layout/options.js";

const q = (value: number) => Number(value.toFixed(3));

type Owner = SymbolPresentationNode | RailPresentationNode;
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;

export function annotationPortPosition(node: Owner, port: PresentationPort) {
  const o = node.primitiveOrigin,
    s = node.symbolSize;
  switch (port.side) {
    case "west":
      return { x: o.x, y: o.y + port.offset * s.height };
    case "east":
      return { x: o.x + s.width, y: o.y + port.offset * s.height };
    case "north":
      return { x: o.x + port.offset * s.width, y: o.y };
    case "south":
      return { x: o.x + port.offset * s.width, y: o.y + s.height };
  }
}

function portLane(node: Owner, port: PresentationPort): Box {
  const p = annotationPortPosition(node, port),
    far = 1e8,
    gap = 16;
  switch (port.side) {
    case "west":
      return { x: -far, y: p.y - gap, width: far + p.x, height: 2 * gap };
    case "east":
      return { x: p.x, y: p.y - gap, width: far, height: 2 * gap };
    case "north":
      return { x: p.x - gap, y: -far, width: 2 * gap, height: far + p.y };
    case "south":
      return { x: p.x - gap, y: p.y, width: 2 * gap, height: far };
  }
}

function terminalLabelBoxes(node: Owner): Box[] {
  return node.labels
    .filter((l) => l.ownerKind === "port")
    .map((l) => {
      const port = required(
        node.ports.find((p) => p.id === l.ownerId),
        "Missing terminal label port",
      );
      const p = annotationPortPosition(node, port);
      const x =
        port.side === "west"
          ? p.x - l.width - H
          : port.side === "east"
            ? p.x + H
            : p.x + V;
      const y =
        port.side === "north"
          ? p.y - l.height - H
          : port.side === "south"
            ? p.y + H
            : p.y + V;
      return { x: x - 4, y: y - 4, width: l.width + 8, height: l.height + 8 };
    });
}

function cardObstacles(node: Owner): Box[] {
  const header = required(
    node.labels.find((l) => l.ownerId === node.id),
    "Missing node header",
  );
  const caption =
    node.kind === "symbol" ? contactCaptionRegion(node, header) : undefined;
  return [
    {
      x: node.primitiveOrigin.x - 4,
      y: node.primitiveOrigin.y - 4,
      width: node.symbolSize.width + 8,
      height: node.symbolSize.height + 8,
    },
    {
      x:
        node.orientation === "top-to-bottom"
          ? 4
          : (node.width - header.width) / 2,
      y: 0,
      width: header.width + 8,
      height: 22,
    },
    ...(caption
      ? [
          {
            x: caption.x - 4,
            y: caption.y - 4,
            width: caption.width + 8,
            height: caption.height + 8,
          },
        ]
      : []),
    ...node.ports.map((p) => portLane(node, p)),
    ...terminalLabelBoxes(node),
  ];
}

function enclosingBox(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

function cardBoxes(
  node: Owner,
  card: PresentationLabel,
  forbidden: readonly Box[],
  bounds: Box,
  placed: readonly PresentationLabel[],
) {
  const port = required(
    node.ports.find((p) => p.id === card.ownerId),
    "Missing off-view port",
  );
  const anchor = annotationPortPosition(node, port);
  const candidates: { box: Box; cost: number; distance: number }[] = [];
  for (const gap of [CARD_GAP, CARD_GAP + 8, CARD_GAP + 16]) {
    for (const x of [
      anchor.x - gap - card.width,
      anchor.x + gap,
      node.primitiveOrigin.x - gap - card.width,
      node.primitiveOrigin.x + node.symbolSize.width + gap,
    ]) {
      for (const y of [
        anchor.y - gap - card.height,
        anchor.y + gap,
        bounds.y - card.height - 8,
        bounds.y + bounds.height + 8,
        anchor.y - card.height / 2,
        anchor.y,
        ...forbidden
          .filter((b) => b.width < 1e6 && b.height < 1e6)
          .flatMap((b) => [b.y - card.height - 4, b.y + b.height + 4]),
      ]) {
        const box = { x, y, width: card.width, height: card.height };
        const expanded = enclosingBox(bounds, box);
        const band =
          node.kind === "symbol"
            ? gangReservationBand(node, expanded)
            : undefined;
        if (
          (band && intersects(box, band)) ||
          forbidden.some((other) => intersects(box, other)) ||
          !orderedStack(node, card, box, placed)
        )
          continue;
        candidates.push({
          box,
          cost: expanded.width * expanded.height + gap,
          distance: Math.hypot(
            Math.max(box.x - anchor.x, 0, anchor.x - box.x - box.width),
            Math.max(box.y - anchor.y, 0, anchor.y - box.y - box.height),
          ),
        });
      }
    }
  }
  const unique = new Map<string, (typeof candidates)[number]>();
  for (const c of candidates) {
    const key = JSON.stringify(c.box);
    if (!unique.has(key)) unique.set(key, c);
  }
  return [...unique.values()]
    .sort((a, b) => a.distance - b.distance || a.cost - b.cost)
    .slice(0, 128);
}

/** Negative internal choices select an existing physical quadrant, not a new box. */
function directionalRank(
  node: Owner,
  card: PresentationLabel,
  candidates: readonly { box: Box }[],
  requested: number,
) {
  const port = required(
    node.ports.find((p) => p.id === card.ownerId),
    "Missing off-view port",
  );
  const anchor = annotationPortPosition(node, port);
  return candidates.findIndex(
    ({ box }) =>
      (box.x > anchor.x ? 2 : 0) +
        (box.y + box.height / 2 > anchor.y ? 1 : 0) ===
      -requested - 1,
  );
}

function enlargedOwner(
  node: Owner,
  cards: readonly PresentationLabel[],
  bounds: Box,
): Owner {
  // Integral reservation margins keep ELK compound centering from introducing
  // half-precision ticks into otherwise unchanged port/label offsets.
  const dx = -Math.floor(bounds.x) + 4,
    dy = -Math.floor(bounds.y) + 4;
  const translated = cards.map((label) => {
    const card = required(label.offView, "Missing off-view card");
    return {
      ...label,
      offView: {
        ...card,
        position: { x: q(card.position.x + dx), y: q(card.position.y + dy) },
      },
    };
  });
  return {
    ...node,
    width: Math.ceil(bounds.x + bounds.width + dx + 4),
    height: Math.ceil(bounds.y + bounds.height + dy + 4),
    contentBox: { x: q(dx), y: q(dy), width: node.width, height: node.height },
    primitiveOrigin: {
      x: q(node.primitiveOrigin.x + dx),
      y: q(node.primitiveOrigin.y + dy),
    },
    labels: [...node.labels, ...translated],
  };
}

/** Reserve owner-local cards and clear port lanes before ELK runs. */
export function reserveOffViewCards(
  node: Owner,
  cards: readonly PresentationLabel[],
  choices: Readonly<Record<string, number>> = {},
): Owner | undefined {
  if (!cards.length) return node;
  const forbidden = cardObstacles(node),
    placed: PresentationLabel[] = [];
  let bounds: Box = { x: 0, y: 0, width: node.width, height: node.height };
  for (const card of displayedCards(node, cards)) {
    if (!cardInkFits(card)) return undefined;
    const candidates = cardBoxes(node, card, forbidden, bounds, placed);
    const requested = choices[card.id] ?? choices["*"] ?? 0;
    const rank =
      requested < 0
        ? directionalRank(node, card, candidates, requested)
        : (choices[card.id] ?? Math.min(requested, candidates.length - 1));
    const box = candidates[rank]?.box;
    if (!box) return undefined;
    forbidden.push({
      x: box.x - 4,
      y: box.y - 4,
      width: box.width + 8,
      height: box.height + 8,
    });
    const left = Math.min(bounds.x, box.x),
      top = Math.min(bounds.y, box.y);
    bounds = {
      x: left,
      y: top,
      width: Math.max(bounds.x + bounds.width, box.x + box.width) - left,
      height: Math.max(bounds.y + bounds.height, box.y + box.height) - top,
    };
    placed.push({
      ...card,
      offView: {
        ...required(card.offView, "Missing card data"),
        position: { x: box.x, y: box.y },
        placementCount: candidates.length,
        placementRank: rank,
      },
    });
  }
  return enlargedOwner(node, placed, bounds);
}

function displayedCards(node: Owner, cards: readonly PresentationLabel[]) {
  const axis = node.orientation === "left-to-right" ? "y" : "x";
  const anchor = (c: PresentationLabel) =>
    annotationPortPosition(
      node,
      required(
        node.ports.find((p) => p.id === c.ownerId),
        "Missing card port",
      ),
    );
  return [...cards].sort((a, b) => anchor(a)[axis] - anchor(b)[axis]);
}

/** Cards sharing a bank follow the physical order of their displayed terminals. */
function orderedStack(
  node: Owner,
  card: PresentationLabel,
  box: Box,
  placed: readonly PresentationLabel[],
) {
  const vertical = node.orientation === "left-to-right",
    axis = vertical ? "y" : "x";
  const anchor = annotationPortPosition(
    node,
    required(
      node.ports.find((p) => p.id === card.ownerId),
      "Missing card port",
    ),
  );
  for (const previous of placed) {
    const other = required(previous.offView, "Missing placed card");
    const p = annotationPortPosition(
      node,
      required(
        node.ports.find((p) => p.id === previous.ownerId),
        "Missing card port",
      ),
    );
    const overlap = vertical
      ? box.x < other.position.x + previous.width &&
        box.x + box.width > other.position.x
      : box.y < other.position.y + previous.height &&
        box.y + box.height > other.position.y;
    const delta = vertical
      ? box.y + box.height / 2 - other.position.y - previous.height / 2
      : box.x + box.width / 2 - other.position.x - previous.width / 2;
    if (overlap && (anchor[axis] - p[axis]) * delta < -0.001) return false;
  }
  return true;
}
