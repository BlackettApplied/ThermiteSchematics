// Browser-only measurement helpers; dependencies arrive explicitly from the caller.
export function bind(c, name) {
  const { parameters, dependencies } = c.h.bindings[name],
    fn = c.h[name];
  return (...args) => {
    const fields = Object.fromEntries(dependencies.map((n) => [n, c[n]]));
    if (!parameters.length) return fn(fields);
    fields[parameters.at(-1)] = args[parameters.length - 1];
    return fn(...parameters.slice(0, -1).map((_, i) => args[i]), fields);
  };
}
export function install(c, names) {
  for (const name of names) c[name] = c.h.bind(c, name);
}
