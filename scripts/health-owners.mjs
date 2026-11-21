const fileOf = (key) => key.split("#", 1)[0];
function contains(metrics, outer, inner) {
  const a = metrics.bodyRanges?.[outer],
    b = metrics.bodyRanges?.[inner];
  return (
    outer !== inner &&
    fileOf(outer) === fileOf(inner) &&
    a &&
    b &&
    a[0] <= b[0] &&
    a[1] >= b[1]
  );
}
// Resolve current owners from authenticated content candidates, never display
// locators. Reserve enclosing bodies first; then descend through nested owners.
// Equal-content ties at one current location prefer its base ancestor.
export function currentOwners(rows, current, base) {
  const owners = new Map();
  let pending = [...rows];
  while (pending.length) {
    const eligible = pending.filter(
      (row) =>
        !pending.some(
          (other) =>
            other.id === row.id && contains(current, other.key, row.key),
        ),
    );
    const winner = eligible.find(
      (row) =>
        !eligible.some(
          (other) =>
            other.key === row.key &&
            other.common === row.common &&
            other.added === row.added &&
            other.exact === row.exact &&
            contains(base, other.from, row.from),
        ),
    );
    if (!winner) break;
    owners.set(winner.key, winner.id);
    pending = pending.filter(
      (row) => row.id !== winner.id && row.key !== winner.key,
    );
  }
  return owners;
}
