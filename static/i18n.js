/* KKS Card Organizer - UI language (zh / en)
 *
 * The UI was written in Chinese. This file adds an English layer without
 * touching app.js: every text node is looked up in EXACT, then matched
 * against RULES; anything unmatched stays as-is.
 *
 * Switching a language reloads the page, which re-runs the whole pass.
 */
(function () {
  var LANG_KEY = 'kkcard.lang';
  var ZH = 'zh', EN = 'en';

  function detect() {
    try {
      var saved = localStorage.getItem(LANG_KEY);
      if (saved === ZH || saved === EN) return saved;
      return /^zh/i.test(navigator.language || '') ? ZH : EN;
    } catch (e) { return ZH; }
  }

  var lang = detect();

  var EXACT = {
    'KKS 卡片整理器': 'KKS Card Organizer',
    '卡片整理器': 'Card Organizer',
    '正在读取…': 'Reading…',
    '未选择文件夹': 'No folder selected',
    '人物卡': 'Characters',
    '服装卡': 'Outfits',
    '场景卡': 'Scenes',
    '选择文件夹': 'Folders',
    '载入中…': 'Loading…',
    '本地库：读取中…': 'Index: reading…',
    '未选择卡片': 'No card selected',
    '移动到…': 'Move to…',
    '安装…': 'Install…',
    '回收站': 'Recycle bin',
    '隔离删除': 'Quarantine',
    '打开文件夹': 'Open folder',
    '新建文件夹': 'New folder',
    '刷新': 'Refresh',
    'mod 数量不限': 'Any mod count',
    '一张 mod 都没用': 'No mods',
    '1–5 个 mod': '1–5 mods',
    '6–20 个': '6–20',
    '20 个以上': '20+',
    '全部类型': 'All types',
    '读不出的': 'Unreadable',
    '清空筛选': 'Clear filters',
    '先选一个文件夹': 'Pick a folder first',
    '左侧点开任意子文件夹，只读取该文件夹里的卡': 'Open any subfolder on the left — only its cards are read',
    '不会递归，也不会一次加载全部': 'No recursion, nothing is loaded up front',
    '读取中…': 'Reading…',
    '移动到哪个文件夹': 'Move to which folder',
    '还没选目标': 'No target selected',
    '＋ 新建文件夹': '＋ New folder',
    '移动': 'Move',
    '安装一个卡片文件夹': 'Install a card folder',
    '源文件夹路径': 'Source folder',
    '浏览…': 'Browse…',
    '扫描这一层（含子目录）里的 png 卡和 .zipmod：': 'Scan the PNG cards and .zipmod files here (subfolders included):',
    '人物卡 → 放进当前预览的文件夹；服装卡 → 放进 coordinate；mod → 放进游戏 mods；':
      'Character cards → the folder you are viewing; outfits → coordinate; mods → the game mods folder;',
    '认不出的（比如不像 mod 的 zip）→ 放进「未分类」。全部记账，可整批撤销。':
      'Anything unrecognised (e.g. a zip that is not a mod) → 「Unclassified」. Every move is logged and can be undone in bulk.',
    '还没扫描': 'Not scanned yet',
    '卡片（前 20 个）': 'Cards (first 20)',
    'mod 包（前 20 个）': 'Mod packs (first 20)',
    '解包的 mod（前 20 个，会打包成 .zipmod）': 'Unpacked mods (first 20, repacked into .zipmod)',
    '贴图（不安装，留在原处）': 'Overlays (not installed, left in place)',
    '插件数据（前 20 个）': 'Plugin data (first 20)',
    '这个文件夹里没有可安装的东西': 'Nothing installable in this folder',
    '（根目录）': '(root)',
    '带 manifest.xml + abdata 的解包 mod 会自动重新打包成 .zipmod 放进 mods，不动游戏 abdata。':
      'Unpacked mods (manifest.xml + abdata) are repacked into .zipmod and dropped into mods — the game abdata folder is never touched.',
    '贴图和说明文件不自动安装——卡里的 overlay 内嵌在卡里，外面这些只是素材库。':
      'Overlays and readme files are not installed — a card carries its own overlay inside the card file, the loose PNGs are just a library.',
    'BepInEx 的数据文件按原相对路径镜像。全部记账，可在「历史记录」里整批撤销。':
      'Data files under BepInEx are mirrored to the same relative path. Everything is logged and can be undone from History.',
    '历史记录': 'History',
    '扫描': 'Scan',
    '开始安装': 'Install',
    '把选中的': 'Move the selected',
    '张卡移进隔离区，不直接删除：': 'card(s) into quarantine instead of deleting them:',
    '更换…': 'Change…',
    '会保留原来的分类层级，每张卡单独一个文件夹，旁边写一份': 'The original folder hierarchy is kept — one folder per card, with a',
    '记录它引用的 zipmod。': 'file listing the zipmods it references.',
    '批次目录里还有': 'The batch folder also contains',
    '_报告.html': '_report.html',
    '，列出这些卡用过的所有 GUID。': ', listing every GUID these cards used.',
    '连带把「只被这批卡用到」的 mod 一起移走': 'Also move mods used only by these cards',
    '（仍被其它卡引用的不动；一次要扫全库，第一次会慢十几秒）':
      '(mods still used by other cards stay; scans the whole library, slow the first time)',
    '随时可以把文件夹拖回原处还原': 'Drag the folder back at any time to undo',
    '取消': 'Cancel',
    '移入隔离区': 'Move to quarantine',
    '安装历史（最近 10 次）': 'Install history (last 10 runs)',
    '只记录文件位置变更，不备份内容': 'Moves only — nothing is backed up',
    '关闭': 'Close',
    '隔离区 · 还原': 'Quarantine · restore',
    '重新扫描': 'Rescan',
    '还原选中的': 'Restore selected',
    '全部折叠': 'Collapse all',
    '点击重建本地索引': 'Click to rebuild the local index',
    '按名字筛选…': 'Filter by name…',
    '点右边「浏览…」挑一个文件夹': 'Use 「Browse…」 to pick a folder',

    '找不到 coordinate 目录': 'coordinate folder not found',
    '找不到 Studio\\scene 目录': 'Studio\\scene folder not found',
    '无法连接本地服务': 'Cannot reach the local service',
    '本地库：未建立': 'Index: not built',
    '读取目录失败': 'Failed to read folder',
    '没有找到含 png 的文件夹': 'No folder containing PNG files',
    '(根目录)': '(root)',
    '(根)': '(root)',
    '这个文件夹本身没有卡': 'This folder has no cards of its own',
    '在左边点开一个子文件夹看看': 'Open a subfolder on the left',
    ' · 服装卡': ' · outfits',
    '无卡数据': 'No card data',
    '文件不完整': 'Truncated file',
    '不是 PNG': 'Not a PNG',
    '读不出': 'Unreadable',
    '标记未知': 'Unknown marker',
    '解析失败': 'Parse failed',
    '异常': 'Broken',
    '这张 png 的情况': 'About this PNG',
    '未能解析出卡数据': 'Could not parse card data',
    '类型：': 'Type: ',
    '图片尺寸：': 'Image size: ',
    '文件大小：': 'File size: ',
    'PNG 主体结束于：': 'PNG body ends at: ',
    ' 字节': ' bytes',
    '主体之后的追加数据：': 'Appended after the body: ',
    '读到的标记：': 'Marker read: ',
    '服装名：': 'Outfit name: ',
    '存档版本：': 'Save version: ',
    '这是服装卡（coordinate），应该在 UserData\\coordinate 目录里。放在 chara 人物卡目录下游戏读不到，建议移走。':
      'This is an outfit card (coordinate) — it belongs in UserData\\coordinate. The game cannot read it from the chara folder; consider moving them out.',
    '卡片信息': 'Card info',
    '名字：': 'Name: ',
    '名：': 'Name: ',
    '这张卡没有引用任何 zipmod，用的全是游戏自带素材。':
      'This card references no zipmods — it uses only stock game assets.',
    '服装卡目录 coordinate　（把选中的服装卡整批送过去）':
      'Outfit folder (coordinate)　— send the selected outfit cards there',
    '→ coordinate（根目录）': '→ coordinate (root)',
    '移动中…': 'Moving…',
    '移动失败：': 'Move failed: ',
    '部分没动成：': 'Some files were not moved:',
    '打开失败：': 'Open failed: ',
    '调用资源管理器失败：': 'Could not launch Explorer: ',
    '在当前文件夹里新建子文件夹：': 'Create a subfolder in:',
    '新建失败：': 'Create failed: ',
    '调不出选择框：': 'Could not open the folder picker: ',
    '只移动，不删除。卡离开 chara 之后就不会再被游戏读到；想反悔，把文件夹整个拖回原处即可。':
      'Move only, never delete. Once a card leaves chara the game stops seeing it; to undo, drag the whole folder back.',
    '扫描全库中…': 'Scanning the library…',
    '隔离失败：': 'Quarantine failed: ',
    '位置：': 'Location: ',
    '没成功的：': 'Failed:',
    '先在左边选一个文件夹，人物卡会放进那里': 'Pick a folder on the left first — character cards go there',
    '；服装卡 → coordinate；mod → 游戏 mods；': '; outfits → coordinate; mods → the game mods folder;',
    '认不出的（比如不像 mod 的 zip）→「未分类」。全部记账，可在「历史记录」里整批撤销。':
      'Anything unrecognised (e.g. a zip that is not a mod) → 「Unclassified」. All moves are logged; undo in bulk from 「History」.',
    '先选一个源文件夹': 'Pick a source folder first',
    '扫描中…': 'Scanning…',
    '正在扫描…': 'Scanning…',
    '卡片（前 20 个）': 'Cards (first 20)',
    'mod 包（前 20 个）': 'Mod packages (first 20)',
    '这个文件夹里没有卡，也没有 .zipmod': 'No cards and no .zipmod files in this folder',
    '安装中…': 'Installing…',
    '安装失败：': 'Install failed: ',
    '根目录': 'root',
    '什么都没动': 'Nothing was moved',
    '这次操作已记录，可以在「历史记录」里整批撤销。':
      'This run was logged — undo it in bulk from 「History」.',
    '跳过：': 'Skipped:',
    '还没有安装记录': 'No installs recorded yet',
    '未分类': 'Unclassified',
    '已撤销': 'Undone',
    '撤销这次': 'Undo this run',
    '如果原目录已经不存在，那部分会跳过。': 'Parts whose original folder no longer exists are skipped.',
    '撤销失败：': 'Undo failed: ',
    '隔离区是空的': 'The quarantine is empty',
    '（原位置未知）': '(original location unknown)',
    '还原中…': 'Restoring…',
    '还原失败：': 'Restore failed: ',
    '正在重建索引…': 'Rebuilding index…',
    '重建失败，看服务窗口的报错': 'Rebuild failed — check the server window',
    '没有可以带走的 mod（要么都还被别的卡用着，要么本来就没有）':
      'No mods to take along (all are still used by other cards, or there were none)',
    '批次目录里的 _报告.html 列出了全部 GUID。': '_report.html in the batch folder lists every GUID.',
    '这个文件夹里没有卡': 'No cards in this folder',
    '换一个子文件夹试试': 'Try another subfolder',
    '没有符合筛选条件的卡': 'No cards match the filters',
    '换个关键词，或者点「清空筛选」': 'Try another keyword, or click 「Clear filters」',

    '重建本地索引？\n\n会重新检查人物卡目录和 mods 目录里的每一个文件。\n没改动过的文件会直接跳过，通常十几秒；第一次建库要 30 秒左右。':
      'Rebuild the local index?\n\nThis re-checks every file in the card and mods folders.\nUnchanged files are skipped, usually taking ten seconds or so; the first build takes about 30 seconds.',

    '先在左边选一个文件夹，人物卡会放进那里；服装卡 → coordinate；mod → 游戏 mods；':
      'Pick a folder on the left first — character cards go there; outfits → coordinate; mods → the game mods folder; ',
    '人物卡会放进当前预览的文件夹：': 'Character cards go into the folder you are viewing: ',
    '点一张卡看预览': 'Click a card to preview it',
    '单击切换预览，Ctrl 单击多选': 'Click to preview, Ctrl-click to multi-select',
    '收起 / 展开预览栏': 'Collapse / expand preview pane',
    '拖动调整宽度': 'Drag to resize',
    '记录它引用的 zipmod。': 'records the zipmods it referenced.',
    '记录它引用的 zipmod。 批次目录里还有': 'records the zipmods it referenced. The batch folder also holds',
    '批次目录里还有': 'The batch folder also holds',
    '，列出这些卡用过的所有 GUID。': ', listing every GUID these cards used.',

    '游戏目录：读取中…': 'Game folder: reading…',
    '⚠ 没找到游戏目录，点这里指定': '⚠ No game folder found — click to pick one',
    '认不出的（比如不像 mod 的 zip）原样留在原地，不动它们。全部记账，可在「历史记录」里整批撤销。':
      'Anything unrecognised (e.g. a zip that is not a mod) stays where it is. Everything is logged — undo a run in 「History」.',
    '这个目录里没有 KoikatsuSunshine.exe': 'No KoikatsuSunshine.exe in that folder'
  };

  var RULES = [
    [/^游戏目录：(.+)$/, 'Game folder: $1'],
    [/^发现 (\d+) 张卡、(\d+) 个 mod 包$/, 'Found $1 cards, $2 mod packs'],
    [/^发现 (\d+) 张卡、(\d+) 个 mod 包、(\d+) 个解包 mod（会重新打包）$/, 'Found $1 cards, $2 mod packs, $3 unpacked mods (will be repacked)'],
    [/^发现 (\d+) 张卡、(\d+) 个 mod 包、(\d+) 个解包 mod（会重新打包）、(\d+) 张贴图（不安装），另有 (\d+) 个其它文件会跳过$/, 'Found $1 cards, $2 mod packs, $3 unpacked mods (will be repacked), $4 overlays (not installed); $5 other files skipped'],
    [/^…还有 (\d+) 张$/, '…$1 more'],
    [/^…还有 (\d+) 个$/, '…$1 more'],
    [/^卡片 → (.+)；服装卡 → coordinate；mod → mods。$/, 'Cards → $1; outfits → coordinate; mods → mods.'],
    [/^(\d+) 张卡 \/ (\d+) 个 mod \/ (\d+) 个解包 mod \/ (\d+) 张贴图 \/ (\d+) 个数据$/, '$1 cards / $2 mods / $3 unpacked / $4 overlays / $5 data'],
    [/^(\d+) 张卡 \/ (\d+) 个 mod \/ (\d+) 个解包 mod \/ (\d+) 张贴图$/, '$1 cards / $2 mods / $3 unpacked / $4 overlays'],
    [/^(\d+) 张卡 \/ (\d+) 个 mod \/ (\d+) 个解包 mod$/, '$1 cards / $2 mods / $3 unpacked'],
    [/^(\d+) 张卡 \/ (\d+) 个 mod \/ (\d+) 张贴图$/, '$1 cards / $2 mods / $3 overlays'],
    [/^(\d+) 张卡 \/ (\d+) 个 mod$/, '$1 cards / $2 mods'],
    [/^贴图 (\d+) 张留在原处没装（要当素材用请自己拖进 UserData\\Overlays\\）$/, '$1 overlays left in place (drag them into UserData\\Overlays\\ yourself if you want them)'],
    [/^解包的 mod (\d+) 个 → 已重新打包成 zipmod 放进 mods$/, '$1 unpacked mods → repacked as .zipmod into mods'],
    [/^认不出的 (\d+) 个留在原地没动（比如不像 mod 的 zip）$/, '$1 file(s) left untouched (e.g. a zip that is not a mod)'],
    [/^(Koikatsu Sunshine|Koikatsu|Koikatu)[\s\u00a0]+人物卡([\s\S]*)$/, '$1 character card$2'],
    [/^(Koikatsu Sunshine|Koikatsu|Koikatu)[\s\u00a0]+服装卡([\s\S]*)$/, '$1 outfit card$2'],
    [/^(Koikatsu Sunshine|Koikatsu|Koikatu)[\s\u00a0]+场景卡([\s\S]*)$/, '$1 scene card$2'],
    [/^(\d+) 张（另有 (\d+) 个异常）$/, '$1 cards ($2 broken)'],
    [/^本地库：(\d+) 张卡 · (\d+) 个 mod（([\d.]+) MB）$/, 'Index: $1 cards · $2 mods ($3 MB)'],
    [/^(.+)　共 (\d+) 张（本层 (\d+) 张）$/, '$1　— $2 total ($3 here)'],
    [/^(\d+) 张（在子文件夹）$/, '$1 cards (in subfolders)'],
    [/^（另有 (\d+) 个异常）$/, ' ($1 broken)'],
    [/^本层有 (\d+) 个 png 读不出卡数据，排在最后（灰色）$/, '$1 PNG(s) here are not cards — listed last, greyed out'],
    [/^筛出 (\d+) \/ (\d+)$/, 'Matching $1 / $2'],
    [/^读取 (\d+) 张卡…$/, 'Reading $1 cards…'],
    [/^已选 (\d+) 张$/, 'Selected $1'],
    [/^依赖的 mod（(\d+)）$/, 'Required mods ($1)'],
    [/^已隔离 (\d+) 张卡$/, 'Quarantined $1 card(s)'],
    [/^它有 (\d+) 个子文件夹、共 (\d+) 张卡$/, 'It has $1 subfolder(s) holding $2 cards'],
    [/^发现 (\d+) 张卡、(\d+) 个 mod 包，另有 (\d+) 个其它文件会跳过$/, 'Found $1 cards and $2 mod packages; $3 other files will be skipped'],
    [/^…还有 (\d+) 张$/, '…and $1 more'],
    [/^…还有 (\d+) 个$/, '…and $1 more'],
    [/^…还有 (\d+) 条$/, '…and $1 more'],
    [/^(\d+) 张卡 \/ (\d+) 个 mod$/, '$1 cards / $2 mods'],
    [/^(\d+) 个 mod$/, '$1 mods'],
    [/^(\d+) 张$/, '$1 cards'],
    [/^(\d+) 个文件$/, '$1 files'],
    [/^人物卡 (\d+) 张 → (.+)$/, 'Character cards $1 → $2'],
    [/^服装卡 (\d+) 张 → coordinate$/, 'Outfit cards $1 → coordinate'],
    [/^mod (\d+) 个 → mods$/, 'Mods $1 → mods'],
    [/^认不出的 (\d+) 个 → 未分类$/, 'Unrecognised $1 → Unclassified'],
    [/^同时移走了 (\d+) 个只被这批卡使用的 mod$/, 'Also moved $1 mod(s) used only by these cards'],
    [/^这些卡一共引用了 (\d+) 个 zipmod。$/, 'These cards reference $1 zipmods in total.'],
    [/^已搬回 (\d+) 个文件$/, 'Moved back $1 file(s)'],
    [/^已还原 (\d+) 张卡$/, 'Restored $1 card(s)'],
    [/^还原选中的 (\d+) 张$/, 'Restore $1 selected'],
    [/^把选中的 (\d+) 张卡搬回它们原来的文件夹？$/, 'Move $1 selected card(s) back to their original folders?'],
    [/^把这次安装的 (\d+) 个文件搬回原处？$/, 'Move the $1 file(s) from this run back where they came from?'],
    [/^在「(.+)」里新建文件夹：$/, 'Create a folder inside 「$1」:'],
    [/^装到 (.+)$/, 'Into $1']
  ];

  // zipmod 用途片段翻译：第5套 · 服装 · 手套 / 第5套 · 饰品槽 ×46 / 面部 · 脸型
  var PART = {
    '上衣': 'Top', '下装': 'Bottoms', '内衣': 'Bra', '内裤': 'Panties',
    '手套': 'Gloves', '丝袜': 'Pantyhose', '鞋子': 'Shoes', '连身裙': 'Onepiece',
    '身体': 'Body', '面部': 'Face', '头发': 'Hair', '服装': 'Clothing',
    '饰品': 'Accessory', '化妆': 'Makeup', '角色参数': 'Parameter', '状态': 'Status',
    '饰品槽': 'Accessory slot',
    '脸型': 'Face shape', '鼻子': 'Nose', '体型': 'Body type',
    '细节贴图': 'Detail texture', '涂装2': 'Paint 2', '涂装1': 'Paint 1',
    '眉毛': 'Eyebrows', '眼睛': 'Eyes', '嘴': 'Mouth', '发型': 'Hairstyle',
    '底色': 'Base colour', '妆容': 'Makeup', '皮肤': 'Skin'
  };

  function partTr(s) {
    function one(chunk) {
      return chunk.split(' · ').map(function (seg) {
        var m = /^第(\d+)套$/.exec(seg);
        if (m) return 'Outfit ' + m[1];
        m = /^饰品槽(\d+)$/.exec(seg);
        if (m) return 'Accessory slot ' + m[1];
        m = /^(.*?) ×(\d+)$/.exec(seg);
        if (m) return (PART[m[1]] || m[1]) + ' ×' + m[2];
        return PART[seg] || seg;
      }).join(' · ');
    }
    return s.split('、').map(one).join(', ');
  }

  function tr(s) {
    if (lang === ZH) return s;
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    if (!m) return s;
    var lead = m[1], core = m[2], tail = m[3];
    if (!core) return s;
    if (EXACT.hasOwnProperty(core)) return lead + EXACT[core] + tail;
    var norm = core.replace(/[\s\u00a0]+/g, ' ');
    if (norm !== core && EXACT.hasOwnProperty(norm)) return lead + EXACT[norm] + tail;
    for (var i = 0; i < RULES.length; i++) {
      if (RULES[i][0].test(core)) return lead + core.replace(RULES[i][0], RULES[i][1]) + tail;
    }
    if (/第\d+套|饰品槽\d/.test(core)) return lead + partTr(core) + tail;
    return s;
  }

  var applied = new WeakMap();

  function doText(node) {
    var cur = node.nodeValue;
    if (!cur) return;
    if (applied.get(node) === cur) return;
    var next = tr(cur);
    if (next !== cur) {
      node.nodeValue = next;
      applied.set(node, next);
    }
  }

  function doAttrs(el) {
    ['placeholder', 'title', 'aria-label'].forEach(function (a) {
      var v = el.getAttribute && el.getAttribute(a);
      if (!v) return;
      var next = tr(v);
      if (next !== v) el.setAttribute(a, next);
    });
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) doAttrs(root);
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
    var n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 3) doText(n);
      else doAttrs(n);
    }
  }

  var queue = [];
  var pending = false;
  var mo = new MutationObserver(function (records) {
    if (lang === ZH) return;
    for (var k = 0; k < records.length; k++) queue.push(records[k]);
    if (pending) return;
    pending = true;
    setTimeout(function () {
      pending = false;
      var list = queue;
      queue = [];
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        if (r.type === 'characterData') doText(r.target);
        else for (var j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j]);
      }
    }, 60);
  });

  function start() {
    document.documentElement.lang = lang === ZH ? 'zh-CN' : 'en';
    if (lang === EN) {
      var t = document.querySelector('title');
      if (t) t.textContent = 'KKS Card Organizer';
      walk(document.body);
      mo.observe(document.body, { childList: true, subtree: true, characterData: true });
      setTimeout(function () { walk(document.body); }, 400);
      setTimeout(function () { walk(document.body); }, 1500);
    } else {
      mo.observe(document.body, { childList: true, subtree: true });
    }
    var btn = document.getElementById('langBtn');
    if (btn) {
      btn.textContent = lang === ZH ? 'EN' : '中文';
      btn.title = lang === ZH ? 'Switch to English' : '切换到中文';
      btn.addEventListener('click', function () {
        try { localStorage.setItem(LANG_KEY, lang === ZH ? EN : ZH); } catch (e) {}
        location.reload();
      });
    }
  }

  window.I18N = { lang: lang, t: tr, walk: walk };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
