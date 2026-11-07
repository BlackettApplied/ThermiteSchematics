import {
  selectSignalLoop,
  signalLoopTitle,
  type SignalLoopViewRequest,
} from "../signal-loop.js";
import { buildDocumentation, type DocumentationRequest } from "@thermite/query";
import type { ElectricalIr } from "@thermite/compiler";
import type { InvalidSheetError } from "../errors.js";

import type { RenderOutcome } from "../types.js";

export function failure(
  reason: InvalidSheetError["reason"],
  message: string,
  details?: Readonly<Record<string, unknown>>,
): RenderOutcome<never> {
  return {
    ok: false,
    error: {
      code: "R006",
      root: "packet",
      reason,
      message,
      ...(details ? { details } : {}),
    },
  };
}
export function record(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

export interface PacketViewContext {
  /** Zero-based index in the authored views array. */
  readonly viewIndex: number;
  readonly title: string;
}
export function packetViewContext(
  view: unknown,
  viewIndex: number,
  ir?: Readonly<ElectricalIr>,
): PacketViewContext {
  if (record(view) && typeof view.title === "string")
    return { viewIndex, title: view.title };
  if (record(view) && view.format === "documentation-view-request/0.1" && ir) {
    try {
      return {
        viewIndex,
        title: buildDocumentation(ir, view as unknown as DocumentationRequest)
          .title,
      };
    } catch {
      /* Preserve the original validation failure below. */
    }
  }
  if (record(view) && view.format === "communication-view-request/0.1")
    return {
      viewIndex,
      title:
        view.medium === "ethernet"
          ? "Ethernet connections"
          : "NRG heater bus connections",
    };
  if (record(view) && view.format === "connector-assembly-view-request/0.1")
    return { viewIndex, title: "Connector and cable assemblies" };
  if (record(view) && view.format === "signal-loop-view-request/0.1" && ir) {
    try {
      return {
        viewIndex,
        title: signalLoopTitle(
          selectSignalLoop(ir, view as unknown as SignalLoopViewRequest),
        ),
      };
    } catch {
      /* The view renderer reports the selection failure. */
    }
  }
  if (record(view) && record(view.root)) {
    const value =
      typeof view.root.value === "string" ? view.root.value : "<unknown>";
    const root =
      view.root.by === "uid"
        ? ([...(ir?.devices ?? []), ...(ir?.cables ?? [])].find(
            (d) => d.uid === value,
          )?.designation ?? value)
        : value;
    const intent = record(view.intent) ? view.intent.kind : view.family;
    const target =
      record(view.intent) && record(view.intent.to)
        ? view.intent.to
        : undefined;
    const targetName =
      target?.by === "uid"
        ? (ir?.devices.find((d) => d.uid === target.value)?.designation ??
          target.value)
        : target?.value;
    return {
      viewIndex,
      title: `${root} / ${intent === "trace" ? `trace to ${targetName ?? "<unknown>"}` : typeof intent === "string" ? intent : "schematic"}`,
    };
  }
  return {
    viewIndex,
    title:
      record(view) && typeof view.kind === "string"
        ? view.kind
        : "Untitled view",
  };
}
export function withPacketViews<
  E extends { readonly message: string; readonly root?: string },
>(error: E, views: readonly PacketViewContext[]): E {
  if (!views.length) return error;
  const unique = [...new Map(views.map((v) => [v.viewIndex, v])).values()].sort(
    (a, b) => a.viewIndex - b.viewIndex,
  );
  const context = unique
    .map((v) => `view[${v.viewIndex}] ${JSON.stringify(v.title)}`)
    .join(", ");
  return {
    ...error,
    message: `Packet ${context}: ${error.message}`,
    details: {
      ...("details" in error ? (error.details as object) : {}),
      views: unique,
      ...(unique.length === 1
        ? {
            view: unique[0]!,
            viewIndex: unique[0]!.viewIndex,
            viewTitle: unique[0]!.title,
          }
        : {}),
    },
  };
}
export class PacketDraftError extends Error {
  constructor(
    message: string,
    readonly views: readonly PacketViewContext[],
  ) {
    super(message);
  }
}
