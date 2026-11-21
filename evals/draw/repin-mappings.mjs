import assert from "node:assert/strict";
import { isDeepStrictEqual as equal } from "node:util";

export function mapped(pair, field, a, b) {
  if (a === b) {
    assert(pair[field] === undefined, `Unused rename mapping: ${field}`);
    return;
  }
  assert(
    equal(pair[field], { from: a, to: b }),
    `Literal ${field} rename mapping required`,
  );
}
export function renameTextChanged(pair, before, after) {
  const a = before.facts.text,
    b = after.facts.text;
  mapped(pair, "text", a, b);
  return a !== b;
}
