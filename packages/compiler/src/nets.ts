import { createHash } from "node:crypto";

import type { ExpansionResult } from "./expansion.js";
import type {
  ConductiveElementId,
  GraphNormalizationResult,
  IrIndexes,
  IrPotential,
} from "./graph.js";
import type { TerminalId } from "./resolution.js";

export interface IrNet {
  id: string;
  terminalIds: TerminalId[];
  conductiveElementIds: ConductiveElementId[];
  potentialUids: string[];
}

export interface NetDerivationResult {
  nets: IrNet[];
  potentials: IrPotential[];
  indexes: IrIndexes;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareTerminalId(left: TerminalId, right: TerminalId): number {
  return (
    compareText(left.deviceUid, right.deviceUid) ||
    compareText(left.terminalKey, right.terminalKey)
  );
}

const conductiveKindOrder: Record<ConductiveElementId["kind"], number> = {
  wire: 0,
  jumper: 1,
  cable_conductor: 2,
};

function compareConductiveElementId(
  left: ConductiveElementId,
  right: ConductiveElementId,
): number {
  const kindOrder =
    conductiveKindOrder[left.kind] - conductiveKindOrder[right.kind];

  if (kindOrder !== 0) {
    return kindOrder;
  }

  if (left.kind === "cable_conductor") {
    const rightConductor = right as Extract<
      ConductiveElementId,
      { kind: "cable_conductor" }
    >;
    return (
      compareText(left.cableUid, rightConductor.cableUid) ||
      compareText(left.conductorId, rightConductor.conductorId)
    );
  }

  return compareText(
    left.uid,
    (right as Extract<ConductiveElementId, { kind: typeof left.kind }>).uid,
  );
}

function terminalKey(id: TerminalId): string {
  return JSON.stringify([id.deviceUid, id.terminalKey]);
}

function netId(terminalIds: readonly TerminalId[]): string {
  const preimage = JSON.stringify(
    terminalIds.map(({ deviceUid, terminalKey }) => [deviceUid, terminalKey]),
  );
  const digest = createHash("sha256").update(preimage, "utf8").digest("hex");
  return `net:sha256:${digest}`;
}

class UnionFind {
  readonly #parent: number[];
  readonly #rank: number[];

  constructor(size: number) {
    this.#parent = Array.from({ length: size }, (_, index) => index);
    this.#rank = Array.from({ length: size }, () => 0);
  }

  find(index: number): number {
    const parent = this.#parent[index]!;

    if (parent !== index) {
      this.#parent[index] = this.find(parent);
    }

    return this.#parent[index]!;
  }

  union(left: number, right: number): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);

    if (leftRoot === rightRoot) {
      return;
    }

    const leftRank = this.#rank[leftRoot]!;
    const rightRank = this.#rank[rightRoot]!;

    if (leftRank < rightRank) {
      this.#parent[leftRoot] = rightRoot;
      return;
    }

    this.#parent[rightRoot] = leftRoot;
    if (leftRank === rightRank) {
      this.#rank[leftRoot] = leftRank + 1;
    }
  }
}

function requiredTerminalIndex(
  terminalIndexByKey: ReadonlyMap<string, number>,
  terminal: TerminalId,
): number {
  const index = terminalIndexByKey.get(terminalKey(terminal));

  if (index === undefined) {
    throw new Error(
      `Conductive graph references an unmaterialized terminal ${terminalKey(terminal)}.`,
    );
  }

  return index;
}

/**
 * Derives every conductive connected component and mechanically attaches declared
 * potentials. Net derivation remains mechanical; the downstream M3 rule stage owns
 * potential conflict and terminal-rating evaluation over the completed IR.
 */
export function deriveProjectNets(
  expansion: ExpansionResult,
  graph: GraphNormalizationResult,
): NetDerivationResult {
  const terminalIds = expansion.terminals
    .map(({ id }) => ({ ...id }))
    .sort(compareTerminalId);
  const terminalIndexByKey = new Map(
    terminalIds.map((terminal, index) => [terminalKey(terminal), index]),
  );
  const components = new UnionFind(terminalIds.length);

  for (const { value: endpoints } of graph.indexes
    .terminalIdsByConductiveElement) {
    components.union(
      requiredTerminalIndex(terminalIndexByKey, endpoints[0]),
      requiredTerminalIndex(terminalIndexByKey, endpoints[1]),
    );
  }

  const terminalIdsByRoot = new Map<number, TerminalId[]>();
  for (const [index, terminal] of terminalIds.entries()) {
    const root = components.find(index);
    const members = terminalIdsByRoot.get(root) ?? [];
    members.push(terminal);
    terminalIdsByRoot.set(root, members);
  }

  const conductiveElementIdsByRoot = new Map<number, ConductiveElementId[]>();
  for (const { key: element, value: endpoints } of graph.indexes
    .terminalIdsByConductiveElement) {
    const root = components.find(
      requiredTerminalIndex(terminalIndexByKey, endpoints[0]),
    );
    const members = conductiveElementIdsByRoot.get(root) ?? [];
    members.push({ ...element });
    conductiveElementIdsByRoot.set(root, members);
  }

  const nets: IrNet[] = [...terminalIdsByRoot].map(([root, members]) => ({
    id: netId(members),
    terminalIds: members,
    conductiveElementIds: (conductiveElementIdsByRoot.get(root) ?? []).sort(
      compareConductiveElementId,
    ),
    potentialUids: [],
  }));
  nets.sort((left, right) => compareText(left.id, right.id));

  const netByTerminalKey = new Map<string, IrNet>();
  for (const net of nets) {
    for (const terminal of net.terminalIds) {
      netByTerminalKey.set(terminalKey(terminal), net);
    }
  }

  const potentials: IrPotential[] = graph.potentials.map((potential) => {
    const net = netByTerminalKey.get(terminalKey(potential.terminal));

    if (net === undefined) {
      throw new Error(
        `Potential ${potential.uid} references an unmaterialized terminal ${terminalKey(potential.terminal)}.`,
      );
    }

    net.potentialUids.push(potential.uid);
    return {
      ...potential,
      terminal: { ...potential.terminal },
      electrical: { ...potential.electrical },
      netId: net.id,
    };
  });

  for (const net of nets) {
    net.potentialUids.sort(compareText);
  }
  potentials.sort((left, right) => compareText(left.uid, right.uid));

  return {
    nets,
    potentials,
    indexes: {
      ...graph.indexes,
      netIdByTerminal: terminalIds.map((terminal) => ({
        key: { ...terminal },
        value: netByTerminalKey.get(terminalKey(terminal))!.id,
      })),
    },
  };
}
