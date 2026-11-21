export function points(path: string) {
  return [...path.matchAll(/[ML] ([\d.-]+) ([\d.-]+)/gu)].map((m) => ({
    x: +m[1]!,
    y: +m[2]!,
  }));
}
export function lengths(source: readonly { x: number; y: number }[]) {
  const turns: { x: number; y: number }[] = [];
  for (const p of source) {
    const a = turns.at(-2),
      b = turns.at(-1);
    if (
      a &&
      b &&
      ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y))
    )
      turns.pop();
    turns.push(p);
  }
  return turns
    .slice(1)
    .map((p, i) => Math.hypot(p.x - turns[i]!.x, p.y - turns[i]!.y));
}
