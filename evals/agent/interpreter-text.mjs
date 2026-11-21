// Distinguish executable API references from strings written or printed as data.
export function interpreterText(body) {
  const input = body.replace(/\\{2,}["']/g, (match) => match.at(-1));
  const literals =
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;
  let code = "",
    last = 0,
    module = false,
    child = false;
  const strings = [];
  for (const match of input.matchAll(literals)) {
    code += input.slice(last, match.index);
    const literal = match[0],
      value = literal.slice(1, -1);
    if (/^["'`]/.test(literal)) {
      module ||=
        /\b(?:require|import)\(\s*$/.test(code) &&
        /^(?:node:)?(?:http|https|net)$/.test(value);
      module ||=
        /\b(?:from|import)\s*$/.test(code) &&
        /^node:(?:http|https|net)$/.test(value);
      child ||=
        /\b(?:spawn(?:sync)?|exec(?:sync)?|subprocess\.run|popen|system)\(\s*(?:\[)?\s*$/i.test(
          code,
        ) && /^(?:curl|wget|gh|git|nc|ssh|scp|rsync)(?:\s|$)/.test(value);
      strings.push({
        value,
        start: match.index,
        end: match.index + literal.length,
      });
      code += '""' + " ".repeat(literal.length - 2);
    } else code += " ".repeat(literal.length);
    last = match.index + literal.length;
  }
  return { code: code + input.slice(last), module, child, strings, input };
}
