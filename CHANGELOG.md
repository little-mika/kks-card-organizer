# Changelog

## 0.1-beta — 2026-11-11

First public build. **Target platform: Koikatsu Sunshine (KKS).**

Not tested on the original Koikatsu (KK). The parser reads KK card headers, but
KK folder layout and Studio data were never validated — see the README.

### Cards
- Character cards (`UserData\chara`), outfit cards (`UserData\coordinate`) and
  Studio scene cards (`UserData\Studio\scene`) in one window.
- PNG tail parser mirroring `KKManager.Core.Data.Cards.CardLoader`: character
  cards, outfit cards (different layout) and scene cards (no header at all).
- Cards that are not cards — covers, previews, stray textures — are shown
  greyed out with the reason instead of being hidden.
- Detail panel lists every referenced zipmod GUID with a human-readable
  description of which body part it is used for.

### Mods
- Quarantine-delete: mods referenced only by the deleted card(s) move into the
  quarantine batch alongside the card. Mods still referenced elsewhere stay
  put. Mods shared inside one batch go to `_共用mod\`.
- Recycle bin restores a card and its mods to the original locations.
- Install: point at an extracted pack, cards go to the current folder, outfit
  cards to `coordinate`, zipmods to the mods folder, unknown files to
  `未分类`. Last 10 install runs can be undone individually.

### Performance
- SQLite index (`data\kkcard.db`) makes reopening a folder ~100× faster.
- 5064 cards indexed in ~28 s once; 16577 zipmods in ~3.7 s.

### Misc
- Rotating log in `logs\kkcard.log`, traceback dump in `logs\crash.txt`,
  front-end errors in `logs\frontend.log`.
- Launcher is a plain `.bat` (see README: the earlier `.vbs` was correctly
  flagged by Defender).