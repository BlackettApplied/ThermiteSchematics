# PDF fonts

Unmodified Noto Sans Regular and Bold TrueType fonts are bundled solely for
repeatable PDF text rendering. They do not embed electrical component libraries.
The accompanying OFL.txt is the upstream SIL Open Font License 1.1.

Noto Sans Math Regular supplies missing mathematical and arrow glyphs, including
U+2212 MINUS SIGN and U+2192 RIGHTWARDS ARROW. PDF export uses font-only spans for
those glyph runs; ordinary text keeps Noto Sans Regular/Bold. Source strings,
SVG/HTML artifacts, anchors and coordinates are unchanged. Characters absent
from both bundled families are still rejected. All fonts are loaded offline.

Retrieved September 6, 2026 from the archived upstream notofonts/noto-fonts repo:

- https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf
- https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf
- https://raw.githubusercontent.com/notofonts/noto-fonts/main/LICENSE (saved as OFL.txt)

Noto Sans Math retrieved September 8, 2026 from the same archived upstream and
covered by the identical upstream license:

- https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSansMath/NotoSansMath-Regular.ttf

SHA-256:

```text
b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5  NotoSans-Regular.ttf
c976e4b1b99edc88775377fcc21692ca4bfa46b6d6ca6522bfda505b28ff9d6a  NotoSans-Bold.ttf
80b61fd613d3519197e64fff6f7e71fdc7f3e6526440ea4115b554ef7fd59af7  NotoSansMath-Regular.ttf
0dab92d0544f7b233403f14b84a663bdbfa746982eda629e7f4f9ffe1b036feb  OFL.txt
```
