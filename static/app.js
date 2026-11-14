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
  lastDetail: null,
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
  document.body.classList.toggle('mods-view', name === 'mods');
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
  clearDetail();
  $('#gridWrap').classList.add('hidden');
  if (name === 'plugins') {
    $('#filterBar').classList.add('hidden');
    $('#emptyState').classList.add('hidden');
    $('#modWrap').classList.add('hidden');
    $('#plugWrap').classList.remove('hidden');
    $('.sidebar').classList.add('mods-mode');
    await loadPlugins(false);
    return;
  }
  $('#plugWrap').classList.add('hidden');
  if (name === 'mods') {
    $('#filterBar').classList.add('hidden');
    $('#emptyState').classList.add('hidden');
    $('#modWrap').classList.remove('hidden');
    $('.sidebar').classList.add('mods-mode');
    await loadMods('orphan', false);
    return;
  }
  $('.sidebar').classList.remove('mods-mode');
  $('#modWrap').classList.add('hidden');
  $('#emptyState').classList.remove('hidden');
  $('.es-icon').textContent = '🗂';
  $('.es-title').textContent = '先选一个文件夹';
  $('.es-sub').innerHTML = '左侧点开任意子文件夹，只读取该文件夹里的卡<br><span class="mono">不会递归，也不会一次加载全部</span>';
  updateSelection();
  await loadTree(true);
}

/* ------------------------------------------------------------ mod 清理 */
const KIND_CN = {
  chara: '人物内容', studio: '场景物件', anim: '动作', mixed: '人物+场景',
  plugin: '插件', other: '其它', empty: '空包', missing: '文件缺失', error: '读不出',
};
const MODSTATE = { cat: 'orphan', offset: 0, limit: 60, total: 0, items: [] };
const MODSEL = new Set();

function updateModSel() {
  const b = $('#modClean');
  b.disabled = MODSEL.size === 0;
  b.textContent = MODSEL.size ? '移到清理区 (' + MODSEL.size + ')' : '移到清理区';
}

/* ------------------------------------------------------------ 插件 */
const PLUGSTATE = { cat: 'all', loaded: false, data: null };

const PLUG_STATE_CN = {
  missing: '缺依赖', wrongver: 'BepInEx 版本', blocked: '被拦住',
  failed: '加载失败', filtered: '仅 Studio', older: '有新版', ok: '正常',
};

function plugMatches(r, cat) {
  if (cat === 'all') return true;
  if (cat === 'problem') {
    return ['missing', 'wrongver', 'blocked', 'failed'].indexOf(r.state) >= 0;
  }
  return r.state === cat;
}

function fmtSize(n) {
  if (!n) return '';
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}

async function loadPlugins(refresh) {
  $('#plugList').innerHTML = '<div class="mod-empty">' +
    (refresh ? '正在扫描 256 个 dll…' : '读取中…') + '</div>';
  let d;
  try {
    d = await (await fetch('/api/plugins' + (refresh ? '?refresh=1' : ''))).json();
  } catch (e) {
    $('#plugList').innerHTML = '<div class="mod-empty">读取失败</div>';
    return;
  }
  if (!d.ok) {
    $('#plugList').innerHTML = '<div class="mod-empty">' +
      esc(d.error || '扫描失败') + '</div>';
    return;
  }
  PLUGSTATE.data = d;
  PLUGSTATE.loaded = true;
  const c = d.counts || {};
  $('#pcAll').textContent = d.total || 0;
  $('#pcProblem').textContent = (c.missing || 0) + (c.wrongver || 0) +
    (c.blocked || 0) + (c.failed || 0);
  $('#pcOk').textContent = c.ok || 0;
  $('#pcFiltered').textContent = c.filtered || 0;
  $('#plugInfo').textContent = 'BepInEx ' + (d.bepinex || '?') +
    ' · 扫描于 ' + (d.scanned_at || '?');
  renderPlugins();
}

function renderPlugins() {
  const box = $('#plugList');
  const d = PLUGSTATE.data;
  if (!d) { box.innerHTML = ''; return; }
  const rows = (d.plugins || []).filter((r) => plugMatches(r, PLUGSTATE.cat));
  if (!rows.length) {
    box.innerHTML = '<div class="mod-empty">这个分类里没有插件</div>';
    return;
  }
  box.innerHTML = '';
  rows.forEach((r) => {
    const row = el('div', 'plugrow s-' + r.state);

    const main = el('div', 'plugmain');
    const head = el('div', 'plughead');
    head.appendChild(el('span', 'plugstate', PLUG_STATE_CN[r.state] || r.state));
    head.appendChild(el('span', 'plugname', r.name || r.file));
    if (r.version) head.appendChild(el('span', 'plugver', 'v' + r.version));
    main.appendChild(head);

    const meta = el('div', 'plugmeta');
    meta.appendChild(el('span', 'mono', r.rel));
    if (r.size) meta.appendChild(el('span', '', ' · ' + fmtSize(r.size)));
    main.appendChild(meta);

    if (r.deps && r.deps.length) {
      const deps = el('div', 'plugdeps');
      deps.textContent = '依赖：' + r.deps.map((x) =>
        x.guid + (x.min ? ' ≥' + x.min : '')).join('，');
      main.appendChild(deps);
    }

    if (r.missing && r.missing.length) {
      const warn = el('div', 'plugwarn');
      warn.textContent = '问题：' + r.missing.map((m) =>
        m.guid + ' 需要 ≥' + (m.min || '?') +
        (m.have ? '（现有 ' + m.have + '）' : '（未找到）')).join('；');
      main.appendChild(warn);
    }
    if (r.wrong_bepinex) {
      const warn = el('div', 'plugwarn soft');
      warn.textContent = '这个插件要求 BepInEx ' + r.wrong_bepinex +
        '，当前是 ' + (d.bepinex || '?') + '（通常只是警告）';
      main.appendChild(warn);
    }
    if (r.detail) {
      main.appendChild(el('div', 'plugdetail', r.detail));
    }

    row.appendChild(main);

    const act = el('div', 'plugact');
    const isOff = /\.(off|disabled)$/i.test(r.rel) || !!r.disabled_twin;
    const btn = el('button', 'btn ghost small', isOff ? '启用' : '禁用');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '处理中…';
      try {
        const res = await (await fetch('/api/plugintoggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rel: r.rel, enable: isOff }),
        })).json();
        if (!res.ok) {
          alert('失败：' + (res.error || '未知错误'));
          btn.disabled = false;
          btn.textContent = isOff ? '启用' : '禁用';
          return;
        }
        await loadPlugins(true);
      } catch (e) {
        alert('失败：' + e.message);
        btn.disabled = false;
        btn.textContent = isOff ? '启用' : '禁用';
      }
    });
    act.appendChild(btn);
    row.appendChild(act);

    box.appendChild(row);
  });
}

async function loadMods(cat, append) {
  MODSTATE.cat = cat;
  if (!append) { MODSTATE.offset = 0; MODSTATE.items = []; }
  $('#modList').innerHTML = '<div class="mod-empty">读取中…</div>';
  let d;
  try {
    d = await (await fetch('/api/orphans?cat=' + encodeURIComponent(cat) +
      '&offset=' + MODSTATE.offset + '&limit=' + MODSTATE.limit)).json();
  } catch (e) {
    $('#modList').innerHTML = '<div class="mod-empty">读取失败</div>';
    return;
  }
  MODSTATE.total = d.total || 0;
  MODSTATE.items = append ? MODSTATE.items.concat(d.items || []) : (d.items || []);
  MODSTATE.offset = MODSTATE.items.length;
  if (d.counts) {
    $('#cntOrphan').textContent = d.counts.orphan || 0;
    $('#cntNever').textContent = d.counts.never || 0;
    $('#cntInUse').textContent = d.counts.in_use || 0;
  }
  $('#modInfo').textContent = '已显示 ' + MODSTATE.items.length + ' / ' + MODSTATE.total;
  renderMods();
}

function renderMods() {
  const box = $('#modList');
  box.textContent = '';
  if (!MODSTATE.items.length) {
    box.appendChild(el('div', 'mod-empty', '这里没有东西'));
    return;
  }
  MODSTATE.items.forEach((it) => {
    const row = el('div', 'modrow');
    if (MODSEL.has(it.path)) row.classList.add('picked');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'modcb';
    cb.checked = MODSEL.has(it.path);
    cb.addEventListener('change', () => {
      if (cb.checked) MODSEL.add(it.path); else MODSEL.delete(it.path);
      row.classList.toggle('picked', cb.checked);
      updateModSel();
    });
    row.appendChild(cb);
    const thumb = el('div', 'modthumb');
    if (it.thumbs && it.thumbs.length) {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = '/api/modthumb?path=' + encodeURIComponent(it.path) +
                '&entry=' + encodeURIComponent(it.thumbs[0]);
      thumb.appendChild(img);
    } else {
      thumb.textContent = '无图';
    }
    const main = el('div', 'modmain');
    main.appendChild(el('div', 'modfile', it.file));
    const meta = el('div', 'modmeta');
    meta.appendChild(el('span', 'tag ' + (it.kind || 'other'), KIND_CN[it.kind] || it.kind || '?'));
    meta.appendChild(el('span', 'muted small', fmtSize(it.size)));
    if (it.ever) meta.appendChild(el('span', 'muted small', '曾引用 ' + it.ever + ' 张'));
    if (it.now) meta.appendChild(el('span', 'muted small', '当前 ' + it.now + ' 张'));
    main.appendChild(meta);
    if (it.items && it.items.length) {
      const items = el('div', 'moditems');
      it.items.slice(0, 8).forEach((s) => items.appendChild(el('span', 'moditem', s)));
      if (it.item_count > 8) items.appendChild(el('span', 'moditem more', '+' + (it.item_count - 8)));
      main.appendChild(items);
    }
    if (it.name || it.author) {
      main.appendChild(el('div', 'muted small',
        (it.name || '') + (it.author ? ' · ' + it.author : '')));
    }
    row.appendChild(thumb);
    row.appendChild(main);
    box.appendChild(row);
  });
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
    clearDetail();
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
  clearDetail();
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
  if (state.sel.has(name)) {
    showDetail(c, relOf(c));
    return;
  }
  if (state.lastDetail === name) {
    const rest = [...state.sel];
    const last = rest.length ? rest[rest.length - 1] : null;
    const obj = last ? state.visible.find((x) => x.name === last) : null;
    if (obj) showDetail(obj, relOf(obj));
    else clearDetail();
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
const DET_EMPTY_HTML =
  '<div class="det-empty"><div class="de-icon">🖼</div>' +
  '<div>点一张卡看预览</div>' +
  '<div class="de-sub">单击切换预览，Ctrl 单击多选</div></div>';

function clearDetail() {
  state.lastDetail = null;
  const body = $('#detBody');
  if (body) body.innerHTML = DET_EMPTY_HTML;
}

function showDetail(c, rel) {
  state.lastDetail = c.name;
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
  const dest = state.current ? state.current : (window.I18N ? I18N.t('（根目录）') : '（根目录）');
  $('#instHint').innerHTML = '';
  $('#instHint').appendChild(el('div', '',
    '卡片 → ' + esc(dest) + '；服装卡 → coordinate；mod → mods。'));
  $('#instHint').appendChild(el('div', 'muted',
    '带 manifest.xml + abdata 的解包 mod 会自动重新打包成 .zipmod 放进 mods，不动游戏 abdata。'));
  $('#instHint').appendChild(el('div', 'muted',
    '贴图和说明文件不自动安装——卡里的 overlay 内嵌在卡里，外面这些只是素材库。'));
  $('#instHint').appendChild(el('div', 'muted',
    'BepInEx 的数据文件按原相对路径镜像。全部记账，可在「历史记录」里整批撤销。'));
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
    (r.total_packs ? '、' + r.total_packs + ' 个解包 mod（会重新打包）' : '') +
    (r.total_overlays ? '、' + r.total_overlays + ' 张贴图（不安装）' : '') +
    (r.total_datas ? '、' + r.total_datas + ' 个插件数据文件' : '') +
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
  if (r.total_packs) {
    box.appendChild(el('div', 'inst-lab', '解包的 mod（前 20 个，会打包成 .zipmod）'));
    r.packs.slice(0, 20).forEach((p) => {
      box.appendChild(el('div', 'inst-row', p.name + '　→ ' + p.guid + '.zipmod　' + fmtSize(p.size)));
    });
    if (r.total_packs > 20) box.appendChild(el('div', 'inst-row muted', '…还有 ' + (r.total_packs - 20) + ' 个'));
  }
  if (r.total_overlays) {
    box.appendChild(el('div', 'inst-lab', '贴图（不安装，留在原处）'));
    r.overlays.slice(0, 20).forEach((o) => {
      box.appendChild(el('div', 'inst-row', o.name));
    });
    if (r.total_overlays > 20) box.appendChild(el('div', 'inst-row muted', '…还有 ' + (r.total_overlays - 20) + ' 张'));
  }
  if (r.total_datas) {
    box.appendChild(el('div', 'inst-lab', '插件数据（前 20 个）'));
    r.datas.slice(0, 20).forEach((d) => {
      box.appendChild(el('div', 'inst-row', d.root + '\\' + d.rel));
    });
    if (r.total_datas > 20) box.appendChild(el('div', 'inst-row muted', '…还有 ' + (r.total_datas - 20) + ' 个'));
  }
  if (!r.total_cards && !r.total_mods && !r.total_packs && !r.total_overlays && !r.total_datas) {
    box.appendChild(el('div', 'inst-row muted', '这个文件夹里没有可安装的东西'));
  }
  $('#instInfo').textContent = r.total_cards + ' 张卡 / ' + r.total_mods + ' 个 mod'
    + (r.total_packs ? ' / ' + r.total_packs + ' 个解包 mod' : '')
    + (r.total_overlays ? ' / ' + r.total_overlays + ' 张贴图' : '')
    + (r.total_datas ? ' / ' + r.total_datas + ' 个数据' : '');
  $('#instOk').disabled = !(r.total_cards || r.total_mods || r.total_packs || r.total_datas);
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
    if (r.counts.pack) lines.push('解包的 mod ' + r.counts.pack + ' 个 → 已重新打包成 zipmod 放进 mods');
    if (r.counts.data) lines.push('插件数据 ' + r.counts.data + ' 个 → 按原路径镜像');
    if (r.overlay_kept && r.overlay_kept.length) {
      lines.push('贴图 ' + r.overlay_kept.length + ' 张留在原处没装（要当素材用请自己拖进 UserData\\Overlays\\）');
    }
    if (r.replaced && r.replaced.length) {
      lines.push('换掉了 ' + r.replaced.length +
        ' 个旧版同 GUID 的包（已挪进隔离区，随时可还原）');
      r.replaced.slice(0, 5).forEach(x => {
        lines.push('　' + String(x.old || '').split(/[\\/]/).pop() + ' → ' + x.new);
      });
      if (r.replaced.length > 5) lines.push('　…还有 ' + (r.replaced.length - 5) + ' 个');
    }
    if (r.missing && r.missing.length) {
      lines.push('');
      lines.push('⚠ 装完发现 ' + r.missing.length + ' 个 mod 依赖没装上，这些卡会缺部件：');
      r.missing.slice(0, 8).forEach(x => {
        lines.push('　' + x.guid + '（' + x.cards.slice(0, 2).join('、') +
          (x.cards.length > 2 ? ' 等 ' + x.cards.length + ' 张' : '') + '）');
      });
      if (r.missing.length > 8) lines.push('　…还有 ' + (r.missing.length - 8) + ' 个');
    }
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
/* 右侧预览栏宽度：拖拽调整 + 记忆 */
(function initDetResize() {
  const KEY = 'kkcard.detw';
  const el = $('#detail');
  const grip = $('#detResizer');
  if (!el || !grip) return;
  const saved = parseInt(localStorage.getItem(KEY) || '', 10);
  if (saved >= 240 && saved <= 720) el.style.setProperty('--det-w', saved + 'px');
  let drag = false;
  grip.addEventListener('pointerdown', (ev) => {
    drag = true;
    grip.classList.add('dragging');
    grip.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  grip.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const rect = el.getBoundingClientRect();
    let w = rect.right - ev.clientX;
    w = Math.max(240, Math.min(720, w));
    el.style.setProperty('--det-w', w + 'px');
    localStorage.setItem(KEY, String(Math.round(w)));
  });
  const stop = (ev) => {
    if (!drag) return;
    drag = false;
    grip.classList.remove('dragging');
    try { grip.releasePointerCapture(ev.pointerId); } catch (e) {}
  };
  grip.addEventListener('pointerup', stop);
  grip.addEventListener('pointercancel', stop);

  const fold = $('#detFold');
  if (!fold) return;
  const paintFold = () => {
    fold.textContent = el.classList.contains('folded') ? '\u21e4' : '\u21e5';
  };
  if (localStorage.getItem('kkcard.detfold') === '1') el.classList.add('folded');
  paintFold();
  fold.addEventListener('click', () => {
    const now = el.classList.toggle('folded');
    localStorage.setItem('kkcard.detfold', now ? '1' : '0');
    paintFold();
  });
})();

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

document.querySelectorAll('.modtab').forEach((b) => {
  b.addEventListener('click', async () => {
    document.querySelectorAll('.modtab').forEach((x) => x.classList.toggle('active', x === b));
    await loadMods(b.dataset.cat, false);
  });
});
$('#modMore').addEventListener('click', () => loadMods(MODSTATE.cat, true));
$('#modRefresh').addEventListener('click', () => loadMods(MODSTATE.cat, false));

document.querySelectorAll('[data-pcat]').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('[data-pcat]').forEach((x) => x.classList.toggle('active', x === b));
    PLUGSTATE.cat = b.dataset.pcat;
    renderPlugins();
  });
});
$('#plugRefresh').addEventListener('click', () => loadPlugins(true));

$('#modClean').addEventListener('click', async () => {
  if (!MODSEL.size) return;
  const list = Array.from(MODSEL);
  if (!confirm('把选中的 ' + list.length + ' 个 mod 移到清理区？\n\n' +
               '只会移动文件，不删除；清理区里留有清单，可以搬回来。')) return;
  const btn = $('#modClean');
  btn.disabled = true;
  btn.textContent = '移动中…';
  let r;
  try {
    r = await (await fetch('/api/modclean', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: list, recycle: RECYCLE }),
    })).json();
  } catch (e) {
    alert('移动失败：' + e);
    updateModSel();
    return;
  }
  if (r.error) { alert(r.error); updateModSel(); return; }
  MODSEL.clear();
  updateModSel();
  const mb = (r.size / 1048576).toFixed(1);
  alert('已移走 ' + r.moved + ' 个 mod（' + mb + ' MB）' +
        (r.errors && r.errors.length ? '\n' + r.errors.length + ' 个失败' : '') +
        (r.batch ? '\n\n清理区：' + r.batch : ''));
  await loadMods(MODSTATE.cat, false);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('#moveModal').classList.contains('hidden')) {
      $('#moveModal').classList.add('hidden');
    } else {
      clearDetail();
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
