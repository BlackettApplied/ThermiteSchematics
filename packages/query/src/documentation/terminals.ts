import { symbolProfile } from "@thermite/schema";
import type { DocumentationContext } from "./context.js";
export function appendTerminalRow<T>(
  d: DocumentationContext<T>["selected"][number],
  type: DocumentationContext<T>["types"] extends Map<string, infer U>
    ? U
    : never,
  key: string,
  context: DocumentationContext<T>,
) {
  const { connections, tid, label, compare, devices, rows, reportDescription } =
    context;
  const terminal = { deviceUid: d.uid, terminalKey: key },
    peers = connections.get(tid(terminal)) ?? [];
  const display = (items: typeof peers, emptyState: string) =>
    items
      .map(
        (p) => `${p.conductor} -> ${p.peer ? label(p.peer) : "Unterminated"}`,
      )
      .sort(compare)
      .join("; ") || emptyState;
  const local = peers.filter(
    (p) =>
      p.peer &&
      d.location !== undefined &&
      devices.get(p.peer.deviceUid)?.location === d.location,
  );
  const remote = peers.filter((p) => !local.includes(p));
  rows.push({
    key: tid(terminal),
    cells: [
      d.designation,
      d.location ?? "",
      key,
      reportDescription(
        type.terminals.find((t) => t.key === key)?.description,
      ) ?? "",
      display(local, "No same-location connections"),
      display(remote, "No other / unspecified location connections"),
      peers.length ? "Terminated" : "Unconnected",
    ],
    deviceUids: [
      d.uid,
      ...peers.flatMap((p) => (p.peer ? [p.peer.deviceUid] : [])),
    ],
  });
}
export function documentationTerminals<T>(context: DocumentationContext<T>) {
  const { selected, types, request, table } = context;
  for (const d of selected) {
    const type = types.get(d.typeId)!;
    // Explicit selector supports any device. Automatic terminal plans use declared categories or resolved strip profiles.
    if (
      !request.device &&
      !request.filter?.devices &&
      type.category !== "terminal-strip" &&
      symbolProfile(type) !== "thermite:terminal-strip"
    )
      continue;
    const keys = type.terminalOrder ?? type.terminals.map((t) => t.key);
    for (const key of keys) {
      appendTerminalRow(d, type, key, context);
    }
  }
  return table(
    request.device
      ? `${selected[0]!.designation} terminal plan`
      : "Terminal plans",
    [
      "Device",
      "Location",
      "Terminal",
      "Description",
      "Same location connections",
      "Other / unspecified location connections",
      "State",
    ],
    [0.1, 0.13, 0.09, 0.14, 0.23, 0.23, 0.08],
    [
      "Lists every terminal, including unconnected terminals and explicit jumpers. Internal continuity is never inferred.",
      "Terminals follow the authored order where specified. Location groups do not assert installation sides.",
    ],
  );
}
