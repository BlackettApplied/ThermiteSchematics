# Third-party notices

Thermite's original source is licensed under [Apache-2.0](LICENSE). This does
not relicense third-party material. Keep this file, [NOTICE](NOTICE), and the
applicable license texts with source distributions.

## Bundled fonts

`packages/cli/assets/fonts/` contains unmodified Noto Sans Regular, Noto Sans
Bold, and Noto Sans Math Regular, Copyright 2018 The Noto Project Authors.
They are distributed under the **SIL Open Font License 1.1**. The full copyright
notice and license are in [OFL.txt](packages/cli/assets/fonts/OFL.txt); upstream
URLs and SHA-256 hashes are in the [font README](packages/cli/assets/fonts/README.md).
These fonts are embedded by the PDF renderer. Embedding them does not change
the license of the generated document
([OFL FAQ](https://openfontlicense.org/ofl-faq/), section 1.13).
Retain their license when copying or redistributing the font files.

## Package dependencies

The source checkout and `bun run alpha:pack` archive do not bundle `node_modules`.
`bun install --frozen-lockfile` installs the versions and integrity hashes in
`bun.lock`, which does not record license metadata. Each package retains its
upstream copyright and license; the license files and metadata in its installed
package directory are authoritative. For example, `png-js` 1.1.0 declares no
license field but includes an MIT `LICENSE` file, Copyright 2017 Devon Govett.
The retained `package-lock.json` serves only the frozen private release tooling
and is not a current dependency inventory.

In particular, the renderer uses **elkjs 0.12.0**, whose package declares
`EPL-2.0 OR GPL-3.0-or-later`. Thermite uses it under **EPL-2.0**. Source and
licensing information are available from [elkjs](https://github.com/kieler/elkjs/tree/0.12.0)
and [Eclipse Layout Kernel](https://github.com/eclipse-elk/elk). ELK remains a
separate third-party dependency; Thermite's Apache license does not replace its
terms. The [EPL-2.0 distribution provisions](https://www.eclipse.org/legal/epl/epl-v20.html)
include source availability and notice requirements when redistributing it.

If distributing built software or copying dependencies into an archive, include
the licenses/notices for the actual runtime dependency tree, including transitive
dependencies, and satisfy applicable source availability requirements. The
`scripts/release-third-party-*` inventories belong to the frozen private 0.2.0
packager; they are not an inventory of the current source alpha's dependencies.

## Component research

Manufacturer libraries contain Thermite's authored component definitions and
source references. Manufacturer manuals, datasheets, trademarks, and linked
material remain subject to their owners' rights. A source URL is evidence for a
component fact, not permission to redistribute the complete source document.
See [CONTRIBUTING.md](CONTRIBUTING.md) for library submission requirements.
