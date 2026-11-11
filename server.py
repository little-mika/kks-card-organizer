# -*- coding: utf-8 -*-
"""KK 卡片整理器 —— 本地服务。

只做三件事：
  1. 把 UserData/chara 下的目录列成树，让你先选文件夹
  2. 只解析你选中的那个文件夹里的卡（不递归）
  3. 给出缩略图

用法：
    python server.py                # 默认 D:\\kks\\K_K_S\\UserData\\chara
    python server.py --root <路径> --port 8765 --open
"""
import os
import sys
import json
import io
import shutil
import hashlib
import argparse
import datetime
import threading
import time
import logging
import logging.handlers
import traceback
import urllib.parse
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
VERSION = "0.1-beta"
sys.path.insert(0, HERE)
import kklib  # noqa: E402
import store  # noqa: E402

# ---------------------------------------------------------------- 日志
# 出问题的时候把现场留在 logs\ 里，方便回头查。
LOG_DIR = os.path.join(HERE, "logs")
try:
    os.makedirs(LOG_DIR, exist_ok=True)
except Exception:
    LOG_DIR = HERE

log = logging.getLogger("kkcard")
log.setLevel(logging.DEBUG)
log.propagate = False
if not log.handlers:
    try:
        _fh = logging.handlers.RotatingFileHandler(
            os.path.join(LOG_DIR, "kkcard.log"),
            maxBytes=2 * 1024 * 1024, backupCount=5, encoding="utf-8")
        _fh.setLevel(logging.DEBUG)
        _fh.setFormatter(logging.Formatter(
            "%(asctime)s  %(levelname)-7s  [%(threadName)s]  %(message)s",
            "%Y-%m-%d %H:%M:%S"))
        log.addHandler(_fh)
    except Exception:
        pass
    try:
        _ch = logging.StreamHandler(sys.stderr)
        _ch.setLevel(logging.WARNING)
        _ch.setFormatter(logging.Formatter("%(levelname)s: %(message)s"))
        log.addHandler(_ch)
    except Exception:
        pass


def _log_exc(exc_type, exc, tb):
    """没被接住的异常：写进日志，别让窗口一闪就没了。"""
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc, tb)
        return
    log.critical("未捕获的异常\n%s", "".join(traceback.format_exception(exc_type, exc, tb)))
    try:
        with open(os.path.join(LOG_DIR, "crash.txt"), "a", encoding="utf-8") as f:
            f.write("\n===== %s =====\n" % datetime.datetime.now().isoformat(timespec="seconds"))
            f.write("".join(traceback.format_exception(exc_type, exc, tb)))
    except Exception:
        pass


sys.excepthook = _log_exc
try:
    threading.excepthook = lambda a: _log_exc(a.exc_type, a.exc_value, a.exc_traceback)
except Exception:
    pass

try:
    from PIL import Image
    HAS_PIL = True
except Exception:
    HAS_PIL = False

CONF = {
    "game": "",      # Koikatsu Sunshine 根目录，由自动探测或设置填充
    "root": "",
    "coord": "",
    "mods": "",
    "recycle": "",
    "scene": "",
    "thumb_dir": os.path.join(HERE, "data", "thumb"),
    "settings": os.path.join(HERE, "data", "settings.json"),
    "instlog": os.path.join(HERE, "data", "install_log.json"),
    "db": os.path.join(HERE, "data", "kkcard.db"),
}
os.makedirs(CONF["thumb_dir"], exist_ok=True)
os.makedirs(os.path.dirname(CONF["settings"]), exist_ok=True)
store.init(CONF["db"])


# ------------------------------------------------------------ 游戏目录探测
def is_kks_root(path):
    """一个目录像不像 KKS 安装根。"""
    if not path or not os.path.isdir(path):
        return False
    if os.path.isfile(os.path.join(path, "KoikatsuSunshine.exe")):
        return True
    if os.path.isdir(os.path.join(path, "KoikatsuSunshine_Data")):
        return True
    if os.path.isdir(os.path.join(path, "UserData", "chara")):
        return True
    return False


def _kks_layout(game):
    """游戏根 -> 四个子目录。"""
    g = os.path.abspath(game)
    return {
        "root": os.path.join(g, "UserData", "chara"),
        "coord": os.path.join(g, "UserData", "coordinate"),
        "scene": os.path.join(g, "UserData", "Studio", "scene"),
        "mods": os.path.join(g, "mods"),
    }


def read_registry_installdir():
    """KoikatuSunshineRegistryFixer.bat 会把 INSTALLDIR 写进注册表。"""
    try:
        import winreg
    except Exception:
        return None
    keys = [
        (winreg.HKEY_CURRENT_USER, r"Software\Illusion\KoikatsuSunshine\KoikatsuSunshine"),
        (winreg.HKEY_CURRENT_USER, r"Software\Illusion\KoikatsuSunshine"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Illusion\KoikatsuSunshine\KoikatsuSunshine"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Illusion\KoikatsuSunshine\KoikatsuSunshine"),
    ]
    names = ("INSTALLDIR", "InstallDir", "InstallPath", "GameDir", "Path")
    for hive, sub in keys:
        try:
            with winreg.OpenKey(hive, sub) as k:
                for name in names:
                    try:
                        v, _ = winreg.QueryValueEx(k, name)
                    except OSError:
                        continue
                    if v and os.path.isdir(v) and is_kks_root(v):
                        return os.path.abspath(v)
        except OSError:
            continue
    return None


def guess_game_root():
    """注册表 -> 程序附近 -> 常见盘符，返回找到的 KKS 根目录或 None。"""
    p = read_registry_installdir()
    if p:
        return p

    names = ("K_K_S", "KoikatsuSunshine", "KoikatuSunshine", "KKS", "恋活Sunshine", "Koikatsu")
    seen = set()
    d = HERE
    for _ in range(4):
        if d in seen:
            break
        seen.add(d)
        if is_kks_root(d):
            return d
        for n in names:
            c = os.path.join(d, n)
            if is_kks_root(c):
                return c
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent

    for drive in "CDEFGHIJK":
        base = drive + ":\\"
        if not os.path.isdir(base):
            continue
        for n in names:
            for cand in (os.path.join(base, n), os.path.join(base, n, "K_K_S")):
                if is_kks_root(cand):
                    return os.path.abspath(cand)
    return None


def apply_game_root(game, recycle=None, save=True):
    """把游戏根写进 CONF，顺带重算四个子目录。"""
    game = os.path.abspath(game)
    CONF["game"] = game
    for k, v in _kks_layout(game).items():
        CONF[k] = v
    if recycle:
        CONF["recycle"] = os.path.abspath(recycle)
    elif not CONF.get("recycle"):
        CONF["recycle"] = os.path.join(os.path.dirname(game), "隔离区")
    if save:
        save_settings()
    return CONF


def load_settings():
    try:
        with open(CONF["settings"], encoding="utf-8") as f:
            d = json.load(f)
    except Exception:
        return
    game = d.get("game") or ""
    if game and is_kks_root(game):
        apply_game_root(game, recycle=d.get("recycle"), save=False)
        return
    if d.get("mods"):
        CONF["mods"] = d["mods"]
    if d.get("recycle"):
        CONF["recycle"] = d["recycle"]
    if d.get("root") and os.path.isdir(d["root"]):
        for k in ("root", "coord", "scene"):
            if d.get(k):
                CONF[k] = d[k]


def save_settings():
    try:
        with open(CONF["settings"], "w", encoding="utf-8") as f:
            json.dump({
                "game": CONF["game"], "root": CONF["root"], "coord": CONF["coord"],
                "scene": CONF["scene"], "mods": CONF["mods"], "recycle": CONF["recycle"],
            }, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


load_settings()
if not is_kks_root(CONF.get("game")):
    _g = guess_game_root()
    if _g:
        apply_game_root(_g, recycle=CONF.get("recycle") or None, save=True)
        log.info("自动识别游戏目录：%s", CONF["game"])
    else:
        log.warning("没找到 KoikatsuSunshine 安装目录，请在界面里手动指定")

# 可浏览的根：key -> 绝对路径
ROOTS = {"chara": "root", "coord": "coord", "scene": "scene"}


def root_path(name):
    key = ROOTS.get(name or "chara", "root")
    return CONF[key]


def root_label(name):
    return {"chara": "人物卡 chara", "coord": "服装卡 coordinate",
            "scene": "场景卡 scene"}.get(name or "chara", "人物卡 chara")

_card_cache = {}
_tree_cache = {}
_lock = threading.Lock()


# ----------------------------------------------------------------- utils
def safe_join(root, rel):
    rel = (rel or "").replace("\\", "/").strip("/")
    root_abs = os.path.realpath(root)
    if not rel:
        return root_abs
    p = os.path.realpath(os.path.join(root_abs, rel))
    if os.path.commonpath([root_abs, p]) != root_abs:
        raise ValueError("path escapes root")
    return p


def build_tree(root):
    dirs = []
    if not os.path.isdir(root):
        return dirs
    for dp, dn, fn in os.walk(root):
        pngs = [f for f in fn if f.lower().endswith(".png")]
        rel = os.path.relpath(dp, root).replace("\\", "/")
        dirs.append({"path": "" if rel == "." else rel, "own": len(pngs)})
    dirs.sort(key=lambda d: d["path"])
    return dirs


def cards_in(dirpath, hint=None):
    """走本地库：只有新增/改动过的文件才会真解析。"""
    return store.cards_in(dirpath, hint)


def thumb_path(src):
    st = os.stat(src)
    h = hashlib.sha1(("%s|%d|%d" % (src, st.st_mtime, st.st_size)).encode("utf-8")).hexdigest()
    return os.path.join(CONF["thumb_dir"], h + ".jpg")


def make_thumb(src):
    dst = thumb_path(src)
    if os.path.exists(dst):
        return dst
    if not HAS_PIL:
        return None
    try:
        raw = kklib.read_png_part(src)
        im = Image.open(io.BytesIO(raw))
        im = im.convert("RGB")
        im.thumbnail((320, 320), Image.LANCZOS)
        tmp = dst + ".tmp"
        im.save(tmp, "JPEG", quality=88)
        os.replace(tmp, dst)
        return dst
    except Exception:
        return None


# ----------------------------------------------------------------- http
class Handler(BaseHTTPRequestHandler):
    server_version = "KKSCard/1.0"

    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False)
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass

    def _file(self, path, ctype):
        try:
            with open(path, "rb") as f:
                data = f.read()
        except Exception:
            self._send(404, {"error": "not found"})
            return
        self._send(200, data, ctype)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        path = urllib.parse.unquote(u.path)

        try:
            if path == "/" or path == "/index.html":
                return self._file(os.path.join(HERE, "static", "index.html"),
                                  "text/html; charset=utf-8")
            if path.startswith("/static/"):
                name = path[len("/static/"):].replace("/", os.sep)
                full = os.path.realpath(os.path.join(HERE, "static", name))
                if not full.startswith(os.path.realpath(os.path.join(HERE, "static"))):
                    return self._send(403, {"error": "forbidden"})
                ext = os.path.splitext(full)[1].lower()
                ctype = {".js": "application/javascript; charset=utf-8",
                         ".css": "text/css; charset=utf-8",
                         ".html": "text/html; charset=utf-8",
                         ".woff2": "font/woff2",
                         ".svg": "image/svg+xml"}.get(ext, "application/octet-stream")
                return self._file(full, ctype)

            if path == "/api/config":
                coord = CONF["coord"]
                scene = CONF["scene"]
                return self._send(200, {
                    "game": CONF["game"], "game_ok": is_kks_root(CONF["game"]),
                    "root": CONF["root"], "coord": coord, "mods": CONF["mods"],
                    "recycle": CONF["recycle"], "scene": scene, "has_pil": HAS_PIL,
                    "has_coord": os.path.isdir(coord),
                    "has_scene": os.path.isdir(scene),
                    "has_root": os.path.isdir(CONF["root"]),
                    "version": VERSION, "logs": LOG_DIR,
                })

            if path == "/api/tree":
                rname = (q.get("root") or ["chara"])[0]
                rp = root_path(rname)
                if not os.path.isdir(rp):
                    return self._send(200, {"root": rp, "dirs": [], "missing": True})
                if (q.get("refresh") or ["0"])[0] == "1":
                    with _lock:
                        _tree_cache.pop(rp, None)
                with _lock:
                    cached = _tree_cache.get(rp)
                if cached is None:
                    cached = build_tree(rp)
                    with _lock:
                        _tree_cache[rp] = cached
                return self._send(200, {"root": rp, "dirs": cached})

            if path == "/api/cards":
                rel = (q.get("dir") or [""])[0]
                rn = (q.get("root") or ["chara"])[0]
                d = safe_join(root_path(rn), rel)
                if not os.path.isdir(d):
                    return self._send(400, {"error": "not a directory"})
                cards = cards_in(d, hint=rn)
                return self._send(200, {"dir": rel, "total": len(cards), "cards": cards})

            if path == "/api/thumb":
                rel = (q.get("path") or [""])[0]
                src = safe_join(root_path((q.get("root") or ["chara"])[0]), rel)
                if not os.path.isfile(src):
                    return self._send(404, {"error": "not found"})
                t = make_thumb(src)
                if not t:
                    return self._send(404, {"error": "no thumb"})
                return self._file(t, "image/jpeg")

            return self._send(404, {"error": "no route"})
        except Exception as e:
            try:
                log.exception("GET %s 处理失败", self.path)
            except Exception:
                pass
            return self._send(500, {"error": str(e)})

    # ------------------------------------------------------------ POST
    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self._send(400, {"error": "bad json"})

        try:
            if u.path == "/api/move":
                return self._api_move(body)
            if u.path == "/api/mkdir":
                return self._api_mkdir(body)
            if u.path == "/api/open":
                return self._api_open(body)
            if u.path == "/api/quarantine":
                return self._api_quarantine(body)
            if u.path == "/api/install":
                return self._api_install(body)
            if u.path == "/api/themes":
                return self._api_themes(body)
            if u.path == "/api/pickdir":
                return self._api_pickdir(body)
            if u.path == "/api/settings":
                return self._api_settings(body)
            if u.path == "/api/detect":
                return self._api_detect(body)
            if u.path == "/api/instlog":
                return self._api_instlog(body)
            if u.path == "/api/undo":
                return self._api_undo(body)
            if u.path == "/api/recycle":
                return self._api_recycle(body)
            if u.path == "/api/restore":
                return self._api_restore(body)
            if u.path == "/api/index":
                return self._api_index(body)
            if u.path == "/api/log":
                return self._api_log(body)
            return self._send(404, {"error": "no route"})
        except Exception as e:
            try:
                log.exception("POST %s 处理失败", u.path)
            except Exception:
                pass
            return self._send(500, {"error": str(e)})

    def _forget(self):
        with _lock:
            _card_cache.clear()
            _tree_cache.clear()

    def _api_move(self, body):
        src_rp = root_path(body.get("root"))
        dst_rp = root_path(body.get("to_root") or body.get("root"))
        src_rel = (body.get("from") or "").replace("\\", "/")
        dst_rel = (body.get("to") or "").replace("\\", "/")
        files = [os.path.basename(str(f)) for f in (body.get("files") or []) if f]
        if not files:
            return self._send(400, {"error": "没有选中文件"})
        src = safe_join(src_rp, src_rel)
        dst = safe_join(dst_rp, dst_rel)
        if not os.path.isdir(src):
            return self._send(400, {"error": "源文件夹不存在"})
        if src == dst:
            return self._send(400, {"error": "源和目标是同一个文件夹"})
        os.makedirs(dst, exist_ok=True)
        moved, errors = [], []
        for base in files:
            s = os.path.join(src, base)
            if not os.path.isfile(s):
                errors.append(base + "：不存在")
                continue
            d = os.path.join(dst, base)
            if os.path.exists(d):
                stem, ext = os.path.splitext(base)
                i = 1
                while os.path.exists(d):
                    d = os.path.join(dst, "%s_%d%s" % (stem, i, ext))
                    i += 1
            try:
                shutil.move(s, d)
                moved.append(os.path.basename(d))
                store.drop_card(s)
                store.upsert_card(d)
            except Exception as e:
                errors.append("%s：%s" % (base, e))
        self._forget()
        return self._send(200, {"moved": moved, "errors": errors,
                                "from": src_rel, "to": dst_rel})

    def _api_mkdir(self, body):
        rp = root_path(body.get("root"))
        parent = safe_join(rp, (body.get("parent") or "").replace("\\", "/"))
        name = (body.get("name") or "").strip()
        if not name or any(c in name for c in '\\/:*?"<>|'):
            return self._send(400, {"error": "文件夹名不合法"})
        target = os.path.join(parent, name)
        if os.path.exists(target):
            return self._send(400, {"error": "已存在同名文件夹"})
        os.makedirs(target, exist_ok=True)
        self._forget()
        rel = os.path.relpath(target, rp).replace("\\", "/")
        return self._send(200, {"path": rel})

    def _api_open(self, body):
        rel = (body.get("dir") or "").replace("\\", "/")
        p = safe_join(root_path(body.get("root")), rel)
        if not os.path.isdir(p):
            return self._send(400, {"error": "文件夹不存在：%s" % p})
        import subprocess
        try:
            if body.get("select"):
                subprocess.Popen(["explorer.exe", "/select,", p])
            else:
                subprocess.Popen(["explorer.exe", p])
        except Exception as e:
            return self._send(500, {"error": "无法启动资源管理器：%s" % e})
        return self._send(200, {"ok": True, "path": p})

    def _api_detect(self, body):
        """自动/手动定位 KKS 安装目录。"""
        game = (body.get("game") or "").strip()
        if game:
            game = os.path.abspath(game)
            if not os.path.isdir(game):
                return self._send(400, {"error": "目录不存在：%s" % game})
            if not is_kks_root(game):
                # 允许直接指向 K_K_S 这种带 exe 的目录，也允许指到上一级
                for name in ("K_K_S", "KoikatsuSunshine", "Koikatsu"):
                    c = os.path.join(game, name)
                    if is_kks_root(c):
                        game = c
                        break
                else:
                    return self._send(400, {"error": "这个目录里没有 KoikatsuSunshine.exe"})
        else:
            game = guess_game_root()
            if not game:
                return self._send(200, {"ok": False, "error": "没找到，请手动选一下游戏根目录"})
        recycle = body.get("recycle") or None
        apply_game_root(game, recycle=recycle)
        self._forget()
        log.info("游戏目录设为 %s", CONF["game"])
        return self._send(200, {"ok": True, "game": CONF["game"],
                                "root": CONF["root"], "coord": CONF["coord"],
                                "scene": CONF["scene"], "mods": CONF["mods"],
                                "recycle": CONF["recycle"]})

    # ------------------------------------------------------- 隔离删除
    def _api_quarantine(self, body):
        rp = root_path(body.get("root"))
        rel = (body.get("dir") or "").replace("\\", "/")
        files = [os.path.basename(str(f)) for f in (body.get("files") or []) if f]
        if not files:
            return self._send(400, {"error": "没有选中卡片"})
        src = safe_join(rp, rel)
        if not os.path.isdir(src):
            return self._send(400, {"error": "源文件夹不存在"})
        return self._send(200, _do_quarantine(
            rp, src, rel, files,
            recycle=body.get("recycle") or None,
            with_mods=bool(body.get("with_mods"))))

    # ------------------------------------------------------- 前端报错
    def _api_log(self, body):
        msg = str(body.get("msg") or "")[:4000]
        where = str(body.get("where") or "")[:500]
        stack = str(body.get("stack") or "")[:8000]
        try:
            with open(os.path.join(LOG_DIR, "frontend.log"), "a", encoding="utf-8") as f:
                f.write("\n===== %s =====\n" % datetime.datetime.now().isoformat(timespec="seconds"))
                f.write("where: %s\nmsg: %s\n%s\n" % (where, msg, stack))
        except Exception:
            pass
        log.warning("前端报错 [%s] %s", where, msg)
        return self._send(200, {"ok": True})

    # ------------------------------------------------------- 本地库
    def _index_status(self):
        try:
            size = os.path.getsize(CONF["db"]) if os.path.isfile(CONF["db"]) else 0
        except Exception:
            size = 0
        return {"cards": store.card_count(), "mods": store.mod_count(), "db": size}

    def _api_index(self, body):
        if body.get("rebuild"):
            n = refresh_card_store()
            store.scan_mods(CONF["mods"], force=True)
            d = self._index_status()
            d["rebuilt"] = n
            return self._send(200, d)
        return self._send(200, self._index_status())

    # ------------------------------------------------------- 安装导入
    def _api_install(self, body):
        rp = root_path(body.get("root"))
        dest_rel = (body.get("dest") or "").replace("\\", "/")
        dest = safe_join(rp, dest_rel)
        source = (body.get("src") or "").strip().strip('"')
        if not source:
            return self._send(400, {"error": "没有指定源文件夹"})
        source = os.path.abspath(source)
        if not os.path.isdir(source):
            return self._send(400, {"error": "源文件夹不存在：%s" % source})
        if body.get("preview"):
            return self._send(200, _install_scan(source))
        if not os.path.isdir(dest):
            return self._send(400, {"error": "目标文件夹不存在：%s" % dest})
        return self._send(200, _do_install(source, dest, dest_rel, body.get("root") or "chara"))

    def _api_themes(self, body):
        return self._send(200, {"ok": True})

    def _api_pickdir(self, body):
        try:
            p = _tk_pick_dir(body.get("initial") or "")
        except Exception as e:
            return self._send(500, {"error": "打不开选择框：%s" % e})
        if not p:
            return self._send(200, {"cancelled": True})
        return self._send(200, {"path": p})

    def _api_settings(self, body):
        if body.get("game"):
            apply_game_root(body["game"], recycle=body.get("recycle") or None)
        if body.get("recycle"):
            CONF["recycle"] = os.path.abspath(body["recycle"])
        if body.get("mods"):
            CONF["mods"] = os.path.abspath(body["mods"])
        save_settings()
        self._forget()
        return self._send(200, {"game": CONF["game"], "root": CONF["root"],
                                "coord": CONF["coord"], "scene": CONF["scene"],
                                "mods": CONF["mods"], "recycle": CONF["recycle"]})

    def _api_instlog(self, body):
        return self._send(200, {"log": load_instlog()})

    def _api_undo(self, body):
        entry_id = body.get("id")
        if not entry_id:
            return self._send(400, {"error": "没指定要撤销哪一次"})
        r = undo_install(entry_id)
        return self._send(200, r)

    def _api_recycle(self, body):
        return self._send(200, {"root": CONF["recycle"], "batches": scan_recycle()})

    def _api_restore(self, body):
        folders = body.get("folders") or []
        if not folders:
            return self._send(400, {"error": "没选中要还原的卡"})
        return self._send(200, restore_cards(folders))


CARD_EXT = (".png",)
MOD_EXT = (".zipmod", ".zip")


def _short_hash(s):
    return hashlib.md5(s.encode("utf-8", "replace")).hexdigest()[:6]


def _install_scan(source, max_files=30000):
    """扫描源文件夹（递归，最多 3 层），分类出卡和 mod。"""
    cards, mods, others = [], [], 0
    seen = set()
    count = [0]

    def walk(d, depth=0):
        nonlocal others
        if count[0] > max_files:
            return
        try:
            names = os.listdir(d)
        except Exception:
            return
        for n in sorted(names):
            if count[0] > max_files:
                return
            full = os.path.join(d, n)
            if os.path.isdir(full):
                if depth < 6 and not n.startswith("."):
                    walk(full, depth + 1)
                continue
            count[0] += 1
            low = n.lower()
            if low.endswith(MOD_EXT):
                try:
                    sz = os.path.getsize(full)
                except Exception:
                    sz = 0
                key = (n.lower(), sz)
                if key in seen:
                    continue
                seen.add(key)
                mods.append({"name": n, "path": full, "size": sz})
            elif low.endswith(CARD_EXT):
                info = kklib.parse_card(full)
                if info.get("kind") in ("card", "coord"):
                    cards.append({"name": n, "path": full,
                                  "kind": info.get("kind"),
                                  "title": info.get("title") or "",
                                  "refs": len({r.get("guid") for r in (info.get("refs") or []) if r.get("guid")})})
            else:
                others += 1

    walk(source)
    cards.sort(key=lambda x: x["name"].lower())
    mods.sort(key=lambda x: x["name"].lower())
    return {"src": source, "cards": cards, "mods": mods, "others": others,
            "scanned": count[0], "truncated": count[0] > max_files,
            "total_cards": len(cards), "total_mods": len(mods)}


def _unique_path(dest_dir, name):
    d = os.path.join(dest_dir, name)
    if not os.path.exists(d):
        return d
    stem, ext = os.path.splitext(name)
    i = 1
    while os.path.exists(d):
        d = os.path.join(dest_dir, "%s_%d%s" % (stem, i, ext))
        i += 1
    return d


def _do_install(source, dest, dest_rel, root_name="chara"):
    """卡按类型归位，mod 进 mods；认不出的原样留下，由用户自己决定放哪。"""
    scan = _install_scan(source)
    coord_root = CONF["coord"]
    mods_dir = CONF["mods"]
    try:
        os.makedirs(mods_dir, exist_ok=True)
    except Exception:
        pass

    moves, errors, skipped = [], [], []
    counts = {"card": 0, "coord": 0, "mod": 0, "unknown": 0}

    def move_to(src_path, dst_dir, tag):
        d = _unique_path(dst_dir, os.path.basename(src_path))
        try:
            shutil.move(src_path, d)
        except Exception as e:
            errors.append("%s：%s" % (os.path.basename(src_path), e))
            return False
        moves.append({"src": src_path, "dst": d, "type": tag})
        counts[tag] += 1
        # 立刻写进本地库，下次打开不用重扫
        try:
            if tag in ("card", "coord"):
                store.upsert_card(d, hint=("chara" if tag == "card" else "coord"))
            elif tag == "mod":
                store.upsert_mod(d)
        except Exception:
            pass
        return True

    for c in scan["cards"]:
        if c["kind"] == "coord":
            target = coord_root if root_name != "coord" else dest
            if not os.path.isdir(target):
                errors.append("%s：coordinate 目录不存在，留在原地" % c["name"])
                continue
            move_to(c["path"], target, "coord")
        else:
            move_to(c["path"], dest, "card")

    for m in scan["mods"]:
        low = m["name"].lower()
        if low.endswith(".zip") and not _zip_is_mod(m["path"]):
            skipped.append(m["name"])
            continue
        if os.path.exists(os.path.join(mods_dir, os.path.basename(m["path"]))):
            errors.append("%s：mods 里已有同名文件，跳过" % m["name"])
            continue
        move_to(m["path"], mods_dir, "mod")

    entry = {
        "id": datetime.datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + hashlib.md5(
            (source + str(len(moves))).encode("utf-8", "replace")).hexdigest()[:4],
        "at": datetime.datetime.now().isoformat(timespec="seconds"),
        "src": source,
        "dest": os.path.join(root_path(root_name), dest_rel).replace("\\", "/"),
        "root": root_name,
        "counts": counts,
        "moves": moves,
        "errors": errors,
    }
    if moves:
        add_instlog(entry)
    _CARD_CACHE_CLEAR()
    return {"cards": [os.path.basename(m["dst"]) for m in moves if m["type"] == "card"],
            "coords": [os.path.basename(m["dst"]) for m in moves if m["type"] == "coord"],
            "mods": [os.path.basename(m["dst"]) for m in moves if m["type"] == "mod"],
            "unknown": [],
            "skipped": skipped,
            "errors": errors, "counts": counts, "entry": entry.get("id") if moves else None,
            "dest": dest_rel, "src": source}


# ------------------------------------------------------------- 全局索引
def card_index(force=False):
    """guid -> [卡相对 chara 的路径]。全部来自本地库，不碰文件。"""
    return store.holders(CONF["root"])


def mods_index(force=False):
    """guid -> [zipmod 绝对路径]。第一次或 force 时才扫盘。"""
    if force or not store.mod_count():
        store.scan_mods(CONF["mods"], force=force)
    return store.mods_by_guid()


def _CARD_CACHE_CLEAR():
    _tree_cache.clear()


def refresh_card_store(progress=None):
    """全量走一遍人物卡目录，把没进库的卡补进去。"""
    root = CONF["root"]
    paths = []
    for dp, dn, fn in os.walk(root):
        for f in fn:
            if f.lower().endswith(".png"):
                paths.append(os.path.join(dp, f))
    n = 0
    for i, p in enumerate(paths):
        if store.upsert_card(p):
            n += 1
        if progress and i % 50 == 0:
            progress(i, len(paths))
    try:
        store.prune(root)
    except Exception:
        pass
    return n


def ensure_card_store():
    """库里的卡明显比磁盘少时，先补齐再判断引用关系。"""
    root = CONF["root"]
    disk = 0
    for dp, dn, fn in os.walk(root):
        disk += sum(1 for f in fn if f.lower().endswith(".png"))
    have = store.card_count()
    if have >= disk * 0.99 and have > 0:
        return 0
    return refresh_card_store()


# --------------------------------------------------------------- 回收站
def scan_recycle():
    """列出隔离区里的批次和其中的卡。"""
    root = CONF["recycle"]
    out = []
    if not os.path.isdir(root):
        return out
    for name in sorted(os.listdir(root), reverse=True):
        batch = os.path.join(root, name)
        if not os.path.isdir(batch):
            continue
        items = []
        for dp, dn, fn in os.walk(batch):
            meta = os.path.join(dp, "_info.json")
            if not os.path.isfile(meta):
                continue
            try:
                with open(meta, encoding="utf-8") as f:
                    m = json.load(f)
            except Exception:
                continue
            pngs = [f for f in fn if f.lower().endswith(".png")]
            items.append({
                "folder": dp,
                "rel": os.path.relpath(dp, root).replace("\\", "/"),
                "file": m.get("file") or (pngs[0] if pngs else ""),
                "kind": m.get("kind"),
                "title": m.get("title") or "",
                "from": m.get("from") or "",
                "refs": len({r.get("guid") for r in (m.get("refs") or []) if r.get("guid")}),
            })
        if items:
            out.append({"batch": name, "path": batch, "items": items,
                        "count": len(items)})
    return out


def restore_cards(folders):
    """把隔离区里的卡搬回它们原来的文件夹。"""
    back, errors = [], []
    for folder in folders:
        folder = os.path.abspath(folder)
        if not os.path.isdir(folder):
            errors.append("%s：目录不存在" % folder)
            continue
        meta_path = os.path.join(folder, "_info.json")
        try:
            with open(meta_path, encoding="utf-8") as f:
                meta = json.load(f)
        except Exception:
            errors.append("%s：读不到 _info.json" % os.path.basename(folder))
            continue
        src_dir = meta.get("from") or ""
        name = meta.get("file") or ""
        pngs = [f for f in os.listdir(folder) if f.lower().endswith(".png")]
        if not name and pngs:
            name = pngs[0]
        if not src_dir or not name:
            errors.append("%s：记录里没有原位置" % os.path.basename(folder))
            continue
        src = os.path.join(folder, name)
        if not os.path.isfile(src):
            errors.append("%s：卡已不在隔离区" % name)
            continue
        try:
            os.makedirs(src_dir, exist_ok=True)
        except Exception as e:
            errors.append("%s：原目录建不出来（%s）" % (name, e))
            continue
        dst = _unique_path(src_dir, name)
        try:
            shutil.move(src, dst)
            back.append(os.path.basename(dst))
            try:
                store.upsert_card(dst)
            except Exception:
                pass
            # 当初跟着这张卡一起搬走的 mod，也一并放回游戏 mods 目录
            md = os.path.join(folder, "mods")
            if os.path.isdir(md):
                for f in sorted(os.listdir(md)):
                    sp = os.path.join(md, f)
                    if not os.path.isfile(sp):
                        continue
                    try:
                        dm = _unique_path(CONF["mods"], f)
                        os.makedirs(CONF["mods"], exist_ok=True)
                        shutil.move(sp, dm)
                        store.upsert_mod(dm)
                        back.append("mods\\" + os.path.basename(dm))
                    except Exception as e:
                        errors.append("mod %s：%s" % (f, e))
            try:
                os.remove(meta_path)
            except Exception:
                pass
        except Exception as e:
            errors.append("%s：%s" % (name, e))
    _CARD_CACHE_CLEAR()
    return {"restored": back, "errors": errors}


def _tk_pick_dir(initial=""):
    """弹一个系统文件夹选择框，返回选中的路径（取消返回 None）。"""
    import tkinter as tk
    from tkinter import filedialog
    box = {"path": None}

    def run():
        r = tk.Tk()
        r.withdraw()
        r.attributes("-topmost", True)
        try:
            p = filedialog.askdirectory(
                parent=r, title="选择文件夹",
                initialdir=initial or (CONF["recycle"] if os.path.isdir(CONF["recycle"]) else os.path.expanduser("~")))
        finally:
            r.destroy()
        box["path"] = p or None

    t = threading.Thread(target=run, daemon=True)
    t.start()
    t.join(600)
    return box["path"]


# ------------------------------------------------------------- 安装记录
def load_instlog():
    try:
        with open(CONF["instlog"], encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def save_instlog(entries):
    try:
        with open(CONF["instlog"], "w", encoding="utf-8") as f:
            json.dump(entries[:10], f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def add_instlog(entry):
    entries = load_instlog()
    entries.insert(0, entry)
    save_instlog(entries)
    return entry


def undo_install(entry_id):
    entries = load_instlog()
    target = None
    for e in entries:
        if e.get("id") == entry_id:
            target = e
            break
    if target is None:
        return {"error": "找不到这条安装记录"}
    if target.get("undone"):
        return {"error": "这条已经撤销过了"}
    back, errors = [], []
    for m in target.get("moves", []):
        src, dst = m.get("src"), m.get("dst")
        if not dst or not os.path.exists(dst):
            errors.append("%s：文件已经不在了" % os.path.basename(str(dst)))
            continue
        if not os.path.isdir(os.path.dirname(src)):
            errors.append("%s：原目录不存在，跳过" % os.path.basename(str(src)))
            continue
        d = src
        if os.path.exists(d):
            stem, ext = os.path.splitext(os.path.basename(src))
            i = 1
            while os.path.exists(d):
                d = os.path.join(os.path.dirname(src), "%s_undo%d%s" % (stem, i, ext))
                i += 1
        try:
            shutil.move(dst, d)
            back.append(os.path.basename(d))
        except Exception as e:
            errors.append("%s：%s" % (os.path.basename(str(dst)), e))
    target["undone"] = True
    target["undone_at"] = datetime.datetime.now().isoformat(timespec="seconds")
    save_instlog(entries)
    _CARD_CACHE_CLEAR()
    return {"restored": back, "errors": errors}


def _zip_is_mod(path):
    """.zip 是不是一个 mod 包：里面有 manifest.xml 或者 abdata/。"""
    import zipfile
    try:
        with zipfile.ZipFile(path) as z:
            names = z.namelist()[:400]
    except Exception:
        return False
    for n in names:
        low = n.lower()
        if low.endswith("manifest.xml"):
            return True
        if low.startswith("abdata/") or "/abdata/" in low:
            return True
    return False


def _do_quarantine(rp, src, rel, files, recycle=None, with_mods=False):
    """把选中的卡移进隔离区，保留原来的分类层级，每张卡一个文件夹。"""
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    base_dir = os.path.abspath(recycle or CONF["recycle"])
    batch = os.path.join(base_dir, stamp)
    # 保留原分类路径（female/抽卡游戏/原神 之类）
    sub = os.path.join(batch, *[x for x in rel.split("/") if x]) if rel else batch
    os.makedirs(sub, exist_ok=True)
    items, errors = [], []
    all_refs = {}
    if with_mods:
        try:
            ensure_card_store()
            if not store.mod_count():
                store.scan_mods(CONF["mods"])
        except Exception as e:
            errors.append("建索引时出错：%s" % e)
    for base in files:
        s = os.path.join(src, base)
        if not os.path.isfile(s):
            errors.append(base + "：不存在")
            continue
        info = kklib.parse_card(s)
        stem = os.path.splitext(base)[0]
        folder = os.path.join(sub, "%s__%s" % (_safe_name(stem)[:60], _short_hash(base + stamp)))
        try:
            os.makedirs(folder, exist_ok=True)
            dst = os.path.join(folder, base)
            shutil.move(s, dst)
            store.drop_card(s)
        except Exception as e:
            errors.append("%s：%s" % (base, e))
            continue
        refs = info.get("refs") or []
        for r in refs:
            all_refs.setdefault(r.get("guid"), []).append(base)
        meta = {
            "file": base,
            "kind": info.get("kind"),
            "title": info.get("title") or "",
            "from": os.path.join(rp, rel).replace("\\", "/"),
            "quarantined_at": stamp,
            "refs": refs,
        }
        try:
            with open(os.path.join(folder, "_info.json"), "w", encoding="utf-8") as f:
                json.dump(meta, f, ensure_ascii=False, indent=2)
        except Exception:
            pass
        items.append({"file": base, "folder": folder, "refs": [r.get("guid") for r in refs],
                      "kind": info.get("kind")})

    moved_mods = []
    orphan_guids = []
    if with_mods and items:
        try:
            holders = card_index()
            loc = mods_index()
        except Exception as e:
            errors.append("建索引失败：%s" % e)
            holders, loc = {}, {}
        quar_rels = set()
        for it in items:
            quar_rels.add((rel + "/" + it["file"]) if rel else it["file"])
        folder_of = {it["file"]: it["folder"] for it in items}
        for g, owners in all_refs.items():
            if set(holders.get(g, [])) - quar_rels:
                continue                      # 还有别的卡在用，不能动
            paths = loc.get(g) or []
            if not paths:
                continue
            owner_set = set(owners)
            if len(owner_set) == 1:
                target_dir = os.path.join(folder_of.get(list(owner_set)[0], batch), "mods")
            else:
                target_dir = os.path.join(batch, "_共用mod")
            try:
                os.makedirs(target_dir, exist_ok=True)
            except Exception as e:
                errors.append("建目录失败 %s：%s" % (target_dir, e))
                continue
            orphan_guids.append(g)
            for p in paths:
                if not os.path.isfile(p):
                    continue
                try:
                    d = _unique_path(target_dir, os.path.basename(p))
                    shutil.move(p, d)
                    store.drop_mod(p)
                    moved_mods.append({"guid": g, "file": os.path.basename(d),
                                       "to": os.path.relpath(d, batch).replace("\\", "/")})
                except Exception as e:
                    errors.append("%s：%s" % (os.path.basename(p), e))

    manifest = {
        "batch": stamp,
        "created": datetime.datetime.now().isoformat(timespec="seconds"),
        "recycle": base_dir,
        "category": rel,
        "source": os.path.join(rp, rel).replace("\\", "/"),
        "count": len(items),
        "items": items,
        "mods": moved_mods,
        "orphan_guids": orphan_guids,
        "errors": errors,
    }
    try:
        with open(os.path.join(batch, "_manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        with open(os.path.join(batch, "_报告.html"), "w", encoding="utf-8") as f:
            f.write(_report_html(manifest, all_refs))
    except Exception:
        pass
    _CARD_CACHE_CLEAR()
    return {"batch": batch, "count": len(items), "errors": errors,
            "guids": sorted(all_refs.keys()), "src": rel,
            "mods": moved_mods, "orphans": len(orphan_guids)}


def _safe_name(s):
    bad = '\\/:*?"<>|\r\n\t'
    return "".join("_" if c in bad else c for c in s).strip(" .") or "card"


def _report_html(manifest, all_refs):
    rows = []
    for guid, files in sorted(all_refs.items()):
        rows.append("<tr><td class=mono>%s</td><td>%s</td></tr>"
                    % (_html_esc(guid), _html_esc("、".join(files))))
    items = []
    for it in manifest["items"]:
        items.append("<tr><td>%s</td><td>%s</td><td class=mono>%d</td></tr>"
                     % (_html_esc(it["file"]), _html_esc(it["kind"] or ""), len(it["refs"])))
    return """<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>隔离批次 %s</title><style>
body{background:#1b1b1f;color:#e7e7ea;font:14px "Segoe UI","Microsoft YaHei",sans-serif;padding:24px}
h1{font-size:20px}h2{font-size:15px;margin-top:28px;color:#9ad8ff}
table{border-collapse:collapse;width:100%%;margin-top:8px}
th,td{border-bottom:1px solid #33333a;padding:6px 8px;text-align:left;vertical-align:top}
th{color:#a0a0a8;font-weight:500}.mono{font-family:Consolas,monospace;font-size:12px;color:#b8b8c0}
.ok{color:#7ee787}</style></head><body>
<h1>隔离批次 %s</h1>
<p>来源：<span class="mono">%s</span><br>时间：%s<br>共隔离 <b>%d</b> 张卡</p>
<h2>被隔离的卡</h2><table><tr><th>文件</th><th>类型</th><th>引用 mod 数</th></tr>%s</table>
<h2>这些卡引用过的 zipmod（去重）</h2>
<p class="ok">如果某个 GUID 只出现在这里，它对应的 zipmod 现在就是孤儿了。</p>
<table><tr><th>GUID</th><th>被这些卡引用</th></tr>%s</table>
</body></html>""" % (_html_esc(manifest["batch"]), _html_esc(manifest["batch"]),
                    _html_esc(manifest["source"]), _html_esc(manifest["created"]),
                    manifest["count"], "".join(items), "".join(rows))


def _html_esc(s):
    return (str(s or "").replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def _already_running(port):
    import urllib.request
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/api/config" % port, timeout=1.5) as r:
            return r.status == 200
    except Exception:
        return False


def _kill_port(port):
    """杀掉占着这个端口的进程（多半是上一次没退干净的自己）。"""
    import subprocess
    try:
        out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True, timeout=15).stdout
    except Exception:
        return
    pids = set()
    for line in out.splitlines():
        if "LISTENING" in line and (":%d " % port) in line:
            pid = line.split()[-1]
            if pid.isdigit():
                pids.add(pid)
    for pid in pids:
        try:
            subprocess.run(["taskkill", "/f", "/pid", pid],
                           capture_output=True, timeout=10)
        except Exception:
            pass


def _msgbox(text, title="KKS Card Organizer"):
    """pythonw 下没有控制台，出问题时得让人看得见。"""
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, str(text), str(title), 0x40)
    except Exception:
        pass


# 浏览器真实安装位置。msedge.exe 通常不在 PATH 里，也不在 CreateProcess 的
# 搜索范围内（App Paths 只有 ShellExecute 会用），所以必须按路径找。
_BROWSER_PATHS = {
    "edge": [
        r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe",
        r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe",
        r"%LocalAppData%\Microsoft\Edge\Application\msedge.exe",
    ],
    "chrome": [
        r"%ProgramFiles%\Google\Chrome\Application\chrome.exe",
        r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe",
        r"%LocalAppData%\Google\Chrome\Application\chrome.exe",
    ],
}


def _browser_exe(name):
    for pat in _BROWSER_PATHS.get(name, ()):
        p = os.path.expandvars(pat)
        if os.path.isfile(p):
            return p
    return ""


def open_ui(url, mode="auto"):
    """在自己的浏览器里打开界面。

    mode: auto = Edge/Chrome 的应用窗口，找不到就用系统默认浏览器；
          edge / chrome = 只试这一个；default = 直接用系统默认浏览器。
    任何一步失败都不会影响服务本身。
    """
    import subprocess
    order = []
    if mode == "default":
        order = []
    elif mode in ("edge", "chrome"):
        order = [mode]
    else:
        order = ["edge", "chrome"]
    flags = getattr(subprocess, "DETACHED_PROCESS", 0)
    for name in order:
        exe = _browser_exe(name)
        if not exe:
            log.info("%s 没找到，换下一个", name)
            continue
        try:
            subprocess.Popen([exe, "--app=" + url, "--window-size=1440,960"],
                             creationflags=flags)
            log.info("已用 %s 打开界面：%s", os.path.basename(exe), url)
            return True
        except Exception:
            log.exception("%s 打不开，换下一个", name)
    try:
        os.startfile(url)          # 系统默认浏览器
        log.info("已用默认浏览器打开界面：%s", url)
        return True
    except Exception:
        log.exception("默认浏览器也打不开")
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=CONF["root"])
    ap.add_argument("--mods", default=CONF["mods"])
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--db", default=CONF["db"], help="本地索引库路径")
    ap.add_argument("--open", action="store_true")
    ap.add_argument("--browser", default="auto",
                    choices=["auto", "edge", "chrome", "default"],
                    help="用哪个浏览器打开界面（auto = 先 Edge/Chrome 应用窗口，失败退回默认浏览器）")
    ap.add_argument("--kill", action="store_true",
                    help="端口被占用时先杀掉占用者")
    a = ap.parse_args()
    if a.root:
        CONF["root"] = os.path.abspath(a.root)
    if a.mods:
        CONF["mods"] = os.path.abspath(a.mods)
    if a.db != CONF["db"]:
        CONF["db"] = os.path.abspath(a.db)
        store.init(CONF["db"])
    if not CONF["root"] or not os.path.isdir(CONF["root"]):
        # 不退出：界面里点左栏底部那行可以指定游戏目录
        log.warning("卡目录不存在：%r —— 启动后点左栏「游戏目录」那行手动指定", CONF["root"])
        print("警告：卡目录不存在：", CONF["root"])
    class Srv(ThreadingHTTPServer):
        allow_reuse_address = False
        daemon_threads = True

    if _already_running(a.port):
        # 是本程序（任何版本）已经起来了，直接开窗口
        print("已有一个实例在 %d 端口运行。" % a.port)
        if a.open:
            open_ui("http://127.0.0.1:%d/" % a.port, a.browser)
        return 0
    if a.kill:
        _kill_port(a.port)
        time.sleep(0.4)
    srv = Srv(("127.0.0.1", a.port), Handler)
    url = "http://127.0.0.1:%d/" % a.port
    log.info("启动 v%s  端口=%d  卡目录=%s  mods=%s  库=%s",
             VERSION, a.port, CONF["root"], CONF["mods"], CONF["db"])
    print("卡片整理器已启动:", url)
    print("根目录:", CONF["root"])
    print("日志:", LOG_DIR)
    if a.open:
        # 服务先能应答，再开窗口；开不了也只是打不开窗口，不影响服务
        threading.Timer(0.9, open_ui, args=(url, a.browser)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    except Exception:
        log.exception("服务异常退出")
        raise
    finally:
        log.info("服务停止")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        log.exception("启动失败")
        _msgbox("启动失败。\n\n详细原因见：\n%s\n\n把 kkcard.log 发到 GitHub Issues 即可。"
                % os.path.join(LOG_DIR, "kkcard.log"))
        sys.exit(3)
