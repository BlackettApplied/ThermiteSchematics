export function strictCoverageReason(rows, reportOnly = false) {
  const count = rows.filter((r) => r.status === "not-measured").length;
  return !reportOnly && count
    ? `${count} not-measured observation(s): strict mode requires measured current output.`
    : undefined;
}
export function policyStatusCounts(rows) {
  return Object.fromEntries(
    [
      "pass",
      "xfail",
      "fail",
      "xpass",
      "manual",
      "not-applicable",
      "not-measured",
      "not-implemented",
    ].map((status) => [
      status,
      rows.filter(
        (r) => r.classification === "policy-gap" && r.status === status,
      ).length,
    ]),
  );
}
export function statusTable(counts) {
  return [
    "| DQ | Pass | Fail | Xfail | Xpass | Manual | Not applicable | Not measured | Not implemented |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(counts).map(
      ([dq, c]) =>
        `| ${dq} | ${c.pass} | ${c.fail} | ${c.xfail} | ${c.xpass} | ${c.manual} | ${c["not-applicable"]} | ${c["not-measured"]} | ${c["not-implemented"]} |`,
    ),
  ];
}
