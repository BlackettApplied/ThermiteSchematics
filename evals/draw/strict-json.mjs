import assert from "node:assert/strict";
export function strictJsonBytes(bytes) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    value = JSON.parse(text),
    stack = [];
  // Native parsing validates grammar; this bounded-stack scan catches duplicate
  // decoded keys without constructing a second AST for 20 MB measurement reports.
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{" || ch === "[")
      stack.push({ object: ch === "{", keys: new Set(), key: true });
    else if (ch === "}" || ch === "]") stack.pop();
    else if (ch === "," && stack.at(-1)?.object) stack.at(-1).key = true;
    else if (ch === '"') {
      const start = i;
      for (i++; i < text.length; i++) {
        if (text[i] === "\\") i++;
        else if (text[i] === '"') break;
      }
      const top = stack.at(-1);
      if (top?.object && top.key) {
        const key = JSON.parse(text.slice(start, i + 1));
        assert(!top.keys.has(key), "Duplicate JSON key: " + key);
        top.keys.add(key);
        top.key = false;
      }
    }
  }
  return value;
}
