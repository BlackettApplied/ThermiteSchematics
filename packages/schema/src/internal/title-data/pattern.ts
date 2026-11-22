export type PatternToken =
  | { readonly literal: string }
  | {
      readonly token: "drawingBase" | "sheetNumber" | "sheetTotal";
      readonly padding: number;
    };
/** No evaluation or substitution language beyond these three closed tokens. */
export function parsePattern(
  pattern: string,
): readonly PatternToken[] | undefined {
  const tokens: PatternToken[] = [];
  let literal = "";
  const flush = () => {
    if (literal) tokens.push({ literal });
    literal = "";
  };
  for (let i = 0; i < pattern.length;) {
    if (pattern.startsWith("{{", i) || pattern.startsWith("}}", i)) {
      literal += pattern[i];
      i += 2;
    } else if (pattern[i] === "{") {
      const end = pattern.indexOf("}", i + 1);
      if (end < 0) return undefined;
      const match = /^(drawingBase|sheetNumber|sheetTotal)(?::(02|03))?$/.exec(
        pattern.slice(i + 1, end),
      );
      if (!match || (match[1] === "drawingBase" && match[2])) return undefined;
      flush();
      tokens.push({
        token: match[1] as "drawingBase" | "sheetNumber" | "sheetTotal",
        padding: match[2] ? Number(match[2]) : 0,
      });
      i = end + 1;
    } else if (pattern[i] === "}") return undefined;
    else {
      literal += pattern[i];
      i++;
    }
  }
  flush();
  return tokens;
}
