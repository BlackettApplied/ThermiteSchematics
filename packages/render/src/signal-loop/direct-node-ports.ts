import type {
  LoopNodeContext,
  LoopPort,
  LoopNodeGeometry,
} from "./direct-types.js";
export function directLoopPorts(
  uid: string,
  index: number,
  ordered: string[],
  captionWidth: number,
  w: number,
  h: number,
  header: number,
  context: LoopNodeContext,
) {
  const { physicalEdges, assemblies, vertical, key } = context;
  const list: LoopPort[] = ordered.flatMap((terminal, i) =>
    (["in", "out"] as const).flatMap((side) => {
      const has = physicalEdges.some(
        (e) =>
          key(e.ends[side === "out" ? 0 : 1]) ===
          key({ deviceUid: uid, terminalKey: terminal }),
      );
      if (!has) return [];
      const suppressed = assemblies.some((a) =>
        a.assembly!.members.some(
          (m) =>
            key(m.ends[side === "out" ? 0 : 1]) ===
            key({ deviceUid: uid, terminalKey: terminal }),
        ),
      );
      const id = `n${index}_${side}_${i}`;
      return [
        {
          id,
          terminal,
          side,
          suppressed,
          x: vertical ? captionWidth + 9 + i * 14 : side === "in" ? 0 : w,
          y: vertical ? (side === "in" ? 0 : h) : header + 5 + i * 10,
        },
      ];
    }),
  );

  return list;
}

export function appendDirectAssemblyPorts(
  list: LoopPort[],
  geometry: LoopNodeGeometry,
  context: LoopNodeContext,
) {
  const { uid, index, w, h } = geometry;
  const { assemblies, stages, vertical } = context;
  for (const assembly of assemblies)
    for (const side of ["in", "out"] as const) {
      if (assembly.ends[side === "out" ? 0 : 1].deviceUid !== uid) continue;
      if (list.some((p) => p.assembly && p.side === side))
        throw new Error(
          "Only one cable assembly per device face is supported in a loop view.",
        );
      const memberPorts = list.filter(
        (p) =>
          p.side === side &&
          assembly.assembly!.members.some(
            (m) => m.ends[side === "out" ? 0 : 1].terminalKey === p.terminal,
          ),
      );
      if (index !== 0 && index !== stages.length - 1)
        for (const p of memberPorts) {
          if (!list.some((q) => q.terminal === p.terminal && q.side !== p.side))
            list.push({
              ...p,
              id: `${p.id}_unused`,
              side: side === "in" ? "out" : "in",
              x: vertical ? p.x : side === "in" ? w : 0,
              y: vertical ? (side === "in" ? h : 0) : p.y,
              suppressed: false,
              unused: true,
            });
        }
      list.push({
        id: `n${index}_${side}_${assembly.id}`,
        terminal: "",
        side,
        assembly,
        x: vertical
          ? memberPorts.reduce((s, p) => s + p.x, 0) / memberPorts.length
          : side === "in"
            ? 0
            : w,
        y: vertical
          ? side === "in"
            ? 0
            : h
          : memberPorts.reduce((s, p) => s + p.y, 0) / memberPorts.length,
      });
    }
}
