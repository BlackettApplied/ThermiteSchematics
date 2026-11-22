import { circuitTerminalAttachments } from "../symbols/circuit-attachments.js";
import { TERMINAL_TEXT_SIZE } from "../symbols/circuit-text.js";
import { emitCircuitContactCaption } from "../symbols/circuit-caption.js";
import {
  escapeXmlText as xml,
  escapeXmlAttribute as attr,
} from "../svg/escape.js";
import {
  declaredSensorOutput,
  coilQualifier,
  motorIsThreePhase,
} from "../symbols/printable-policy.js";
import {
  circuitInterfaceMark,
  circuitBlock,
  circuitMarkName,
  circuitMotor,
  circuitMotorVertical,
  circuitWinding,
  circuitWindingVertical,
  composedCircuitMark,
} from "../symbols/circuit.js";
import type { FunctionRow } from "./types.js";
import type { EmissionState, EmissionRow } from "./emission-state.js";
import { verticalLaneX } from "./nodes.js";
export function emitCircuitRows(state: EmissionState) {
  const { node, out } = state;
  for (const row of node.rows) {
    const next = emissionRowState(row, state);
    const { f, mark, vertical, key, coupled, cy } = next;
    if (f.kind === "channel") emitChannelRow(next);
    else {
      if (mark === "motor") emitNodeMotor(next);
      else if (mark === "winding") {
        const first = node.pins.find(
            (p) => key(p.terminal) === key(f.terminals[0]!),
          )!,
          last = node.pins.find(
            (p) => key(p.terminal) === key(f.terminals[1]!),
          )!;
        out.push(
          vertical
            ? circuitWindingVertical(
                node.height,
                first.x,
                last.x,
                f.kind === "source",
                coupled,
                cy,
                [first.y, last.y],
              )
            : circuitWinding(
                node.width,
                first.y,
                last.y,
                f.kind === "source",
                coupled,
                [first.x, last.x],
              ),
        );
      } else emitNodeOtherSymbol(next);
      emitNodeContact(next);
      emitNodeExtras(next);
    }
    out.push("</g>");
  }
}

function emissionRowState(row: FunctionRow, state: EmissionState) {
  const { node, vertical, diagramCenterY, out, fkey } = state;
  const { f, mark } = row;
  const cx = vertical ? verticalLaneX(row.center, node) : node.width / 2;
  const cy = vertical ? diagramCenterY : row.center;
  out.push(
    `<g data-function-key="${attr(f.id.functionKey)}" data-function-id="${attr(fkey(f))}"><title>${xml(`${node.device.designation}/${f.id.functionKey}`)}</title>`,
  );
  return { ...state, row, f, mark, cx, cy };
}

function emitChannelRow(state: EmissionRow) {
  const {
    row,
    f,
    mark,
    cy,
    cx,
    out,
    node,
    vertical,
    key,
    channelLabelLines,
    text,
  } = state;
  const lines = row.channelLines!;
  const specialized = mark === "level-sensor" || mark === "sensor-3wire";
  const annotationTop = cy - (9 + lines.length * 3.1) / 2;
  if (mark === "sensor-3wire")
    out.push(
      circuitInterfaceMark(
        mark,
        cx,
        annotationTop + 4,
        f.terminals.map((t) =>
          node.pins.find((p) => key(p.terminal) === key(t))!,
        ),
        vertical,
      ),
    );
  else if (specialized)
    out.push(composedCircuitMark(mark, cx, annotationTop + 4, vertical));
  const printableLines = channelLabelLines(node.device, f, node.type, true);
  for (const [i] of lines.entries()) {
    const line = printableLines[i]!;
    if (!line) continue;
    out.push(
      `<g data-channel-line="${i === 0 ? "address" : "signal"}">${text(vertical && mark === "sensor-3wire" ? cx - 6 : cx, specialized ? annotationTop + 11.5 + i * 3.1 : cy + 0.8 + (i - (lines.length - 1) / 2) * 3.1, line, TERMINAL_TEXT_SIZE, "middle")}</g>`,
    );
  }
}

function emitNodeMotor(state: EmissionRow) {
  const { out, vertical, cx, cy, row, node, f, key } = state;
  out.push(
    vertical
      ? circuitMotorVertical(
          cx,
          cy,
          row.slots * node.pitch * node.verticalScaleX,
          f.terminals.map(
            (t) => node.pins.find((p) => key(p.terminal) === key(t))!.x,
          ),
          motorIsThreePhase(node.type, f),
        )
      : circuitMotor(
          node.width,
          row.center - (row.slots * node.pitch) / 2,
          row.slots * node.pitch,
          f.terminals.map(
            (t) => node.pins.find((p) => key(p.terminal) === key(t))!.y,
          ),
          motorIsThreePhase(node.type, f),
        ),
  );
}

function emitNodeOtherSymbol(state: EmissionRow) {
  const { mark, out, vertical, node, row, f, key, cx, cy, n } = state;
  if (
    [
      "level-sensor",
      "conductivity-probe",
      "receptacle",
      "ac-input",
      "dc-output",
      "source",
      "sensor-3wire",
    ].includes(circuitMarkName(mark))
  ) {
    out.push(
      circuitInterfaceMark(
        mark,
        cx,
        cy,
        f.terminals.map((t) =>
          node.pins.find((p) => key(p.terminal) === key(t))!,
        ),
        vertical,
        f.kind === "source",
      ),
    );
  } else {
    if (mark === "heater" && f.terminals.length === 3 && !vertical)
      out.push(
        `<g transform="translate(0 ${n(row.center - (row.slots * node.pitch) / 2)})">${circuitBlock(node.width, row.slots * node.pitch)}</g>`,
      );
    out.push(composedCircuitMark(mark, cx, cy, vertical));
  }
}

function emitNodeContact(state: EmissionRow) {
  const {
    out,
    node,
    f,
    mark,
    cx,
    cy,
    captionCenters,
    captionSegments,
    captionBoxes,
    diagnostics,
    text,
  } = state;
  out.push(
    emitCircuitContactCaption({
      type: node.type,
      fn: f,
      mark,
      device: node.device,
      x: cx,
      y: cy,
      centers: captionCenters,
      segments: captionSegments,
      occupied: captionBoxes,
      width: node.width,
      height: node.height,
      diagnostics,
      text,
    }),
  );
}

function emitNodeExtras(state: EmissionRow) {
  const {
    mark,
    node,
    f,
    out,
    cx,
    cy,
    text,
    vertical,
    key,
    oneSidedFunction,
    attachmentWeights,
  } = state;
  if (mark === "coil" && coilQualifier(node.type, f))
    out.push(text(cx, cy + 0.8, coilQualifier(node.type, f)!, 2.5, "middle"));
  if (mark === "sensor-3wire" && declaredSensorOutput(node.type))
    out.push(
      text(
        cx,
        vertical
          ? cy + 8
          : Math.max(
              ...f.terminals.map(
                (t) => node.pins.find((p) => key(p.terminal) === key(t))!.y,
              ),
            ) + 5,
        declaredSensorOutput(node.type)!,
        2.5,
        "middle",
      ),
    );
  if (!oneSidedFunction(f, mark) || f.kind === "bus")
    out.push(
      circuitTerminalAttachments(
        node,
        f.terminals,
        mark === "earth",
        vertical,
        cx,
        cy,
        attachmentWeights,
      ),
    );
}
