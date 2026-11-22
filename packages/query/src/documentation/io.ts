import { formatTerminalSet } from "../print-projection.js";
import type { TerminalId } from "@thermite/compiler";
import type { DocumentationContext } from "./context.js";
export function appendChannelRow<T>(
  d: DocumentationContext<T>["selected"][number],
  f: DocumentationContext<T>["ir"]["functions"][number],
  context: DocumentationContext<T>,
) {
  const { netMembers, nets, tid, label, compare, rows, options, connections } =
    context;
  const terminalKeys = f.terminals.map((t) => t.terminalKey);
  const assignment =
    d.io !== undefined && Object.hasOwn(d.io.channels, f.id.functionKey)
      ? d.io.channels[f.id.functionKey]
      : undefined;
  const members = new Map<string, TerminalId>();
  for (const t of f.terminals)
    for (const member of netMembers.get(nets.get(tid(t)) ?? "") ?? [])
      if (member.deviceUid !== d.uid) members.set(tid(member), member);
  const peers = [...members.values()].sort((a, b) =>
    compare(label(a), label(b)),
  );
  rows.push({
    key: JSON.stringify([d.uid, f.id.functionKey]),
    cells: [
      d.designation,
      options?.output === "csv"
        ? f.id.functionKey
        : (assignment?.address ??
          (formatTerminalSet(terminalKeys) ||
            "Channel identity not specified")),
      f.kind === "channel" ? f.direction : "",
      d.io?.addressSpace ?? "",
      assignment?.address ?? "",
      assignment?.signal ?? "",
      options?.output === "csv"
        ? f.terminals.map(label).join(", ")
        : formatTerminalSet(terminalKeys, (t) => `${d.designation}.${t}`),
      peers.map(label).join("; ") || "No connections",
      `${assignment?.usage ?? "Not specified"}; ${f.terminals.some((t) => (connections.get(tid(t)) ?? []).length) ? "terminated" : "unconnected"}`,
    ],
    deviceUids: [d.uid, ...peers.map((t) => t.deviceUid)],
  });
}
export function documentationIo<T>(context: DocumentationContext<T>) {
  const { selected, ir, compare, table, request } = context;
  for (const d of selected)
    for (const f of ir.functions
      .filter((f) => f.id.deviceUid === d.uid && f.kind === "channel")
      .sort((a, b) => compare(a.id.functionKey, b.id.functionKey))) {
      appendChannelRow(d, f, context);
    }
  return table(
    request.device ? `${selected[0]!.designation} I/O plan` : "I/O schedule",
    [
      "Device",
      "Channel",
      "Direction",
      "Address space",
      "Address",
      "Signal",
      "Terminals",
      "Connected net endpoints",
      "Assignment / state",
    ],
    [0.09, 0.08, 0.07, 0.09, 0.08, 0.16, 0.1, 0.21, 0.12],
    [
      "Every declared channel is listed. Missing assignments remain unspecified; unconnected does not automatically mean spare.",
      "Net endpoints show physical continuity only. Addresses are authored labels, not PLC configuration or a live PLC readback.",
    ],
  );
}
