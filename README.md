# KKS Card Organizer

A portable, offline card manager for **Koikatsu Sunshine (KKS)** that actually understands zipmod dependencies.

**Version 0.1-beta** · Windows 10/11 · No installation · Nothing leaves your PC

> **Developed by DeepSeek.**

---

## Read this first: KKS ≠ KK

**This tool was built for Koikatsu Sunshine (コイカツ！サンシャイン), not the original Koikatsu (KK).**

They are two different games: different executables, different card formats, different folder layouts.

- Everything here was developed and tested against a **real KKS install** (`KoikatsuSunshine.exe`, cards written with the `【KoiKatuCharaSun】` header).
- It has **never been tested on a vanilla KK install**, and no KK-specific behaviour was verified.
- The card parser *does* recognise KK cards (`【KoiKatuChara】`) and Koikatsu Party cards (`【KoiKatuCharaSP】`) — KKS itself can load KK cards, which is why they show up in KKS collections and why they are supported as *input*. That is not the same as the tool being validated on KK.
- Scene cards and the folder layout are assumed to follow KKS. KK's Studio folder differs in places.

So: if you play KKS, this is the intended target. If you play KK only, treat it as **untested** — it may work, it may not, and you should try it on a copy of your data first.

(The name is intentional: the old tool, [KKManager](https://github.com/IllusionMods/KKManager), is Illusion's mod manager and covers many games. This one is narrower — it is about *cards* and it is about *KKS*.)

---

## The problem

Every KKS mod collection ends up the same way: thousands of `.zipmod` files, thousands of character cards, and almost no way to tell which mod belongs to which card.

The official [KKManager](https://github.com/IllusionMods/KKManager) can tell you *how many cards use a mod* by exporting a CSV. That is a fine report — but it does not help when you want to **delete a card and take its mods with it**. You delete the card, the mods stay behind forever, and the folder keeps growing.

This tool closes that gap.

- Open a card → see exactly which zipmods it needs, and **what part of the body each one paints** (5th outfit · gloves, accessory slot ×46, …).
- Delete a card → the zipmods that **only this card** used go into a quarantine folder together with the card. Mods still used by another card are left alone. Mods shared by several deleted cards go into a shared bin.
- Changed your mind → restore the card and its mods in one click.

Everything is a **move**, never a delete. Nothing is written into your game folder that the game would not read anyway.

---

## Features

### Three browsers in one window

| Tab | Folder | What it shows |
|---|---|---|
| Character cards | `UserData\chara` | `【KoiKatuChara】` `【KoiKatuCharaSun】` `【KoiKatuCharaSP】` `【EroMakeChara】` |
| Outfit cards | `UserData\coordinate` | `【KoiKatuClothes】` |
| Scene cards | `UserData\Studio\scene` | Studio scenes (no version header — parsed from the trailing data block) |

Cards are shown as a thumbnail grid with a **mod-count badge**. Anything in the folder that is not a card (covers, previews, leftover textures) is shown greyed out with the reason, so you can spot junk instead of wondering where a file went.

### Card details

Click a card and the right-hand panel (permanent, resizable, collapsible) shows the full-size image plus every zipmod GUID it references, grouped by how it is used:

```
ZMX008                 5th outfit · outfit · gloves · 4th outfit · outfit · gloves
yamadamod.accprim      5th outfit · accessory slot ×46 · 4th outfit · accessory slot ×45
HeadMod                face · head shape
moderchan.CharamakerSupportMOD   face · nose · body · paint 2
```

Single click selects and previews; `Ctrl`+click adds to the selection while the preview follows the card you clicked last.

### Mod cleanup

The fourth sidebar entry, **mod 清理**, lists mods by how they are referenced:

| Tab | Meaning |
|---|---|
| 真孤儿 | some card used to reference it, no card does now |
| 从未被引用 | no card has ever referenced it |
| 在用 | currently referenced |

Each row shows the file, a content tag (人物内容 / 场景物件 / 动作 / 插件), size, manifest name and author, the item names read out of the pack's `abdata/list/characustom/*.csv`, and a thumbnail when the pack has one — so a mod you have never seen before still tells you what it is. Tick rows and move them to the cleanup folder; nothing is deleted, and a `_清单.json` goes with the batch.

### Plugins

The fifth sidebar entry, **插件**, lists every dll under `BepInEx\plugins` together with its **actual load state**:

| Tab | Meaning |
|---|---|
| 全部 | every dll that declares a plugin class |
| 有问题 | missing dependency / blocked by one / failed to load / wrong BepInEx version |
| 正常 | the log says it loaded |
| 仅 Studio | declares `BepInProcess`, so it only loads in the Studio — expected |

The state is built from two sources. Mono.Cecil reads `BepInPlugin` (GUID, name, version), `BepInDependency` (what it needs and the minimum version) and `BepInProcess` straight out of each dll; then `BepInEx\LogOutput.log` is parsed for the sentences "loaded", "missing dependencies", "skipped because a dependency was not loaded", "process filters" and "targets a wrong version of BepInEx". **The log wins** — some plugins are mixed-mode dlls (e.g. `KKS_OverlayMods.dll`, which contains KSOX) whose GUID Cecil cannot read, so a pure dependency-table check would report them as missing.

Each row has an enable/disable button that renames `.dll` to `.dll.off` and back. Files are never deleted.

### Filters

Filter the current folder by name, by number of mods (none / few / many), or by card type — a quick way to find the heavy cards or the ones that need nothing at all.

### Move cards

Select one or many (`Ctrl` click, `Shift` click, `Ctrl+A`), then move them anywhere inside the browsed root — including the **outfit card folder** as a one-click target when you realise a "character card" is really an outfit card.

### Quarantine instead of delete

Deleting moves files into

```
<quarantine>\<timestamp>\<original\sub\path>\<card name>__<hash>\
      card.png
      _info.json
      mods\            <- zipmods used only by this card
```

and the batch folder gets a `_报告.html` / report listing every GUID that was involved.

Rules, in order:

1. A mod is only touched if the card being quarantined references it **and** no other card in the store references it.
2. A mod referenced by several cards of the same batch goes to `_共用mod\` instead of a single card folder.
3. Plugins (`.dll`) and unknown content are never touched.
4. Nothing is ever `unlink`ed — only `shutil.move`d.

The **Recycle bin** panel lists every batch and restores any selection: the card goes back to its original folder and the zipmods go back to your mods folder.

### Install a downloaded pack

Point the tool at the folder you just extracted from an archive, and it sorts the pile for you:

| File | Goes to |
|---|---|
| character card | the folder you are currently browsing |
| outfit card | `UserData\coordinate` |
| `.zipmod` | your mods folder |
| `.zip` that contains `manifest.xml` or `abdata/` | your mods folder |
| **unpacked mod** — a folder holding both `manifest.xml` and an `abdata\` tree | **re-packed into `mods\<guid>.zipmod`** — the game's `abdata\` is never written to |
| **plugin data** — anything under a `BepInEx\` folder (e.g. `BepInEx\Stiletto\*.txt` shoe tables) | mirrored to the same relative path under the game root |
| overlay textures and readme files | **left where they are** — see below |
| anything else | **stays where it is** — nothing is created, nothing is moved |

**Why unpacked mods get re-packed instead of copied over `abdata`.** A character
pack often ships its mod already unzipped: a folder with `manifest.xml` next to
`abdata\chara\*.unity3d` and `abdata\list\characustom\*.csv`. Dropping those
files into the game's own `abdata\` does work, but it is the old "hard mod"
route — a game update or reinstall wipes them, KKManager cannot see them, and
two mods using the same generic CSV name (`top.csv`, `bot.csv`) overwrite each
other silently. Packing them back into a `.zipmod` keeps the base install
untouched and makes the mod a normal, removable one.

**Why overlay PNGs are not installed.** A card carries its overlay textures
*inside the card file* (`KKEx` → `KSOX` → `FaceOver` / `BodyOver` / `EyeOver` …),
so loading the card needs no file on disk. The loose `eye L.png`,
`face_original_Diffuse.png` files in a pack are a texture library for Maker —
useful only if you want to paint a character yourself. Copy the ones you want
into `UserData\Overlays\` by hand.

There is no "unsorted" folder. If you want one, make it yourself (right-click → 新建文件夹 in the app, or in Explorer) and pick it as the target — the tool never decides for you.

**Duplicate handling and dependency check.** Before a mod is copied in, its `manifest.xml` is read and the GUID is compared against what is already installed. Same GUID and the installed copy is older or smaller → that copy is moved to quarantine and the incoming one takes its place. Same GUID and a larger copy is already there → the incoming file is skipped. When the move finishes, every installed card is re-parsed and any GUID it references but cannot find is listed, so a missing part shows up in the result dialog instead of hours later in the game.

Every install is recorded (file moves only, no copies) and the last 10 runs can be **undone one by one** from the Install dialog.

### Fast after the first scan

A local SQLite index (`data\kkcard.db`) caches the parsed metadata of every card and every zipmod GUID.

| Operation | First time | After that |
|---|---|---|
| Scan one card folder (216 cards) | ~1.5 s | **0.015 s** |
| Full card index (5 064 cards) | ~28 s | instant |
| Mod index (16 577 zipmods) | ~3.7 s | instant |

Open a folder for the first time and it takes a second; open it again and the thumbnails appear immediately.

The index stays current incrementally. Each directory's mtime is stored, so a
quarantine sweep only re-reads folders that actually changed, capped at 8 seconds
per run and resumed on the next one — a no-op refresh finishes in a few
hundredths of a second. Entries for cards that no longer exist on disk are
pruned automatically once the DB is more than 5% larger than the real count.

### English / 中文

The interface ships in both languages. The button in the top-right corner switches between **EN** and **中文**; the choice is remembered in `localStorage`. English is picked automatically on non-Chinese systems.

---

## Requirements

- Windows 10 or 11
- Python **3.9+** (64-bit), either installed system-wide or as a `python\` folder next to the launcher
- Edge / Chrome (used as the app window; any modern browser works if you open the URL manually)
- Optional: `Pillow` — enables fast thumbnail caching. Without it the browser scales the full-size PNG, which still works but is slower.

## Quick start

1. Download the release zip and extract it anywhere **without non-ASCII characters in the path** (a known KKS limitation — actually the tool itself handles unicode fine, but keep the game path clean).
2. Double-click **`启动.bat`**.
3. A small window opens at `http://127.0.0.1:8765/`.

### Finding the game

The tool locates Koikatsu Sunshine by itself, in this order:

1. `data\settings.json` — whatever it configured last time
2. **the registry** — `HKCU\Software\Illusion\KoikatsuSunshine\KoikatsuSunshine` → `INSTALLDIR`, which is exactly what the community `KoikatuSunshineRegistryFixer.bat` writes
3. the folder the tool sits in, and up to three levels above it (looking for `K_K_S`, `KoikatsuSunshine.exe`, `UserData\chara`)
4. the usual drive roots (`C:\` … `K:\`) under names like `kks`, `KKS`, `K_K_S`, `KoikatsuSunshine`, `恋活Sunshine`

Whatever it finds is written back to `data\settings.json`, so you only pay for the search once. The result is shown at the bottom of the left sidebar; **click that line** to pick a different folder by hand — the four sub-paths (`chara`, `coordinate`, `Studio\scene`, `mods`) are derived automatically and the quarantine defaults to `隔离区` next to the game folder.

If you move the game later, click the line and point it at the new place. Nothing else needs editing.

### Organising cards your own way

The folder tree on the left is just `UserData\chara` as it exists on disk. Create as many subfolders as you like — `抽卡游戏`, `原神`, `22.7.15`, whatever — the game reads them recursively. The app shows one folder at a time (no recursion), and **移动…** moves the selected cards into any folder of that tree, creating new ones with **新建文件夹**.

### About antivirus warnings

An earlier build shipped a `.vbs` launcher that started the server in a hidden window through `cmd`. That combination is textbook malware behaviour, Windows Defender deleted it on sight, and it was the right call.

The current launcher is a plain `.bat` file that does exactly two things: locate a Python interpreter and start `server.py` with `pythonw.exe` (no console). Nothing is hidden, nothing is injected, no network access is made beyond `127.0.0.1`. If your AV still complains, open the file and read it — it is 12 lines — and whitelist the folder if you are satisfied.

---

## How the mod linking actually works

KKS cards are PNG files with a binary payload appended **after** the `IEND` chunk. `kklib.py` reproduces what `KKManager.Core.Data.Cards.CardLoader.ParseCard` does:

```
[PNG header + chunks + IEND]
int32   productNo
string  marker          【KoiKatuCharaSun】 / 【KoiKatuChara】 / 【KoiKatuClothes】 ...
string  version
int32   faceLength
bytes   face PNG
int32   blockCount
msgpack BlockHeader { lstInfo: [ { name, version, pos, size } ] }
int64   ...
```

Each block then lives at `position + info.pos`. The one that matters here is `KKEx` →
`com.bepis.sideloader.universalautoresolver` → `PluginData` → `info`, a list of msgpack objects:

```json
{"ModID": "ZMX008", "Slot": 151, "LocalSlot": 100017709,
 "Property": "outfit4.ChaFileClothes.ClothesGloves", "CategoryNo": 109}
```

`ModID` is the zipmod GUID. `Property` says which part of the character that GUID is used for — that is what the detail panel translates into "5th outfit · gloves".

Outfit cards are a different layout (no face image, no version string before the name), so they are parsed by a separate branch. Scene cards have no unified header at all; the GUIDs are recovered by walking the trailing msgpack for `ModID` keys.

Everything is pure Python — the included msgpack decoder handles the subset these files use, so `msgpack-python` is not required.

## Project layout

```
启动.bat            launcher
server.py          HTTP server + JSON API + quarantine / install / restore logic
kklib.py           card + zipmod parsing (PNG tail, msgpack, manifests, content profiling)
store.py           SQLite index
plugins.py         plugin inventory: merges Mono.Cecil scan + LogOutput.log verdicts
tools/scan_plugins.ps1   the Cecil scanner invoked by plugins.py
static/            index.html, style.css, app.js, i18n.js  (no framework, no CDN)
data/              kkcard.db, thumbnails, settings   (created on first run, gitignored)
logs/              kkcard.log, crash.txt, frontend.log (created on first run, gitignored)
```

## API

Everything the UI does is a plain JSON call, so you can script it:

| Endpoint | Purpose |
|---|---|
| `GET /api/config` | paths, version, capabilities |
| `GET /api/tree?root=chara\|coord\|scene` | folder tree with card counts |
| `GET /api/cards?root=&dir=` | parsed cards in one folder |
| `GET /api/thumb?path=` | cached thumbnail |
| `POST /api/move` | move cards (`root`, `paths`, `to`, `to_root`) |
| `POST /api/quarantine` | quarantine cards (+ optional orphan mods) |
| `POST /api/install` | scan / install a folder |
| `POST /api/recycle` · `/api/restore` | list / restore quarantine batches |
| `POST /api/instlog` · `/api/undo` | list / undo install runs |
| `GET /api/index` | index stats |
| `POST /api/index` | rebuild the index |
| `GET /api/orphans?cat=summary\|in_use\|orphan\|never` | mods by reference state |
| `GET /api/plugins?refresh=1` | plugin inventory with load verdicts |
| `POST /api/plugintoggle` | disable / enable one plugin (`rel`, `enable`) |
| `GET /api/modthumb?path=&entry=` | thumbnail extracted from a zipmod |
| `POST /api/modclean` | move selected mods to quarantine |

## Logs

Anything that goes wrong is written to `logs\`:

- `kkcard.log` — rotating server log (2 MB × 5)
- `crash.txt` — full traceback of an uncaught exception
- `frontend.log` — JavaScript errors reported by the UI

If you open an issue, attach these three files.

## Known limits

- **Mods with no card reference are not cleaned up.** This tool answers "which mods belong to this card", not "which mods are garbage". Orphan detection needs scene-card support and content profiling, which is planned but not in 0.1-beta.
- A `.zipmod` is treated as an indivisible unit. If a pack contains both character parts and unrelated studio props, the whole file moves together.
- Cards you move behind the tool's back (with Explorer) are picked up again by the index on the next scan, but their "original location" for restore purposes is the location at quarantine time.
- The scene-card parser recovers GUIDs heuristically; unusual scene files may show fewer mods than they actually use.

## Acknowledgements

- [IllusionMods/KKManager](https://github.com/IllusionMods/KKManager) — the card format reference implementation, and years of work that made modding these games sane.
- [GameProgram7777/KKCleaner](https://github.com/GameProgram7777/KKCleaner) — proved that people want mod cleanup, and showed exactly where a CSV-only approach hurts.
- [im-mi/KoiCatalog](https://github.com/im-mi/KoiCatalog) — the card-browsing UI everybody remembers.

Not affiliated with Illusion, or with any of the above.

## License

MIT — see [LICENSE](LICENSE).

## 中文说明

完整中文文档见 **[README.zh-CN.md](README.zh-CN.md)**。

一句话：这是给恋活 / 恋活Sunshine 用的本地卡片管理器，能看卡、看卡依赖了哪些 mod（以及用在身上哪个部位）、删卡时把「只被这张卡用到的 mod」一起收进隔离区、随时还原，还能把下载的整合包自动分类装进游戏目录。

**由 DeepSeek 开发。**
