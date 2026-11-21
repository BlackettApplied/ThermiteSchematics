import { interpreterText } from "./interpreter-text.mjs";

// Resolve only literal GET API arguments. Unknown options, dynamic expressions,
// concatenations and additional unresolved network calls receive no exemption.
// Returned requests go through exactly the curl URL/header classifier.
export function interpreterFetches(body) {
  if (body === null) return null;
  const { code, strings, input, child } = interpreterText(body);
  if (child) return null;
  const calls = [
    ...code.matchAll(
      /\b(?:fetch|https?\.(?:get|request|connect)|require\(\s*""\s*\)\.get|requests\.(?:get|post|put|patch|delete|head|request|options|session)|(?:urllib(?:\.request|2)?\.)?urlopen|net\.connect|XMLHttpRequest|WebSocket|Bun\.connect|socket)\s*\(\s*/gi,
    ),
  ];
  if (!calls.length) return null;
  const targets = [];
  for (const call of calls) {
    if (call[0].startsWith("require(")) {
      const module = strings.find(
        (s) => s.start >= call.index && s.end < call.index + call[0].length,
      );
      if (!/^(?:node:)?https?$/.test(module?.value ?? "")) return null;
    } else if (
      !/^(?:fetch|https?\.get|requests\.get|(?:urllib(?:\.request|2)?\.)?urlopen)\s*\(/i.test(
        call[0],
      )
    )
      return null;
    const literal = strings.find(
      (s) => s.start === call.index + call[0].length,
    );
    if (
      !literal ||
      !/^\s*\)/.test(input.slice(literal.end)) ||
      !/^https?:\/\//i.test(literal.value) ||
      /\\|\$\{|#\{/.test(literal.value)
    )
      return null;
    targets.push({
      target: literal.value,
      headers: [],
      safe: true,
      shell: true,
      network: true,
    });
  }
  return targets;
}
