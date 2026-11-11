# KKS 卡片整理器（KKS Card Organizer）

给 **恋活Sunshine（Koikatsu Sunshine，简称 KKS）** 用的本地卡片管理器，真正能看懂 zipmod 依赖关系。

> **本项目由 DeepSeek 开发。**

**版本 0.1-beta** · Windows 10/11 · 免安装 · 全程离线，不联网

---

## 先说清楚：KKS 不是 KK

**这个工具是为「恋活Sunshine」（コイカツ！サンシャイン，KKS）做的，不是原版「恋活」（Koikatsu，KK）。**

这是两个游戏：可执行文件不同、卡片格式不同、目录结构也不完全一样。

- 全部功能都是在**真实的 KKS 整合包**上开发和测试的（`KoikatsuSunshine.exe`，卡片头 `【KoiKatuCharaSun】`）。
- **从未在原版 KK 环境里实际测试过**，也没有针对 KK 做过任何兼容性验证。
- 解析器确实能认出 KK 的卡（`【KoiKatuChara】`）和 Koikatsu Party 的卡（`【KoiKatuCharaSP】`）——因为 KKS 本身就能读 KK 的卡，所以 KKS 的卡库混着 KK 卡很常见，把它当**输入**支持是一回事，这不等于「这工具在 KK 上验证过」。
- 场景卡格式和目录布局都按 KKS 假设。KK 的 Studio 目录在部分位置不一样。

结论：玩 KKS 的，这是目标平台。只玩 KK 的，请当作**未测试**——可能能用，也可能不能，建议先拿一份数据副本试。

（名字是刻意的：[KKManager](https://github.com/IllusionMods/KKManager) 是 Illusion 官方的 mod 管理器，覆盖多款游戏；这个更窄——它只管**卡片**，而且只管 **KKS**。）

---

## 它解决什么问题

整合包用久了都是这个下场：上万个 `.zipmod`、几千张人物卡，却没有任何办法知道哪张卡用了哪个 mod。

官方 [KKManager](https://github.com/IllusionMods/KKManager) 能导出 CSV 告诉你「一个 mod 被几张卡使用」。这是一份不错的报表，但当你**想删掉一张卡、顺便把它的 mod 带走**时，它帮不上忙。卡删了，mod 永远留在原地，文件夹只增不减。

这个工具补的就是这一段。

- 打开一张卡 → 看到它依赖的全部 zipmod，以及**每个 mod 用在身体的哪个部位**（第 5 套衣服·手套、饰品槽 ×46……）。
- 删一张卡 → 只被这张卡用到的 zipmod 会跟卡一起进隔离区。还被别的卡用着的，一个都不动。被多张已删卡共用的，进共用区。
- 后悔了 → 点一下还原，卡和 mod 一起回去。

全程只有**移动**，没有删除。游戏目录里不会多出任何它读不懂的东西。

---

## 功能

### 一个窗口，三种卡片

| 标签 | 目录 | 识别格式 |
|---|---|---|
| 人物卡 | `UserData\chara` | `【KoiKatuChara】` `【KoiKatuCharaSun】` `【KoiKatuCharaSP】` `【EroMakeChara】` |
| 服装卡 | `UserData\coordinate` | `【KoiKatuClothes】` |
| 场景卡 | `UserData\Studio\scene` | Studio 场景（无统一版本头，从尾部数据块里恢复） |

缩略图网格 + **mod 数量角标**。文件夹里那些不是卡的东西（封面、预览图、放错的贴图）会灰显并注明原因，一眼能看出哪里多了垃圾，而不是纳闷文件去哪了。

### 卡片详情

点一张卡，右边是原图，下面列出它引用的每个 zipmod GUID，按用途归纳：

```
ZMX008                 第5套·服装·手套、第4套·服装·手套
yamadamod.accprim      第5套·饰品槽 ×46、第4套·饰品槽 ×45
HeadMod                面部·脸型
moderchan.CharamakerSupportMOD   面部·鼻子、身体·涂装2
```

### 筛选

按名字、按 mod 数量（无 / 少 / 多）、按类型筛当前文件夹。找「特别重的卡」或「什么都不需要的卡」，几秒搞定。

### 移动卡片

单选、`Ctrl` 多选、`Shift` 范围选、`Ctrl+A` 全选，然后移到自己想分类的地方。移动目标里还带一个「服装卡目录 coordinate」——发现某张"人物卡"其实是服装卡时，一键送过去。

### 隔离，而不是删除

删除操作会把文件移到

```
<隔离区>\<时间戳>\<原目录\子目录\><卡名>__<短hash>\
      卡.png
      _info.json
      mods\            <- 只被这张卡用到的 zipmod
```

批次目录里还有一份 `_报告.html`，列出这一批涉及的所有 GUID。

规则按顺序：

1. 只有「这张卡引用了、且库里没有第二张卡引用」的 mod 会被动。
2. 同一批次里被多张卡共用的 mod，进 `_共用mod\`，不塞进某一张卡的文件夹。
3. 插件（`.dll`）和认不出的内容，一律不碰。
4. 永远只 `shutil.move`，从不 `unlink`。

**回收站**面板按批次列出所有隔离内容，勾选即可还原：卡回原目录，zipmod 回游戏 mods 目录。

### 安装下载来的整合包

指一个刚解压的文件夹，剩下的它分类：

| 文件 | 去处 |
|---|---|
| 人物卡 | 你当前正在浏览的文件夹 |
| 服装卡 | `UserData\coordinate` |
| `.zipmod` | 游戏 mods 目录 |
| 内含 `manifest.xml` 或 `abdata/` 的 `.zip` | 游戏 mods 目录 |
| 其它认不出的 | 隔离区旁边的 `未分类` 文件夹 |

每次安装都会记账（只记位置变更，不备份内容），最近 10 次可以在「历史记录」里**逐次撤销**。

### 第一次慢，之后秒开

本地 SQLite 索引（`data\kkcard.db`）缓存每张卡的解析结果和每个 zipmod 的 GUID。

| 操作 | 首次 | 之后 |
|---|---|---|
| 扫一个卡文件夹（216 张） | 约 1.5 秒 | **0.015 秒** |
| 全量卡片索引（5064 张） | 约 28 秒 | 瞬时 |
| mod 索引（16577 个 zipmod） | 约 3.7 秒 | 瞬时 |

---

## 环境要求

- Windows 10 / 11
- Python **3.9+**（64 位）：系统安装的，或者放在启动器旁边的 `python\` 文件夹里
- Edge / Chrome（用来开应用窗口；任何现代浏览器手动打开 URL 也行）
- 可选：`Pillow` —— 启用缩略图缓存。没有也能用，只是由浏览器缩放原图，会慢一些。

## 快速开始

1. 下载 Release 里的 zip，解压到任意位置（**路径别带中文**——这是恋活/KKS 整合包的老毛病，工具自己处理 unicode 没问题，但游戏目录最好干净）。
2. 双击 **`启动.bat`**。
3. 弹出应用窗口，地址是 `http://127.0.0.1:8765/`。

如果游戏装得比较特别，改 `server.py` 顶部的路径：

```python
CONF = {
    "root":  r"..\UserData\chara",
    "coord": r"..\UserData\coordinate",
    "scene": r"..\UserData\Studio\scene",
    "mods":  r"..\mods",
    "recycle": r"..\隔离区",
}
```

（部分路径可以在界面里改，写进 `data\settings.json`，启动时读取。）

### 关于杀软报毒

早期版本附带一个 `.vbs` 启动器，通过 `cmd` 在隐藏窗口里起服务。这个组合是教科书级的木马特征，Windows Defender 当场把它删了，删得对。

现在的启动器就是普通的 `.bat`，只做两件事：找 Python，用 `pythonw.exe` 起 `server.py`（无控制台）。没有隐藏调用、没有注入、除 `127.0.0.1` 外不产生任何网络连接。要是杀软还报，直接打开文件看一眼——总共 12 行——确认后再把文件夹加白。

---

## mod 关联是怎么算出来的

KKS 的卡是「PNG 图片 + `IEND` 之后追加的二进制数据」。`kklib.py` 复刻了 `KKManager.Core.Data.Cards.CardLoader.ParseCard` 的流程：

```
[PNG 头 + 数据块 + IEND]
int32   productNo
string  标记              【KoiKatuCharaSun】 / 【KoiKatuChara】 / 【KoiKatuClothes】 ...
string  版本
int32   faceLength
bytes   脸图 PNG
int32   blockCount
msgpack BlockHeader { lstInfo: [ { name, version, pos, size } ] }
int64   ...
```

之后每个 block 位于 `position + info.pos`。这里关心的是 `KKEx` →
`com.bepis.sideloader.universalautoresolver` → `PluginData` → `info`，一个 msgpack 对象列表：

```json
{"ModID": "ZMX008", "Slot": 151, "LocalSlot": 100017709,
 "Property": "outfit4.ChaFileClothes.ClothesGloves", "CategoryNo": 109}
```

`ModID` 就是 zipmod 的 GUID，`Property` 说明这个 GUID 用在身上哪个部位——详情面板里那句「第5套·服装·手套」就是这么来的。

服装卡结构不同（没有脸图，名字前没有版本串），单独一个分支。场景卡根本没有统一头，靠遍历尾部 msgpack 找 `ModID` 键恢复 GUID。

全部纯 Python —— 自带的 msgpack 解码器覆盖了这类文件用到的子集，不需要装 `msgpack-python`。

## 目录结构

```
启动.bat            启动器
server.py          HTTP 服务 + JSON API + 隔离/安装/还原逻辑
kklib.py           卡片与 zipmod 解析（PNG 尾部、msgpack、manifest、内容画像）
store.py           SQLite 索引
static/            index.html、style.css、app.js（无框架、无 CDN）
data/              kkcard.db、缩略图、设置（首次运行生成，已 gitignore）
logs/              kkcard.log、crash.txt、frontend.log（首次运行生成，已 gitignore）
```

## API

界面做的每件事都是普通 JSON 调用，可以自己写脚本：

| 接口 | 用途 |
|---|---|
| `GET /api/config` | 路径、版本、能力 |
| `GET /api/tree?root=chara\|coord\|scene` | 目录树与卡片计数 |
| `GET /api/cards?root=&dir=` | 某目录下解析过的卡 |
| `GET /api/thumb?path=` | 缓存缩略图 |
| `POST /api/move` | 移动卡片（`root`、`paths`、`to`、`to_root`） |
| `POST /api/quarantine` | 隔离卡片（可选连带独占 mod） |
| `POST /api/install` | 扫描 / 安装文件夹 |
| `POST /api/recycle` · `/api/restore` | 列出 / 还原隔离批次 |
| `POST /api/instlog` · `/api/undo` | 列出 / 撤销安装记录 |
| `POST /api/index` | 重建索引 |

## 日志

出问题都写在 `logs\` 里：

- `kkcard.log` —— 轮转服务日志（2 MB × 5）
- `crash.txt` —— 未捕获异常的完整堆栈
- `frontend.log` —— 前端 JS 报错

提 issue 时把这三个文件一起附上。

## 已知限制

- **没有任何卡引用的 mod 不会被清理。** 这个工具回答的是「哪些 mod 属于这张卡」，不是「哪些 mod 是垃圾」。孤儿扫描需要场景卡支持和内容画像，规划中，0.1-beta 不含。
- 一个 `.zipmod` 当成不可分割的整体。如果某个包同时包含人物部件和无关的场景道具，整个文件一起动。
- 用资源管理器在工具背后移动的卡，下次扫描会被索引补回，但「原位置」以隔离那一刻为准。
- 场景卡的 GUID 是启发式恢复的，特殊场景文件可能显示得比实际少。

## 致谢

- [IllusionMods/KKManager](https://github.com/IllusionMods/KKManager) —— 卡片格式的参考实现，以及让这两个游戏还能好好 mod 的多年工作。
- [GameProgram7777/KKCleaner](https://github.com/GameProgram7777/KKCleaner) —— 证明了大家确实需要 mod 清理，也示范了只靠 CSV 会在哪里摔跤。
- [im-mi/KoiCatalog](https://github.com/im-mi/KoiCatalog) —— 很多人记得的那个看图界面。

与 Illusion 及上述项目均无隶属关系。

## 许可

MIT，见 [LICENSE](LICENSE)。
