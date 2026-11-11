"""卡片 / mod 的本地索引库（SQLite）。

设计目标：
  · 一张卡解析一次就记下来，以后靠 (mtime, size) 判断要不要重解析；
  · 卡之间互相引用关系存成独立表，随时能反查「谁在用这个 guid」；
  · mod 同理，只记录 guid，不动文件。

表结构：
  cards(path, mtime, size, data)        data = 前端要的整块 JSON
  card_refs(card_path, guid)            映射，带索引
  mods(path, mtime, size, guid)
  meta(k, v)                            附带信息（mods 根目录等）
"""
import json
import os
import sqlite3
import threading

import kklib

_lock = threading.RLock()
_conn = None
_db_path = None
_holders_cache = {}

SCHEMA = """
CREATE TABLE IF NOT EXISTS cards(
  path TEXT PRIMARY KEY, mtime REAL, size INTEGER, data TEXT
);
CREATE TABLE IF NOT EXISTS card_refs(
  card_path TEXT, guid TEXT
);
CREATE INDEX IF NOT EXISTS idx_refs_guid ON card_refs(guid);
CREATE INDEX IF NOT EXISTS idx_refs_card ON card_refs(card_path);
CREATE TABLE IF NOT EXISTS mods(
  path TEXT PRIMARY KEY, mtime REAL, size INTEGER, guid TEXT
);
CREATE INDEX IF NOT EXISTS idx_mods_guid ON mods(guid);
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
"""


def init(db_path):
    global _conn, _db_path
    _db_path = db_path
    d = os.path.dirname(db_path)
    if d:
        os.makedirs(d, exist_ok=True)
    _conn = sqlite3.connect(db_path, check_same_thread=False)
    _conn.execute("PRAGMA journal_mode=WAL")
    _conn.execute("PRAGMA synchronous=NORMAL")
    _conn.executescript(SCHEMA)
    _conn.commit()
    return _conn


def _c():
    if _conn is None:
        raise RuntimeError("store 未初始化")
    return _conn


# --------------------------------------------------------------- 卡的写入
def _agg_refs(refs):
    """同一个 guid 常在多个槽位出现，按 guid 聚合，保留所有用途。"""
    agg = {}
    for r in refs or []:
        g = r.get("guid")
        if not g:
            continue
        slot = agg.get(g)
        if slot is None:
            slot = agg[g] = {"guid": g, "props": [], "name": r.get("name"),
                             "author": r.get("author"), "website": r.get("website")}
        d = kklib.describe_property(r.get("property"))
        if d and d not in slot["props"]:
            slot["props"].append(d)
    for slot in agg.values():
        slot["props"] = kklib.compress_props(slot["props"])
    return list(agg.values())


def make_meta(path, hint=None):
    """解析一张卡，返回 (data_dict, 唯一 guid 列表)。"""
    info = kklib.parse_card(path, hint=hint)
    if info is None:
        return None, []
    refs = _agg_refs(info.get("refs") or [])
    info["refs"] = refs
    info.pop("path", None)
    info.pop("ext_keys", None)
    guids = [r["guid"] for r in refs]
    return info, guids


def _put_card(path, st, data, guids):
    c = _c()
    js = json.dumps(data, ensure_ascii=False)
    c.execute("INSERT OR REPLACE INTO cards(path, mtime, size, data) VALUES(?,?,?,?)",
              (path, st.st_mtime, st.st_size, js))
    c.execute("DELETE FROM card_refs WHERE card_path=?", (path,))
    if guids:
        c.executemany("INSERT INTO card_refs(card_path, guid) VALUES(?,?)",
                      [(path, g) for g in guids])


def upsert_card(path, hint=None, force=False):
    """文件变了才重新解析。返回 data dict 或 None。"""
    try:
        st = os.stat(path)
    except OSError:
        return None
    with _lock:
        c = _c()
        row = c.execute("SELECT mtime, size, data FROM cards WHERE path=?",
                        (path,)).fetchone()
    if row and not force and abs(row[0] - st.st_mtime) < 1e-6 and row[1] == st.st_size:
        return json.loads(row[2])
    data, guids = make_meta(path, hint)
    if data is None:
        return None
    with _lock:
        _put_card(path, st, data, guids)
        _c().commit()
        _holders_cache.clear()
    return data


def drop_card(path):
    with _lock:
        c = _c()
        c.execute("DELETE FROM cards WHERE path=?", (path,))
        c.execute("DELETE FROM card_refs WHERE card_path=?", (path,))
        c.commit()
        _holders_cache.clear()


def cards_in(dirpath, hint=None):
    """列一个目录下的所有卡；只重解析新增或改动过的文件。"""
    try:
        names = os.listdir(dirpath)
    except OSError:
        return []
    files = sorted(f for f in names if f.lower().endswith(".png"))
    if not files:
        return []

    paths = [os.path.join(dirpath, f) for f in files]
    with _lock:
        c = _c()
        known = {}
        for p in paths:
            row = c.execute("SELECT mtime, size, data FROM cards WHERE path=?",
                            (p,)).fetchone()
            if row:
                known[p] = row

    todo, out = [], {}
    for p in paths:
        try:
            st = os.stat(p)
        except OSError:
            continue
        row = known.get(p)
        if row and abs(row[0] - st.st_mtime) < 1e-6 and row[1] == st.st_size:
            out[p] = json.loads(row[2])
        else:
            todo.append(p)

    if todo:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=8) as ex:
            for p, data in zip(todo, ex.map(lambda x: upsert_card(x, hint), todo)):
                if data is not None:
                    out[p] = data

    # 清理已经不在磁盘上的条目
    with _lock:
        c = _c()
        existing = set(paths)
        stale = [r[0] for r in c.execute(
            "SELECT path FROM cards WHERE path LIKE ?", (dirpath + os.sep + "%",))
            if r[0] not in existing and os.sep not in r[0][len(dirpath) + 1:]]
        for p in stale:
            c.execute("DELETE FROM cards WHERE path=?", (p,))
            c.execute("DELETE FROM card_refs WHERE card_path=?", (p,))
        if stale:
            c.commit()

    return [out[p] for p in paths if p in out]


# --------------------------------------------------------------- 反查
def prune(root):
    """删掉库里磁盘上已经不存在的卡（用户在资源管理器里手动挪过）。"""
    root = os.path.abspath(root)
    gone = []
    with _lock:
        c = _c()
        rows = c.execute("SELECT path FROM cards WHERE path LIKE ?",
                         (root + os.sep + "%",)).fetchall()
        for (p,) in rows:
            if not os.path.isfile(p):
                gone.append(p)
        for p in gone:
            c.execute("DELETE FROM cards WHERE path=?", (p,))
            c.execute("DELETE FROM card_refs WHERE card_path=?", (p,))
        if gone:
            c.commit()
            _holders_cache.clear()
    return len(gone)


def holders(root):
    """guid -> [卡相对 root 的路径]，直接从库里取，不碰文件。结果带缓存。"""
    root = os.path.abspath(root)
    with _lock:
        hit = _holders_cache.get(root)
        if hit is not None:
            return hit
        rows = _c().execute(
            "SELECT c.path, r.guid FROM card_refs r JOIN cards c ON c.path = r.card_path"
        ).fetchall()
    idx = {}
    for path, guid in rows:
        try:
            rel = os.path.relpath(path, root).replace("\\", "/")
        except ValueError:
            continue
        idx.setdefault(guid, []).append(rel)
    with _lock:
        _holders_cache[root] = idx
    return idx


def invalidate():
    """库里一改就清掉内存缓存。"""
    with _lock:
        _holders_cache.clear()


def card_count():
    with _lock:
        return _c().execute("SELECT COUNT(*) FROM cards").fetchone()[0]


# --------------------------------------------------------------- mod
def read_mod_guid(path):
    try:
        man = kklib.read_manifest(path)
    except Exception:
        return None
    if not man:
        return None
    return man.get("guid") or None


def upsert_mod(path, force=False):
    try:
        st = os.stat(path)
    except OSError:
        return None
    with _lock:
        c = _c()
        row = c.execute("SELECT mtime, size, guid FROM mods WHERE path=?",
                        (path,)).fetchone()
    if row and not force and abs(row[0] - st.st_mtime) < 1e-6 and row[1] == st.st_size:
        return row[2]
    guid = read_mod_guid(path)
    if guid is None:
        return None
    with _lock:
        _c().execute("INSERT OR REPLACE INTO mods(path, mtime, size, guid) VALUES(?,?,?,?)",
                     (path, st.st_mtime, st.st_size, guid))
        _c().commit()
    return guid


def drop_mod(path):
    with _lock:
        c = _c()
        c.execute("DELETE FROM mods WHERE path=?", (path,))
        c.commit()


def scan_mods(mods_root, force=False):
    """全量走一遍 mods 根目录，只解析新文件。返回解析到的文件数。"""
    todo = []
    for dp, dn, fn in os.walk(mods_root):
        for f in fn:
            if f.lower().endswith((".zipmod", ".zip")):
                todo.append(os.path.join(dp, f))
    if not todo:
        return 0
    from concurrent.futures import ThreadPoolExecutor
    n = 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        for g in ex.map(lambda p: upsert_mod(p, force), todo):
            if g:
                n += 1
    # 清掉已经不存在的
    with _lock:
        c = _c()
        existing = set(todo)
        stale = [r[0] for r in c.execute("SELECT path FROM mods")
                 if r[0] not in existing]
        for p in stale:
            c.execute("DELETE FROM mods WHERE path=?", (p,))
        if stale:
            c.commit()
    return n


def mods_by_guid():
    """guid -> [zipmod 绝对路径]。"""
    with _lock:
        rows = _c().execute("SELECT guid, path FROM mods").fetchall()
    idx = {}
    for guid, path in rows:
        idx.setdefault(guid, []).append(path)
    return idx


def mod_count():
    with _lock:
        return _c().execute("SELECT COUNT(*) FROM mods").fetchone()[0]


# --------------------------------------------------------------- 杂项
def get_meta(k, default=None):
    with _lock:
        row = _c().execute("SELECT v FROM meta WHERE k=?", (k,)).fetchone()
    return json.loads(row[0]) if row else default


def set_meta(k, v):
    with _lock:
        _c().execute("INSERT OR REPLACE INTO meta(k, v) VALUES(?,?)",
                     (k, json.dumps(v, ensure_ascii=False)))
        _c().commit()
