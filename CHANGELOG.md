# Changelog

## 0.6-beta — 2026-11-14

### 卡库扫描改成增量，不再全盘 walk

以前每次删卡都会先跑一遍 `ensure_card_store()` 全盘 walk 补齐卡片库，卡片一多就是几秒钟的纯等待。现在：

- 每个目录的 mtime 记进库（`dirmt:<相对路径>`），mtime 没变的目录直接跳过。
- 单次最多跑 8 秒，跑不完下次继续，不会卡住界面。
- 库里条目比磁盘多 5% 以上时自动 `prune`，清掉已经不在磁盘上的卡。

实测 324 个目录：首次约 8 秒扫完 958 张，第二次 8 秒补到 1440 张，第三次 **0.02 秒**收尾；顺手清掉 1,190 条失效记录。

### 安装：按 GUID 查重，装完校验依赖

- 装 mod 前用 `manifest.xml` 里的 GUID 查库，不再只看文件名。同一个 GUID 已有更大的包 → 跳过；新包更大 → 把旧的挪进隔离区再放新的，并在结果里列出「换掉了哪些」。
- 装完把所有卡重新解析一遍，卡引用了但 mods 里找不到的 GUID 会列出来（`⚠ 装完发现 N 个 mod 依赖没装上`），不用等进游戏才发现缺部件。

### 隔离区批次清单

新增 `隔离区-批次清单.csv` 导出：每批多少卡、多少 mod、多大、还有几个 mod 被当前卡库引用。
## 0.5-beta — 2026-11-14

### 插件页

第五个标签「插件」，列出 BepInEx\plugins 下所有 dll 的真实加载状态：

- 用 Mono.Cecil 读每个 dll 的 BepInPlugin（GUID / 名称 / 版本）、BepInDependency（依赖 + 最低版本）、BepInProcess（限定进程）。
- 同时解析 BepInEx\LogOutput.log，把日志里说"加载成功 / 缺依赖 / 被拦住 / 版本不对 / 进程过滤跳过"的结论叠加上去——Cecil 读不了混合模式 dll（如 KKS_OverlayMods.dll 里的 KSOX），光看依赖表会误报。
- 四种分类：全部 / 有问题 / 正常 / 仅 Studio；每个插件一行，显示状态、名称、版本、相对路径、大小、依赖清单和具体问题。
- 每行一个「禁用 / 启用」按钮，把 .dll 改名为 .dll.off 或改回来，不会删除文件。

### 移除

- Tools\ZipmodThumbnailHandler 与 Tools\ZipmodThumbServices 已删——管理器的 mod 清理页自带缩略图，不需要资源管理器的 Shell 扩展。Tools\KKManager 保留。

## 0.4-beta — 2026-11-13

Unreleased local build. **Target platform: Koikatsu Sunshine (KKS).**

### Installer: unpacked zipmods are re-packed, overlays are no longer installed
- **Unpacked mods become `.zipmod` again.** A folder that contains both
  `manifest.xml` and an `abdata\` tree is an unzipped Sideloader mod. Installing
  it by copying files over the game's `abdata\` works, but it is the old
  "hard mod" approach: a game update wipes it, KKManager cannot see it, and two
  mods that happen to ship the same `abdata\list\characustom\*.csv` name
  overwrite each other. The installer now packs such folders into
  `mods\<guid>.zipmod` instead — the game's `abdata\` is never written to, and
  the mod shows up in KKManager like any other.
- **Overlays are left where they are.** A card stores its overlay textures
  inside the card file itself (`KKEx` → `KSOX` → `FaceOver` / `BodyOver` /
  `EyeOver` …), so nothing on disk is referenced. The loose PNGs that ship in a
  character pack are just a texture library for use in Maker — they are no
  longer copied into `UserData\Overlays\` automatically. The scan dialog still
  lists them so you can drag the ones you want.
- The scan summary and result message now report `packed` and `overlays kept`
  separately.
## 0.3-beta — 2026-11-13

Unreleased local build. **Target platform: Koikatsu Sunshine (KKS).**

### Installer: three more kinds of files
- **Overlays (textures).** Plain PNGs whose names look like `eye*`, `face*`,
  `body*`, `iris*`, `*_Diffuse`, `*_MainTex`, `*template*` are now moved to
  `UserData\Overlays\<package name>\`. If the source already had a
  `UserData\Overlays\...` layout, that structure is kept instead. Previews,
  thumbnails and covers are excluded.
- **Plugin data.** Files under a `BepInEx\` folder — e.g. the
  `BepInEx\Stiletto\*.txt` shoe-height tables that ship with some outfits —
  are mirrored to the same relative path under the game root.
- **`abdata\` is left alone.** It is the game's own resource tree; overwriting
  it from a pack can break the base install, so those files always stay where
  they are.
- The scan dialog now lists four sections (cards / mods / overlays / data) and
  the result summary reports each count separately.

## 0.2-beta — 2026-11-12

Unreleased local build. **Target platform: Koikatsu Sunshine (KKS).**

### Preview panel
- The right-hand panel is now permanent: it sits there empty until you pick a
  card, so the grid never jumps around.
- Drag its left edge to resize (240–720 px). Collapse it to a 22 px strip with
  the handle; both the width and the collapsed state are remembered.
- Single click = select + preview. `Ctrl`+click = add to selection while the
  preview follows the most recently clicked card.
- Opening **mod 清理** hides the panel so the list gets the full width.

### Mod cleanup view
- New sidebar entry **mod 清理** with three tabs:
  **真孤儿** (mods that some card used to reference, now referenced by none),
  **从未被引用** (never referenced by any card),
  **在用** (currently referenced).
- Each row shows the file, a content tag (人物内容 / 场景物件 / 动作 / 插件 /
  人物+场景), size, the manifest name/author, the item names parsed out of the
  zipmod's `abdata/list/characustom/*.csv`, and its thumbnail when the pack has
  one.
- Tick rows and press **移到清理区** — files move to
  `<recycle>\<timestamp>\mods\…` with a `_清单.json`, nothing is deleted.
- Reference history is kept in a new `guid_history` table, so "used to be
  referenced by N cards, now by none" survives card deletion.

### Performance
- The card index no longer re-walks the whole card tree on every quarantine.
  A one-off `full_scan_at` marker plus the directory-level lazy load keeps it
  current; SQLite handles the lookups.

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
  cards to `coordinate`, zipmods to the mods folder. **Anything unrecognised
  stays where it is — no `未分类` folder is created.** Last 10 install runs can
  be undone individually.

### Setup
- The game folder is discovered automatically: `data\settings.json`, then the
  registry (`HKCU\Software\Illusion\KoikatsuSunshine\KoikatsuSunshine` →
  `INSTALLDIR`, written by `KoikatuSunshineRegistryFixer.bat`), then the
  folder the tool sits in, then common drive paths. Click the line at the
  bottom of the sidebar to point it somewhere else by hand.
- Launcher looks for `pythonw` next to itself, then on `PATH`, then in the
  development runtime — a `python\` folder is no longer required.
- English / 中文 interface toggle in the top-right corner.

### Performance
- SQLite index (`data\kkcard.db`) makes reopening a folder ~100× faster.
- 5064 cards indexed in ~28 s once; 16577 zipmods in ~3.7 s.

### Misc
- Rotating log in `logs\kkcard.log`, traceback dump in `logs\crash.txt`,
  front-end errors in `logs\frontend.log`.
- Launcher is a plain `.bat` (see README: the earlier `.vbs` was correctly
  flagged by Defender).