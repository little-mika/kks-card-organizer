# -*- coding: utf-8 -*-
"""Koikatsu / Koikatsu Sunshine 卡片与 zipmod 读取库。

卡片布局（依据 KKManager 的 CardLoader.cs）：
    [PNG 图片][IEND]
    int32 productNo
    BinaryReader 7bit-len UTF8  marker   e.g. 【KoiKatuCharaSun】
    BinaryReader 7bit-len UTF8  loadVersion
    int32 faceLen  +  faceLen 字节的脸图 PNG
    int32 count    + count 字节的 blockHeader(msgpack)
    int64 未知字段
    <- 数据区起点，各 block 位于 起点 + info.pos

KKEx block 是 Dictionary<string, PluginData>，PluginData = [version, data]。
Sideloader 把 zipmod 引用放在 data["info"] = 一组 msgpack(ResolveInfo)，
其中 ModID 就是 zipmod 的 GUID，Property 说明这张卡把它用在哪。

场景卡结构不同：依赖写在顶层 msgpack 的 ExtendedSaveData 里，
key 同样是 com.bepis.sideloader.universalautoresolver，值也是 [version, {"info": [...]}]。
"""
import struct, zipfile, os, re

PNG_SIG = b"\x89PNG\r\n\x1a\n"
PNG_END = b"IEND\xae\x42\x60\x82"

UAR_IDS = (
    "com.bepis.sideloader.universalautoresolver",
    "EC.Core.Sideloader.UniversalAutoResolver",
)

CARD_MARKERS = {
    "【KoiKatuChara】": "Koikatsu 人物卡",
    "【KoiKatuCharaS】": "Koikatsu Party 人物卡",
    "【KoiKatuCharaSP】": "Koikatsu Party SP 人物卡",
    "【KoiKatuCharaSun】": "Koikatsu Sunshine 人物卡",
    "【KoiKatuClothes】": "服装卡",
    "【EroMakeChara】": "Emotion Creators 人物卡",
    "【AIS_Chara】": "AI 少女 人物卡",
    "【AIS_Clothes】": "AI 少女 服装卡",
    "【RG_Chara】": "RoomGirl 人物卡",
    "【HCChara】": "HoneyCome 人物卡",
    "【HCPChara】": "HoneyCome Party 人物卡",
    "【SVChara】": "SummerVacation 人物卡",
    "【SVClothes】": "SummerVacation 服装卡",
}

# 这些标记是服装卡结构（没有脸图，loadVersion 后直接跟服装名+数据）
CLOTHES_MARKERS = {"【KoiKatuClothes】", "【AIS_Clothes】", "【SVClothes】"}


# ---------------------------------------------------------------- msgpack
class Reader:
    __slots__ = ("b", "i")

    def __init__(self, b, i=0):
        self.b = b
        self.i = i

    def u8(self):
        v = self.b[self.i]
        self.i += 1
        return v

    def take(self, n):
        v = self.b[self.i:self.i + n]
        self.i += n
        return v

    def unpack(self, fmt):
        n = struct.calcsize(fmt)
        v = struct.unpack_from(fmt, self.b, self.i)[0]
        self.i += n
        return v


def _mp(r):
    c = r.u8()
    if c <= 0x7F:
        return c
    if c >= 0xE0:
        return c - 0x100
    if 0x80 <= c <= 0x8F:
        return {_mp(r): _mp(r) for _ in range(c & 0x0F)}
    if 0x90 <= c <= 0x9F:
        return [_mp(r) for _ in range(c & 0x0F)]
    if 0xA0 <= c <= 0xBF:
        return r.take(c & 0x1F).decode("utf-8", "replace")
    if c == 0xC0:
        return None
    if c == 0xC2:
        return False
    if c == 0xC3:
        return True
    if c == 0xC4:
        return r.take(r.u8())
    if c == 0xC5:
        return r.take(r.unpack(">H"))
    if c == 0xC6:
        return r.take(r.unpack(">I"))
    if c == 0xCA:
        return r.unpack(">f")
    if c == 0xCB:
        return r.unpack(">d")
    if c == 0xCC:
        return r.u8()
    if c == 0xCD:
        return r.unpack(">H")
    if c == 0xCE:
        return r.unpack(">I")
    if c == 0xCF:
        return r.unpack(">Q")
    if c == 0xD0:
        return r.unpack(">b")
    if c == 0xD1:
        return r.unpack(">h")
    if c == 0xD2:
        return r.unpack(">i")
    if c == 0xD3:
        return r.unpack(">q")
    if c == 0xD9:
        return r.take(r.u8()).decode("utf-8", "replace")
    if c == 0xDA:
        return r.take(r.unpack(">H")).decode("utf-8", "replace")
    if c == 0xDB:
        return r.take(r.unpack(">I")).decode("utf-8", "replace")
    if c == 0xDC:
        return [_mp(r) for _ in range(r.unpack(">H"))]
    if c == 0xDD:
        return [_mp(r) for _ in range(r.unpack(">I"))]
    if c == 0xDE:
        return {_mp(r): _mp(r) for _ in range(r.unpack(">H"))}
    if c == 0xDF:
        return {_mp(r): _mp(r) for _ in range(r.unpack(">I"))}
    raise ValueError("msgpack type 0x%02x unsupported" % c)


def mp_unpack(blob):
    return _mp(Reader(blob))


def _read_str(r):
    n = 0
    sh = 0
    while True:
        b = r.u8()
        n |= (b & 0x7F) << sh
        if b < 0x80:
            break
        sh += 7
    return r.take(n).decode("utf-8", "replace")


def _uar_refs(ext_dict):
    """从 KKEx / ExtendedSaveData 字典里抽出 ResolveInfo 列表。"""
    out = []
    if not isinstance(ext_dict, dict):
        return out
    for key, pd in ext_dict.items():
        if str(key) not in UAR_IDS:
            continue
        body = None
        if isinstance(pd, list) and len(pd) >= 2:
            body = pd[1]
        elif isinstance(pd, dict):
            body = pd.get(1)
        if not isinstance(body, dict):
            continue
        infos = body.get("info")
        if not isinstance(infos, list):
            continue
        for item in infos:
            if isinstance(item, (bytes, bytearray)):
                try:
                    item = mp_unpack(bytes(item))
                except Exception:
                    continue
            if isinstance(item, dict) and item.get("ModID"):
                out.append({
                    "guid": str(item.get("ModID")),
                    "slot": item.get("Slot"),
                    "property": str(item.get("Property") or ""),
                    "category": item.get("CategoryNo"),
                    "author": item.get("Author"),
                    "website": item.get("Website"),
                    "name": item.get("Name"),
                })
    return out


# ---------------------------------------------------------------- card
_CN_CLOTHES = {
    "ClothesTop": "上衣", "ClothesBottom": "下装", "ClothesBra": "内衣",
    "ClothesShorts": "内裤", "ClothesGloves": "手套", "ClothesPantyhose": "丝袜",
    "ClothesShoes": "鞋子", "ClothesOnepiece": "连身裙",
}
_CN_ROOT = {
    "ChaFileBody": "身体", "ChaFileFace": "面部", "ChaFileHair": "头发",
    "ChaFileClothes": "服装", "ChaFileAccessory": "饰品", "ChaFileMakeup": "化妆",
    "ChaFileParameter": "角色参数", "ChaFileStatus": "状态",
}
_CN_FIELD = {
    "headId": "脸型", "noseId": "鼻子", "bodyId": "体型", "detailId": "细节贴图",
    "PaintID2": "涂装2", "PaintID1": "涂装1", "eyebrowId": "眉毛", "eyesId": "眼睛",
    "mouthId": "嘴", "hairstyle": "发型", "baseId": "底色", "layoutId": "妆容",
    "skinId": "皮肤", "eyes": "眼睛",
}
_NUM_TAIL = re.compile(r"\d+$")


def compress_props(props, keep=2):
    """把 ['第5套 · 饰品槽0','第5套 · 饰品槽1',...] 压成 ['第5套 · 饰品槽 ×52']。"""
    groups = {}
    order = []
    for p in props:
        parts = p.split(" · ")
        outfit = parts[0] if parts and parts[0].startswith("第") else ""
        rest = parts[1] if len(parts) > 1 else (parts[0] if parts else "")
        key = (outfit, _NUM_TAIL.sub("", rest).strip())
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(p)
    out = []
    for key in order:
        items = groups[key]
        if len(items) > keep:
            outfit, name = key
            label = ("%s · %s ×%d" % (outfit, name, len(items))) if outfit else ("%s ×%d" % (name, len(items)))
            out.append(label)
        else:
            out.extend(items)
    return out


def describe_property(prop):
    """把 outfit4.ChaFileClothes.ClothesGloves 解释成「第5套 · 手套」。"""
    if not prop:
        return ""
    parts = prop.split(".")
    bits = []
    for p in parts:
        if p.startswith("outfit") and p[6:].isdigit():
            bits.append("第%d套" % (int(p[6:]) + 1))
        elif p.startswith("accessory") and p[9:].isdigit():
            bits.append("饰品槽%d" % int(p[9:]))
        elif p in _CN_CLOTHES:
            bits.append(_CN_CLOTHES[p])
        elif p in _CN_ROOT:
            bits.append(_CN_ROOT[p])
        elif p in _CN_FIELD:
            bits.append(_CN_FIELD[p])
        elif p == "PartsInfo" or p == "id":
            continue
        elif p == "ChaFileAccessory":
            continue
        else:
            bits.append(p)
    return " · ".join(bits)


def read_png_part(path):
    """返回卡片第一段 PNG 的字节（封面图），供缩略图使用。"""
    with open(path, "rb") as f:
        data = f.read()
    i = data.find(PNG_END)
    if i < 0:
        return data
    return data[:i + len(PNG_END)]


def _png_size(data):
    try:
        if len(data) >= 24 and data[12:16] == b"IHDR":
            return (int.from_bytes(data[16:20], "big"),
                    int.from_bytes(data[20:24], "big"))
    except Exception:
        pass
    return (0, 0)


def _mp_read_str(blob, pos):
    """从 pos 读一个 msgpack 字符串，返回 (文本, 新位置)。"""
    if pos >= len(blob):
        raise ValueError("越界")
    b = blob[pos]
    if 0xA0 <= b <= 0xBF:                      # fixstr
        n = b & 0x1F
        return blob[pos + 1:pos + 1 + n].decode("utf-8", "replace"), pos + 1 + n
    if b == 0xD9:                              # str8
        n = blob[pos + 1]
        return blob[pos + 2:pos + 2 + n].decode("utf-8", "replace"), pos + 2 + n
    if b == 0xDA:                              # str16
        n = struct.unpack_from(">H", blob, pos + 1)[0]
        return blob[pos + 3:pos + 3 + n].decode("utf-8", "replace"), pos + 3 + n
    if b == 0xDB:                              # str32
        n = struct.unpack_from(">I", blob, pos + 1)[0]
        return blob[pos + 5:pos + 5 + n].decode("utf-8", "replace"), pos + 5 + n
    raise ValueError("不是字符串")


def _scan_modids(blob):
    """在任意字节里捞出所有 ResolveInfo 的 ModID（场景卡没有统一的块表，只能扫）。"""
    out, seen = [], set()
    key = b"\xa5ModID"
    i = 0
    while True:
        j = blob.find(key, i)
        if j < 0:
            break
        i = j + len(key)
        try:
            s, _ = _mp_read_str(blob, j + len(key))
        except Exception:
            continue
        s = (s or "").strip()
        if not (2 <= len(s) <= 120) or " " in s:
            continue
        if s.isdigit() and len(s) < 6:      # 纯数字短串多半是别的字段
            continue
        if s.isascii() and not any(c.isalpha() or c == "." for c in s):
            continue
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out


def parse_card(path, fast=False, hint=None):
    """解析一个 png。

    返回 dict（永远不返回 None），kind 取值：
      card       正常人物/服装卡
      scene      场景卡（另一套格式，不解析依赖）
      plain      普通图片，PNG 之后没有卡数据 -> 游戏内读不出来
      truncated  PNG 本身不完整（找不到 IEND）
      notpng     扩展名是 png 但内容不是
      unreadable 文件读不了
      unknown    PNG 后有数据但认不出标记
      broken     解析中途出错
    """
    base_info = {"name": os.path.basename(path), "refs": [], "ext_keys": []}
    try:
        st = os.stat(path)
        with open(path, "rb") as f:
            data = f.read()
    except Exception as e:
        base_info.update({"path": path, "size": 0, "mtime": 0,
                          "kind": "unreadable", "reason": "文件读不出来：%s" % e})
        return base_info

    base_info.update({"path": path, "size": st.st_size, "mtime": int(st.st_mtime)})

    if not data.startswith(PNG_SIG):
        base_info.update({"kind": "notpng",
                          "reason": "扩展名是 .png，但文件头不是 PNG（可能是别的格式改了后缀）"})
        return base_info

    w, h = _png_size(data)
    base_info["w"], base_info["h"] = w, h

    i = data.find(PNG_END)
    if i < 0:
        base_info.update({"kind": "truncated",
                          "reason": "PNG 数据不完整：找不到结束标记，文件可能没下载完或被截断"})
        return base_info

    png_end = i + len(PNG_END)
    tail = st.st_size - png_end
    base_info.update({"png_end": png_end, "tail": tail})

    if tail < 8:
        base_info.update({"kind": "plain",
                          "reason": "普通图片：PNG 数据之后就结束了，没有人物卡数据，游戏内读不出这张卡"})
        return base_info

    try:
        r = Reader(data, png_end)
        product = r.unpack("<i")
        marker = _read_str(r)
        if not marker.startswith("\u3010"):
            is_scene = bool(re.match(r"^\d+\.\d+", marker))
            if not is_scene and hint == "scene" and tail > 1000:
                # 老版场景卡没有统一的版本头，按目录约定归为场景卡
                is_scene = True
            info = {
                "marker": marker,
                "kind": "scene" if is_scene else "unknown",
                "product": product,
            }
            if is_scene:
                blob = data[r.i:]
                refs, dims = [], {}
                try:
                    obj = mp_unpack(blob)
                    refs = _uar_refs(obj) if isinstance(obj, dict) else []
                except Exception:
                    refs = []
                if not refs:
                    refs = [{"guid": g, "props": []} for g in _scan_modids(blob)]
                if not fast:
                    try:
                        obj = mp_unpack(blob)
                        if isinstance(obj, dict):
                            for k in ("version", "name", "map", "title"):
                                v = obj.get(k)
                                if isinstance(v, str) and len(v) < 80:
                                    dims[k] = v
                    except Exception:
                        pass
                info.update({"refs": refs, "param": dims,
                             "label": "场景卡"})
            else:
                info["reason"] = "PNG 之后有数据，但卡标记认不出来：%r" % marker[:40]
            base_info.update(info)
            return base_info

        if marker in CLOTHES_MARKERS:
            # 服装卡结构：loadVersion, 服装名, int32 长度, 衣服数据, "KKEx", 版本, 长度, msgpack
            load_ver = _read_str(r)
            coord_name = _read_str(r)
            n = r.unpack("<i")
            if n < 0 or r.i + n > len(data):
                raise ValueError("服装数据长度越界")
            r.i += n
            refs, ext_keys = [], []
            try:
                mk = _read_str(r)
                r.unpack("<i")
                ln = r.unpack("<i")
                if mk == "KKEx" and 0 < ln <= len(data) - r.i:
                    ext = mp_unpack(data[r.i:r.i + ln])
                    if isinstance(ext, dict):
                        ext_keys = [str(k) for k in ext.keys()]
                        refs = _uar_refs(ext)
            except Exception:
                pass
            base_info.update({
                "marker": marker,
                "kind": "coord",
                "label": CARD_MARKERS.get(marker, "服装卡"),
                "product": product,
                "refs": refs,
                "ext_keys": ext_keys,
                "param": {"coordName": coord_name, "loadVersion": load_ver},
            })
            return base_info

        _read_str(r)          # loadVersion
        face_len = r.unpack("<i")
        if face_len > 0:
            r.i += face_len
        count = r.unpack("<i")
        header = mp_unpack(r.take(count))
        base = r.i + 8
        blocks = {}
        if isinstance(header, dict):
            for bi in header.get("lstInfo") or []:
                if isinstance(bi, dict) and "name" in bi:
                    blocks[bi["name"]] = bi
        refs, ext_keys = [], []
        param = {}
        kkex = blocks.get("KKEx")
        if kkex and not fast:
            start = base + int(kkex["pos"])
            ext = mp_unpack(data[start:start + int(kkex["size"])])
            if isinstance(ext, dict):
                ext_keys = [str(k) for k in ext.keys()]
                refs = _uar_refs(ext)
        cp = blocks.get("Custom")
        if cp and not fast:
            try:
                start = base + int(cp["pos"])
                custom = mp_unpack(data[start:start + int(cp["size"])])
                if isinstance(custom, dict):
                    for k in ("fullname", "name", "sex", "personality", "birthDay"):
                        if k in custom:
                            param[k] = custom[k]
            except Exception:
                pass
        base_info.update({
            "marker": marker,
            "kind": "card",
            "label": CARD_MARKERS.get(marker, marker),
            "product": product,
            "refs": refs,
            "ext_keys": ext_keys,
            "param": param,
        })
        return base_info
    except Exception as e:
        base_info.update({"marker": "", "kind": "broken",
                          "reason": "卡头解析失败：%s" % e})
        return base_info


# ---------------------------------------------------------------- zipmod
def read_manifest(zipmod_path):
    try:
        with zipfile.ZipFile(zipmod_path) as z:
            name = None
            for n in z.namelist():
                if n.lower().split("/")[-1] == "manifest.xml":
                    name = n
                    break
            if not name:
                return None
            txt = z.read(name).decode("utf-8-sig", "replace")
    except Exception:
        return None

    def tag(t):
        m = re.search(r"<%s[^>]*>(.*?)</%s>" % (t, t), txt, re.S)
        return m.group(1).strip() if m else ""

    return {"guid": tag("guid"), "name": tag("name"),
            "version": tag("version"), "author": tag("author")}


def profile_zipmod(zipmod_path):
    """扫描 zipmod 内部结构，判定内容类型。返回 dict。

    kind:
      plugin   含 .dll，插件，永不进候选
      chara    含 abdata/list/characustom 或 abdata/chara，人物内容
      studio   只含 abdata/studio*，场景物件
      anim     只含 abdata/anim_imports，动作
      mixed    同时有人物和场景内容
      empty    空包/读不了
    """
    try:
        with zipfile.ZipFile(zipmod_path) as z:
            names = [n.replace("\\", "/").lower() for n in z.namelist()]
    except Exception:
        return {"kind": "empty", "files": 0}
    has_dll = any(n.endswith(".dll") for n in names)
    has_chara_list = any("/abdata/list/characustom/" in n or n.startswith("abdata/list/characustom/") for n in names)
    has_chara = any("/abdata/chara/" in n or n.startswith("abdata/chara/") for n in names)
    has_studio = any("/abdata/studio/" in n or n.startswith("abdata/studio/") for n in names)
    has_anim = any("/abdata/anim_imports/" in n or n.startswith("abdata/anim_imports/") for n in names)
    if has_dll:
        kind = "plugin"
    elif (has_chara_list or has_chara) and has_studio:
        kind = "mixed"
    elif has_chara_list or has_chara:
        kind = "chara"
    elif has_studio:
        kind = "studio"
    elif has_anim:
        kind = "anim"
    else:
        kind = "other"
    return {
        "kind": kind,
        "files": len(names),
        "chara_list": has_chara_list,
        "studio": has_studio,
    }
