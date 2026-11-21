import {
  compact,
  elementKey,
  identityValue,
  terminalId,
  terminalName,
} from "./tranche4-source.mjs";
import { finding, painted } from "./review-geometry.mjs";
function cardMatch(pending, right, identity, end, ir) {
  // nativeConductors4 guarantees exactly two ends; the opposite index preserves self-loops.
  const candidates = pending
    .map((w) => ({
      w,
      // nativeConductors4 requires exactly two ends; the opposite index also preserves self-loops.
      peer: w.ends[
        1 - w.ends.findIndex((t) => terminalId(t) === terminalId(end))
      ],
    }))
    .map((x) => ({
      ...x,
      destination: compact(
        x.peer ? terminalName(ir, x.peer) : "unterminated (spare)",
      ),
    }))
    .filter((x) => right.startsWith(x.destination));
  return (
    candidates.find((x) => identityValue(identity, x.w)) ??
    candidates.find((x) => x.w.names.some((n) => compact(n) === identity))
  );
}
export function cardIdentityFindings(card, catalog, ir) {
  const fail = (kind, extra = {}) =>
    finding(kind, card, { surface: "card", ...extra });
  if (
    !Array.isArray(card.conductors) ||
    !card.conductors.length ||
    !card.terminalId?.deviceUid ||
    !card.terminalId?.terminalKey ||
    !ir.terminals?.some((t) => terminalId(t.id) === terminalId(card.terminalId))
  )
    return [fail("conductor-card-source-unavailable")];
  const own = card.conductors.map((e) => catalog.get(elementKey(e)));
  if (
    own.some(
      (w) =>
        !w ||
        !w.ends.some((t) => terminalId(t) === terminalId(card.terminalId)),
    )
  )
    return [fail("conductor-card-native-incidence-disagrees")];
  const text = card.texts.filter(
    (t) => painted(t) && !card.headingElements.includes(t.element),
  );
  const pieces = text
      .map((t) => t.text)
      .join("\n")
      .split(/→|->/u),
    result = [];
  if (pieces.length !== own.length + 1)
    return [
      fail("conductor-card-painted-rows-unavailable", {
        expected: own.length,
        arrows: pieces.length - 1,
      }),
    ];
  let identity = compact(pieces[0]);
  const pending = own.slice();
  for (let i = 1; i < pieces.length; i++) {
    const right = compact(pieces[i]);
    const match = cardMatch(pending, right, identity, card.terminalId, ir);
    if (!match) {
      result.push(
        fail("conductor-card-native-identity-disagrees", { actual: identity }),
      );
      break;
    }
    if (!identityValue(identity, match.w))
      result.push(
        fail("conductor-primary-alias-missing", {
          conductor: match.w.key,
          actual: identity,
          primary: match.w.primary,
        }),
      );
    pending.splice(pending.indexOf(match.w), 1);
    identity = right.slice(match.destination.length);
  }
  if (pending.length || identity)
    result.push(
      fail("conductor-card-row-reconciliation-failed", {
        remaining: pending.map((w) => w.key),
        extra: identity,
      }),
    );
  return result;
}
