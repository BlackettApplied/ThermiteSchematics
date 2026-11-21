import { painted, pointDistance } from "./review-geometry.mjs";

/** A surviving rail name may supply the native source potential. Validate the
 * measured source landing, the rail mark and the native potential together. */
export function survivingRailCaption(g, label, routes, text, ir) {
  return g.texts.find((caption) => {
    const key = caption.labelOwnerKey;
    if (
      caption.labelRole !== "rail" ||
      caption.labelOwnerKind !== "rail" ||
      key?.[0] !== "rail" ||
      key[3] !== "potential" ||
      caption.text !== text ||
      !painted(caption) ||
      caption.appearanceScope !== label.appearanceScope
    )
      return false;
    return routes.some((route) =>
      route.ownedLandings?.some(
        (landing) =>
          landing.end === "source" &&
          landing.anchor &&
          landing.endpoint &&
          pointDistance(landing.anchor, landing.endpoint) <= 0.05 &&
          landing.deviceUid === key[1] &&
          landing.terminal === key[2] &&
          (ir?.potentials ?? []).some(
            (p) =>
              p.name === text &&
              p.netId === route.net &&
              p.terminal.deviceUid === key[1] &&
              p.terminal.terminalKey === key[2],
          ) &&
          g.shapes.some(
            (s) =>
              s.element === landing.anchorElement &&
              s.appearanceScope === caption.appearanceScope &&
              s.symbol?.startsWith("ais:rail-"),
          ),
      ),
    );
  });
}
