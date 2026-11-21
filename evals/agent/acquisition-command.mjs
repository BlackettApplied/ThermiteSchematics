// Recognize literal read-only fetches, not arbitrary shell programs.
export function shellWords(
  text,
  { literal = false, escapeBackslash = true } = {},
) {
  const words = [];
  let word = "",
    quote = null,
    escaped = false,
    active = false,
    start = 0;
  const flush = (end) => {
    if (active) {
      words.push(
        literal ? { value: word, literal: text.slice(start, end) } : word,
      );
      word = "";
      active = false;
    }
  };
  const pushControl = (i) => {
    const c = text[i];
    const descriptor =
      c === ">" && /^\d+$/.test(word) && text.slice(start, i) === word
        ? word
        : "";
    if (descriptor) {
      word = "";
      active = false;
    } else flush(i);
    // Keep a descriptor duplication in one token. Its ampersand does not
    // end the command or put it in the background.
    const next = text[i + 1];
    const value = c + (next === c || (c === ">" && next === "&") ? next : "");
    const spelling = descriptor + value;
    words.push(
      literal ? { value, literal: spelling, control: true } : spelling,
    );
    return i + value.length - 1;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (!active && !/\s/.test(c)) start = i;
    if (escaped) {
      word += c;
      escaped = false;
      active = true;
      continue;
    }
    if (quote) {
      if (c === quote) quote = null;
      else if (escapeBackslash && c === "\\" && quote === '"') escaped = true;
      else {
        if (quote === '"' && (c === "`" || (c === "$" && text[i + 1] === "(")))
          return null;
        word += c;
      }
      continue;
    }
    if (c === "`" || (c === "$" && text[i + 1] === "(")) return null;
    if (c === "\n" || c === "\r") {
      flush(i);
      const value = "\n";
      words.push(literal ? { value, literal: value, control: true } : value);
      continue;
    }
    if (escapeBackslash && c === "\\") {
      escaped = true;
      active = true;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      active = true;
      continue;
    }
    if (/\s/.test(c)) {
      flush(i);
      continue;
    }
    if (/[&|;<>()]/.test(c)) {
      i = pushControl(i);
      continue;
    }
    word += c;
    active = true;
  }
  if (quote || escaped) return null;
  flush(text.length);
  return words;
}
export function literalShellBody(input) {
  return input
    .trim()
    .replace(
      /^(?:\/[\w/.-]+\/)?(?:zsh|bash|sh)\s+-(?:lc|c)\s+(['"])([\s\S]*)\1$/,
      "$2",
    )
    .replace(
      /^(?:\/[\w/.-]+\/)?(?:zsh|bash|sh)\s+-(?:lc|c)\s+([\w./-]+)$/,
      "$1",
    );
}
