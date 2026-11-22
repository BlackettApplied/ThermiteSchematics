import { required } from "../presentation/util.js";
import { stripTerminalKey } from "./terminal-strip-facts.js";
import {
  fragmentAnchors,
  type StripFragment,
  type StripLabel,
} from "./terminal-strip-layout.js";

interface BridgeEnd {
  key: string;
  centreY: number;
  y: number;
}
interface BridgeApproach {
  uid: string;
  number: number;
  lane: number;
  from: BridgeEnd;
  to: BridgeEnd;
}
export interface StripApproaches {
  bridges: BridgeApproach[];
  rightStubs: ReadonlyMap<StripLabel, number>;
}

function bridgeLanes(part: StripFragment) {
  const anchors = new Map(fragmentAnchors(part).map((a) => [a.key, a]));
  return part.model.bridges
    .flatMap((j, index) => {
      const a = anchors.get(stripTerminalKey(j.endpoints[0].terminal)),
        b = anchors.get(stripTerminalKey(j.endpoints[1].terminal));
      return a && b
        ? [
            {
              uid: j.uid,
              number: index + 1,
              span: Math.abs(a.y - b.y),
              from: { key: a.key, centreY: a.y, y: a.y },
              to: { key: b.key, centreY: b.y, y: b.y },
            },
          ]
        : [];
    })
    .sort((a, b) => a.span - b.span || a.number - b.number)
    .map((bridge, index) => ({ ...bridge, lane: index + 1 }));
}

function approachesByTerminal(bridges: readonly BridgeApproach[]) {
  const rows = new Map<string, { terminal: BridgeEnd; rises: boolean }[]>();
  for (const { from, to } of bridges) {
    for (const [terminal, rises] of [
      [from, to.centreY <= from.centreY],
      [to, from.centreY < to.centreY],
    ] as const) {
      const ends = rows.get(terminal.key) ?? [];
      ends.push({ terminal, rises });
      rows.set(terminal.key, ends);
    }
  }
  return rows;
}

/** Order the right-edge approaches from upward bridges through caption stubs
 * to downward bridges. Within each direction the wider bridge lands beyond
 * the nearer bend, so two bridges can share the terminal without sharing ink.
 * The terminal rectangle, caption baselines and fragment fit stay fixed. */
export function stripApproaches(part: StripFragment): StripApproaches {
  const bridges = bridgeLanes(part);
  const local = new Set(bridges.map((b) => b.uid));
  const rows = approachesByTerminal(bridges);
  const rightStubs = new Map<StripLabel, number>();
  for (const row of part.rows) {
    const ends = rows.get(row.terminal.key);
    if (!ends) continue;
    const stubs = (row.sides[1] ?? []).filter(
      (label) => !label.bridge || !local.has(label.bridge.uid),
    );
    // Keep the centres inside the eight millimetre terminal body.
    const count = ends.length + stubs.length;
    const step = Math.min(1.8, 6.4 / Math.max(1, count - 1));
    const centre = required(ends[0], "Missing bridge approach").terminal
      .centreY;
    let slot = -(count - 1) / 2;
    for (const end of ends.filter((end) => end.rises))
      end.terminal.y = centre + step * slot++;
    for (const stub of stubs) rightStubs.set(stub, centre + step * slot++);
    for (const end of ends.filter((end) => !end.rises).reverse())
      end.terminal.y = centre + step * slot++;
  }
  return { bridges: bridges.sort((a, b) => a.number - b.number), rightStubs };
}

/** Keep the stub in its landing lane through the bridge gutter, then
 * fan towards the unchanged caption baseline outside the last bridge track. */
export function stripStubElbow(
  end: number,
  index: number,
  count: number,
  landing: number,
  target: number,
) {
  const fraction = (index + 1) / (count + 1);
  return end - 1 - 7 * (target < landing ? 1 - fraction : fraction);
}
