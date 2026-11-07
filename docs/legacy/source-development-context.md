# Source development and release context

These notes preserve the private-release context from the source README and
contributor guide. Current development instructions are in the
[repository README](../../README.md) and [CONTRIBUTING](../../CONTRIBUTING.md).
The original [private release controls](private-release.md) and
[legacy agent guide](private-release-agent-guide.md) preserve the release authority.

## Source checkout context

The normal check covers the source alpha. Historical private 0.2.0 packaging and
release-evidence checks are separate; their legacy Node/npm commands and
`package-lock.json` apply only in their original release context. They are not
prerequisites for using or contributing to the public alpha. The former root
guide's private-release sections are preserved in the
[legacy agent guide](private-release-agent-guide.md).

## Contributor checks and release context

The normal check is the cross-platform source-alpha development check. It
excludes the frozen private 0.2.0 tarball inventory suite, which remains available
as `npm run test:legacy-package` on its historical source revision with its
original Node/npm toolchain. Source
archives are verified separately by extracting, installing, building, and running
the alpha CLI. Some historical
private-release consumer tests intentionally skip without a downloaded release
candidate; the test output reports those skips. Protected release-evidence audits
remain separate and are not asserted by the source-alpha check.

The former root guide's private-runtime contract is preserved in the
[legacy agent guide](private-release-agent-guide.md); source engine
instructions live in the compact [root guide](../../AGENTS.md).

Keep historical private release controls intact.

The frozen
`release-package.test.ts` suite stays excluded unless explicitly selected via
`npm run test:legacy-package` on its historical source revision and toolchain.
