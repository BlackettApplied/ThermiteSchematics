// Cable rows paint their conductor first, then the open-end X paths. Endpoint
// captions are direct row children, while terminated identities have a tag group.
export function cableCaptionMarks(c) {
  const { root, ids, texts, point, visible, strokeInk, sx, sy } = c;
  const textByElement = new Map(texts.map((t) => [t.element, t]));
  return [
    ...root.querySelectorAll("g[data-cable-uid][data-conductor-id]"),
  ].flatMap((row) => {
    const [conductor, ...paths] = row.querySelectorAll(":scope > path");
    if (!conductor || !paths.length) return [];
    const route = visible(conductor);
    if (!route) return [];
    const middle = route.b.x + route.b.w / 2;
    const marks = paths.flatMap((path) => {
      const v = visible(path),
        m = path.getScreenCTM();
      if (!v || !strokeInk(path, v.clip, m).length) return [];
      const css = getComputedStyle(path);
      const pad = Number.parseFloat(css.strokeWidth) / 2;
      const x = pad * Math.hypot(m.a, m.c) * sx;
      const y = pad * Math.hypot(m.b, m.d) * sy;
      return [
        {
          element: ids.get(path),
          side: v.b.x + v.b.w / 2 < middle ? "start" : "end",
          bbox: {
            x: v.b.x - x,
            y: v.b.y - y,
            w: v.b.w + 2 * x,
            h: v.b.h + 2 * y,
          },
        },
      ];
    });
    return [...row.querySelectorAll(":scope > text")].flatMap((e) => {
      const caption = textByElement.get(ids.get(e));
      if (
        !caption?.reviewPainted ||
        !["X UNTERMINATED", "? UNASSIGNED"].includes(caption.text)
      )
        return [];
      const side = e.getAttribute("text-anchor");
      return [
        {
          caption,
          marks: marks.filter((m) => m.side === side),
          cableUid: row.getAttribute("data-cable-uid"),
          conductorId: row.getAttribute("data-conductor-id"),
          side,
        },
      ];
    });
  });
}
