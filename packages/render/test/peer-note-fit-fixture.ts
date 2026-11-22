import { printableTextMetrics } from "../src/text-metrics.js";
import type { RenderedSheet } from "../src/packet/types.js";
import type { PeerReference } from "../src/packet/peer-reference-ink.js";

export function peerNoteFitFixture(
  form: "full" | "compact" | "locator" | "wrapped",
) {
  const sheet: RenderedSheet = {
    number: 1,
    view: {
      format: "documentation-view/0.1",
      kind: "circuit",
      title: "Peer note fit",
    },
    references: [],
    continuations: [],
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="215.9mm" height="279.4mm" viewBox="0 0 215.9 279.4" data-sheet="1"></svg>',
  };
  const first: PeerReference = {
    kind: "conductor-peer",
    identity: ["A1", "W-901", "B1"],
    owner: { x: 10, y: 10, w: 0, h: 0 },
    value: "W-901 · SRC1.L3 → XT-SUBASSEMBLY.5/L3 04.D3",
    compact: "→ XT-SUBASSEMBLY.5/L3 04.D3",
    destination: "04.D3",
  };
  const advance = (s: string) => printableTextMetrics(s, 2.5).advance;
  const field = {
    x: 10,
    y: 10,
    w: {
      full: advance(first.value) + 2.1,
      compact: advance(first.compact) + 2.1,
      locator: advance("→ 04.D3") + 2.1,
      wrapped: advance(first.compact) - 0.25,
    }[form],
    h: form === "wrapped" ? 24 : 4.7,
  };
  return {
    sheet,
    field,
    entries:
      form === "wrapped"
        ? [
            first,
            {
              ...first,
              identity: ["A2", "W-902", "B1"],
              owner: { ...first.owner, y: 31 },
              value: first.value.replace("901", "902"),
            },
          ]
        : [first],
  };
}
