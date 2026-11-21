import type { ElectricalIr, TerminalId } from "@thermite/compiler";
import type { LoopFunction } from "./series-selection.js";
import type { SignalLoopViewRequest } from "../signal-loop.js";
import { escapeXmlText as xml } from "../svg/escape.js";
import {
  assertLoopPolarityEntry,
  readLoopPolarity,
  terminalKey,
  loopFunctionReference,
} from "./polarity.js";

export class DirectLoopPolarityError extends Error {
  constructor(
    message: string,
    readonly title: string,
  ) {
    super(message);
  }
}

/** Direct interfaces join like polarities; series source traversal is separate. */
export function directLoopPolarity(
  ir: Readonly<ElectricalIr>,
  from: LoopFunction,
  to: LoopFunction,
  paths: readonly { terminals: readonly TerminalId[] }[],
) {
  const transmitter = readLoopPolarity(
    ir,
    from.function.terminals,
    "transmitter",
  );
  const input = readLoopPolarity(ir, to.function.terminals, "input");
  if (transmitter && input) {
    const arrival = paths
      .find((p) => {
        const departure = p.terminals[0];
        return (
          departure &&
          terminalKey(departure) === terminalKey(transmitter.positive)
        );
      })
      ?.terminals.at(-1);
    if (!arrival)
      throw new Error("Signal loop polarity requires complete direct paths.");
    try {
      assertLoopPolarityEntry(
        ir,
        transmitter.positive,
        arrival,
        input,
        "Signal loop polarity",
      );
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      throw new DirectLoopPolarityError(
        error.message,
        `${from.device.designation} - signal loop`,
      );
    }
  }
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [from, to]
    .filter((_, i) => !(i === 0 ? transmitter : input))
    .sort(
      (a, b) =>
        compare(a.device.designation, b.device.designation) ||
        compare(a.function.id.functionKey, b.function.id.functionKey),
    )
    .map(loopFunctionReference);
}

export function finishDirectLoopDrawing<T extends { content: string }>(
  drawing: T,
  selected: {
    unverifiedEndpoints: readonly string[];
    output: boolean;
    auxiliary: readonly unknown[];
  },
  request: SignalLoopViewRequest,
  assemblies: boolean,
) {
  const engineNotes = selected.unverifiedEndpoints.length
    ? [`polarity not verified: ${selected.unverifiedEndpoints.join(", ")}.`]
    : undefined;
  return {
    ...drawing,
    content:
      (engineNotes ? `<desc>${xml(engineNotes.join("\n"))}</desc>` : "") +
      drawing.content,
    ...(engineNotes ? { engineNotes } : {}),
    note: [
      assemblies
        ? `Heavy line = cable assembly, not a shared electrical net. Pin maps run ${selected.output ? "from output toward actuator" : "from transmitter toward input"}; core details remain in the conductor view.`
        : `${selected.auxiliary.length ? "Separate command and auxiliary nets." : "Two separate signal nets."} Dashed cores are explicitly spare; connector contact numbers are not a mating-face view.`,
      ...(engineNotes ?? []),
      ...(request.notes ?? []),
    ].join("\n"),
  };
}
