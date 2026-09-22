import type { ElkNode } from "elkjs/lib/elk-api.js";
import type { SignalLoopViewRequest, selectSignalLoop } from "./signal-loop.js";
import { escapeXmlText, escapeXmlAttribute } from "./svg/escape.js";

/** Presentation membership is explicit; location strings never imply nesting. */
export function drawEnclosures(
  graph: ElkNode,
  selected: ReturnType<typeof selectSignalLoop>,
  specs: NonNullable<SignalLoopViewRequest["enclosures"]>,
  vertical: boolean,
) {
  const n = (v: number) => String(Number(v.toFixed(3)));
  const occupied = new Set<string>(),
    labels = new Set<string>();
  const nodes = new Map(
    (graph.children ?? []).map((node) => [
      selected.stages[Number(node.id.slice(1))]!,
      node,
    ]),
  );
  const resolve = (name: string) => {
    const matches = [...selected.devices.values()].filter(
      (d) => d.uid === name || d.designation === name,
    );
    if (matches.length !== 1 || !nodes.has(matches[0]!.uid))
      throw new Error(
        `Enclosure device ${JSON.stringify(name)} is not uniquely present in this view.`,
      );
    return matches[0]!.uid;
  };
  const boxes = specs.map((spec) => {
    const members = spec.devices
      .map(resolve)
      .sort((a, b) => selected.stages.indexOf(a) - selected.stages.indexOf(b));
    if (
      new Set(members).size !== members.length ||
      members.some((uid) => occupied.has(uid)) ||
      labels.has(spec.label)
    )
      throw new Error(
        "Enclosures need unique names and disjoint device membership.",
      );
    const first = selected.stages.indexOf(members[0]!);
    if (members.some((uid, i) => selected.stages[first + i] !== uid))
      throw new Error(
        "Enclosure devices must form a contiguous section of the signal chain.",
      );
    members.forEach((uid) => occupied.add(uid));
    labels.add(spec.label);
    const wall =
      spec.wallDevice === undefined ? undefined : resolve(spec.wallDevice);
    if (
      wall &&
      ((wall !== members[0] && wall !== members.at(-1)) ||
        members.length < 2 ||
        selected.types.get(selected.devices.get(wall)!.typeId)!.symbol !==
          "thermite:bulkhead-connector")
    )
      throw new Error(
        "A wall device must be the first or last member and declare a bulkhead-connector profile, alongside interior devices.",
      );
    const selectedNodes = members.map((uid) => nodes.get(uid)!);
    const points = selectedNodes.flatMap((node) => [
      { x: node.x!, y: node.y! },
      { x: node.x! + node.width!, y: node.y! + node.height! },
    ]);
    const ids = new Set(
      selectedNodes.flatMap((node) => node.ports?.map((p) => p.id) ?? []),
    );
    for (const edge of graph.edges ?? [])
      if (
        edge.sources.every((id) => ids.has(id)) &&
        edge.targets.every((id) => ids.has(id))
      ) {
        for (const section of edge.sections ?? [])
          points.push(
            section.startPoint,
            ...(section.bendPoints ?? []),
            section.endPoint,
          );
        for (const label of edge.labels ?? [])
          points.push(
            { x: label.x!, y: label.y! },
            { x: label.x! + label.width!, y: label.y! + label.height! },
          );
      }
    let x = Math.min(...points.map((p) => p.x)) - 8,
      y = Math.min(...points.map((p) => p.y)) - 16;
    let right = Math.max(...points.map((p) => p.x)) + 8,
      bottom = Math.max(...points.map((p) => p.y)) + (vertical ? 16 : 8);
    if (wall) {
      const node = nodes.get(wall)!;
      if (wall === members[0]) {
        if (vertical) y = node.y! + node.height! / 2;
        else x = node.x! + node.width! / 2;
      } else {
        if (vertical) bottom = node.y! + node.height! / 2;
        else right = node.x! + node.width! / 2;
      }
    }
    const width = right - x,
      height = bottom - y;
    if (
      ![x, y, width, height].every(Number.isFinite) ||
      width <= 0 ||
      height <= 0 ||
      [...spec.label].length * 2.4 > width - 8
    )
      throw new Error(
        "Enclosure label or boundary cannot fit without clipping.",
      );
    for (const [uid, node] of nodes) {
      const intersects =
        node.x! < right - 0.01 &&
        node.x! + node.width! > x + 0.01 &&
        node.y! < bottom - 0.01 &&
        node.y! + node.height! > y + 0.01;
      if (!members.includes(uid) && intersects)
        throw new Error(
          "Enclosure boundary would contain an unassigned device.",
        );
      if (
        members.includes(uid) &&
        uid !== wall &&
        (node.x! < x ||
          node.y! < y ||
          node.x! + node.width! > right ||
          node.y! + node.height! > bottom)
      )
        throw new Error("An interior device crosses the enclosure boundary.");
    }
    return {
      x,
      y,
      width,
      height,
      members,
      wall,
      label: spec.label,
      labelAtBottom: vertical && wall !== members.at(-1),
    };
  });
  for (const [i, a] of boxes.entries())
    for (const b of boxes.slice(i + 1))
      if (
        a.x < b.x + b.width &&
        b.x < a.x + a.width &&
        a.y < b.y + b.height &&
        b.y < a.y + a.height
      )
        throw new Error("Enclosure boundaries overlap; use a different view.");
  const minX = Math.min(0, ...boxes.map((b) => b.x)),
    minY = Math.min(0, ...boxes.map((b) => b.y));
  return {
    minX,
    minY,
    width: Math.max(graph.width!, ...boxes.map((b) => b.x + b.width)) - minX,
    height: Math.max(graph.height!, ...boxes.map((b) => b.y + b.height)) - minY,
    content: boxes
      .map(
        (
          b,
        ) => `<g data-enclosure="${escapeXmlAttribute(b.label)}" data-member-uids="${escapeXmlAttribute(JSON.stringify(b.members))}"${b.wall ? ` data-wall-device-uid="${escapeXmlAttribute(b.wall)}"` : ""}>
<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.width)}" height="${n(b.height)}" rx="1.5" fill="#f7f9fc" stroke="#7b899a" stroke-width="0.4" stroke-dasharray="3 2"/>
<text x="${n(b.x + 4)}" y="${n(b.labelAtBottom ? b.y + b.height - 5 : b.y + 6)}" font-family="Arial, Helvetica, sans-serif" font-size="3.1" font-weight="700" fill="#344054">${escapeXmlText(b.label)}</text></g>`,
      )
      .join("\n"),
  };
}
