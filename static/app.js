/* KKS 卡片整理器 · 前端 */
'use strict';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 前端出了错就记到 logs\frontend.log，方便回头查
function reportError(where, msg, stack) {
  try {
    fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ where: where || '', msg: String(msg || ''), stack: String(stack || '') }),
    }).catch(() => {});
  } catch (e) { /* 上报失败就算了 */ }
}
window.addEventListener('error', (ev) => {
  if (ev && ev.message) reportError((ev.filename || '') + ':' + (ev.lineno || 0), ev.message, ev.error && ev.error.stack);
});
window.addEventListener('unhandledrejection', (ev) => {
  const r = ev && ev.reason;
  reportError('promise', (r && r.message) || String(r), r && r.stack);
});

const state = {
  tree: [],
  nodes: new Map(),
  current: null,
  cards: [],
  visible: [],
  sel: new Set(),
  lastPick: null,
  onlyCards: true,
  moveTarget: null,
  root: 'chara',
};

let ROOT = '';
let ROOTPATH = { chara: '', coord: '', scene: '' };

function withRoot(url) {
  return url + (url.includes('?') ? '&' : '?') + 'root=' + state.root;
}

/* ------------------------------------------------------------ 启动 */
/* 树的点击统一在这里处理（事件委托，节点重建也不会丢） */
$('#tree').addEventListener('click', onTreeClick);

async function boot() {
  try {
    const cfg = await (await fetch('/api/config')).json();
    ROOTPATH.chara = cfg.root || '';
    ROOTPATH.coord = cfg.coord || '';
    ROOTPATH.scene = cfg.scene || '';
    ROOT = ROOTPATH.chara;
    RECYCLE = cfg.recycle || '';
    $('#rootPath').textContent = ROOT || '未设置游戏目录';
    showGameLine(cfg);
    const bc = document.querySelector('.rootbtn[data-root="coord"]');
    if (bc && !cfg.has_coord) { bc.disabled = true; bc.title = '找不到 coordinate 目录'; }
    const bs = document.querySelector('.rootbtn[data-root="scene"]');
    if (bs && !cfg.has_scene) { bs.disabled = true; bs.title = '找不到 Studio\\scene 目录'; }
    if (cfg.version && $('#verTag')) $('#verTag').textContent = 'v' + cfg.version;
  } catch (e) {
    $('#rootPath').textContent = '无法连接本地服务';
  }
  loadIndexInfo();
  await loadTree(true);
}

function showGameLine(cfg) {
  const el2 = $('#gameLine');
  if (!el2) return;
  if (cfg.game_ok) {
    el2.textContent = '游戏目录：' + cfg.game;
    el2.classList.remove('bad');
    el2.title = '点击重新查找游戏目录';
  } else {
    el2.textContent = '⚠ 没找到游戏目录，点这里指定';
    el2.classList.add('bad');
    el2.title = '点击选择 KoikatsuSunshine 所在文件夹';
  }
}

async function detectGame(manual) {
  let game = '';
  if (manual) {
    game = await pickFolder('');
    if (!game) return;
  }
  const r = await (await fetch('/api/detect', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ game })
  })).json();
  if (!r.ok) { alert(r.error || '没找到'); return; }
  location.reload();
}

async function loadIndexInfo() {
  const el = $('#idxInfo');
  if (!el) return;
  try {
    const d = await (await fetch('/api/index', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'})).json();
    el.textContent = `本地库：${d.cards} 张卡 · ${d.mods} 个 mod（${(d.db / 1048576).toFixed(1)} MB）`;
  } catch (e) {
    el.textContent = '本地库：未建立';
  }
}

async function switchRoot(name) {
  if (state.root === name) return;
  state.root = name;
  document.querySelectorAll('.rootbtn').forEach((b) => {
    b.classList.toggle('active', b.dataset.root === name);
  });
  state.nodes = new Map();
  state.current = null;
  state.cards = [];
  state.visible = [];
  state.sel.clear();
  state.lastPick = null;
  ROOT = ROOTPATH[name] || '';
  $('#rootPath').textContent = ROOT;
  $('#pillDir').textContent = '未选择文件夹';
  $('#tbDir').textContent = '未选择文件夹';
  $('#pillCount').textContent = '—';
  $('#detail').classList.add('hidden');
  $('#gridWrap').classList.add('hidden');
  $('#emptyState').classList.remove('hidden');
  $('.es-icon').textContent = '🗂';
  $('.es-title').textContent = '先选一个文件夹';
  $('.es-sub').innerHTML = '左侧点开任意子文件夹，只读取该文件夹里的卡<br><span class="mono">不会递归，也不会一次加载全部</span>';
  updateSelection();
  await loadTree(true);
}

/* ------------------------------------------------------------ 目录树 */
async function loadTree(initial) {
  const box = $('#tree');
  if (initial) {
    box.textContent = '';
    box.appendChild(el('div', 'tree-empty', '载入中…'));
  }
  const keep = new Set();
  state.nodes.forEach((n) => { if (n.open) keep.add(n.path); });

  let data;
  try {
    data = await (await fetch(withRoot('/api/tree' + (initial ? '' : '?refresh=1')))).json();
  } catch (e) {
    if (initial) { box.textContent = ''; box.appendChild(el('div', 'tree-empty', '读取目录失败')); }
    return;
  }
  state.tree = data.dirs || [];
  buildNodes();
  keep.forEach((p) => { const n = state.nodes.get(p); if (n) n.open = true; });
  if (state.current) {
    const n = state.nodes.get(state.current);
    if (n) n.open = true;
  }

  box.textContent = '';
  const rootNode = state.nodes.get('');
  if (!rootNode || (!rootNode.children.length && rootNode.own === 0)) {
    box.appendChild(el('div', 'tree-empty', '没有找到含 png 的文件夹'));
    return;
  }
  rootNode.children.sort(cmpNode);
  if (!rootNode.children.length) {
    // 目录是平铺的（比如 coordinate），只有根这一层
    box.appendChild(renderNode(rootNode, 0));
    return;
  }
  rootNode.children.forEach((n) => box.appendChild(renderNode(n, 0)));
}

function cmpNode(a, b) {
  const an = a.path.split('/').pop(), bn = b.path.split('/').pop();
  return an.localeCompare(bn, 'zh-CN');
}

function buildNodes() {
  state.nodes = new Map();
  const ensure = (path) => {
    if (state.nodes.has(path)) return state.nodes.get(path);
    const n = { path, own: 0, total: 0, children: [], open: false };
    state.nodes.set(path, n);
    if (path) {
      const i = path.lastIndexOf('/');
      ensure(i < 0 ? '' : path.slice(0, i)).children.push(n);
    }
    return n;
  };
  ensure('');
  state.tree.forEach((d) => { ensure(d.path).own = d.own; });
  const calc = (n) => {
    n.total = n.own;
    n.children.forEach((c) => { n.total += calc(c); });
    return n.total;
  };
  state.nodes.get('').children.forEach(calc);
  const rt = state.nodes.get('');
  rt.total = rt.own;
  rt.children.forEach((c) => { rt.total += calc(c); });
}

function ensureNodePath(path) {
  if (state.nodes.has(path)) return state.nodes.get(path);
  const n = { path, own: 0, total: 0, children: [], open: false };
  state.nodes.set(path, n);
  if (path) {
    const i = path.lastIndexOf('/');
    const parent = ensureNodePath(i < 0 ? '' : path.slice(0, i));
    if (!parent.children.includes(n)) parent.children.push(n);
  }
  return n;
}

function renderNode(node, depth) {
  const wrap = el('div');
  const row = el('div', 'node');
  row.style.paddingLeft = (8 + depth * 14) + 'px';
  row.dataset.path = node.path;

  const hasKids = node.children.length > 0;
  const caret = el('span', 'caret' + (node.open ? ' open' : ''), hasKids ? '▶' : '');
  if (!hasKids) caret.className = 'leaf';
  row.appendChild(caret);
  row.appendChild(el('span', 'nm', node.path.split('/').pop() || (state.root === 'coord' ? 'coordinate' : 'chara')));
  row.classList.toggle('zero', node.total === 0);
  row.appendChild(el('span', 'ct', String(node.total)));
  row.title = (node.path || '(根目录)') + '　共 ' + node.total + ' 张（本层 ' + node.own + ' 张）';

  const kids = el('div', 'children');
  if (!node.open) kids.classList.add('hidden');

  const drawKids = () => {
    kids.textContent = '';
    node.children.sort(cmpNode);
    node.children.forEach((c) => kids.appendChild(renderNode(c, depth + 1)));
  };

  wrap.appendChild(row);
  wrap.appendChild(kids);
  if (node.open) drawKids();
  return wrap;
}

/* 树的点击统一在这里处理（事件委托，避免节点重建后监听器丢失） */
function rerenderTree() {
  const box = $('#tree');
  box.textContent = '';
  const rootNode = state.nodes.get('');
  if (!rootNode) return;
  if (!rootNode.children.length) {
    box.appendChild(renderNode(rootNode, 0));
    return;
  }
  rootNode.children.sort(cmpNode);
  rootNode.children.forEach((n) => box.appendChild(renderNode(n, 0)));
}

function markActive(path) {
  document.querySelectorAll('.node.active').forEach((n) => n.classList.remove('active'));
  const r = document.querySelector('.node[data-path="' + String(path).replace(/"/g, '\\"') + '"]');
  if (r) r.classList.add('active');
}

function onTreeClick(ev) {
  const row = ev.target.closest ? ev.target.closest('.node') : null;
  if (!row) return;
  const path = row.dataset.path || '';
  const node = state.nodes.get(path);
  if (!node) return;
  const hasKids = node.children.length > 0;

  if (ev.target.classList && ev.target.classList.contains('caret') && hasKids) {
    node.open = !node.open;
    rerenderTree();
    markActive(state.current || '');
    return;
  }
  if (node.own === 0 && hasKids) {
    node.open = true;
    rerenderTree();
    pickDir(node, document.querySelector('.node[data-path="' + String(path).replace(/"/g, '\\"') + '"]') || row, true);
    return;
  }
  pickDir(node, row, false);
}

function pickDir(node, row, justExpand) {
  document.querySelectorAll('.node.active').forEach((n) => n.classList.remove('active'));
  row.classList.add('active');
  if (justExpand) {
    state.current = node.path;
    state.cards = [];
    state.visible = [];
    state.sel.clear();
    $('#pillDir').textContent = node.path;
    $('#pillCount').textContent = node.total + ' 张（在子文件夹）';
    $('#tbDir').textContent = node.path;
    $('#gridWrap').classList.add('hidden');
    $('#loading').classList.add('hidden');
    $('#detail').classList.add('hidden');
    $('#emptyState').classList.remove('hidden');
    $('.es-icon').textContent = '📁';
    $('.es-title').textContent = '这个文件夹本身没有卡';
    $('.es-sub').innerHTML = '它有 ' + node.children.length + ' 个子文件夹、共 ' +
      node.total + ' 张卡<br><span class="mono">在左边点开一个子文件夹看看</span>';
    updateSelection();
    return;
  }
  loadDir(node.path, node.own);
}

/* ------------------------------------------------------------ 卡列表 */
async function loadDir(dir, own) {
  state.current = dir;
  state.sel.clear();
  state.lastPick = null;
  $('#pillDir').textContent = (dir || '(根)') + (state.root === 'coord' ? ' · 服装卡' : '');
  $('#tbDir').textContent = dir || '(根)';
  $('#detail').classList.add('hidden');
  $('#emptyState').classList.add('hidden');
  $('#gridWrap').classList.add('hidden');
  $('#loading').classList.remove('hidden');
  $('.es-icon').textContent = '🗂';
  $('.es-title').textContent = '先选一个文件夹';
  $('.es-sub').innerHTML = '左侧点开任意子文件夹，只读取该文件夹里的卡<br><span class="mono">不会递归，也不会一次加载全部</span>';
  $('#loadingText').textContent = '读取 ' + (own || '') + ' 张卡…';

  let data;
  try {
    data = await (await fetch(withRoot('/api/cards?dir=' + encodeURIComponent(dir)))).json();
  } catch (e) {
    $('#loading').classList.add('hidden');
    return;
  }
  $('#loading').classList.add('hidden');
  if (data.error) { alert(data.error); return; }
  state.cards = data.cards || [];
  renderGrid();
  updateSelection();
}

const BAD_KIND = {
  plain: '无卡数据',
  truncated: '文件不完整',
  notpng: '不是 PNG',
  unreadable: '读不出',
  unknown: '标记未知',
  broken: '解析失败',
  scene: '场景卡',
};

function applyFilter(list) {
  const name = ($('#fName').value || '').trim().toLowerCase();
  const mod = $('#fMod').value || '';
  const typ = $('#fType').value || '';
  let out = list;
  if (name) out = out.filter((c) => (c.name || '').toLowerCase().includes(name));
  if (typ) {
    out = out.filter((c) => (typ === 'bad'
      ? !isCardKind(c) : c.kind === typ));
  }
  if (mod) {
    out = out.filter((c) => {
      const n = (c.refs || []).length;
      if (mod === 'zero') return n === 0;
      if (mod === 'few') return n >= 1 && n <= 5;
      if (mod === 'mid') return n >= 6 && n <= 20;
      return n > 20;
    });
  }
  return out;
}

function renderGrid() {
  const grid = $('#grid');
  grid.textContent = '';
  const all = state.cards.slice();
  const bad = all.filter((c) => !isCardKind(c));
  const cards = all.filter(isCardKind);
  let visible = cards.concat(bad);
  const filtered = applyFilter(visible);

  $('#pillCount').textContent = (all.length - bad.length) + ' 张' +
    (bad.length ? '（另有 ' + bad.length + ' 个异常）' : '');
  $('#skipInfo').textContent = bad.length
    ? '本层有 ' + bad.length + ' 个 png 读不出卡数据，排在最后（灰色）'
    : '';

  const on = ($('#fName').value || '').trim() || $('#fMod').value || $('#fType').value;
  $('#fCount').textContent = on ? ('筛出 ' + filtered.length + ' / ' + visible.length) : '';
  $('#filterBar').classList.toggle('hidden', !all.length);

  state.visible = filtered;

  if (!visible.length) {
    $('#gridWrap').classList.add('hidden');
    $('#emptyState').classList.remove('hidden');
    $('.es-icon').textContent = '📂';
    $('.es-title').textContent = '这个文件夹里没有卡';
    $('.es-sub').textContent = '换一个子文件夹试试';
    return;
  }
  if (!filtered.length) {
    $('#gridWrap').classList.add('hidden');
    $('#emptyState').classList.remove('hidden');
    $('.es-icon').textContent = '🔍';
    $('.es-title').textContent = '没有符合筛选条件的卡';
    $('.es-sub').textContent = '换个关键词，或者点「清空筛选」';
    return;
  }
  $('#emptyState').classList.add('hidden');
  $('#gridWrap').classList.remove('hidden');

  const frag = document.createDocumentFragment();
  state.visible.forEach((c) => frag.appendChild(renderCard(c)));
  grid.appendChild(frag);
}

function tagOf(c) {
  if (c.marker === '【KoiKatuCharaSun】') return { cls: 'sun', txt: 'KKS' };
  if (c.marker === '【KoiKatuChara】') return { cls: 'kk', txt: 'KK' };
  if (c.marker === '【KoiKatuCharaSP】') return { cls: 'kk', txt: 'KKSP' };
  if (c.marker === '【KoiKatuClothes】') return { cls: 'cloth', txt: '服装卡' };
  if (c.marker === '【EroMakeChara】') return { cls: 'cloth', txt: 'EC' };
  if (c.kind === 'coord') return { cls: 'cloth', txt: '服装卡' };
  if (c.kind === 'scene') return { cls: 'scene', txt: '场景卡' };
  return { cls: 'err', txt: BAD_KIND[c.kind] || '异常' };
}

function isCardKind(c) {
  return c.kind === 'card' || c.kind === 'coord' || c.kind === 'scene';
}

function relOf(c) {
  return (state.current ? state.current + '/' : '') + c.name;
}

function renderCard(c) {
  const badKind = !isCardKind(c);
  const box = el('div', 'card' + (badKind ? ' bad' : ''));
  box.dataset.name = c.name;

  const img = document.createElement('img');
  img.className = 'thumb';
  img.loading = 'lazy';
  img.alt = c.name;
  img.src = withRoot('/api/thumb?path=' + encodeURIComponent(relOf(c)));
  img.addEventListener('error', () => img.replaceWith(el('div', 'thumb ph', '?')));
  box.appendChild(img);

  box.appendChild(el('div', 'pickno', ''));
  const refs = (c.refs || []).length;
  if (badKind) {
    box.appendChild(el('div', 'refs err', BAD_KIND[c.kind] || '异常'));
  } else {
    box.appendChild(el('div', 'refs' + (refs === 0 ? ' zero' : ''), refs + ' mod'));
  }

  const meta = el('div', 'meta');
  meta.appendChild(el('div', 'nm', c.name.replace(/\.png$/i, '')));
  const t = tagOf(c);
  meta.appendChild(el('span', 'tag ' + t.cls, t.txt));
  box.appendChild(meta);

  box.addEventListener('click', (ev) => onCardClick(c, ev));
  return box;
}

function onCardClick(c, ev) {
  const name = c.name;
  if (ev.ctrlKey || ev.metaKey) {
    if (state.sel.has(name)) state.sel.delete(name);
    else state.sel.add(name);
  } else if (ev.shiftKey && state.lastPick) {
    const names = state.visible.map((x) => x.name);
    const a = names.indexOf(state.lastPick);
    const b = names.indexOf(name);
    if (a >= 0 && b >= 0) {
      const [s, e] = a < b ? [a, b] : [b, a];
      state.sel = new Set(names.slice(s, e + 1));
    } else {
      state.sel = new Set([name]);
    }
  } else {
    state.sel = new Set([name]);
  }
  state.lastPick = name;
  updateSelection();
  if (state.sel.size === 1 && state.sel.has(name)) {
    showDetail(c, relOf(c));
  } else if (state.sel.size > 1) {
    $('#detail').classList.add('hidden');
  }
}

function updateSelection() {
  const picked = [...state.sel];
  document.querySelectorAll('.card').forEach((n) => {
    const i = picked.indexOf(n.dataset.name);
    n.classList.toggle('picked', i >= 0);
    const no = n.querySelector('.pickno');
    if (no) no.textContent = i >= 0 && picked.length > 1 ? String(i + 1) : '';
  });
  const n = picked.length;
  $('#selInfo').textContent = n ? '已选 ' + n + ' 张' : '未选择卡片';
  $('#selInfo').classList.toggle('has', n > 0);
  $('#btnMove').disabled = n === 0;
  $('#btnQuar').disabled = n === 0;
}

/* ------------------------------------------------------------ 详情 */
function showDetail(c, rel) {
  const d = $('#detail');
  d.classList.remove('hidden');
  const body = $('#detBody');
  body.textContent = '';

  const hero = document.createElement('img');
  hero.className = 'det-hero';
  hero.src = withRoot('/api/thumb?path=' + encodeURIComponent(rel));
  body.appendChild(hero);
  body.appendChild(el('div', 'det-file', c.name));
  body.appendChild(el('div', 'det-type', (c.label || c.kind || '') + '　' + fmtSize(c.size)));

  if (c.kind !== 'card' && c.kind !== 'coord' && c.kind !== 'scene') {
    body.appendChild(el('div', 'det-sec', '这张 png 的情况'));
    const warn = el('div', 'det-warn');
    warn.textContent = c.reason || (BAD_KIND[c.kind] || '未能解析出卡数据');
    body.appendChild(warn);

    const kv2 = el('div', 'det-kv');
    kv2.appendChild(el('div', '', '类型：' + (BAD_KIND[c.kind] || c.kind)));
    if (c.w && c.h) kv2.appendChild(el('div', '', '图片尺寸：' + c.w + ' × ' + c.h));
    kv2.appendChild(el('div', '', '文件大小：' + fmtSize(c.size)));
    if (c.png_end) kv2.appendChild(el('div', '', 'PNG 主体结束于：' + c.png_end.toLocaleString() + ' 字节'));
    if (typeof c.tail === 'number') kv2.appendChild(el('div', '', '主体之后的追加数据：' + c.tail.toLocaleString() + ' 字节'));
    if (c.marker) kv2.appendChild(el('div', '', '读到的标记：' + c.marker));
    body.appendChild(kv2);
    return;
  }

  const p = c.param || {};
  if (c.kind === 'coord') {
    body.appendChild(el('div', 'det-sec', '服装卡'));
    const kv = el('div', 'det-kv');
    if (p.coordName) kv.appendChild(el('div', '', '服装名：' + p.coordName));
    if (p.loadVersion) kv.appendChild(el('div', '', '存档版本：' + p.loadVersion));
    kv.appendChild(el('div', '', '类型：' + (c.label || '服装卡')));
    body.appendChild(kv);
    if (state.root === 'chara') {
      body.appendChild(el('div', 'det-warn info',
        '这是服装卡（coordinate），应该在 UserData\\coordinate 目录里。放在 chara 人物卡目录下游戏读不到，建议移走。'));
    }
  } else if (p.fullname || p.name || p.sex) {
    body.appendChild(el('div', 'det-sec', '卡片信息'));
    const kv = el('div', 'det-kv');
    if (p.fullname) kv.appendChild(el('div', '', '名字：' + p.fullname));
    if (p.name) kv.appendChild(el('div', '', '名：' + p.name));
    body.appendChild(kv);
  }

  const refs = c.refs || [];
  body.appendChild(el('div', 'det-sec', '依赖的 mod（' + refs.length + '）'));
  if (!refs.length) {
    body.appendChild(el('div', 'det-warn info', '这张卡没有引用任何 zipmod，用的全是游戏自带素材。'));
  } else {
    refs.forEach((r) => {
      const row = el('div', 'ref');
      row.appendChild(el('div', 'dot'));
      const g = el('div', 'g');
      g.appendChild(el('b', '', r.guid));
      const sub = [(r.props || []).join('、'), r.name || '', r.author ? 'by ' + r.author : '']
        .filter(Boolean).join('　');
      if (sub) g.appendChild(el('span', '', sub));
      row.appendChild(g);
      body.appendChild(row);
    });
  }
}

function fmtSize(n) {
  if (!n) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

/* ------------------------------------------------------------ 移动 */
function openMove() {
  if (!state.sel.size) return;
  state.moveTarget = null;
  $('#moveTarget').textContent = '还没选目标';
  $('#moveOk').disabled = true;
  const autoOpen = new Set();
  if (state.current) {
    const parts = state.current.split('/');
    for (let i = 1; i <= parts.length; i++) autoOpen.add(parts.slice(0, i).join('/'));
  }
  state.moveAutoOpen = autoOpen;

  const box = $('#moveTree');
  box.textContent = '';
  state.moveToRoot = state.root;
  if (state.root === 'chara') {
    const row = el('div', 'mnode coord-target', '服装卡目录 coordinate　（把选中的服装卡整批送过去）');
    row.addEventListener('click', () => {
      document.querySelectorAll('.mnode.sel').forEach((x) => x.classList.remove('sel'));
      row.classList.add('sel');
      state.moveTarget = '';
      state.moveToRoot = 'coord';
      $('#moveTarget').textContent = '→ coordinate（根目录）';
      $('#moveOk').disabled = false;
    });
    box.appendChild(row);
    box.appendChild(el('div', 'mnode-sep'));
  }
  const root = state.nodes.get('');
  if (root) {
    root.children.sort(cmpNode);
    root.children.forEach((n) => box.appendChild(renderMoveNode(n, 0)));
  }
  $('#moveModal').classList.remove('hidden');

  const same = box.querySelector('.mnode.same');
  if (same) same.scrollIntoView({ block: 'center' });
}

function renderMoveNode(node, depth) {
  const wrap = el('div');
  const row = el('div', 'mnode');
  row.style.paddingLeft = (10 + depth * 14) + 'px';
  row.classList.toggle('same', node.path === state.current);

  const hasKids = node.children.length > 0;
  const caret = el('span', 'caret', hasKids ? '▶' : '');
  row.appendChild(caret);
  row.appendChild(el('span', 'nm', node.path.split('/').pop()));
  row.appendChild(el('span', 'ct', String(node.total)));

  const kids = el('div');
  kids.classList.add('hidden');
  let drawn = false;
  const auto = state.moveAutoOpen && state.moveAutoOpen.has(node.path);

  const drawKids = () => {
    if (drawn) return;
    node.children.sort(cmpNode);
    node.children.forEach((c) => kids.appendChild(renderMoveNode(c, depth + 1)));
    drawn = true;
  };

  row.addEventListener('click', (ev) => {
    if (ev.target === caret && hasKids) {
      const open = !kids.classList.contains('hidden');
      if (open) {
        kids.classList.add('hidden');
        caret.classList.remove('open');
      } else {
        drawKids();
        kids.classList.remove('hidden');
        caret.classList.add('open');
      }
      return;
    }
    row.classList.add('sel');
    document.querySelectorAll('.mnode.sel').forEach((x) => x.classList.remove('sel'));
    row.classList.add('sel');
    state.moveTarget = node.path;
    $('#moveTarget').textContent = '→ ' + node.path;
    $('#moveOk').disabled = node.path === state.current;
  });
  wrap.appendChild(row);
  wrap.appendChild(kids);
  if (auto && hasKids) {
    drawKids();
    kids.classList.remove('hidden');
    caret.classList.add('open');
  }
  return wrap;
}

async function doMove() {
  if (state.moveTarget === null || state.moveTarget === undefined) return;
  const files = [...state.sel];
  $('#moveOk').disabled = true;
  $('#moveOk').textContent = '移动中…';
  let r;
  try {
    r = await (await fetch('/api/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: state.current, to: state.moveTarget, files, root: state.root,
        to_root: state.moveToRoot || state.root,
      }),
    })).json();
  } catch (e) {
    r = { error: String(e) };
  }
  $('#moveOk').textContent = '移动';
  $('#moveOk').disabled = false;
  $('#moveModal').classList.add('hidden');
  if (r.error) { alert('移动失败：' + r.error); return; }
  if (r.errors && r.errors.length) {
    alert('部分没动成：\n' + r.errors.join('\n'));
  }
  state.sel.clear();
  await loadTree(false);
  if (state.current !== null) {
    const n = state.nodes.get(state.current);
    await loadDir(state.current, n ? n.own : 0);
  }
}

/* ------------------------------------------------------------ 其它操作 */
async function openFolder() {
  if (state.current === null) return;
  try {
    const r = await (await fetch('/api/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: state.current, root: state.root }),
    })).json();
    if (r.error) alert('打开失败：' + r.error);
  } catch (e) {
    alert('调用资源管理器失败：' + e);
  }
}

async function newFolder() {
  if (state.current === null) { alert('先选一个文件夹'); return; }
  const name = prompt('在当前文件夹里新建子文件夹：\n' + state.current);
  if (!name) return;
  let r;
  try {
    r = await (await fetch('/api/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: state.current, name, root: state.root }),
    })).json();
  } catch (e) {
    alert('新建失败：' + e);
    return;
  }
  if (r.error) { alert(r.error); return; }
  await loadTree(false);
  const np = state.current ? state.current + '/' + name : name;
  const n = ensureNodePath(np);
  const parent = state.nodes.get(state.current);
  if (parent) {
    parent.open = true;
    const box = $('#tree');
    box.textContent = '';
    const root = state.nodes.get('');
    root.children.sort(cmpNode);
    root.children.forEach((x) => box.appendChild(renderNode(x, 0)));
  }
  return n;
}

async function refreshAll() {
  await loadTree(false);
  if (state.current !== null) {
    const n = state.nodes.get(state.current);
    await loadDir(state.current, n ? n.own : 0);
  }
}

/* ------------------------------------------------------------ 隔离删除 */
let quarFiles = [];
let RECYCLE = '';

async function pickFolder(initial) {
  try {
    const r = await (await fetch('/api/pickdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initial: initial || '' }),
    })).json();
    if (r.error) { alert(r.error); return null; }
    return r.path || null;
  } catch (e) {
    alert('调不出选择框：' + e);
    return null;
  }
}

function openQuar() {
  if (!state.sel.size) return;
  quarFiles = [...state.sel];
  $('#quarCount').textContent = quarFiles.length;
  $('#quarPath').textContent = (RECYCLE || 'D:\\kks\\隔离区') + '\\<时间戳>\\' +
    (state.current ? state.current.replace(/\//g, '\\') + '\\' : '');
  $('#quarNote').textContent = '只移动，不删除。卡离开 chara 之后就不会再被游戏读到；' +
    '想反悔，把文件夹整个拖回原处即可。';
  $('#quarModal').classList.remove('hidden');
}

async function doQuar() {
  const btn = $('#quarOk');
  btn.disabled = true;
  btn.textContent = $('#quarMods').checked ? '扫描全库中…' : '移动中…';
  let r;
  try {
    r = await (await fetch('/api/quarantine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dir: state.current, files: quarFiles, root: state.root,
        with_mods: $('#quarMods').checked, recycle: RECYCLE || '',
      }),
    })).json();
  } catch (e) {
    r = { error: String(e) };
  }
  btn.disabled = false;
  btn.textContent = '移入隔离区';
  $('#quarModal').classList.add('hidden');
  if (r.error) { alert('隔离失败：' + r.error); return; }
  const lines = ['已隔离 ' + r.count + ' 张卡', '位置：' + r.batch];
  if (r.mods && r.mods.length) {
    lines.push('同时移走了 ' + r.mods.length + ' 个只被这批卡使用的 mod');
  } else if ($('#quarMods').checked) {
    lines.push('没有可以带走的 mod（要么都还被别的卡用着，要么本来就没有）');
  }
  if (r.guids && r.guids.length) {
    lines.push('');
    lines.push('这些卡一共引用了 ' + r.guids.length + ' 个 zipmod。');
    lines.push('批次目录里的 _报告.html 列出了全部 GUID。');
  }
  if (r.errors && r.errors.length) {
    lines.push('');
    lines.push('没成功的：');
    lines.push(...r.errors);
  }
  alert(lines.join('\n'));
  state.sel.clear();
  await refreshAll();
}

/* ------------------------------------------------------------ 安装 */
let instScanResult = null;

function openInstall() {
  instScanResult = null;
  $('#instPreview').textContent = '';
  $('#instInfo').textContent = '还没扫描';
  $('#instOk').disabled = true;
  $('#instHint').innerHTML = (state.current
    ? '人物卡会放进当前预览的文件夹：<b>' + esc(state.current) + '</b>'
    : '先在左边选一个文件夹，人物卡会放进那里')
    + '；服装卡 → coordinate；mod → 游戏 mods；<br>'
    + '认不出的（比如不像 mod 的 zip）原样留在原地，不动它们。全部记账，可在「历史记录」里整批撤销。';
  $('#instModal').classList.remove('hidden');
  setTimeout(() => $('#instSrc').focus(), 50);
}

async function scanInstall() {
  const src = $('#instSrc').value.trim();
  if (!src) { alert('先选一个源文件夹'); return; }
  const box = $('#instPreview');
  box.textContent = '扫描中…';
  $('#instInfo').textContent = '正在扫描…';
  let r;
  try {
    r = await (await fetch('/api/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ src, preview: true, root: state.root }),
    })).json();
  } catch (e) {
    r = { error: String(e) };
  }
  if (r.error) { box.textContent = ''; $('#instInfo').textContent = r.error; return; }
  instScanResult = r;
  box.textContent = '';
  const head = el('div', 'inst-sum',
    '发现 ' + r.total_cards + ' 张卡、' + r.total_mods + ' 个 mod 包' +
    (r.others ? '，另有 ' + r.others + ' 个其它文件会跳过' : ''));
  box.appendChild(head);
  if (r.total_cards) {
    box.appendChild(el('div', 'inst-lab', '卡片（前 20 个）'));
    r.cards.slice(0, 20).forEach((c) => {
      box.appendChild(el('div', 'inst-row', c.name + '　' + (c.refs || 0) + ' 个 mod'));
    });
    if (r.total_cards > 20) box.appendChild(el('div', 'inst-row muted', '…还有 ' + (r.total_cards - 20) + ' 张'));
  }
  if (r.total_mods) {
    box.appendChild(el('div', 'inst-lab', 'mod 包（前 20 个）'));
    r.mods.slice(0, 20).forEach((m) => {
      box.appendChild(el('div', 'inst-row', m.name + '　' + fmtSize(m.size)));
    });
    if (r.total_mods > 20) box.appendChild(el('div', 'inst-row muted', '…还有 ' + (r.total_mods - 20) + ' 个'));
  }
  if (!r.total_cards && !r.total_mods) {
    box.appendChild(el('div', 'inst-row muted', '这个文件夹里没有卡，也没有 .zipmod'));
  }
  $('#instInfo').textContent = r.total_cards + ' 张卡 / ' + r.total_mods + ' 个 mod';
  $('#instOk').disabled = !(r.total_cards || r.total_mods);
}

async function doInstall() {
  const src = $('#instSrc').value.trim();
  if (!src) return;
  const btn = $('#instOk');
  btn.disabled = true;
  btn.textContent = '安装中…';
  let r;
  try {
    r = await (await fetch('/api/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ src, dest: state.current || '', root: state.root }),
    })).json();
  } catch (e) {
    r = { error: String(e) };
  }
  btn.disabled = false;
  btn.textContent = '开始安装';
  if (r.error) { alert('安装失败：' + r.error); return; }
  $('#instModal').classList.add('hidden');
  const lines = [];
  if (r.counts) {
    if (r.counts.card) lines.push('人物卡 ' + r.counts.card + ' 张 → ' + (state.current || '根目录'));
    if (r.counts.coord) lines.push('服装卡 ' + r.counts.coord + ' 张 → coordinate');
    if (r.counts.mod) lines.push('mod ' + r.counts.mod + ' 个 → mods');
    if (r.skipped && r.skipped.length) {
      lines.push('认不出的 ' + r.skipped.length + ' 个留在原地没动（比如不像 mod 的 zip）');
      lines.push('　' + r.skipped.slice(0, 6).join('、') + (r.skipped.length > 6 ? ' …' : ''));
    }
  }
  if (!lines.length) lines.push('什么都没动');
  if (r.entry) lines.push('', '这次操作已记录，可以在「历史记录」里整批撤销。');
  if (r.errors && r.errors.length) {
    lines.push('');
    lines.push('跳过：');
    lines.push(...r.errors.slice(0, 12));
    if (r.errors.length > 12) lines.push('…还有 ' + (r.errors.length - 12) + ' 条');
  }
  alert(lines.join('\n'));
  await refreshAll();
}

/* ------------------------------------------------------------ 安装历史 */
async function openHistory() {
  const box = $('#histBody');
  box.textContent = '读取中…';
  $('#histModal').classList.remove('hidden');
  let r;
  try {
    r = await (await fetch('/api/instlog')).json();
  } catch (e) {
    box.textContent = String(e);
    return;
  }
  const log = r.log || [];
  box.textContent = '';
  if (!log.length) {
    box.appendChild(el('div', 'inst-row muted', '还没有安装记录'));
    return;
  }
  log.forEach((e) => {
    const c = e.counts || {};
    const row = el('div', 'hist-item' + (e.undone ? ' undone' : ''));
    const top = el('div', 'hist-top');
    top.appendChild(el('span', 'hist-at', (e.at || '').replace('T', ' ')));
    top.appendChild(el('span', 'hist-src', e.src || ''));
    row.appendChild(top);
    const sum = ['人物卡 ' + (c.card || 0), '服装卡 ' + (c.coord || 0),
      'mod ' + (c.mod || 0)].join('　');
    row.appendChild(el('div', 'hist-sum', sum + '　→ ' + (e.dest || '')));
    const foot = el('div', 'hist-foot');
    const cnt = el('span', 'muted', (e.moves || []).length + ' 个文件');
    foot.appendChild(cnt);
    foot.appendChild(el('span', 'grow'));
    if (e.undone) {
      foot.appendChild(el('span', 'muted', '已撤销'));
    } else {
      const b = el('button', 'btn small danger', '撤销这次');
      b.addEventListener('click', () => undoEntry(e));
      foot.appendChild(b);
    }
    row.appendChild(foot);
    box.appendChild(row);
  });
}

async function undoEntry(e) {
  if (!confirm('把这次安装的 ' + (e.moves || []).length + ' 个文件搬回原处？\n\n' +
    '如果原目录已经不存在，那部分会跳过。')) return;
  let r;
  try {
    r = await (await fetch('/api/undo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: e.id }),
    })).json();
  } catch (err) {
    alert('撤销失败：' + err);
    return;
  }
  if (r.error) { alert(r.error); return; }
  const lines = ['已搬回 ' + r.restored.length + ' 个文件'];
  if (r.errors && r.errors.length) {
    lines.push('');
    lines.push(...r.errors.slice(0, 12));
  }
  alert(lines.join('\n'));
  await openHistory();
  await refreshAll();
}

/* ------------------------------------------------------------ 回收站 */
let recSel = new Set();

async function openRecycle() {
  recSel = new Set();
  $('#recModal').classList.remove('hidden');
  $('#recPath').textContent = RECYCLE || '';
  await loadRecycle();
}

async function loadRecycle() {
  const box = $('#recBody');
  box.textContent = '扫描中…';
  $('#recOk').disabled = true;
  let r;
  try {
    r = await (await fetch('/api/recycle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })).json();
  } catch (e) {
    box.textContent = String(e);
    return;
  }
  if (r.root) { RECYCLE = r.root; $('#recPath').textContent = r.root; }
  const batches = r.batches || [];
  box.textContent = '';
  if (!batches.length) {
    box.appendChild(el('div', 'inst-row muted', '隔离区是空的'));
    return;
  }
  batches.forEach((b) => {
    const wrap = el('div', 'rec-batch');
    const head = el('div', 'rec-head');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'rec-cb';
    cb.dataset.batch = b.batch;
    cb.addEventListener('change', () => {
      b.items.forEach((it) => {
        if (cb.checked) recSel.add(it.folder); else recSel.delete(it.folder);
      });
      box.querySelectorAll('.rec-item[data-batch="' + b.batch + '"] .rec-cb')
        .forEach((x) => { x.checked = cb.checked; });
      updateRecSel();
    });
    head.appendChild(cb);
    head.appendChild(el('span', 'rec-name', b.batch));
    head.appendChild(el('span', 'muted', b.count + ' 张'));
    wrap.appendChild(head);
    b.items.forEach((it) => {
      const row = el('div', 'rec-item');
      row.dataset.batch = b.batch;
      const c2 = document.createElement('input');
      c2.type = 'checkbox';
      c2.className = 'rec-cb';
      c2.addEventListener('change', () => {
        if (c2.checked) recSel.add(it.folder); else recSel.delete(it.folder);
        updateRecSel();
      });
      row.appendChild(c2);
      row.appendChild(el('span', 'rec-file', it.file));
      row.appendChild(el('span', 'rec-from', it.from || '（原位置未知）'));
      row.appendChild(el('span', 'muted', (it.refs || 0) + ' mod'));
      wrap.appendChild(row);
    });
    box.appendChild(wrap);
  });
}

function updateRecSel() {
  const n = recSel.size;
  $('#recOk').disabled = n === 0;
  $('#recOk').textContent = n ? '还原选中的 ' + n + ' 张' : '还原选中的';
}

async function doRestore() {
  if (!recSel.size) return;
  if (!confirm('把选中的 ' + recSel.size + ' 张卡搬回它们原来的文件夹？')) return;
  const btn = $('#recOk');
  btn.disabled = true;
  btn.textContent = '还原中…';
  let r;
  try {
    r = await (await fetch('/api/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folders: [...recSel] }),
    })).json();
  } catch (e) {
    r = { error: String(e) };
  }
  btn.disabled = false;
  if (r.error) { alert('还原失败：' + r.error); updateRecSel(); return; }
  const lines = ['已还原 ' + r.restored.length + ' 张卡'];
  if (r.errors && r.errors.length) {
    lines.push('');
    lines.push(...r.errors.slice(0, 10));
  }
  alert(lines.join('\n'));
  recSel = new Set();
  await loadRecycle();
  await refreshAll();
}

/* ------------------------------------------------------------ 事件 */
$('#detClose').addEventListener('click', () => {
  $('#detail').classList.add('hidden');
  state.sel.clear();
  updateSelection();
});
$('#btnCollapse').addEventListener('click', async () => {
  state.nodes.forEach((n) => { n.open = false; });
  const box = $('#tree');
  box.textContent = '';
  const root = state.nodes.get('');
  root.children.sort(cmpNode);
  root.children.forEach((n) => box.appendChild(renderNode(n, 0)));
});
$('#btnMove').addEventListener('click', openMove);
$('#moveClose').addEventListener('click', () => $('#moveModal').classList.add('hidden'));
$('#moveOk').addEventListener('click', doMove);
$('#moveNewDir').addEventListener('click', async () => {
  const base = state.moveTarget !== null ? state.moveTarget : state.current;
  if (base === null) { alert('先选一个文件夹'); return; }
  const name = prompt('在「' + (base || 'chara') + '」里新建文件夹：');
  if (!name) return;
  let r;
  try {
    r = await (await fetch('/api/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: base, name, root: state.root }),
    })).json();
  } catch (e) { alert('新建失败：' + e); return; }
  if (r.error) { alert(r.error); return; }
  await loadTree(false);
  const np = base ? base + '/' + name : name;
  ensureNodePath(np);
  state.moveAutoOpen = new Set();
  let acc = '';
  np.split('/').forEach((seg) => { acc = acc ? acc + '/' + seg : seg; state.moveAutoOpen.add(acc); });
  state.moveTarget = np;
  $('#moveTarget').textContent = '→ ' + np;
  const box = $('#moveTree');
  box.textContent = '';
  const root = state.nodes.get('');
  if (root) {
    root.children.sort(cmpNode);
    root.children.forEach((n) => box.appendChild(renderMoveNode(n, 0)));
  }
  $('#moveOk').disabled = np === state.current;
});
$('#btnOpen').addEventListener('click', openFolder);
$('#btnNewDir').addEventListener('click', newFolder);
$('#btnRefresh').addEventListener('click', refreshAll);
$('#btnQuar').addEventListener('click', openQuar);
$('#quarClose').addEventListener('click', () => $('#quarModal').classList.add('hidden'));
$('#quarCancel').addEventListener('click', () => $('#quarModal').classList.add('hidden'));
$('#quarOk').addEventListener('click', doQuar);
$('#btnInstall').addEventListener('click', openInstall);
$('#instClose').addEventListener('click', () => $('#instModal').classList.add('hidden'));
$('#instScan').addEventListener('click', scanInstall);
$('#instOk').addEventListener('click', doInstall);
$('#instBrowse').addEventListener('click', async () => {
  const p = await pickFolder($('#instSrc').value.trim() || '');
  if (!p) return;
  $('#instSrc').value = p;
  scanInstall();
});
$('#instHistory').addEventListener('click', openHistory);
$('#histClose').addEventListener('click', () => $('#histModal').classList.add('hidden'));
$('#histClose2').addEventListener('click', () => $('#histModal').classList.add('hidden'));
$('#btnRecycle').addEventListener('click', openRecycle);
$('#idxInfo').addEventListener('click', rebuildIndex);
$('#gameLine').addEventListener('click', () => detectGame(true));

async function rebuildIndex() {
  if (!confirm('重建本地索引？\n\n会重新检查人物卡目录和 mods 目录里的每一个文件。\n没改动过的文件会直接跳过，通常十几秒；第一次建库要 30 秒左右。')) return;
  const el = $('#idxInfo');
  el.textContent = '正在重建索引…';
  try {
    const d = await (await fetch('/api/index', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({rebuild: true})})).json();
    el.textContent = `本地库：${d.cards} 张卡 · ${d.mods} 个 mod（${(d.db / 1048576).toFixed(1)} MB）`;
  } catch (e) {
    el.textContent = '重建失败，看服务窗口的报错';
  }
}
$('#recClose').addEventListener('click', () => $('#recModal').classList.add('hidden'));
$('#recRefresh').addEventListener('click', loadRecycle);
$('#recOk').addEventListener('click', doRestore);
['#fName', '#fMod', '#fType'].forEach((sel) => {
  const n = $(sel);
  n.addEventListener('input', renderGrid);
  n.addEventListener('change', renderGrid);
});
$('#fReset').addEventListener('click', () => {
  $('#fName').value = '';
  $('#fMod').value = '';
  $('#fType').value = '';
  renderGrid();
});
$('#quarPick').addEventListener('click', async () => {
  const p = await pickFolder(RECYCLE);
  if (!p) return;
  RECYCLE = p;
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recycle: p }),
    });
  } catch (e) { /* 忽略 */ }
  openQuar();
});
document.querySelectorAll('.rootbtn').forEach((b) => {
  b.addEventListener('click', () => { if (!b.disabled) switchRoot(b.dataset.root); });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('#moveModal').classList.contains('hidden')) {
      $('#moveModal').classList.add('hidden');
    } else {
      $('#detClose').click();
    }
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    if (state.visible.length && document.activeElement === document.body) {
      e.preventDefault();
      state.sel = new Set(state.visible.map((c) => c.name));
      updateSelection();
    }
  }
});

boot();
