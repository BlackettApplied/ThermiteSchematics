// Historical evidence is data, even when it contains executable-looking text.
// Keep these exclusions shared by every broad health/test-support source scan.
export const AUDIT_DATA_FIXTURES = [
  /^packages\/cli\/test\/fixtures\/health-.*\.ts\.txt$/,
  /^packages\/cli\/test\/fixtures\/guide-tb2-publication\.md\.txt$/,
];
export const auditDataFixture = (path) =>
  AUDIT_DATA_FIXTURES.some((pattern) =>
    pattern.test(path.replaceAll("\\", "/")),
  );
