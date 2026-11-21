import { appendJsonPointer } from "../../json-pointer.js";
import type { JsonValue } from "../../parser.js";
import { Issues, isObject } from "./validation-common.js";

// Plain comparisons such as A<B and C>D are not tags. Attributes must have
// tag syntax (or a known HTML boolean attribute), rather than arbitrary prose.
const tag =
  /<\/?[A-Za-z][A-Za-z0-9:_.-]*(?:\s+(?:[A-Za-z_:][A-Za-z0-9:_.-]*\s*=\s*(?:"[^"<>]*"|'[^'<>]*'|[^\s"'=<>`]+)|(?:disabled|checked|selected|multiple|required|autofocus|readonly|hidden)\b))*\s*\/?>/u;
export function checkPlainText(
  value: string,
  pointer: string,
  issues: Issues,
): void {
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    if (
      /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(ch) ||
      (cp >= 0xd800 && cp <= 0xdfff)
    ) {
      issues.add(
        "R005",
        pointer,
        `Title field ${pointer} contains forbidden code point U+${cp.toString(16).toUpperCase()}.`,
        "forbidden-code-point",
      );
      return;
    }
  }
  if (tag.test(value))
    issues.add(
      "E013",
      pointer,
      "Title text must be plain text, without markup.",
    );
}
export function visitStrings(
  value: JsonValue,
  pointer: string,
  visitor: (text: string, pointer: string) => void,
): void {
  if (typeof value === "string") visitor(value, pointer);
  else if (Array.isArray(value))
    value.forEach((v, i) =>
      visitStrings(v, appendJsonPointer(pointer, i), visitor),
    );
  else if (isObject(value))
    for (const [key, v] of Object.entries(value))
      visitStrings(v, appendJsonPointer(pointer, key), visitor);
}
