import type { ElectricalIr } from "@thermite/compiler";
import {
  svgTree,
  descendants,
  type SvgNode,
} from "../device-legend/svg-tree.js";
import {
  escapeXmlAttribute as attr,
  escapeXmlText as xml,
} from "../svg/escape.js";
import { navigationHash } from "./navigation-identity.js";
import type { Draft } from "./types.js";
import type { NativeOccurrenceSeed } from "./navigation-types.js";
import { generatedSvgInk } from "../device-legend/svg-ink.js";
import { unionInk } from "./rooted-ink.js";
import { required } from "../presentation/util.js";
function serialize(n: SvgNode): string {
  return `<${n.name}${Object.entries(n.attrs)
    .map(([k, v]) => ` ${k}="${attr(v)}"`)
    .join("")}>${xml(n.text)}${n.children.map(serialize).join("")}</${n.name}>`;
}
function circuitTerminals(
  owner: SvgNode,
  fn: ElectricalIr["functions"][number],
  group: string,
  uid: string,
) {
  return descendants(owner)
    .filter(
      (n) =>
        n.attrs["data-terminal-id"] &&
        fn.terminals.some(
          (t) => n.attrs["data-terminal-key"] === t.terminalKey,
        ),
    )
    .flatMap((n) => {
      const marker = n.children.find((c) => c.name === "circle");
      if (!marker) return [];
      const terminalKey = required(
        n.attrs["data-terminal-key"],
        "Circuit terminal key missing",
      );
      const primitiveId = `navigation-terminal-${navigationHash([group, uid, terminalKey])}`;
      marker.attrs.id = primitiveId;
      marker.attrs["data-terminal-key"] = terminalKey;
      marker.attrs["data-device-uid"] = uid;
      return [{ key: terminalKey, primitiveId }];
    });
}

/** Circuit adapter lives at the composition seam; catalog and circuit layout are untouched. */
export function seedCircuitNavigation(
  ir: Readonly<ElectricalIr>,
  drafts: Draft[],
) {
  for (const draft of drafts) {
    const tree = svgTree(draft.content),
      seeds: NativeOccurrenceSeed[] = [];
    const nodes = descendants(tree),
      original = new Map(nodes.map((n) => [n, { ...n.attrs }]));
    const visit = (
      node: SvgNode,
      group: string,
      owner?: SvgNode,
      groupNode?: SvgNode,
    ) => {
      group = node.attrs["data-circuit-group"] ?? group;
      if (node.attrs["data-circuit-group"]) groupNode = node;
      if (node.attrs["data-layout-width"] && node.attrs["data-device-uid"])
        owner = node;
      const key = node.attrs["data-function-key"];
      if (key && owner)
        seeds.push(
          circuitSeed(
            ir,
            node,
            group,
            owner,
            required(groupNode, "Missing circuit group"),
            key,
          ),
        );
      for (const child of node.children) visit(child, group, owner, groupNode);
    };
    for (const n of tree.children) visit(n, "");
    let index = 0;
    draft.content = draft.content.replace(/<(?![/? !])[^>]+>/g, (tag) => {
      const node = required(nodes[index++], "Missing circuit markup node");
      if (/^<([^\s/>]+)/.exec(tag)?.[1] !== node.name)
        throw Error("Circuit navigation start-tag/tree name mismatch");
      const before = required(
        original.get(node),
        "Missing circuit original attributes",
      );
      const additions = Object.entries(node.attrs)
        .filter(([k, v]) => before[k] !== v)
        .map(([k, v]) => ` ${k}="${attr(v)}"`)
        .join("");
      return tag.replace(/\/?>(?=$)/, (end) => additions + end);
    });
    if (index !== nodes.length)
      throw Error("Circuit navigation start-tag/tree count mismatch");
    draft.navigationSeeds = seeds;
  }
  markCircuitBoundaryCopies(drafts);
}

function markCircuitBoundaryCopies(drafts: Draft[]) {
  const groups = new Map<string, NativeOccurrenceSeed[]>();
  for (const d of drafts)
    for (const s of d.navigationSeeds ?? [])
      groups.set(s.logicalKey, [...(groups.get(s.logicalKey) ?? []), s]);
  const primary = new Map<string, string>();
  for (const [key, seeds] of groups) {
    if (seeds.length < 2) continue;
    const endpoints = [
      ...new Set(seeds.flatMap((s) => s.partEndpointKeys ?? [])),
    ].sort();
    // An endpoint unit is source identity, independent of its eventual page.
    primary.set(
      key,
      required(
        endpoints.find((e) => JSON.parse(e)[0] !== "source-unit") ??
          endpoints[0],
        "Missing circuit placement unit",
      ),
    );
  }
  for (const d of drafts)
    d.navigationSeeds = (d.navigationSeeds ?? []).map((seed) => {
      const owner = primary.get(seed.logicalKey);
      return !owner || seed.partEndpointKeys?.includes(owner)
        ? seed
        : {
            ...seed,
            fragmentEndpoints: required(
              seed.partEndpointKeys,
              "Missing circuit boundary endpoints",
            ),
          };
    });
}
function circuitUnitEndpoints(
  group: SvgNode,
  fn: ElectricalIr["functions"][number],
): string[] {
  return descendants(group)
    .filter((n) => n.attrs["data-circuit-conductor"])
    .flatMap((n) => {
      const ends = JSON.parse(n.attrs["data-endpoints"] ?? "[]") as {
        deviceUid: string;
        terminalKey: string;
      }[];
      return ends.flatMap((t, end) =>
        t.deviceUid === fn.id.deviceUid &&
        fn.terminals.some((p) => p.terminalKey === t.terminalKey)
          ? [
              JSON.stringify([
                n.attrs["data-circuit-conductor"],
                end,
                t.terminalKey,
              ]),
            ]
          : [],
      );
    })
    .sort();
}
function circuitSeed(
  ir: Readonly<ElectricalIr>,
  node: SvgNode,
  group: string,
  owner: SvgNode,
  groupNode: SvgNode,
  key: string,
): NativeOccurrenceSeed {
  const uid = required(
    owner.attrs["data-device-uid"],
    "Circuit source owner missing",
  );
  const fn = required(
    ir.functions.find(
      (f) => f.id.deviceUid === uid && f.id.functionKey === key,
    ),
    "Unknown circuit function",
  );
  const logicalKey = JSON.stringify(["circuit-group", group, uid, key]);
  const unitKeys = circuitUnitEndpoints(
    required(groupNode, "Missing circuit group"),
    fn,
  );
  const groupUnits = descendants(required(groupNode, "Missing circuit group"))
    .flatMap((n) => n.attrs["data-circuit-conductor"] ?? [])
    .sort();
  const nativeId = `navigation-native-${navigationHash([logicalKey, groupUnits])}`;
  const scopeId = `navigation-scope-${navigationHash([group, uid, groupUnits])}`;
  owner.attrs.id = scopeId;
  node.attrs.id = nativeId;
  node.attrs["data-navigation-native"] = nativeId;
  const terminals = circuitTerminals(
    owner,
    fn,
    JSON.stringify([group, groupUnits]),
    uid,
  );
  const body = required(
    unionInk(
      generatedSvgInk(
        `<svg viewBox="0 0 ${owner.attrs["data-layout-width"]} ${owner.attrs["data-layout-height"]}">${serialize(node)}</svg>`,
      ).ink,
    ),
    "Circuit function has no measured body",
  );
  return {
    source: fn.id,
    logicalKey,
    nativeId,
    terminalScopeId: scopeId,
    representation: "circuit",
    partEndpointKeys: [
      ...unitKeys,
      ...groupUnits.map((id) => JSON.stringify(["source-unit", id])),
    ],
    terminals,
    body,
  };
}
