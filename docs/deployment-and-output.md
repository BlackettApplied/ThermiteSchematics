# Deployment and generated output

`thermite init <new-directory>` creates and validates a staged project before
making it available. It copies the exact generic library JSON to `libraries/core`
and writes a relative path reference and fresh integrity lock. Existing projects
using shipped library identities continue to work. The `cabinets` template
provides two cabinets, two used cores, and two loose spare cores.

Generated output cannot overwrite project inputs, requests, libraries, or agent
configuration. Symlinked/hard-linked output paths are rejected. Views and packets
write SVG, HTML, JSON or PDF; reports also write CSV. [Continuity](continuity-checks.md)
writes text (`.txt`) or JSON; diagnostics write text (`.txt`), JSON or CSV.
A file matching an authored source glob is rejected. The CLI uses atomic file
replacement for ordinary generated outputs.

Runtime and source workflows use Bun 1.4.2 on the systems listed in
[platform checks](platforms.md). Keep the runtime or source checkout separate
from the electrical project; see [runtime packaging](runtime-package.md).

See the [formats and compatibility hub](formats-and-compatibility.md#libraries-and-deployment).
