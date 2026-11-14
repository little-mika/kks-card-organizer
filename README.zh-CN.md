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

点一张卡，右边常驻的预览栏（可拖宽、可收起）显示原图，下面列出它引用的每个 zipmod GUID，按用途归纳：

```
ZMX008                 第5套·服装·手套、第4套·服装·手套
yamadamod.accprim      第5套·饰品槽 ×46、第4套·饰品槽 ×45
HeadMod                面部·脸型
moderchan.CharamakerSupportMOD   面部·鼻子、身体·涂装2
```

单击是"选中 + 预览"，`Ctrl` 单击是加选，预览始终跟着最后点的那张。

### mod 清理

左栏第四个入口 **mod 清理**，按引用情况分三个页签：

| 页签 | 含义 |
|---|---|
| 真孤儿 | 曾经有卡引用它，现在一张都没有 |
| 从未被引用 | 从来没有卡引用过 |
| 在用 | 现在还有卡引用 |

每条显示文件名、内容类型（人物内容 / 场景物件 / 动作 / 插件）、大小、manifest 里的名字与作者、从包里 `abdata/list/characustom/*.csv` 读出来的部件名，以及包内缩略图——没见过的 mod 也能一眼看出是什么。勾选后「移到清理区」，只移动不删除，批次里带一份 `_清单.json`。

### 插件

左栏第五个入口 **插件**，把 `BepInEx\plugins` 下的 dll 全列出来，并告诉你每个插件的**真实加载状态**：

| 页签 | 含义 |
|---|---|
| 全部 | 读到插件类的所有 dll |
| 有问题 | 缺依赖 / 被依赖链拦住 / 加载失败 / BepInEx 版本不对 |
| 正常 | 日志里明确加载成功 |
| 仅 Studio | 声明了 `BepInProcess`，只在工作室里加载，主游戏里看不到属正常 |

状态是两路数据叠出来的：Mono.Cecil 直接读 dll 里的 `BepInPlugin`（GUID、名称、版本）、`BepInDependency`（依赖谁、最低要多少版本）、`BepInProcess`；再解析 `BepInEx\LogOutput.log`，取「加载成功 / 缺依赖 / 因为依赖没加载而跳过 / 进程过滤跳过 / BepInEx 版本不对」这些结论。**日志优先**——有些插件是混合模式 dll（比如装着 KSOX 的 `KKS_OverlayMods.dll`），Cecil 读不出它的 GUID，只看依赖表会把它误判成缺依赖。

每行一个「禁用 / 启用」按钮，把 `.dll` 改名成 `.dll.off` 或改回来，不删文件，随时可逆。

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
| **解包的 mod**——同一个文件夹里既有 `manifest.xml` 又有 `abdata\` 目录树 | **重新打包成 `mods\<guid>.zipmod`**，游戏自己的 `abdata\` 一个字节都不写 |
| **插件数据**——`BepInEx\` 目录下的文件（比如 `BepInEx\Stiletto\*.txt` 的鞋跟高度表） | 按原相对路径镜像到游戏根 |
| 贴图和说明文件 | **原样留在原地**——理由见下 |
| 其它认不出的 | **原样留在原地**——不建文件夹，不搬 |

**为什么解包的 mod 要重新打包，而不是覆盖 `abdata`。** 人物包里经常带一个已经解压开的 mod：一个文件夹里 `manifest.xml` 旁边就是 `abdata\chara\*.unity3d` 和 `abdata\list\characustom\*.csv`。把这些文件直接铺进游戏的 `abdata\` 确实能用，但那属于旧的「Hard mod」做法——游戏更新或重装会丢、KKManager 看不到、两个 mod 用了同一个通用 CSV 名（`top.csv`、`bot.csv`）就会互相顶掉而且没有任何提示。打回 `.zipmod` 既不碰本体，又变成可识别、可卸载的正常 mod。

**为什么贴图 PNG 不装了。** 卡里的 overlay 贴图是**内嵌在卡文件里面**的（`KKEx` → `KSOX` → `FaceOver` / `BodyOver` / `EyeOver` …），读卡时根本不需要磁盘上的文件。包里那些 `eye L.png`、`face_original_Diffuse.png` 是给 Maker 里自己画角色用的素材库，只有你想手动改角色时才用得上。需要的自己拖进 `UserData\Overlays\` 即可。

没有「未分类」这种默认文件夹。要分类就自己建（界面里「新建文件夹」，或者资源管理器里建），再自己选目标——工具不替你决定。

**重复包处理和依赖校验。** 装一个 mod 之前会先读它的 `manifest.xml`，拿 GUID 跟已装的比对：同一个 GUID 而库里那份更旧或更小 → 把旧的挪进隔离区，新的顶上；同一个 GUID 而库里已经有更大的 → 跳过不装。搬完之后会把所有卡重新解析一遍，卡引用了但 mods 里找不到的 GUID 会列出来，缺部件当场就能看到，不用等进游戏才发现。

每次安装都会记账（只记位置变更，不备份内容），最近 10 次可以在「历史记录」里**逐次撤销**。

### 第一次慢，之后秒开

本地 SQLite 索引（`data\kkcard.db`）缓存每张卡的解析结果和每个 zipmod 的 GUID。
| 操作 | 首次 | 之后 |
|---|---|---|
| 扫一个卡文件夹（216 张） | 约 1.5 秒 | **0.015 秒** |
| 全量卡片索引（5064 张） | 约 28 秒 | 瞬时 |
| mod 索引（16577 个 zipmod） | 约 3.7 秒 | 瞬时 |

索引是增量维护的：每个目录的 mtime 都记下来，隔离操作只会重读真正变过的目录，单次上限 8 秒、跑不完下次接着来——没有变化时刷新只要百分之几秒。库里条目超过磁盘实际数量 5% 时会自动 prune 掉已经不存在的卡。

### 英文 / 中文界面

界面自带两套语言。右上角的按钮在 **EN** 和 **中文** 之间切换，选择记在 `localStorage` 里；非中文系统首次打开会自动用英文。

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

### 它自己会找游戏目录

工具按这个顺序找 Koikatsu Sunshine：

1. `data\settings.json` —— 上次记住的路径
2. **注册表** —— `HKCU\Software\Illusion\KoikatsuSunshine\KoikatsuSunshine` 的 `INSTALLDIR`，正是社区里 `KoikatuSunshineRegistryFixer.bat` 写的那一项
3. 工具所在目录往上三级（找 `K_K_S`、`KoikatsuSunshine.exe`、`UserData\chara`）
4. `C:` 到 `K:` 各盘根下的常见名字：`kks`、`KKS`、`K_K_S`、`KoikatsuSunshine`、`恋活Sunshine`

找到就写回 `data\settings.json`，只搜这一次。结果显示在左栏底部，**点那一行**可以手动换目录；四个子路径（`chara`、`coordinate`、`Studio\scene`、`mods`）自动推导，隔离区默认在游戏目录旁边的 `隔离区`。

以后把游戏挪走了，点那一行重新指一次即可，其它都不用改。

### 按自己的方式整理卡片

左边那棵树就是磁盘上的 `UserData\chara`。想建多少层子文件夹都行——`抽卡游戏`、`原神`、`22.7.15`，游戏会递归读。工具一次只显示一个文件夹（不递归），选好卡片用「移动…」搬到树里任意位置，目标不存在就用「新建文件夹」建一个。

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
plugins.py         插件清单：合并 Mono.Cecil 扫描结果与 LogOutput.log 的加载结论
tools/scan_plugins.ps1   被 plugins.py 调用的 Cecil 扫描器
static/            index.html、style.css、app.js、i18n.js（无框架、无 CDN）
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
| `GET /api/index` | 索引统计 |
| `GET /api/orphans?cat=summary\|in_use\|orphan\|never` | 按引用状态列出 mod |
| `GET /api/plugins?refresh=1` | 插件清单与加载结论 |
| `POST /api/plugintoggle` | 禁用 / 启用某个插件（`rel`、`enable`） |
| `GET /api/modthumb?path=&entry=` | 从 zipmod 里抽出的缩略图 |
| `POST /api/modclean` | 把选中的 mod 移进隔离区 |

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
