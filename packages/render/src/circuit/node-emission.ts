import { terminalAttachmentStroke } from "../symbols/attachment-stroke.js";
import { terminalPortAttribute } from "../layout/port-attributes.js";
import { deviceTagSvg } from "../device-tag-svg.js";
import { ownedTagText, tagAttributes } from "../device-tag-ownership.js";
import { TERMINAL_TEXT_SIZE } from "../symbols/circuit-text.js";
import { LATERAL_PIN_INSET_MM } from "./pin-clearance.js";
import { nodeCaptionSegments } from "../symbols/circuit-node-ink.js";
import { type CaptionBox } from "../symbols/circuit-caption.js";
import {
  captionInk,
  ownerCaption,
  strokeBoxes,
} from "../symbols/caption-ink.js";
import {
  escapeXmlText as xml,
  escapeXmlAttribute as attr,
} from "../svg/escape.js";
import {
  circuitMarkSegments,
  circuitTransformerCore,
  circuitBlock,
  circuitMark,
  circuitTerminal,
} from "../symbols/circuit.js";
import type { DeviceNode, Pin, FunctionRow } from "./types.js";
import type {
  EmissionInput,
  EmissionHooks,
  EmissionBase,
  EmissionPlaced,
  EmissionState,
  CaptionCenter,
} from "./emission-state.js";
import { emitCircuitRows } from "./node-symbols.js";
import { verticalLaneX } from "./nodes.js";
export function emitCircuitNode(
  input: EmissionInput,
  hooks: EmissionHooks,
): string {
  const { node, vertical } = input;
  if (node.tagLane) return emitTaggedNode(node.tagLane, input, hooks);
  const base = nodeEmissionBase(input, hooks);
  const placed = nodeEmissionPlacement(base);
  emitWindingCore(placed);
  const captionCenters = nodeCaptionCenters(placed);
  const { captionSegments, ownerSegments } = nodeCaptionSegments(
    node,
    captionCenters,
    vertical,
    hooks.oneSidedFunction,
  );
  const captionBoxes = nodeCaptionBoxes(placed, captionSegments, ownerSegments);
  const bounds = {
    left: 0.5,
    right: node.width - 0.5,
    top: 0.5,
    bottom: node.height - 0.5,
  };
  const obstacles = strokeBoxes(ownerSegments, 0.4);
  const state = {
    ...placed,
    captionCenters,
    captionSegments,
    ownerSegments,
    captionBoxes,
    bounds,
    obstacles,
  };
  placeNodeDesignation(state);
  const footers = nodeFooters(state);
  emitCircuitRows(state);
  emitNodeGangs(state);
  for (const p of node.pins) emitNodePin(p, state);
  const { out, text } = state;
  footers.forEach((p) => out.push(text(p.x, p.y, p.value, 2.5, p.anchor)));
  out.push("</g>");
  return out.join("");
}

function emitTaggedNode(
  tagLane: NonNullable<DeviceNode["tagLane"]>,
  input: EmissionInput,
  hooks: EmissionHooks,
): string {
  const { node, x, y, vertical, conductors, diagnostics, attachmentWeights } =
    input;
  const { circuitNodeAttributes, n, emitNode, text } = hooks;
  const { body, plan, geometry: g } = tagLane;
  const stems = body.pins
    .map((p, i) => emitNodeStem(p, i, node, g, attachmentWeights, hooks))
    .join("");
  const captions = node.tagColumnCaptions
    .map((s, i) => text(g.tagX + 2, g.tagY + plan.heightMm + (i + 1) * 3.1, s))
    .join("");
  return `<g${circuitNodeAttributes(node)} data-circuit-body-width="${n(body.width)}" data-circuit-body-height="${n(body.height)}" data-circuit-tag-lane="${attr(node.device.uid)}" transform="translate(${n(x)} ${n(y)})"><g ${tagAttributes(node.device.uid)}>${deviceTagSvg(plan, g.tagX, g.tagY)}</g>${emitNode(body, g.bodyX, g.bodyY, vertical, conductors, diagnostics, true, attachmentWeights)}${stems}${captions}</g>`;
}

function emitNodeStem(
  p: Pin,
  i: number,
  node: DeviceNode,
  g: NonNullable<DeviceNode["tagLane"]>["geometry"],
  attachmentWeights: ReadonlyMap<string, number> | undefined,
  hooks: EmissionHooks,
): string {
  const { n, key } = hooks;
  const end = node.pins[i]!;
  const sx = p.x + g.bodyX,
    sy = p.y + g.bodyY;
  return sx === end.x && sy === end.y
    ? ""
    : `<g ${terminalPortAttribute(end.id)} data-terminal-attachment="${attr(key(p.terminal))}" data-attachment-from="${attr(JSON.stringify({ x: sx, y: sy }))}" data-attachment-to="${attr(JSON.stringify({ x: end.x, y: end.y }))}"><path d="M ${n(sx)} ${n(sy)} L ${n(end.x)} ${n(end.y)}" fill="none" stroke="#17212b" stroke-width="${terminalAttachmentStroke(p.id, attachmentWeights)}"/></g>`;
}

function nodeEmissionBase(
  input: EmissionInput,
  hooks: EmissionHooks,
): EmissionBase {
  const { node, x, y, omitDesignation } = input;
  const { circuitNodeAttributes, n } = hooks;
  const out = [
    `<g${omitDesignation ? circuitNodeAttributes(node).replace(/ data-device-uid="[^"]*"/u, "") : circuitNodeAttributes(node)} transform="translate(${n(x)} ${n(y)})"><title>${xml([node.device.description, node.type.catalog?.orderNumber, node.type.description].filter(Boolean).join(" | "))}</title>`,
  ];
  const block =
    node.boundary ||
    node.functions.some(
      (f) =>
        ["source", "load", "channel", "other"].includes(f.kind) &&
        !["motor", "heater", "lamp", "thermocouple", "fuse"].includes(
          circuitMark(node.type, f),
        ),
    );
  if (block)
    out.push(
      circuitBlock(
        node.width,
        node.height,
        node.pins.filter((p) =>
          node.sourceTerminalKeys.includes(p.terminal.terminalKey),
        ),
        node.pins.every((p) =>
          node.sourceTerminalKeys.includes(p.terminal.terminalKey),
        ),
      ).replace(/^<rect /u, '<rect class="circuit-device-frame" '),
    );
  return { ...input, ...hooks, out };
}

function nodeEmissionPlacement(state: EmissionBase): EmissionPlaced {
  const { node, vertical, out, text } = state;
  const coilRow = node.rows.find((row) => row.f.kind === "coil");
  let designationX =
    vertical && node.relationLabels.length && coilRow
      ? verticalLaneX(coilRow.center, node) + 3
      : node.width / 2;
  const designationAnchor: "start" | "middle" =
    vertical && node.relationLabels.length && coilRow ? "start" : "middle";
  // Compute ink first, then fill this original paint-order position.
  const designationIndex = out.length;
  out.push("");
  if (node.boundary)
    out.push(
      text(
        node.width / 2,
        node.height - (vertical ? 7 : 1),
        "BOUNDARY",
        2.5,
        "middle",
      ),
    );
  const verticalFooter =
    node.relationLabels.length * 3.1 +
    (node.boundary || node.relationLabels.length ? 5 : 0);
  const diagramCenterY = (node.height - verticalFooter) / 2;
  const coupled = node.type.symbol === "thermite:transformer";
  return {
    ...state,
    coilRow,
    designationX,
    designationAnchor,
    designationIndex,
    diagramCenterY,
    coupled,
  };
}

function emitWindingCore(state: EmissionPlaced) {
  const { node, key, vertical, coupled, diagramCenterY, out } = state;
  const windingPins = node.rows
    .filter((row) => row.mark === "winding")
    .flatMap((row) =>
      row.f.terminals.map((t) =>
        node.pins.find((p) => key(p.terminal) === key(t))!,
      ),
    );
  if (coupled && windingPins.length) {
    const coordinates = windingPins.map((p) => (vertical ? p.x : p.y));
    out.push(
      circuitTransformerCore(
        vertical ? diagramCenterY : node.width / 2,
        Math.min(...coordinates) - 1,
        Math.max(...coordinates) + 1,
        vertical,
      ),
    );
  }
}

function nodeCaptionCenters(state: EmissionPlaced): CaptionCenter[] {
  const { node } = state;
  return node.rows.map((row) => nodeCaptionCenter(row, state));
}

function nodeCaptionCenter(
  row: FunctionRow,
  state: EmissionPlaced,
): CaptionCenter {
  const { node, vertical, diagramCenterY } = state;
  const x = vertical ? verticalLaneX(row.center, node) : node.width / 2,
    y = vertical ? diagramCenterY : row.center;
  const segments = circuitMarkSegments(row.mark, x, y, vertical),
    points = segments.flatMap((s) => [s[0], s[1]]);
  return {
    key: row.f.id.functionKey,
    x,
    y,
    bounds: {
      left: Math.min(...points.map((p) => p.x)),
      right: Math.max(...points.map((p) => p.x)),
      top: Math.min(...points.map((p) => p.y)),
      bottom: Math.max(...points.map((p) => p.y)),
    },
  };
}

function nodeCaptionBoxes(
  state: EmissionPlaced,
  captionSegments: EmissionState["captionSegments"],
  ownerSegments: EmissionState["ownerSegments"],
): CaptionBox[] {
  const { node, pinLabel, mechanicalGangs, vertical, diagramCenterY } = state;
  const box = captionInk;
  const captionBoxes: CaptionBox[] = [
    ...node.pins.map((p) =>
      box(
        pinLabel(p),
        p.side === "WEST"
          ? 1.5
          : p.side === "EAST"
            ? node.width - 1.5
            : p.x + 1,
        p.side === "WEST" || p.side === "EAST"
          ? p.y - 1.5
          : p.side === "NORTH"
            ? 6
            : node.height - 1.5,
        TERMINAL_TEXT_SIZE,
        p.side === "EAST" ? "end" : "start",
      ),
    ),
  ];
  for (const gang of mechanicalGangs(node, vertical, diagramCenterY)) {
    captionSegments.push([gang.from, gang.to]);
    ownerSegments.push([gang.from, gang.to]);
  }
  captionBoxes.push(
    ...node.pins.map((p) => ({
      left: p.x - 0.75,
      right: p.x + 0.75,
      top: p.y - 0.75,
      bottom: p.y + 0.75,
    })),
  );
  if (node.boundary)
    captionBoxes.push(
      box(
        "BOUNDARY",
        node.width / 2,
        node.height - (vertical ? 7 : 1),
        2.5,
        "middle",
      ),
    );
  return captionBoxes;
}

function placeNodeDesignation(state: EmissionState) {
  const {
    node,
    vertical,
    omitDesignation,
    designationAnchor,
    bounds,
    obstacles,
    captionBoxes,
    out,
    designationIndex,
    text,
  } = state;
  const box = captionInk;
  let { designationX } = state;
  const designation =
    vertical && !omitDesignation
      ? ownerCaption(
          node.device.designation,
          designationX,
          3.3,
          2.7,
          designationAnchor,
          true,
          bounds,
          obstacles,
          captionBoxes,
        )
      : { x: designationX, y: 3.3, anchor: designationAnchor };
  designationX = designation.x;
  if (!omitDesignation)
    captionBoxes.push(
      box(
        node.device.designation,
        designation.x,
        designation.y,
        2.7,
        designationAnchor,
        true,
      ),
    );
  out[designationIndex] = omitDesignation
    ? ""
    : ownedTagText(
        text(
          designation.x,
          designation.y,
          node.device.designation,
          2.7,
          designationAnchor,
          true,
        ),
        node.device.uid,
        "designation",
      );
  state.designationX = designationX;
}

function nodeFooters(state: EmissionState) {
  const {
    node,
    vertical,
    coilRow,
    designationX,
    designationAnchor,
    bounds,
    obstacles,
    captionBoxes,
  } = state;
  const footers = node.relationLabels.map((value, i) => {
    const y =
      node.height -
      (vertical ? 7 : 1) -
      (node.relationLabels.length - 1 - i) * 3.1;
    const p = ownerCaption(
      value,
      vertical && coilRow ? designationX : node.width / 2,
      y,
      2.5,
      vertical && coilRow ? designationAnchor : "middle",
      false,
      bounds,
      obstacles,
      captionBoxes,
    );
    captionBoxes.push(p.box);
    return { ...p, value };
  });
  return footers;
}

function emitNodeGangs(state: EmissionState) {
  const { node, vertical, diagramCenterY, mechanicalGangs, out, n } = state;
  // Ganging is authored mechanical ink, shared with caption collision checks.
  for (const g of mechanicalGangs(node, vertical, diagramCenterY))
    out.push(
      `<line data-mechanical-association="ganged" data-ganged-functions="${attr(JSON.stringify(g.functions))}" x1="${n(g.from.x)}" x2="${n(g.to.x)}" y1="${n(g.from.y)}" y2="${n(g.to.y)}" stroke="#17212b" stroke-width=".25" stroke-dasharray="1.5 1"/>`,
    );
}

function emitNodePin(p: Pin, state: EmissionState) {
  const { key, out, node, pinLabel, text } = state;
  out.push(
    `<g ${terminalPortAttribute(p.id)} data-terminal-id="${attr(key(p.terminal))}" data-terminal-key="${attr(p.terminal.terminalKey)}"${p.outside ? ` data-outside-connections="${p.outside}"` : ""}>`,
    // A landed conductor is an endpoint, not proof of a three-way junction.
    // Measured route junctions are emitted separately by the topology pass.
    circuitTerminal(p.x, p.y, false),
  );
  const label = pinLabel(p);
  if (p.side === "WEST")
    out.push(
      text(
        LATERAL_PIN_INSET_MM,
        p.y - LATERAL_PIN_INSET_MM,
        label,
        TERMINAL_TEXT_SIZE,
      ),
    );
  else if (p.side === "EAST")
    out.push(
      text(
        node.width - LATERAL_PIN_INSET_MM,
        p.y - LATERAL_PIN_INSET_MM,
        label,
        TERMINAL_TEXT_SIZE,
        "end",
      ),
    );
  else if (p.side === "NORTH")
    out.push(text(p.x + 1, 6, label, TERMINAL_TEXT_SIZE));
  else out.push(text(p.x + 1, node.height - 1.5, label, TERMINAL_TEXT_SIZE));
  if (p.outside)
    out.push(
      `<title>${xml(`${node.device.designation}.${p.terminal.terminalKey}: ${p.outside} other physical connection(s) outside this group. See terminal schedule and circuit references.`)}</title>`,
    );
  out.push("</g>");
}
