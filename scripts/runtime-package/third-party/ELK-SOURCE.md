# ELK source availability

This distribution includes unmodified elkjs 0.12.0 under the Eclipse Public
License 2.0. Its full license is `node_modules/elkjs/LICENSE.md`, and all
upstream files and notices are retained. Thermite's separate runtime adapter
loads the original worker bytes without modifying them.

Source code for elkjs and the Eclipse Layout Kernel is available under EPL-2.0
from these public upstream repositories. Download the source or clone the
repository and check out the specified release:

- [elkjs 0.12.0](https://github.com/kieler/elkjs/tree/ff5771d7165445c42c408bb8a090c8035272218c),
  commit `ff5771d7165445c42c408bb8a090c8035272218c` (the published package's gitHead).
  Its README, build.gradle, Gradle wrapper and source directories provide the
  JavaScript adapter and instructions for generating the worker from ELK Java.
- [Eclipse Layout Kernel v0.12.0](https://github.com/eclipse-elk/elk/tree/323312916048544e4e594eab3303cdb0d01e2929),
  commit `323312916048544e4e594eab3303cdb0d01e2929`, provides the corresponding
  ELK release sources. Upstream's CI builds against its master branch; these
  release references identify source availability, not a claim that Thermite
  has reproduced the upstream GWT build byte for byte.

No fee or Thermite-specific access permission is required to obtain this source.
Preserve this notice, upstream copyright notices and EPL-2.0 license when
redistributing the included ELK software. The runtime manifest records the
exact registry integrity and hashes of the delivered files.
