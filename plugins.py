"""插件清单与状态判定。

数据来源三份：
  1. tools/scan_plugins.ps1 用 Mono.Cecil 读 dll 元数据，产出 data/plugins_raw.json
  2. BepInEx/LogOutput.log  里的实际加载结果
  3. 文件系统（大小、时间、是否被改名成 .off）

只读 dll，不改任何东西；toggle() 才会改名，调用方负责确认。
"""
import json
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SCANNER = os.path.join(HERE, "tools", "scan_plugins.ps1")
RAW_JSON = os.path.join(HERE, "data", "plugins_raw.json")

_deps_cache = {"at": 0, "data": None}

# 日志里 "Loading [Name 1.2.3]" 之类的行
_RE_LOADING = re.compile(r"Loading \[(.+?)\]\s*$")
_RE_COULD_NOT = re.compile(
    r"Could not load \[(.+?)\] because it has missing dependencies: (.+)$"
)
_RE_DEP_NOT_LOADED = re.compile(
    r"Skipping \[(.+?)\] because it has a dependency that was not loaded"
)
_RE_PROC_FILTER = re.compile(
    r"Skipping \[(.+?)\] because of process filters \((.+?)\)"
)
_RE_WRONG_BEP = re.compile(
    r"Plugin \[(.+?)\] targets a wrong version of BepInEx \(([\d.]+)\)"
)
_RE_NEWER_EXISTS = re.compile(
    r"Skipping \[(.+?)\] because a newer version exists \((.+?)\)"
)


def _split_name_version(s):
    """'Animation Loader 1.1.3.4' -> ('Animation Loader', '1.1.3.4')"""
    s = s.strip()
    m = re.match(r"^(.*?)\s+([0-9][0-9A-Za-z.\-_]*)$", s)
    if not m:
        return s, None
    return m.group(1).strip(), m.group(2)


def read_log_status(log_path):
    """解析日志，返回 {插件名小写: {'state':..., 'detail':..., 'version':...}}"""
    out = {}
    if not os.path.isfile(log_path):
        return out
    try:
        with open(log_path, "r", encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()
    except OSError:
        return out

    for line in lines:
        m = _RE_COULD_NOT.search(line)
        if m:
            name, ver = _split_name_version(m.group(1))
            out[name.lower()] = {
                "state": "failed",
                "detail": m.group(2).strip(),
                "version": ver,
            }
            continue

        m = _RE_DEP_NOT_LOADED.search(line)
        if m:
            name, ver = _split_name_version(m.group(1))
            key = name.lower()
            cur = out.get(key)
            if not cur or cur["state"] == "loaded":
                out[key] = {
                    "state": "blocked",
                    "detail": "依赖的插件没加载",
                    "version": ver,
                }
            continue

        m = _RE_WRONG_BEP.search(line)
        if m:
            name, ver = _split_name_version(m.group(1))
            key = name.lower()
            cur = out.get(key) or {"state": "loaded", "detail": "", "version": ver}
            if cur["state"] in ("loaded", None) or cur["state"] == "wrongver":
                cur = dict(cur)
                cur["wrong_bepinex"] = m.group(2)
                cur["state"] = "loaded"
                out[key] = cur
            continue

        m = _RE_PROC_FILTER.search(line)
        if m:
            name, ver = _split_name_version(m.group(1))
            key = name.lower()
            cur = out.get(key)
            if not cur or cur["state"] in ("loaded", "wrongver"):
                out[key] = {
                    "state": "filtered",
                    "detail": m.group(2).strip(),
                    "version": ver,
                }
            continue

        m = _RE_NEWER_EXISTS.search(line)
        if m:
            name, ver = _split_name_version(m.group(1))
            out.setdefault(
                name.lower(),
                {
                    "state": "older",
                    "detail": "有更新的版本：" + m.group(2).strip(),
                    "version": ver,
                },
            )
            continue

        m = _RE_LOADING.search(line)
        if m:
            name, ver = _split_name_version(m.group(1))
            key = name.lower()
            cur = out.get(key)
            if cur and cur["state"] in ("failed", "blocked"):
                continue
            base = dict(cur) if cur else {}
            base["state"] = "loaded"
            base["version"] = ver
            base.setdefault("detail", "")
            out[key] = base

    return out


def run_scanner(plugins_dir=None, core_dir=None, out_path=None):
    """调用 PowerShell 扫一遍 dll，写 plugins_raw.json。返回摘要 dict。"""
    out_path = out_path or RAW_JSON
    if not os.path.isfile(SCANNER):
        return {"ok": False, "error": "扫描脚本不存在：" + SCANNER}

    cmd = ["pwsh", "-NoProfile", "-File", SCANNER, "-OutFile", out_path]
    if plugins_dir:
        cmd += ["-PluginsDir", plugins_dir]
    if core_dir:
        cmd += ["-CoreDir", core_dir]

    try:
        p = subprocess.run(
            cmd, capture_output=True, text=True, timeout=120,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except FileNotFoundError:
        return {"ok": False, "error": "找不到 pwsh，请安装 PowerShell 7"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "扫描超时"}

    if p.returncode != 0:
        return {"ok": False, "error": (p.stderr or p.stdout or "未知错误").strip()[:500]}

    try:
        return json.loads((p.stdout or "{}").strip().splitlines()[-1])
    except (ValueError, IndexError):
        return {"ok": True, "note": "扫描完成但摘要无法解析"}


def load_raw():
    if not os.path.isfile(RAW_JSON):
        return None
    try:
        with open(RAW_JSON, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _cmp_ver(a, b):
    """比较版本串，返回 -1/0/1；解析失败按 0 处理。"""
    def parts(v):
        if v is None:
            return []
        return [int(x) for x in re.findall(r"\d+", str(v))]
    pa, pb = parts(a), parts(b)
    if not pa or not pb:
        return 0
    n = max(len(pa), len(pb))
    pa += [0] * (n - len(pa))
    pb += [0] * (n - len(pb))
    for x, y in zip(pa, pb):
        if x != y:
            return -1 if x < y else 1
    return 0


def build_payload(plugins_dir=None, log_path=None, refresh=False):
    """合并三份数据，返回给前端的结构。"""
    global _deps_cache

    plugins_dir = plugins_dir or r"D:\kks\K_K_S\BepInEx\plugins"
    log_path = log_path or r"D:\kks\K_K_S\BepInEx\LogOutput.log"

    if refresh or not os.path.isfile(RAW_JSON):
        scan = run_scanner(plugins_dir=plugins_dir,
                           core_dir=os.path.join(os.path.dirname(plugins_dir), "core"))
        if not scan.get("ok") and not os.path.isfile(RAW_JSON):
            return {"ok": False, "error": scan.get("error") or "扫描失败"}

    raw = load_raw()
    if raw is None:
        return {"ok": False, "error": "没有扫描结果"}

    log_status = read_log_status(log_path)
    bepinex = raw.get("bepinex")
    plugin_guids = {p["guid"]: p for p in raw["plugins"] if p.get("guid")}

    rows = []
    for p in raw["plugins"]:
        if not p.get("cecil_ok"):
            continue

        key = (p.get("name") or "").lower()
        st = log_status.get(key)

        # 依赖检查：缺 GUID 或版本不够
        missing = []
        for d in p.get("deps") or []:
            g = d.get("guid")
            if not g:
                continue
            have = plugin_guids.get(g)
            if have is None:
                # 可能是 BepInEx 核心或其它未扫到的东西，先记为未知
                missing.append({"guid": g, "min": d.get("min"), "why": "未找到该 GUID 的插件"})
                continue
            need = d.get("min")
            if need and _cmp_ver(have.get("version"), need) < 0:
                missing.append({
                    "guid": g,
                    "min": need,
                    "have": have.get("version"),
                    "why": "版本不够",
                })

        wrong_bep = None
        if st and st.get("wrong_bepinex"):
            wrong_bep = st["wrong_bepinex"]

        logged_ok = bool(st and st.get("state") in ("loaded", "filtered", "older"))

        # 状态优先级：日志说加载成功就以日志为准（Cecil 读不到混合模式 dll 的 GUID，
        # 会把 KSOX 这类依赖误判成"未找到"）；否则缺依赖 > 被拦 > 版本不符 > 仅 Studio > 正常
        if missing and not logged_ok:
            state = "missing"
        elif st and st["state"] == "failed":
            state = "missing" if missing else "failed"
        elif st and st["state"] == "blocked":
            state = "blocked"
        elif wrong_bep:
            state = "wrongver"
        elif st and st["state"] == "filtered":
            state = "filtered"
        elif st and st["state"] == "older":
            state = "older"
        else:
            state = "ok"

        rows.append({
            "file": p["file"],
            "rel": p["rel"],
            "size": p.get("size"),
            "mtime": p.get("mtime"),
            "guid": p.get("guid"),
            "name": p.get("name") or p["file"],
            "version": p.get("version"),
            "deps": [d for d in (p.get("deps") or []) if d.get("guid")],
            "processes": p.get("processes") or [],
            "missing": missing,
            "wrong_bepinex": wrong_bep,
            "state": state,
            "detail": (st or {}).get("detail") or "",
            "disabled_twin": p.get("disabled_twin"),
        })

    # 排序：问题优先
    order = {"missing": 0, "failed": 1, "blocked": 2, "wrongver": 3, "older": 4,
             "filtered": 5, "ok": 6}
    rows.sort(key=lambda r: (order.get(r["state"], 9), (r["name"] or "").lower()))

    counts = {}
    for r in rows:
        counts[r["state"]] = counts.get(r["state"], 0) + 1

    _deps_cache = {"at": time.time(), "data": rows}

    return {
        "ok": True,
        "bepinex": bepinex,
        "scanned_at": raw.get("scanned_at"),
        "total": len(rows),
        "counts": counts,
        "plugins": rows,
        "disabled": raw.get("disabled") or [],
    }


def toggle(plugins_dir, rel, enable):
    """启用/禁用一个插件：在 .dll 与 .dll.off 之间改名。

    enable=True  → 把 xxx.dll.off 改回 xxx.dll
    enable=False → 把 xxx.dll 改成 xxx.dll.off
    返回 {'ok':bool, 'rel':新相对路径}
    """
    full = os.path.join(plugins_dir, rel)
    if enable:
        src = full if (rel.endswith(".off") or rel.endswith(".disabled")) else full + ".off"
        if not os.path.isfile(src):
            # 也试 .disabled
            alt = full[:-4] + ".disabled" if rel.endswith(".off") else full + ".disabled"
            if os.path.isfile(alt):
                src = alt
            else:
                return {"ok": False, "error": "找不到可恢复的文件"}
        dst = re.sub(r"\.(off|disabled)$", "", src)
    else:
        if not rel.endswith(".dll"):
            return {"ok": False, "error": "只有 .dll 能禁用"}
        src = full
        dst = full + ".off"
        if not os.path.isfile(src):
            return {"ok": False, "error": "文件不存在"}

    if os.path.exists(dst):
        return {"ok": False, "error": "目标已存在：" + os.path.basename(dst)}

    try:
        os.rename(src, dst)
    except OSError as exc:
        return {"ok": False, "error": str(exc)}

    return {
        "ok": True,
        "rel": os.path.relpath(dst, plugins_dir).replace("\\", "/"),
    }


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "scan":
        print(json.dumps(run_scanner(), ensure_ascii=False))
    else:
        d = build_payload(refresh=True)
        print(json.dumps({"ok": d.get("ok"), "total": d.get("total"),
                          "counts": d.get("counts"), "bepinex": d.get("bepinex")},
                         ensure_ascii=False))
