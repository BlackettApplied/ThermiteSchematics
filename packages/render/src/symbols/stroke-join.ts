type Point = readonly [number, number];

function normal(a: Point, b: Point): Point {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = Math.hypot(dx, dy);
  return length ? [-dy / length, dx / length] : [0, 0];
}

/** SVG's default miter limit is four half-widths. Excess joins bevel. */
export function strokeMiters(
  points: readonly Point[],
  halfStroke: number,
): Point[] {
  return points.flatMap((join, i) => {
    const before = points[i - 1],
      after = points[i + 1];
    if (!before || !after) return [];
    const [x, y] = join;
    const a = normal(before, join),
      b = normal(join, after);
    const scale = halfStroke / (1 + a[0] * b[0] + a[1] * b[1]);
    const dx = scale * (a[0] + b[0]),
      dy = scale * (a[1] + b[1]);
    return Math.hypot(dx, dy) <= 4 * halfStroke
      ? ([
          [x - dx, y - dy],
          [x + dx, y + dy],
        ] as const)
      : [];
  });
}
