// Bun on macOS keeps Intl's default locale even when LC_ALL changes. Configure
// explicit JavaScript defaults in THIS disposable worker, before engine imports,
// rather than pretending two identical effective locales exercise the boundary.
// Explicit locales authored by the engine are always preserved.
export function configureLocale(requested) {
  const locale =
    requested === "C" ? "en-US" : requested.split(".")[0].replaceAll("_", "-");
  for (const name of [
    "Collator",
    "NumberFormat",
    "DateTimeFormat",
    "PluralRules",
    "RelativeTimeFormat",
    "ListFormat",
    "DisplayNames",
    "Segmenter",
  ]) {
    if (typeof Intl[name] !== "function") continue;
    Intl[name] = new Proxy(Intl[name], {
      construct(target, args, receiver) {
        if (args[0] === undefined) args[0] = locale;
        return Reflect.construct(target, args, receiver);
      },
      apply(target, receiver, args) {
        if (args[0] === undefined) args[0] = locale;
        return Reflect.apply(target, receiver, args);
      },
    });
  }
  for (const [prototype, methods, index] of [
    [String.prototype, ["localeCompare"], 1],
    [String.prototype, ["toLocaleLowerCase", "toLocaleUpperCase"], 0],
    [Number.prototype, ["toLocaleString"], 0],
    [
      Date.prototype,
      ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"],
      0,
    ],
  ])
    for (const method of methods) {
      const original = prototype[method];
      Object.defineProperty(prototype, method, {
        configurable: true,
        writable: true,
        value: function (...args) {
          if (args[index] === undefined) args[index] = locale;
          return Reflect.apply(original, this, args);
        },
      });
    }
  return locale;
}
