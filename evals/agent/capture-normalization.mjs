// Canonicalize the wall-clock slot while retaining which CLI template appeared.
// A reset crossing UTC midnight includes a date; never turn it into time-only.
export function normalizeUsageToday(text) {
  return text.replace(
    /(try again at )((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d+(?:st|nd|rd|th), \d{4} )?(?:[1-9]|1[0-2]):[0-5][0-9] (?:AM|PM)(\.)/g,
    (_, prefix, date, suffix) => prefix + (date ?? "") + "12:00 PM" + suffix,
  );
}
