# Supplemental license terms and provenance

fontkit 2.0.4, brotli 1.3.3 and dfa 1.2.0 declare MIT in their upstream
package manifests and READMEs, but neither their registry packages nor their
release commits contain the full project MIT license text. `sources.json`
records the exact release commits (from registry `gitHead` metadata), versions,
authors and declaration URLs verified during preparation.

`MIT-LICENSE` supplies the standard MIT terms from SPDX's versioned license
list. The unfilled copyright template line is omitted; no copyright year or
holder is invented. The original upstream package metadata, attribution, source
headers and README are preserved. This is a supplemental copy of the declared
standard terms, not a claim that upstream supplied this particular file.

The brotli decoder files retain Google copyright and Apache-2.0 headers, so
`Apache-2.0-LICENSE` is also supplied. The encoder's vendor submodule at the
brotli.js release commit is google/brotli commit
`5ce9bf11b3fe0924d87b2a2d47eb7a53a76a4421`; `brotli-vendor-LICENSE`
is that commit's complete, unmodified copyright notice and MIT license.
See the upstream [submodule](https://github.com/devongovett/brotli.js/tree/e36051345f6d27a56e5f39ea70d2f789b8574046/vendor).

The packer checks versions and SHA-256 values before copying these files into
runtime dependency directories, and ships this provenance folder with the ZIP.
Upstream dependency bytes are otherwise preserved. Revisit this evidence when
upgrading any of these dependencies.
