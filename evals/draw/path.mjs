// Read exact straight conductor vertices from SVG path syntax. Curves are not
// approximated into fake short jogs. Browser transforms are applied afterwards.
export function straightPath(d) {
  const tokens =
    d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [];
  let i = 0,
    cmd = "",
    x = 0,
    y = 0;
  const points = [];
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) cmd = tokens[i++];
    if (!["M", "m", "L", "l", "H", "h", "V", "v"].includes(cmd)) return null;
    if (cmd.toUpperCase() === "M" && points.length) return null;
    const relative = cmd === cmd.toLowerCase(),
      kind = cmd.toUpperCase();
    const a = Number(tokens[i++]);
    if (!Number.isFinite(a)) return null;
    if (kind === "H") x = relative ? x + a : a;
    else if (kind === "V") y = relative ? y + a : a;
    else {
      const b = Number(tokens[i++]);
      if (!Number.isFinite(b)) return null;
      x = relative ? x + a : a;
      y = relative ? y + b : b;
    }
    points.push({ x, y });
    if (kind === "M") cmd = relative ? "l" : "L";
  }
  return points;
}
