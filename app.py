from __future__ import annotations

import json
import os
import re
import secrets
import tempfile
import uuid
import base64
import atexit
import hashlib
import queue
import threading
import time
from datetime import date, datetime, timedelta, timezone
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, quote_plus, urlencode, urljoin, urlparse
from urllib.request import Request, urlopen

from flask import Flask, jsonify, request, send_from_directory, session
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash, generate_password_hash
from cryptography.fernet import Fernet, InvalidToken


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "backend_data"
USERS_FILE = DATA_DIR / "users.json"
USER_DATA_DIR = DATA_DIR / "users"
SECRET_FILE = DATA_DIR / ".secret_key"
SECRETS_KEY_FILE = DATA_DIR / ".secrets_key"
BIRD_MAPPINGS_FILE = DATA_DIR / "bird_name_mappings.json"
EBIRD_SPECIES_CACHE_FILE = DATA_DIR / "ebird_species_cache.json"
GEOCODE_CACHE_FILE = DATA_DIR / "geocode_cache.json"
SETTINGS_TEMPLATE_FILE = DATA_DIR / "settings_template.json"

USERNAME_RE = re.compile(r"^[A-Za-z0-9_-]{3,32}$")
MAX_FETCH_BYTES = 1_500_000
MAX_ARTICLE_TEXT_CHARS = 18_000
RNOTE_XHS_SEARCH_ENDPOINT = "https://rnote.dev/api/v2/crawler/search/notes"
RNOTE_XHS_IMAGE_DETAIL_ENDPOINT = "https://rnote.dev/api/v2/crawler/note/image"
RNOTE_XHS_VIDEO_DETAIL_ENDPOINT = "https://rnote.dev/api/v2/crawler/note/video"
WECHAT_SOGOU_SEARCH_ENDPOINT = "https://weixin.sogou.com/weixin"
XHS_BROWSER_SESSIONS: dict[str, Any] = {}
QUERY_VALUE_TOKENS = ("{query}", "{keyword}", "{{query}}", "{{keyword}}")
ENCRYPTED_SECRET_TYPE = "birdroute-fernet-v1"
_FERNET: Fernet | None = None
TRIP_VISIBILITY_VALUES = {"private", "public"}
DEFAULT_TRIP_PACE = "休闲"
AUTH_TOKEN_SALT = "birdroute-auth-token-v1"
AUTH_TOKEN_MAX_AGE_SECONDS = 14 * 24 * 60 * 60
EBIRD_REQUEST_MIN_INTERVAL_SECONDS = 1.25
EBIRD_SPECIES_CACHE_MAX_AGE_DAYS = 30
GEOCODE_REQUEST_MIN_INTERVAL_SECONDS = 1.1
GEOCODE_CACHE_MAX_AGE_DAYS = 90
QUICK_INFO_MAX_ITEMS = 300
QUICK_INFO_KEY_MAX_CHARS = 120
QUICK_INFO_VALUE_MAX_CHARS = 2000
TRIP_BACKUP_KEEP = 30
_EBIRD_REQUEST_LOCK = threading.Lock()
_EBIRD_LAST_REQUEST_AT = 0.0
_GEOCODE_REQUEST_LOCK = threading.Lock()
_GEOCODE_LAST_REQUEST_AT = 0.0

CONTENT_SECRET_FIELDS = [
    "braveApiKey",
    "bingApiKey",
    "serpApiKey",
    "tavilyApiKey",
    "wechatAppSecret",
    "wechatThirdPartyApiKey",
    "xhsAppSecret",
    "xhsOfficialAccessToken",
    "xhsThirdPartyApiKey",
]
API_CREDENTIAL_SECRET_FIELDS = ["ebirdToken", "xcToken"]
LLM_SECRET_FIELDS = ["apiKey"]
SETTINGS_TEMPLATE_SECRET_FIELDS = set(CONTENT_SECRET_FIELDS + API_CREDENTIAL_SECRET_FIELDS + LLM_SECRET_FIELDS + [
    "appSecret",
    "thirdPartyApiKey",
    "officialAccessToken",
])

DEFAULT_BIRD_NAME_MAPPINGS: dict[str, dict[str, str]] = {
    "黑冠麻鹭": {"english": "Malayan Night Heron", "scientific": "Gorsachius melanolophus"},
    "五色鸟": {"english": "Taiwan Barbet", "scientific": "Psilopogon nuchalis"},
    "台湾拟啄木鸟": {"english": "Taiwan Barbet", "scientific": "Psilopogon nuchalis"},
    "白头翁": {"english": "Light-vented Bulbul", "scientific": "Pycnonotus sinensis"},
    "红耳鹎": {"english": "Red-whiskered Bulbul", "scientific": "Pycnonotus jocosus"},
    "红嘴黑鹎": {"english": "Black Bulbul", "scientific": "Hypsipetes leucocephalus"},
    "绿绣眼": {"english": "Swinhoe's White-eye", "scientific": "Zosterops simplex"},
    "灰树鹊": {"english": "Gray Treepie", "scientific": "Dendrocitta formosae"},
    "凤头苍鹰": {"english": "Crested Goshawk", "scientific": "Accipiter trivirgatus"},
    "台湾蓝鹊": {"english": "Taiwan Blue Magpie", "scientific": "Urocissa caerulea"},
    "台湾噪鹛": {"english": "White-whiskered Laughingthrush", "scientific": "Trochalopteron morrisonianum"},
    "白耳画眉": {"english": "White-eared Sibia", "scientific": "Heterophasia auricularis"},
    "绣眼画眉": {"english": "Taiwan Yuhina", "scientific": "Yuhina brunneiceps"},
    "台湾鹛": {"english": "Steere's Liocichla", "scientific": "Liocichla steerii"},
    "黄山雀": {"english": "Flamecrest", "scientific": "Regulus goodfellowi"},
    "栗背林鸲": {"english": "Collared Bush Robin", "scientific": "Tarsiger johnstoniae"},
    "台湾山鹪莺": {"english": "Taiwan Bush Warbler", "scientific": "Locustella alishanensis"},
    "黄胸薮眉": {"english": "Taiwan Fulvetta", "scientific": "Fulvetta formosana"},
    "帝雉": {"english": "Mikado Pheasant", "scientific": "Syrmaticus mikado"},
    "蓝腹鹇": {"english": "Swinhoe's Pheasant", "scientific": "Lophura swinhoii"},
    "台湾鹪鹛": {"english": "Taiwan Wren-babbler", "scientific": "Pnoepyga formosana"},
    "灰面鵟鹰": {"english": "Gray-faced Buzzard", "scientific": "Butastur indicus"},
    "灰面鵟鷹": {"english": "Gray-faced Buzzard", "scientific": "Butastur indicus"},
    "赤腹鹰": {"english": "Chinese Sparrowhawk", "scientific": "Accipiter soloensis"},
    "赤腹鷹": {"english": "Chinese Sparrowhawk", "scientific": "Accipiter soloensis"},
    "凤头蜂鹰": {"english": "Crested Honey Buzzard", "scientific": "Pernis ptilorhynchus"},
    "東方蜂鷹": {"english": "Crested Honey Buzzard", "scientific": "Pernis ptilorhynchus"},
    "苍鹭": {"english": "Gray Heron", "scientific": "Ardea cinerea"},
    "蒼鷺": {"english": "Gray Heron", "scientific": "Ardea cinerea"},
    "白鹭": {"english": "Little Egret", "scientific": "Egretta garzetta"},
    "小白鹭": {"english": "Little Egret", "scientific": "Egretta garzetta"},
    "夜鹭": {"english": "Black-crowned Night Heron", "scientific": "Nycticorax nycticorax"},
    "黑翅长脚鹬": {"english": "Black-winged Stilt", "scientific": "Himantopus himantopus"},
    "黑翅長腳鷸": {"english": "Black-winged Stilt", "scientific": "Himantopus himantopus"},
    "鱼鹰": {"english": "Osprey", "scientific": "Pandion haliaetus"},
    "黑面琵鹭": {"english": "Black-faced Spoonbill", "scientific": "Platalea minor"},
    "黑面琵鷺": {"english": "Black-faced Spoonbill", "scientific": "Platalea minor"},
    "大卷尾": {"english": "Black Drongo", "scientific": "Dicrurus macrocercus"},
    "珠颈斑鸠": {"english": "Spotted Dove", "scientific": "Spilopelia chinensis"},
    "珠頸斑鳩": {"english": "Spotted Dove", "scientific": "Spilopelia chinensis"},
    "翠鸟": {"english": "Common Kingfisher", "scientific": "Alcedo atthis"},
    "普通翠鸟": {"english": "Common Kingfisher", "scientific": "Alcedo atthis"},
}

BIRD_NAME_NOISE_TERMS = ("机会", "高活跃期", "迁徙群", "过境", "重点", "補種", "补种")
SCIENTIFIC_NAME_RE = re.compile(r"\b([A-Z][a-z]{2,}(?:\s+[a-z][a-z-]{2,}){1,2})\b")
HAN_TEXT_RE = re.compile(r"[\u4e00-\u9fff]")

DEFAULT_RESEARCH_PROMPT = """你是一个观鸟旅行攻略写作助手。请根据用户选择/输入的搜索关键词、鸟点信息、当前行程上下文，以及若干篇候选文章正文，写一份可以直接给旅行者阅读的中文 Markdown 攻略。

请输出完整文案，不要输出 JSON，不要包裹代码块。

写作要求：
1. 先判断资料是否足够；资料不足时要明确说明，不要编造。
2. 用自然、清晰的攻略语气写作，重点服务实地观鸟决策。
3. 必须围绕用户关键词展开；关键词中包含的鸟点名、鸟名、“观鸟”、“攻略”等都应作为检索和分析依据。
4. 优先提取：到达方式、具体鸟点/路线、最佳时间、目标鸟种、现场找鸟提示、费用/预约/开放时间、风险和替代方案。
5. 微信公众号、小红书、博客等来源要保留可点击链接；如果多个来源互相矛盾，要单独说明。
6. 不要大段复述原文；把原文信息整理成可执行建议。

建议结构：
# 鸟点攻略：{鸟点名}
## 结论速览
## 关键词与适用范围
## 怎么去
## 到现场怎么找鸟
## 目标鸟种与季节/时间
## 行程安排建议
## 注意事项
## 资料可靠性与待确认
## 来源
"""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    USER_DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not USERS_FILE.exists():
        atomic_write_json(USERS_FILE, {})
    ensure_bird_mappings()
    ensure_settings_template()


def load_secret_key() -> str:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if SECRET_FILE.exists():
        return SECRET_FILE.read_text(encoding="utf-8").strip()
    key = secrets.token_urlsafe(48)
    SECRET_FILE.write_text(key, encoding="utf-8")
    return key


def normalize_fernet_key(raw: str) -> bytes:
    text = str(raw or "").strip()
    if not text:
        return Fernet.generate_key()
    try:
        decoded = base64.urlsafe_b64decode(text.encode("utf-8"))
        if len(decoded) == 32:
            return text.encode("utf-8")
    except Exception:
        pass
    return base64.urlsafe_b64encode(hashlib.sha256(text.encode("utf-8")).digest())


def load_secrets_key() -> bytes:
    env_key = os.environ.get("BIRDROUTE_SECRETS_KEY")
    if env_key:
        return normalize_fernet_key(env_key)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if SECRETS_KEY_FILE.exists():
        return normalize_fernet_key(SECRETS_KEY_FILE.read_text(encoding="utf-8").strip())

    key = Fernet.generate_key()
    SECRETS_KEY_FILE.write_text(key.decode("utf-8"), encoding="utf-8")
    try:
        os.chmod(SECRETS_KEY_FILE, 0o600)
    except OSError:
        pass
    return key


def secrets_fernet() -> Fernet:
    global _FERNET
    if _FERNET is None:
        _FERNET = Fernet(load_secrets_key())
    return _FERNET


def is_encrypted_secret(value: Any) -> bool:
    return isinstance(value, dict) and value.get("__type") == ENCRYPTED_SECRET_TYPE and isinstance(value.get("ciphertext"), str)


def encrypt_secret_value(value: Any) -> Any:
    if value in ("", None):
        return value
    if is_encrypted_secret(value):
        return value
    plaintext = str(value).encode("utf-8")
    return {
        "__type": ENCRYPTED_SECRET_TYPE,
        "ciphertext": secrets_fernet().encrypt(plaintext).decode("utf-8"),
    }


def decrypt_secret_value(value: Any, field: str = "secret") -> str:
    if value in ("", None):
        return ""
    if not is_encrypted_secret(value):
        return str(value)
    try:
        return secrets_fernet().decrypt(str(value.get("ciphertext")).encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError(f"无法解密 {field}，请确认 BIRDROUTE_SECRETS_KEY 或 backend_data/.secrets_key 是否匹配。") from exc


def secret_value_present(value: Any) -> bool:
    if is_encrypted_secret(value):
        return bool(value.get("ciphertext"))
    return bool(value)


def decrypt_secret_fields(data: dict[str, Any], fields: list[str]) -> dict[str, Any]:
    result = dict(data)
    for field in fields:
        if field in result:
            result[field] = decrypt_secret_value(result[field], field)
    return result


def encrypt_secret_fields(data: dict[str, Any], fields: list[str]) -> dict[str, Any]:
    result = dict(data)
    for field in fields:
        if field in result:
            if result[field] in ("", None):
                result.pop(field, None)
            else:
                result[field] = encrypt_secret_value(result[field])
    return result


def has_plaintext_secret(data: Any, fields: list[str]) -> bool:
    if not isinstance(data, dict):
        return False
    for field in fields:
        value = data.get(field)
        if secret_value_present(value) and not is_encrypted_secret(value):
            return True
    return False


def mask_secret_text(value: Any) -> str:
    text = str(value or "")
    if not text:
        return ""
    if len(text) <= 4:
        return text[:1] + "*" * max(1, len(text) - 1)
    if len(text) <= 10:
        return text[:2] + "*" * max(4, len(text) - 4) + text[-2:]
    return text[:4] + "*" * max(6, len(text) - 8) + text[-4:]


def mask_secret_fields(data: dict[str, Any], fields: list[str]) -> dict[str, Any]:
    result = dict(data)
    for field in fields:
        if result.get(field):
            result[field] = mask_secret_text(result[field])
    return result


def is_masked_existing_secret(value: str, existing_value: Any) -> bool:
    return bool(value and existing_value and value == mask_secret_text(existing_value))


def public_llm_settings(settings: dict[str, Any]) -> dict[str, Any]:
    return mask_secret_fields(settings, LLM_SECRET_FIELDS)


def public_content_source_settings(settings: dict[str, Any]) -> dict[str, Any]:
    return mask_secret_fields(settings, CONTENT_SECRET_FIELDS)


def public_api_credentials(settings: dict[str, Any]) -> dict[str, Any]:
    return mask_secret_fields(settings, API_CREDENTIAL_SECRET_FIELDS)


def configured_allowed_origins() -> set[str]:
    raw = os.environ.get("BIRDROUTE_ALLOWED_ORIGINS", "")
    return {origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()}


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def ssl_context_from_env() -> str | tuple[str, str] | None:
    if not env_bool("BIRDROUTE_HTTPS", False):
        return None
    cert = os.environ.get("BIRDROUTE_SSL_CERT")
    key = os.environ.get("BIRDROUTE_SSL_KEY")
    if cert and key:
        return cert, key
    return "adhoc"


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError:
        backup = path.with_suffix(path.suffix + f".broken-{int(datetime.now().timestamp())}")
        path.replace(backup)
        return default


def atomic_write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


def normalize_bird_name(raw: Any) -> str:
    text = str(raw or "")
    text = re.sub(r"\（.*?\）|\(.*?\)", "", text)
    for term in BIRD_NAME_NOISE_TERMS:
        text = text.replace(term, "")
    return normalize_space(text)


def normalize_bird_mapping_key(name: Any) -> str:
    return normalize_bird_name(name).casefold()


def looks_like_scientific_bird_name(name: Any) -> bool:
    text = normalize_bird_name(name)
    if not SCIENTIFIC_NAME_RE.fullmatch(text):
        return False
    parts = text.split()
    if len(parts) < 2:
        return False
    return parts[1].casefold() not in {"species", "sp", "spp"}


def detect_bird_name_language(name: Any) -> str:
    text = normalize_bird_name(name)
    if not text:
        return "unknown"
    if HAN_TEXT_RE.search(text):
        return "chinese"
    if looks_like_scientific_bird_name(text):
        return "scientific"
    if re.search(r"[A-Za-z]", text):
        return "english"
    return "unknown"


def seed_bird_mapping_from_name(name: Any) -> dict[str, Any]:
    text = normalize_bird_name(name)
    language = detect_bird_name_language(text)
    entry: dict[str, Any] = {
        "chinese": "",
        "english": "",
        "scientific": "",
        "originalName": text,
        "nameLanguage": language,
    }
    if language == "chinese":
        entry["chinese"] = text
    elif language == "english":
        entry["english"] = text
    elif language == "scientific":
        entry["scientific"] = text
    else:
        entry["chinese"] = text
    return entry


def bird_mapping_alias_keys(entry: dict[str, Any]) -> set[str]:
    keys: set[str] = set()
    for field in ("chinese", "english", "scientific", "name", "originalName"):
        key = normalize_bird_mapping_key(entry.get(field) or "")
        if key:
            keys.add(key)
    return keys


def normalize_bird_mapping_entry(name: str, value: Any, source: str = "manual") -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    chinese = normalize_bird_name(value.get("chinese") or value.get("name") or name)
    english = normalize_space(str(value.get("english") or value.get("englishName") or ""))
    scientific = normalize_space(str(value.get("scientific") or value.get("scientificName") or ""))
    if not chinese:
        return None
    source_urls = []
    if isinstance(value.get("sourceUrls"), list):
        source_urls = [str(url) for url in value.get("sourceUrls", [])[:5] if str(url).startswith(("http://", "https://"))]
    return {
        "chinese": chinese,
        "english": english,
        "scientific": scientific,
        "source": normalize_space(str(value.get("source") or source or "manual"))[:80],
        "confidence": normalize_space(str(value.get("confidence") or ""))[:40],
        "notes": normalize_space(str(value.get("notes") or ""))[:500],
        "sourceUrls": source_urls,
        "updatedAt": str(value.get("updatedAt") or utc_now()),
    }


def default_bird_mappings_payload() -> dict[str, Any]:
    mappings: dict[str, Any] = {}
    for chinese, value in DEFAULT_BIRD_NAME_MAPPINGS.items():
        entry = normalize_bird_mapping_entry(chinese, {**value, "chinese": chinese, "source": "seed"}, "seed")
        if entry:
            mappings[entry["chinese"]] = entry
    return {"version": 1, "updatedAt": utc_now(), "mappings": mappings}


def ensure_bird_mappings() -> None:
    if not BIRD_MAPPINGS_FILE.exists():
        atomic_write_json(BIRD_MAPPINGS_FILE, default_bird_mappings_payload())


def load_bird_mappings() -> dict[str, dict[str, Any]]:
    ensure_bird_mappings()
    saved = read_json(BIRD_MAPPINGS_FILE, {})
    raw_mappings: Any = saved.get("mappings") if isinstance(saved, dict) else {}
    if not isinstance(raw_mappings, dict):
        raw_mappings = saved if isinstance(saved, dict) else {}

    merged: dict[str, dict[str, Any]] = {}
    for chinese, value in DEFAULT_BIRD_NAME_MAPPINGS.items():
        entry = normalize_bird_mapping_entry(chinese, {**value, "chinese": chinese, "source": "seed"}, "seed")
        if entry:
            merged[normalize_bird_mapping_key(chinese)] = entry
    for name, value in raw_mappings.items():
        entry = normalize_bird_mapping_entry(str(name), value)
        if entry:
            merged[normalize_bird_mapping_key(entry["chinese"])] = entry
    return merged


def save_bird_mappings(mappings: dict[str, dict[str, Any]]) -> None:
    ordered = {entry["chinese"]: entry for entry in sorted(mappings.values(), key=lambda item: str(item.get("chinese") or ""))}
    atomic_write_json(BIRD_MAPPINGS_FILE, {"version": 1, "updatedAt": utc_now(), "mappings": ordered})


def lookup_bird_mappings(names: list[Any]) -> tuple[list[dict[str, Any]], list[str]]:
    mappings = load_bird_mappings()
    alias_index: dict[str, dict[str, Any]] = {}
    for entry in mappings.values():
        for alias_key in bird_mapping_alias_keys(entry):
            alias_index.setdefault(alias_key, entry)

    resolved: list[dict[str, Any]] = []
    missing: list[str] = []
    seen: set[str] = set()
    for raw_name in names[:40]:
        name = normalize_bird_name(raw_name)
        if not name:
            continue
        key = normalize_bird_mapping_key(name)
        if key in seen:
            continue
        seen.add(key)
        entry = alias_index.get(key)
        if entry and (entry.get("english") or entry.get("scientific")):
            resolved_entry = dict(entry)
            resolved_entry["matchedName"] = name
            resolved_entry["nameLanguage"] = detect_bird_name_language(name)
            resolved.append(resolved_entry)
        else:
            missing.append(name)
    return resolved, missing


def upsert_bird_mappings(entries: list[Any], source: str = "manual", updated_by: str = "", limit: int = 40) -> list[dict[str, Any]]:
    mappings = load_bird_mappings()
    saved: list[dict[str, Any]] = []
    for item in entries[:max(1, limit)]:
        if not isinstance(item, dict):
            continue
        name = normalize_bird_name(item.get("chinese") or item.get("name") or "")
        if not name:
            continue
        entry = normalize_bird_mapping_entry(name, {**item, "source": item.get("source") or source}, source)
        if not entry or not (entry.get("english") or entry.get("scientific")):
            continue
        if updated_by:
            entry["updatedBy"] = updated_by[:80]
        entry["updatedAt"] = utc_now()
        mappings[normalize_bird_mapping_key(entry["chinese"])] = entry
        saved.append(entry)
    if saved:
            save_bird_mappings(mappings)
    return saved


def upsert_ebird_species_mappings(species: list[Any], updated_by: str = "", loc_id: str = "") -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for item in species:
        if not isinstance(item, dict):
            continue
        chinese = normalize_bird_name(item.get("chineseName") or item.get("commonName") or "")
        english = normalize_space(str(item.get("englishName") or item.get("english") or ""))
        scientific = normalize_space(str(item.get("scientificName") or item.get("scientific") or ""))
        if not chinese or not (english or scientific):
            continue
        species_code = normalize_space(str(item.get("speciesCode") or ""))
        entries.append({
            "chinese": chinese,
            "english": english,
            "scientific": scientific,
            "source": "ebird",
            "confidence": "high",
            "notes": f"由 eBird 热点历史记录自动补全。speciesCode: {species_code}" if species_code else "由 eBird 热点历史记录自动补全。",
            "sourceUrls": [f"https://ebird.org/hotspot/{loc_id}"] if loc_id else ["https://ebird.org/"],
        })
    return upsert_bird_mappings(entries, source="ebird", updated_by=updated_by, limit=500)


def clean_english_name_candidate(value: str) -> str:
    text = normalize_space(value)
    text = re.sub(r"\b(?:bird|birds|species|ebird|wikipedia|wikimedia|iucn|avibase)\b.*$", "", text, flags=re.I)
    text = re.sub(r"[\u4e00-\u9fff]+", " ", text)
    text = re.sub(r"[?？]+", " ", text)
    text = normalize_space(text)
    text = text.strip(" -|,;")
    if not text or len(text) > 70:
        return ""
    if SCIENTIFIC_NAME_RE.fullmatch(text):
        return ""
    words = [part for part in re.split(r"\s+", text) if part]
    if not 1 <= len(words) <= 6:
        return ""
    if not any(ch.isalpha() for ch in text):
        return ""
    return text


BIRD_MAPPING_LLM_PROMPT = """你是鸟类中文名、英文名、学名映射校对助手。

任务：根据用户给出的鸟名和可选搜索候选，补全中文名、英文名与拉丁学名。输入鸟名可能是中文名、英文名或学名。
要求：
1. 只在较有把握时填写；不确定就留空，并在 notes 说明。
2. 先判断每个输入是中文名、英文名还是学名；不要把英文名写入 chinese 字段。
3. chinese 使用中文通用名，english 使用常见英文名，scientific 使用二名法或三名法拉丁学名。
4. 尽量为每个输入返回一条候选；originalName 必须原样填写用户输入的鸟名，方便系统对齐。
5. 严格输出 JSON，不要 Markdown。

输出格式：
{"mappings":[{"originalName":"用户输入","nameLanguage":"chinese|english|scientific|unknown","chinese":"中文名","english":"English Common Name","scientific":"Genus species","confidence":"high|medium|low","notes":"简短依据"}]}
"""

BIRD_MAPPING_LLM_BATCH_SIZE = 8


def bird_mapping_lookup_query(name: str) -> str:
    language = detect_bird_name_language(name)
    if language == "english":
        return f'"{name}" 中文名 学名 bird scientific name'
    if language == "scientific":
        return f'"{name}" 中文名 英文名 bird common name'
    return f'"{name}" 鸟 英文名 学名 bird scientific name'


def resolve_bird_mappings_by_llm_batch(
    names: list[str],
    llm_settings: dict[str, Any],
    search_settings: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    search_context: list[dict[str, Any]] = []
    search_settings = search_settings or default_content_source_settings()
    batch_names = names[:BIRD_MAPPING_LLM_BATCH_SIZE]
    for index, name in enumerate(batch_names):
        language = detect_bird_name_language(name)
        query = bird_mapping_lookup_query(name)
        try:
            results = search_with_content_provider(query, "web", search_settings)
        except Exception:
            results = []
        search_context.append({
            "index": index,
            "name": name,
            "language": language,
            "results": [
                {"title": item.get("title", ""), "url": item.get("url", ""), "snippet": item.get("snippet", "")}
                for item in results[:3]
            ],
        })
    response = call_llm_json(
        llm_settings,
        BIRD_MAPPING_LLM_PROMPT,
        json.dumps(
            {
                "names": [
                    {"index": index, "name": name, "language": detect_bird_name_language(name)}
                    for index, name in enumerate(batch_names)
                ],
                "searchContext": search_context,
            },
            ensure_ascii=False,
            indent=2,
        ),
    )
    summary = response.get("summary")
    raw_entries = summary.get("mappings") if isinstance(summary, dict) else []
    if not isinstance(raw_entries, list):
        raw_entries = []
    normalized: list[dict[str, Any]] = []
    batch_name_keys = {normalize_bird_mapping_key(name): name for name in batch_names}
    for index, item in enumerate(raw_entries):
        if not isinstance(item, dict):
            continue
        fallback_name = batch_names[index] if index < len(batch_names) else ""
        original_name = normalize_bird_name(item.get("originalName") or item.get("input") or item.get("name") or fallback_name)
        if not original_name:
            continue
        original_name = batch_name_keys.get(normalize_bird_mapping_key(original_name), original_name)
        seed = seed_bird_mapping_from_name(original_name)
        merged = {**seed, "source": "llm"}
        for field in ("chinese", "english", "scientific", "confidence", "notes", "sourceUrls"):
            if item.get(field):
                merged[field] = item.get(field)
        entry_name = normalize_bird_name(merged.get("chinese") or "")
        if not entry_name:
            continue
        entry = normalize_bird_mapping_entry(entry_name, merged, "llm")
        if entry:
            entry["notes"] = entry.get("notes") or "由 LLM 根据候选资料生成，请人工确认。"
            entry["originalName"] = original_name
            entry["nameLanguage"] = detect_bird_name_language(original_name)
            normalized.append(entry)
    return normalized


def resolve_bird_mappings_by_llm(names: list[str], llm_settings: dict[str, Any], search_settings: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    resolved: list[dict[str, Any]] = []
    seen_output: set[str] = set()
    clean_names = [normalize_bird_name(name) for name in names if normalize_bird_name(name)]
    for start in range(0, len(clean_names), BIRD_MAPPING_LLM_BATCH_SIZE):
        batch = clean_names[start:start + BIRD_MAPPING_LLM_BATCH_SIZE]
        batch_resolved = resolve_bird_mappings_by_llm_batch(batch, llm_settings, search_settings)
        for entry in batch_resolved:
            key = normalize_bird_mapping_key(entry.get("originalName") or entry.get("chinese") or entry.get("english") or entry.get("scientific"))
            if key and key in seen_output:
                continue
            if key:
                seen_output.add(key)
            resolved.append(entry)
    return resolved


def normalize_username(username: str) -> str:
    return (username or "").strip()


def validate_username(username: str) -> bool:
    return bool(USERNAME_RE.match(username))


def users_db() -> dict[str, Any]:
    ensure_dirs()
    data = read_json(USERS_FILE, {})
    return data if isinstance(data, dict) else {}


def save_users_db(data: dict[str, Any]) -> None:
    atomic_write_json(USERS_FILE, data)


def user_dir(username: str) -> Path:
    return USER_DATA_DIR / username


def user_trips_dir(username: str) -> Path:
    return user_dir(username) / "trips"


def user_trip_backups_dir(username: str, trip_id: str) -> Path:
    return user_trips_dir(username) / "_backups" / safe_trip_id(trip_id)


def user_settings_dir(username: str) -> Path:
    return user_dir(username) / "settings"


def user_preferences_file(username: str) -> Path:
    return user_settings_dir(username) / "preferences.json"


def user_research_dir(username: str) -> Path:
    return user_dir(username) / "research"


def normalize_trip_reference_id(value: Any) -> str:
    text = str(value or "").strip()
    return text if re.match(r"^[A-Za-z0-9_-]{6,80}$", text) else ""


def safe_trip_id(value: Any) -> str:
    text = str(value or "").strip()
    if re.match(r"^[A-Za-z0-9_-]{6,80}$", text):
        return text
    return uuid.uuid4().hex


def safe_record_id(value: Any) -> str:
    text = str(value or "").strip()
    text = re.sub(r"[^A-Za-z0-9_-]+", "_", text)
    text = text.strip("_")
    return text[:100] or uuid.uuid4().hex


def normalize_trip_visibility(value: Any) -> str:
    text = str(value or "").strip().lower()
    return text if text in TRIP_VISIBILITY_VALUES else "private"


def normalize_trip_tag(value: Any, max_len: int = 48) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\s+", " ", text)
    text = text.strip(" -_｜|，,、;；。.\n\t")
    return text[:max_len]


def unique_trip_tags(values: list[Any], limit: int = 40) -> list[str]:
    tags: list[str] = []
    seen: set[str] = set()
    for value in values:
        tag = normalize_trip_tag(value)
        if not tag:
            continue
        key = tag.casefold()
        if key in seen:
            continue
        seen.add(key)
        tags.append(tag)
        if len(tags) >= limit:
            break
    return tags


def split_trip_tag_text(text: Any) -> list[str]:
    raw = str(text or "")
    return [
        item.strip()
        for item in re.split(r"[、,，;；\n/|]+", raw)
        if item.strip()
    ]


def normalize_date_only(value: Any) -> str:
    text = str(value or "").strip()
    match = re.match(r"^(\d{4}-\d{2}-\d{2})", text)
    return match.group(1) if match else ""


def add_days_to_date(date_text: Any, offset: int) -> str:
    source = parse_iso_date(date_text)
    return (source + timedelta(days=offset)).isoformat() if source else ""


def schedule_date_from_stop(stop: dict[str, Any], day: dict[str, Any]) -> str:
    return normalize_date_only(day.get("date")) or normalize_date_only(stop.get("date"))


def normalize_trip_stop_schedule(stop: dict[str, Any], day: dict[str, Any]) -> dict[str, Any]:
    time_label = str(stop.get("time") or stop.get("timeLabel") or "").strip()
    stop["date"] = schedule_date_from_stop(stop, day)
    stop["time"] = time_label or "待定"
    for field in ("startTime", "endTime", "start", "end", "startsAt", "endsAt"):
        stop.pop(field, None)
    return stop


def normalize_trip_schedule_fields(trip: dict[str, Any]) -> dict[str, Any]:
    trip["startDate"] = normalize_date_only(trip.get("startDate") or trip.get("tripStartDate") or trip.get("dateStart"))
    trip["endDate"] = normalize_date_only(trip.get("endDate") or trip.get("tripEndDate") or trip.get("dateEnd"))
    raw_days = trip.get("days")
    if not isinstance(raw_days, list):
        trip["days"] = []
        return trip
    if trip["startDate"] and (not trip["endDate"] or trip["endDate"] < trip["startDate"]):
        trip["endDate"] = add_days_to_date(trip["startDate"], max(0, len(raw_days) - 1))

    days: list[dict[str, Any]] = []
    for index, raw_day in enumerate(raw_days):
        if not isinstance(raw_day, dict):
            continue
        day = dict(raw_day)
        day["day"] = str(day.get("day") or f"D{index + 1}").strip() or f"D{index + 1}"
        day["date"] = add_days_to_date(trip["startDate"], index) or normalize_date_only(day.get("date") or day.get("dayDate"))

        raw_stops = day.get("stops")
        stops: list[dict[str, Any]] = []
        if isinstance(raw_stops, list):
            for raw_stop in raw_stops:
                if not isinstance(raw_stop, dict):
                    continue
                stop = normalize_trip_stop_schedule(dict(raw_stop), day)
                stops.append(stop)
        day["stops"] = stops
        days.append(day)

    trip["days"] = days
    return trip


def parse_iso_date(value: Any) -> date | None:
    text = normalize_date_only(value)
    if not text:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def same_month_day(year: int, source: date) -> date:
    try:
        return date(year, source.month, source.day)
    except ValueError:
        # Handle Feb 29 by using Feb 28 in non-leap years.
        return date(year, source.month, 28)


def ebird_historic_windows(target_date: date, years: int = 2, day_window: int = 7) -> list[tuple[date, date, int]]:
    today = datetime.now(timezone.utc).date()
    windows: list[tuple[date, date, int]] = []
    year = target_date.year
    while len(windows) < max(1, years) and year >= 1900:
        center = same_month_day(year, target_date)
        if center <= today:
            start = center - timedelta(days=day_window)
            end = center + timedelta(days=day_window)
            end = min(end, today)
            if end >= start:
                windows.append((start, end, year))
        year -= 1
    return windows


def iter_date_range(start: date, end: date):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def fetch_ebird_json_api(url: str, token: str, timeout: int = 30) -> Any:
    global _EBIRD_LAST_REQUEST_AT
    with _EBIRD_REQUEST_LOCK:
        elapsed = time.monotonic() - _EBIRD_LAST_REQUEST_AT
        if elapsed < EBIRD_REQUEST_MIN_INTERVAL_SECONDS:
            time.sleep(EBIRD_REQUEST_MIN_INTERVAL_SECONDS - elapsed)
        _EBIRD_LAST_REQUEST_AT = time.monotonic()
    return fetch_json_api(url, headers={"X-eBirdApiToken": token}, timeout=timeout)


def ebird_species_cache_key(loc_id: str, target_date: date, years: int, day_window: int) -> str:
    return f"v2|{loc_id}|{target_date.isoformat()}|years={years}|window={day_window}"


def load_ebird_species_cache() -> dict[str, Any]:
    data = read_json(EBIRD_SPECIES_CACHE_FILE, {})
    if not isinstance(data, dict):
        return {}
    entries = data.get("entries")
    return entries if isinstance(entries, dict) else {}


def save_ebird_species_cache(entries: dict[str, Any]) -> None:
    atomic_write_json(EBIRD_SPECIES_CACHE_FILE, {
        "version": 1,
        "updatedAt": utc_now(),
        "entries": entries,
    })


def cached_ebird_species_payload(loc_id: str, target_date: date, years: int, day_window: int, allow_stale: bool = False) -> dict[str, Any] | None:
    key = ebird_species_cache_key(loc_id, target_date, years, day_window)
    entry = load_ebird_species_cache().get(key)
    if not isinstance(entry, dict):
        return None
    payload = entry.get("payload")
    if not isinstance(payload, dict):
        return None
    cached_at = parse_optional_datetime(entry.get("cachedAt"))
    if not cached_at:
        return None
    age = datetime.now(timezone.utc) - cached_at
    if not allow_stale and age.days > EBIRD_SPECIES_CACHE_MAX_AGE_DAYS:
        return None
    result = json.loads(json.dumps(payload, ensure_ascii=False))
    result["cacheHit"] = True
    result["cacheStale"] = age.days > EBIRD_SPECIES_CACHE_MAX_AGE_DAYS
    return result


def store_ebird_species_payload(loc_id: str, target_date: date, years: int, day_window: int, payload: dict[str, Any]) -> None:
    entries = load_ebird_species_cache()
    key = ebird_species_cache_key(loc_id, target_date, years, day_window)
    clean_payload = {k: v for k, v in payload.items() if k not in {"cacheHit", "cacheStale"}}
    entries[key] = {
        "cachedAt": utc_now(),
        "payload": clean_payload,
    }
    save_ebird_species_cache(entries)


def fetch_ebird_taxonomy_names(token: str, species_codes: list[str], locale: str) -> dict[str, dict[str, Any]]:
    names: dict[str, dict[str, Any]] = {}
    clean_codes = []
    seen_codes: set[str] = set()
    for raw_code in species_codes:
        code = str(raw_code or "").strip()
        if code and code not in seen_codes:
            seen_codes.add(code)
            clean_codes.append(code)

    for start in range(0, len(clean_codes), 80):
        batch = clean_codes[start:start + 80]
        url = "https://api.ebird.org/v2/ref/taxonomy/ebird?" + urlencode({
            "fmt": "json",
            "locale": locale,
            "species": ",".join(batch),
        })
        data = fetch_ebird_json_api(url, token, timeout=30)
        for item in data if isinstance(data, list) else []:
            if not isinstance(item, dict):
                continue
            code = str(item.get("speciesCode") or "").strip()
            if code:
                names[code] = item
    return names


def fetch_ebird_hotspot_species(token: str, loc_id: str, target_date: date, years: int = 2, day_window: int = 7) -> dict[str, Any]:
    cached = cached_ebird_species_payload(loc_id, target_date, years, day_window)
    if cached:
        return cached

    species_by_key: dict[str, dict[str, Any]] = {}
    windows_payload: list[dict[str, Any]] = []
    warnings: list[str] = []
    rate_limited = False

    for start, end, year in ebird_historic_windows(target_date, years, day_window):
        observations: list[dict[str, Any]] = []
        active_days = 0
        window_rate_limited = False
        for query_date in iter_date_range(start, end):
            url = f"https://api.ebird.org/v2/data/obs/{quote(loc_id, safe='')}/historic/{query_date.year}/{query_date.month}/{query_date.day}?" + urlencode({
                "fmt": "json",
                "rank": "mrec",
                "detail": "full",
                "sppLocale": "zh_SIM",
                "includeProvisional": "false",
            })
            try:
                data = fetch_ebird_json_api(url, token, timeout=30)
            except HTTPError as exc:
                if exc.code == 429:
                    rate_limited = True
                    window_rate_limited = True
                    warnings.append("eBird 请求过于频繁，已停止继续查询并返回已取得的部分结果。请稍后再试，或直接使用缓存结果。")
                    break
                raise
            except Exception as exc:
                warnings.append(f"{query_date.isoformat()} 查询失败：{exc}")
                continue
            day_observations = data if isinstance(data, list) else []
            if day_observations:
                active_days += 1
                observations.extend(day_observations)

        windows_payload.append({
            "year": year,
            "startDate": start.isoformat(),
            "endDate": end.isoformat(),
            "activeDays": active_days,
            "observationCount": len(observations),
            "partial": window_rate_limited,
        })
        for obs in observations:
            if not isinstance(obs, dict):
                continue
            common = str(obs.get("comName") or "").strip()
            scientific = str(obs.get("sciName") or "").strip()
            code = str(obs.get("speciesCode") or "").strip()
            if not common and not scientific:
                continue
            key = (code or scientific or common).casefold()
            existing = species_by_key.get(key)
            obs_date = str(obs.get("obsDt") or "").strip()
            if existing:
                if obs_date and obs_date not in existing["observationDates"]:
                    existing["observationDates"].append(obs_date)
                existing["observationCount"] += 1
                continue
            species_by_key[key] = {
                "commonName": common,
                "scientificName": scientific,
                "speciesCode": code,
                "observationDates": [obs_date] if obs_date else [],
                "observationCount": 1,
            }
        if rate_limited:
            break

    species = sorted(
        species_by_key.values(),
        key=lambda item: ((item.get("commonName") or item.get("scientificName") or "").casefold())
    )
    for item in species:
        item["observationDates"] = sorted(item["observationDates"])[:12]
    species_codes = [str(item.get("speciesCode") or "").strip() for item in species if item.get("speciesCode")]
    taxonomy_warnings: list[str] = list(warnings)
    try:
        english_taxonomy = fetch_ebird_taxonomy_names(token, species_codes, "en") if species_codes else {}
    except Exception as exc:
        english_taxonomy = {}
        taxonomy_warnings.append(f"eBird 英文名补全失败：{exc}")
    try:
        chinese_taxonomy = fetch_ebird_taxonomy_names(token, species_codes, "zh_SIM") if species_codes else {}
    except Exception as exc:
        chinese_taxonomy = {}
        taxonomy_warnings.append(f"eBird 中文名补全失败：{exc}")
    for item in species:
        code = str(item.get("speciesCode") or "").strip()
        english = normalize_space(str(english_taxonomy.get(code, {}).get("comName") or ""))
        chinese = normalize_bird_name(chinese_taxonomy.get(code, {}).get("comName") or item.get("commonName") or "")
        scientific = normalize_space(str(english_taxonomy.get(code, {}).get("sciName") or chinese_taxonomy.get(code, {}).get("sciName") or item.get("scientificName") or ""))
        item["chineseName"] = chinese
        item["englishName"] = english
        item["scientificName"] = scientific
        item["commonName"] = chinese or english or scientific
    payload = {
        "species": species,
        "windows": windows_payload,
        "warnings": taxonomy_warnings,
        "partial": rate_limited,
    }
    if rate_limited and not species:
        stale = cached_ebird_species_payload(loc_id, target_date, years, day_window, allow_stale=True)
        if stale:
            stale_warnings = list(stale.get("warnings") or [])
            stale_warnings.append("eBird 当前限流，已返回本地旧缓存。")
            stale["warnings"] = stale_warnings
            return stale
    if not rate_limited:
        store_ebird_species_payload(loc_id, target_date, years, day_window, payload)
    return payload


def iter_trip_stops(trip: dict[str, Any]):
    days = trip.get("days") if isinstance(trip, dict) else []
    if not isinstance(days, list):
        return
    for day in days:
        if not isinstance(day, dict):
            continue
        stops = day.get("stops")
        if not isinstance(stops, list):
            continue
        for stop in stops:
            if isinstance(stop, dict):
                yield stop


def extract_trip_bird_tags(trip: dict[str, Any]) -> list[str]:
    noise = {"目标", "机会", "水鸟", "林鸟", "猛禽", "过境雀形目", "画眉类", "山地林鸟", "交通节点", "休息"}
    names: list[str] = []
    for stop in iter_trip_stops(trip):
        if str(stop.get("type") or "") != "bird":
            continue
        for raw in split_trip_tag_text(stop.get("birds")):
            name = normalize_bird_name(raw)
            if name and name not in noise:
                names.append(name)
    return unique_trip_tags(names, limit=50)


def extract_trip_location_tags(trip: dict[str, Any]) -> list[str]:
    values: list[Any] = [trip.get("primaryLocation")]
    for stop in iter_trip_stops(trip):
        values.append(stop.get("name"))
    return unique_trip_tags(values, limit=50)


def derive_trip_primary_location(trip: dict[str, Any]) -> str:
    explicit = normalize_trip_tag(trip.get("primaryLocation"))
    if explicit:
        return explicit
    tags = extract_trip_location_tags({**trip, "primaryLocation": ""})
    if tags:
        return tags[0]
    title = str(trip.get("title") or "").strip()
    parts = re.split(r"[｜|—\-·,，/]+", title)
    return normalize_trip_tag(parts[0] if parts else "") or "未设置地点"


def trip_content_fingerprint(trip: dict[str, Any]) -> str:
    payload = {
        "title": trip.get("title", ""),
        "subtitle": trip.get("subtitle", ""),
        "currency": trip.get("currency", ""),
        "summary": trip.get("summary", ""),
        "primaryLocation": trip.get("primaryLocation", ""),
        "tripPace": trip.get("tripPace", DEFAULT_TRIP_PACE),
        "center": trip.get("center") if isinstance(trip.get("center"), dict) else {},
        "days": trip.get("days") if isinstance(trip.get("days"), list) else [],
        "quickInfo": normalize_quick_info_items(trip.get("quickInfo")),
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def public_trip_card(owner: str, trip: dict[str, Any], viewer: str = "") -> dict[str, Any]:
    days = trip.get("days") if isinstance(trip.get("days"), list) else []
    stop_count = 0
    for day in days:
        if isinstance(day, dict) and isinstance(day.get("stops"), list):
            stop_count += len(day["stops"])
    return {
        "owner": owner,
        "tripId": trip.get("id", ""),
        "title": trip.get("title", ""),
        "subtitle": trip.get("subtitle", ""),
        "summary": trip.get("summary", ""),
        "primaryLocation": trip.get("primaryLocation", ""),
        "tripPace": trip.get("tripPace", DEFAULT_TRIP_PACE),
        "birdTags": trip.get("birdTags") if isinstance(trip.get("birdTags"), list) else [],
        "locationTags": trip.get("locationTags") if isinstance(trip.get("locationTags"), list) else [],
        "dayCount": len(days),
        "stopCount": stop_count,
        "updatedAt": trip.get("updatedAt", ""),
        "isOwn": bool(viewer and viewer == owner),
    }


def public_trip_search_text(owner: str, trip: dict[str, Any]) -> str:
    values: list[Any] = [
        owner,
        trip.get("title"),
        trip.get("subtitle"),
        trip.get("summary"),
        trip.get("primaryLocation"),
        trip.get("tripPace"),
        *(trip.get("birdTags") if isinstance(trip.get("birdTags"), list) else []),
        *(trip.get("locationTags") if isinstance(trip.get("locationTags"), list) else []),
    ]
    for stop in iter_trip_stops(trip):
        values.extend([stop.get("name"), stop.get("birds"), stop.get("note"), stop.get("transport")])
    return " ".join(str(item or "") for item in values).casefold()


def ensure_trip_shape(trip: Any) -> dict[str, Any]:
    if not isinstance(trip, dict):
        raise ValueError("trip must be an object")

    normalized = dict(trip)
    normalized["id"] = safe_trip_id(normalized.get("id"))
    normalized["title"] = str(normalized.get("title") or "未命名整体行程")
    normalized["subtitle"] = str(normalized.get("subtitle") or "自定义旅行行程")
    normalized["currency"] = str(normalized.get("currency") or "CNY").strip().upper()
    normalized["summary"] = str(normalized.get("summary") or "暂无概览。")

    center = normalized.get("center")
    if not isinstance(center, dict):
        center = {"lat": 23.7, "lng": 121.0, "zoom": 7}
    normalized["center"] = center

    normalize_trip_schedule_fields(normalized)
    normalized["quickInfo"] = normalize_quick_info_items(normalized.get("quickInfo"))
    if normalized["quickInfo"]:
        normalized["quickInfoUpdatedAt"] = str(normalized.get("quickInfoUpdatedAt") or utc_now())
    else:
        normalized.pop("quickInfoUpdatedAt", None)
    normalized["primaryLocation"] = derive_trip_primary_location(normalized)
    normalized["tripPace"] = normalize_trip_tag(normalized.get("tripPace"), 24) or DEFAULT_TRIP_PACE
    normalized["birdTags"] = extract_trip_bird_tags(normalized)
    normalized["locationTags"] = extract_trip_location_tags(normalized)

    normalized["copiedFromPublic"] = bool(normalized.get("copiedFromPublic"))
    if normalized["copiedFromPublic"]:
        source_trip_id = str(normalized.get("sourcePublicTripId") or "").strip()
        normalized["sourcePublicTripId"] = safe_trip_id(source_trip_id) if source_trip_id else ""
        normalized["sourcePublicTripOwner"] = normalize_username(str(normalized.get("sourcePublicTripOwner") or ""))
        normalized["sourcePublicTripTitle"] = str(normalized.get("sourcePublicTripTitle") or "")
        source_fingerprint = str(normalized.get("sourceFingerprint") or "")
        normalized["sourceFingerprint"] = source_fingerprint
        normalized["copyModified"] = bool(source_fingerprint and trip_content_fingerprint(normalized) != source_fingerprint)
    else:
        normalized["copyModified"] = False

    normalized["visibility"] = normalize_trip_visibility(normalized.get("visibility"))
    if normalized["copiedFromPublic"] and not normalized["copyModified"] and normalized["visibility"] == "public":
        raise ValueError("这是从公开行程复制的副本。请先对行程内容进行修改并保存后，再设置为公开检索。")
    normalized["updatedAt"] = utc_now()
    return normalized


def list_user_trips(username: str) -> list[dict[str, Any]]:
    trips_dir = user_trips_dir(username)
    trips_dir.mkdir(parents=True, exist_ok=True)
    trips: list[dict[str, Any]] = []
    for path in sorted(trips_dir.glob("*.json")):
        trip = read_json(path, None)
        if isinstance(trip, dict):
            if not trip.get("id"):
                trip["id"] = path.stem
            trips.append(normalize_trip_schedule_fields(dict(trip)))
    def sort_key(trip: dict[str, Any]):
        try:
            order = int(trip.get("sortOrder"))
        except (TypeError, ValueError):
            order = 999_999
        return (order, str(trip.get("title") or ""), str(trip.get("updatedAt") or ""))

    trips.sort(key=sort_key)
    return trips


def get_user_trip(username: str, trip_id: str) -> dict[str, Any] | None:
    path = user_trips_dir(username) / f"{safe_trip_id(trip_id)}.json"
    trip = read_json(path, None)
    return normalize_trip_schedule_fields(dict(trip)) if isinstance(trip, dict) else None


def backup_user_trip(username: str, trip_id: str, reason: str = "update") -> dict[str, Any] | None:
    safe_id = safe_trip_id(trip_id)
    path = user_trips_dir(username) / f"{safe_id}.json"
    if not path.exists():
        return None
    trip = read_json(path, None)
    if not isinstance(trip, dict):
        return None

    backup_dir = user_trip_backups_dir(username, safe_id)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup_path = backup_dir / f"{stamp}.json"
    payload = {
        "version": 1,
        "backupOf": safe_id,
        "backedUpAt": utc_now(),
        "reason": normalize_space(str(reason or "update"))[:80],
        "trip": trip,
    }
    atomic_write_json(backup_path, payload)

    backups = sorted(
        backup_dir.glob("*.json"),
        key=lambda item: item.stat().st_mtime,
        reverse=True,
    )
    for old_path in backups[TRIP_BACKUP_KEEP:]:
        try:
            old_path.unlink()
        except OSError:
            pass

    return {
        "backupOf": safe_id,
        "backedUpAt": payload["backedUpAt"],
        "reason": payload["reason"],
        "path": str(backup_path.relative_to(user_dir(username))).replace("\\", "/"),
    }


def save_user_trip(username: str, trip: dict[str, Any]) -> dict[str, Any]:
    normalized = ensure_trip_shape(trip)
    path = user_trips_dir(username) / f"{normalized['id']}.json"
    atomic_write_json(path, normalized)
    return normalized


def load_user_preferences(username: str) -> dict[str, Any]:
    data = read_json(user_preferences_file(username), {})
    return data if isinstance(data, dict) else {}


def save_user_preferences(username: str, preferences: dict[str, Any]) -> None:
    payload = dict(preferences)
    payload["updatedAt"] = utc_now()
    atomic_write_json(user_preferences_file(username), payload)


def get_user_default_trip_id(username: str) -> str:
    preferences = load_user_preferences(username)
    trip_id = normalize_trip_reference_id(preferences.get("defaultTripId"))
    if trip_id and (user_trips_dir(username) / f"{trip_id}.json").exists():
        return trip_id
    if trip_id:
        preferences.pop("defaultTripId", None)
        save_user_preferences(username, preferences)
    return ""


def set_user_default_trip_id(username: str, trip_id: Any) -> str:
    normalized_id = normalize_trip_reference_id(trip_id)
    if normalized_id and not (user_trips_dir(username) / f"{normalized_id}.json").exists():
        raise ValueError("默认行程不存在。")

    preferences = load_user_preferences(username)
    if normalized_id:
        preferences["defaultTripId"] = normalized_id
    else:
        preferences.pop("defaultTripId", None)
    save_user_preferences(username, preferences)
    return normalized_id


def replace_user_trips(username: str, trips: Any) -> list[dict[str, Any]]:
    if not isinstance(trips, list):
        raise ValueError("trips must be an array")

    trips_dir = user_trips_dir(username)
    trips_dir.mkdir(parents=True, exist_ok=True)

    saved: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for index, trip in enumerate(trips):
        normalized = ensure_trip_shape(trip)
        normalized["sortOrder"] = index
        normalized = save_user_trip(username, normalized)
        saved.append(normalized)
        seen_ids.add(normalized["id"])

    for path in trips_dir.glob("*.json"):
        if path.stem not in seen_ids:
            path.unlink()

    current_default_trip_id = get_user_default_trip_id(username)
    if current_default_trip_id and current_default_trip_id not in seen_ids:
        set_user_default_trip_id(username, "")

    return saved


def delete_user_trip(username: str, trip_id: str) -> bool:
    normalized_id = normalize_trip_reference_id(trip_id)
    path = user_trips_dir(username) / f"{safe_trip_id(trip_id)}.json"
    if not path.exists():
        return False
    path.unlink()
    if normalized_id and get_user_default_trip_id(username) == normalized_id:
        set_user_default_trip_id(username, "")
    return True


def iter_public_trip_records(viewer: str = ""):
    ensure_dirs()
    if not USER_DATA_DIR.exists():
        return
    for user_path in sorted(USER_DATA_DIR.iterdir()):
        if not user_path.is_dir():
            continue
        owner = user_path.name
        trips_dir = user_path / "trips"
        if not trips_dir.exists():
            continue
        for path in sorted(trips_dir.glob("*.json")):
            raw = read_json(path, None)
            if not isinstance(raw, dict):
                continue
            try:
                trip = ensure_trip_shape(raw)
            except ValueError:
                continue
            if trip.get("visibility") != "public":
                continue
            if trip.get("copiedFromPublic") and not trip.get("copyModified"):
                continue
            yield owner, trip, public_trip_card(owner, trip, viewer)


def search_public_trips(query: str, viewer: str, limit: int = 30) -> list[dict[str, Any]]:
    terms = [item.casefold() for item in re.split(r"\s+", str(query or "").strip()) if item.strip()]
    scored: list[tuple[int, str, dict[str, Any]]] = []
    for owner, trip, card in iter_public_trip_records(viewer):
        haystack = public_trip_search_text(owner, trip)
        if terms and not all(term in haystack for term in terms):
            continue
        score = 0
        title = str(trip.get("title") or "").casefold()
        tags = " ".join([*(trip.get("birdTags") or []), *(trip.get("locationTags") or [])]).casefold()
        for term in terms:
            if term in title:
                score += 6
            if term in tags:
                score += 4
            if term in haystack:
                score += 1
        if not terms:
            score = 1
        scored.append((score, str(trip.get("updatedAt") or ""), card))
    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [card for _, _, card in scored[: max(1, min(limit, 60))]]


def build_public_trip_copy(owner: str, trip_id: str) -> dict[str, Any]:
    owner = normalize_username(owner)
    if not validate_username(owner):
        raise ValueError("公开行程作者无效。")
    source = get_user_trip(owner, trip_id)
    if not source:
        raise ValueError("公开行程不存在。")
    source = ensure_trip_shape(source)
    if source.get("visibility") != "public":
        raise ValueError("该行程不是公开行程，不能导入。")
    if source.get("copiedFromPublic") and not source.get("copyModified"):
        raise ValueError("该行程仍是未修改的公开副本，不能继续复制。")

    now = utc_now()
    copied = json.loads(json.dumps(source, ensure_ascii=False))
    copied["id"] = uuid.uuid4().hex
    copied["createdAt"] = now
    copied["updatedAt"] = now
    copied["visibility"] = "private"
    copied["copiedFromPublic"] = True
    copied["sourcePublicTripOwner"] = owner
    copied["sourcePublicTripId"] = source.get("id", safe_trip_id(trip_id))
    copied["sourcePublicTripTitle"] = source.get("title", "")
    copied["sourceFingerprint"] = trip_content_fingerprint(source)
    copied["copyModified"] = False
    copied["sortOrder"] = 999_999
    return ensure_trip_shape(copied)


def import_public_trip_for_user(username: str, owner: str, trip_id: str) -> dict[str, Any]:
    copied = build_public_trip_copy(owner, trip_id)
    return save_user_trip(username, copied)


class ArticleTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title_parts: list[str] = []
        self.text_parts: list[str] = []
        self.skip_depth = 0
        self.in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "noscript", "svg", "canvas"}:
            self.skip_depth += 1
        if tag == "title":
            self.in_title = True
        if tag in {"p", "div", "section", "article", "br", "li", "h1", "h2", "h3", "tr"}:
            self.text_parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "noscript", "svg", "canvas"} and self.skip_depth:
            self.skip_depth -= 1
        if tag == "title":
            self.in_title = False
        if tag in {"p", "div", "section", "article", "li", "h1", "h2", "h3", "tr"}:
            self.text_parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self.skip_depth:
            return
        text = data.strip()
        if not text:
            return
        if self.in_title:
            self.title_parts.append(text)
        self.text_parts.append(text + " ")

    def result(self) -> tuple[str, str]:
        title = normalize_space(" ".join(self.title_parts))
        text = normalize_space("\n".join(self.text_parts))
        return title, text


def normalize_space(text: str) -> str:
    text = unescape(str(text or ""))
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()


def decode_response_body(raw: bytes, content_type: str = "") -> str:
    charset = "utf-8"
    match = re.search(r"charset=([\w.-]+)", content_type, re.I)
    if match:
        charset = match.group(1)
    try:
        return raw.decode(charset, errors="replace")
    except LookupError:
        return raw.decode("utf-8", errors="replace")


def fetch_url_html_response(url: str, timeout: int = 15, headers: dict[str, str] | None = None) -> tuple[str, str, str]:
    parsed = urlparse(str(url or ""))
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("只支持 http/https 链接。")

    request_headers = {
        "User-Agent": "Mozilla/5.0 BirdRoute/1.0 Local Research Tool",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
    }
    if headers:
        request_headers.update(headers)
    req = Request(
        url,
        headers=request_headers,
    )
    with urlopen(req, timeout=timeout) as res:
        content_type = res.headers.get("content-type", "")
        raw = res.read(MAX_FETCH_BYTES + 1)
        if len(raw) > MAX_FETCH_BYTES:
            raw = raw[:MAX_FETCH_BYTES]
        return decode_response_body(raw, content_type), content_type, res.geturl()


def fetch_url_html(url: str, timeout: int = 15) -> tuple[str, str]:
    html, content_type, _ = fetch_url_html_response(url, timeout=timeout)
    return html, content_type


def html_attr_value(tag_html: str, attr: str) -> str:
    match = re.search(
        rf"\b{re.escape(attr)}\s*=\s*(?:([\"'])(.*?)\1|([^\s>]+))",
        tag_html,
        flags=re.I | re.S,
    )
    if not match:
        return ""
    return unescape(match.group(2) if match.group(2) is not None else match.group(3) or "").strip()


def decode_script_url(value: str) -> str:
    text = unescape(str(value or "")).strip()
    if "\\" not in text:
        return text
    try:
        return json.loads('"' + text.replace('"', '\\"') + '"')
    except Exception:
        return text.replace("\\/", "/").replace("\\u0026", "&")


def normalize_redirect_url(candidate: str, base_url: str) -> str:
    text = decode_script_url(candidate).strip().strip("\"'")
    if not text:
        return ""
    resolved = urljoin(base_url, text)
    parsed = urlparse(resolved)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ""
    return resolved


def extract_client_redirect_url(base_url: str, html: str) -> str:
    for pattern in (
        r"(?:window\.)?location\.(?:replace|assign)\(\s*([\"'])(.*?)\1\s*\)",
        r"(?:window\.)?location\.href\s*=\s*([\"'])(.*?)\1",
        r"(?:window\.)?location\s*=\s*([\"'])(.*?)\1",
    ):
        match = re.search(pattern, html, flags=re.I | re.S)
        if match:
            redirect_url = normalize_redirect_url(match.group(2), base_url)
            if redirect_url:
                return redirect_url

    for meta in re.findall(r"<meta\b[^>]*>", html, flags=re.I | re.S):
        if html_attr_value(meta, "http-equiv").lower() != "refresh":
            continue
        content = html_attr_value(meta, "content")
        match = re.search(r"url\s*=\s*([^;]+)", content, flags=re.I)
        if match:
            redirect_url = normalize_redirect_url(match.group(1), base_url)
            if redirect_url:
                return redirect_url
    return ""


def should_follow_client_redirect(base_url: str, html: str, redirect_url: str) -> bool:
    if not redirect_url:
        return False
    parsed = urlparse(base_url)
    host = parsed.netloc.lower()
    if host.endswith("mp.weixin.qq.com") and re.search(r"\bid=[\"']js_content[\"']", html, flags=re.I):
        return False
    if "sogou.com" in host:
        return True
    if re.search(r"<meta\b[^>]+http-equiv=[\"']?refresh", html, flags=re.I):
        return True
    compact = re.sub(r"\s+", "", html or "")
    return len(compact) < 5000


def fetch_url_html_follow_redirects(
    url: str,
    timeout: int = 15,
    headers: dict[str, str] | None = None,
    max_redirects: int = 3,
) -> tuple[str, str, str]:
    current_url = str(url or "").strip()
    seen: set[str] = set()
    current_headers = headers
    for _ in range(max(0, max_redirects) + 1):
        html, content_type, final_url = fetch_url_html_response(current_url, timeout=timeout, headers=current_headers)
        current_headers = None
        redirect_url = extract_client_redirect_url(final_url, html)
        if (
            not redirect_url
            or redirect_url in seen
            or redirect_url == final_url
            or not should_follow_client_redirect(final_url, html, redirect_url)
        ):
            return html, content_type, final_url
        seen.add(final_url)
        current_url = redirect_url
    return html, content_type, final_url


def extract_article_from_html(url: str, html: str) -> dict[str, Any]:
    extractor = ArticleTextExtractor()
    try:
        extractor.feed(html)
    except Exception:
        pass
    title, text = extractor.result()

    if not title:
        match = re.search(r"<title[^>]*>(.*?)</title>", html, flags=re.I | re.S)
        title = normalize_space(match.group(1)) if match else url

    text = text[:MAX_ARTICLE_TEXT_CHARS]
    return {
        "title": title or url,
        "url": url,
        "text": text,
        "textLength": len(text),
        "fetchedAt": utc_now(),
    }


def strip_html_text(html: str) -> str:
    extractor = ArticleTextExtractor()
    try:
        extractor.feed(html)
    except Exception:
        pass
    _, text = extractor.result()
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    return normalize_space(text)


def html_field_by_id(html: str, element_id: str) -> str:
    pattern = re.compile(
        rf"<(?P<tag>[a-z0-9]+)[^>]+id=[\"']{re.escape(element_id)}[\"'][^>]*>(?P<body>.*?)</(?P=tag)>",
        flags=re.I | re.S,
    )
    match = pattern.search(html)
    return strip_html_text(match.group("body")) if match else ""


def html_meta_content(html: str, key: str) -> str:
    pattern = re.compile(
        rf"<meta[^>]+(?:property|name)=[\"']{re.escape(key)}[\"'][^>]+content=[\"'](?P<content>.*?)[\"'][^>]*>",
        flags=re.I | re.S,
    )
    match = pattern.search(html)
    return normalize_space(match.group("content")) if match else ""


def extract_wechat_article_from_html(url: str, html: str, content_type: str = "") -> dict[str, Any]:
    title = (
        html_field_by_id(html, "activity-name")
        or html_meta_content(html, "og:title")
        or html_meta_content(html, "twitter:title")
    )
    author = html_field_by_id(html, "js_name")

    content_fragment = ""
    start = re.search(r"<[^>]+id=[\"']js_content[\"'][^>]*>", html, flags=re.I)
    if start:
        tail = html[start.end():]
        end = re.search(
            r"<(?:script|style)\b|<div[^>]+id=[\"']js_pc_qr_code[\"']|<div[^>]+class=[\"'][^\"']*rich_media_tool",
            tail,
            flags=re.I,
        )
        content_fragment = tail[:end.start()] if end else tail

    text = strip_html_text(content_fragment) if content_fragment else ""
    if not text:
        fallback = extract_article_from_html(url, html)
        title = title or fallback.get("title", "")
        text = str(fallback.get("text") or "")

    text = text[:MAX_ARTICLE_TEXT_CHARS]
    article = {
        "title": title or url,
        "url": url,
        "text": text,
        "textLength": len(text),
        "source": "wechat",
        "provider": "mp_weixin",
        "fetchedAt": utc_now(),
    }
    if author:
        article["author"] = author
    if content_type:
        article["contentType"] = content_type
    return article


def ingest_article_url(url: str) -> dict[str, Any]:
    html, content_type, final_url = fetch_url_html_follow_redirects(url, timeout=15)
    parsed = urlparse(final_url)
    if parsed.netloc.endswith("mp.weixin.qq.com"):
        article = extract_wechat_article_from_html(final_url, html, content_type)
    else:
        article = extract_article_from_html(final_url, html)
        article["contentType"] = content_type
    if final_url != url:
        article["originalUrl"] = url
        article["resolvedUrl"] = final_url
    return article


def unwrap_duckduckgo_url(url: str) -> str:
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    if "uddg" in qs and qs["uddg"]:
        return qs["uddg"][0]
    return url


def unwrap_bing_url(url: str) -> str:
    parsed = urlparse(url)
    if "bing.com" not in parsed.netloc:
        return url
    qs = parse_qs(parsed.query)
    encoded = (qs.get("u") or [""])[0]
    if not encoded:
        return url
    if encoded.startswith("a1"):
        encoded = encoded[2:]
    try:
        padded = encoded + "=" * (-len(encoded) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8", errors="replace")
        if decoded.startswith(("http://", "https://")):
            return decoded
    except Exception:
        pass
    return url


def parse_duckduckgo_results(html: str, source: str) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    pattern = re.compile(
        r'<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
        flags=re.I | re.S,
    )
    for match in pattern.finditer(html):
        url = unwrap_duckduckgo_url(unescape(match.group(1)))
        title = normalize_space(re.sub(r"<[^>]+>", "", match.group(2)))
        if not url or not title:
            continue
        if any(item["url"] == url for item in results):
            continue
        results.append({
            "title": title,
            "url": url,
            "source": source,
            "snippet": "",
        })
        if len(results) >= 10:
            break
    return results


def parse_bing_results(html: str, source: str) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    blocks = re.findall(r'<li[^>]+class="b_algo"[^>]*>(.*?)</li>', html, flags=re.I | re.S)
    for block in blocks:
        link = re.search(r'<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', block, flags=re.I | re.S)
        if not link:
            continue
        url = unwrap_bing_url(unescape(link.group(1)))
        title = normalize_space(re.sub(r"<[^>]+>", "", link.group(2)))
        snippet_match = re.search(r"<p[^>]*>(.*?)</p>", block, flags=re.I | re.S)
        snippet = normalize_space(re.sub(r"<[^>]+>", "", snippet_match.group(1))) if snippet_match else ""
        if not url or not title:
            continue
        if any(item["url"] == url for item in results):
            continue
        results.append({
            "title": title,
            "url": url,
            "source": source,
            "snippet": snippet,
        })
        if len(results) >= 10:
            break
    return results


def parse_sogou_web_results(html: str, source: str) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    title_pattern = re.compile(
        r'<h3[^>]+class="[^"]*vr-title[^"]*"[^>]*>.*?<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>.*?</h3>',
        flags=re.I | re.S,
    )
    matches = list(title_pattern.finditer(html))
    for index, match in enumerate(matches[:12]):
        href = unescape(match.group(1))
        url = quote(urljoin("https://www.sogou.com/", href), safe=":/?&=%._-")
        title = clean_search_html_text(match.group(2))
        next_start = matches[index + 1].start() if index + 1 < len(matches) else min(len(html), match.end() + 2200)
        block = html[match.end():next_start]
        snippet_match = re.search(r"<p[^>]*>(.*?)</p>", block, flags=re.I | re.S)
        snippet = clean_search_html_text(snippet_match.group(1)) if snippet_match else clean_search_html_text(block)[:360]
        normalized = normalize_search_result(title, url, source, snippet, "sogou_web")
        if normalized and not any(item["url"] == normalized["url"] for item in results):
            results.append(normalized)
        if len(results) >= 12:
            break
    return results


def search_sogou_web(query: str, source: str) -> list[dict[str, Any]]:
    url = "https://www.sogou.com/web?" + urlencode({"query": query, "ie": "utf8"})
    html, _, final_url = fetch_url_html_response(url, timeout=15, headers=sogou_wechat_headers())
    if "antispider" in final_url or "验证码" in html and "antispider" in html:
        raise ValueError("搜狗网页搜索触发验证码/反爬限制。")
    return parse_sogou_web_results(html, source)


GENERIC_SEARCH_TERMS = {
    "观鸟", "攻略", "博客", "blog", "web", "全网", "个人", "游记", "行程", "旅行", "旅游",
    "鸟", "鸟类", "bird", "birding", "watching", "赏鸟", "野鸟", "自然", "湿地",
}
TOPIC_SEARCH_TERMS = (
    "观鸟", "赏鸟", "鸟类", "野鸟", "鸟种", "birding", "birdwatch", "bird watching",
    "bird", "birds", "生态", "湿地", "迁徙", "候鸟", "保护区",
)
BLOG_HINT_TERMS = (
    "博客", "blog", "游记", "攻略", "心得", "记录", "行程", "wordpress", "blogspot",
    "pixnet", "xuite", "medium", "lofter", "简书", "搜狐", "马蜂窝", "背包客栈",
)
BANNED_SEARCH_TERMS = (
    "游戏", "手游", "通关", "秘宝", "九游", "3dm", "游侠", "豌豆荚", "17173",
    "大江湖", "苍龙与白鸟", "苍龙与白 鸟", "白鸟大雪山", "白 鸟大雪山",
    "teamviewer", "github copilot", "chatgpt", "gpt-5", "youtube",
)
BIRD_NAME_HINT_CHARS = ("鸟", "鹭", "鹀", "雀", "鸫", "鹛", "鹤", "雁", "鸭", "鹰", "隼", "鸲", "鹟", "莺", "鸦", "鹇")


def search_query_terms(query: str) -> list[str]:
    text = re.sub(r"site:\S+", " ", str(query or ""), flags=re.I)
    text = re.sub(r"[\"'“”‘’()\[\]{}:：,，/|+]+", " ", text)
    raw_terms = [term.strip().lower() for term in re.split(r"\s+", text) if term.strip()]
    terms: list[str] = []
    for term in raw_terms:
        if len(term) <= 1:
            continue
        if term in GENERIC_SEARCH_TERMS:
            continue
        if term not in terms:
            terms.append(term)
    return terms[:8]


def search_result_relevance_score(query: str, item: dict[str, Any], source: str) -> int:
    haystack = normalize_space(" ".join([
        str(item.get("title") or ""),
        str(item.get("snippet") or ""),
        str(item.get("url") or ""),
    ])).lower()
    if any(term in haystack for term in BANNED_SEARCH_TERMS):
        return 0
    terms = search_query_terms(query)
    specific_matches = sum(1 for term in terms if term in haystack)
    topic_match = any(term in haystack for term in TOPIC_SEARCH_TERMS)
    bird_name_match = any(term in haystack and any(ch in term for ch in BIRD_NAME_HINT_CHARS) for term in terms)
    if terms:
        if specific_matches >= 2:
            score = 8 + specific_matches
        elif specific_matches == 1 and (topic_match or bird_name_match):
            score = 5
        else:
            return 0
    elif topic_match:
        score = 2
    else:
        return 0

    if source == "blog":
        if any(term in haystack for term in BLOG_HINT_TERMS):
            score += 2
        elif specific_matches < 2:
            return 0
    return score


def filter_relevant_search_results(query: str, source: str, results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if source not in {"blog", "web"}:
        return results
    scored: list[tuple[int, dict[str, Any]]] = []
    for item in results:
        score = search_result_relevance_score(query, item, source)
        if score > 0:
            item["relevanceScore"] = score
            scored.append((score, item))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [item for _, item in scored[:12]]


def search_bing(query: str, source: str) -> list[dict[str, Any]]:
    url = "https://www.bing.com/search?" + urlencode({"q": query, "mkt": "zh-CN", "setlang": "zh-CN"})
    html, _ = fetch_url_html(url, timeout=12)
    return parse_bing_results(html, source)


def search_duckduckgo(query: str, source: str) -> list[dict[str, Any]]:
    url = "https://html.duckduckgo.com/html/?" + urlencode({"q": query})
    html, _ = fetch_url_html(url, timeout=12)
    return parse_duckduckgo_results(html, source)


def unique_search_results(results: list[dict[str, Any]], limit: int = 20) -> list[dict[str, Any]]:
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for item in results:
        url = str(item.get("url") or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        unique.append(item)
        if len(unique) >= limit:
            break
    return unique


def search_web(query: str, source: str, apply_rule_filter: bool = True) -> list[dict[str, Any]]:
    errors: list[Exception] = []
    searchers = (search_sogou_web, search_duckduckgo, search_bing) if source in {"blog", "web", "wechat"} else (search_bing, search_duckduckgo)
    collected: list[dict[str, Any]] = []
    for searcher in searchers:
        try:
            raw_results = searcher(query, source)
            results = filter_relevant_search_results(query, source, raw_results) if apply_rule_filter else raw_results
            if results:
                if source in {"wechat", "xiaohongshu"}:
                    collected.extend(results)
                    continue
                return results
        except Exception as exc:
            errors.append(exc)
    if collected:
        return unique_search_results(collected, 20)
    if errors and source not in {"blog", "web"}:
        raise errors[-1]
    return []


def source_query(base_query: str, source: str) -> str:
    if source == "wechat":
        if re.search(r"\bsite:mp\.weixin\.qq\.com\b", base_query, flags=re.I):
            return base_query
        return f"site:mp.weixin.qq.com {base_query}"
    if source == "xiaohongshu":
        if re.search(r"\bsite:xiaohongshu\.com\b", base_query, flags=re.I):
            return base_query
        return f"site:xiaohongshu.com {base_query}"
    if source == "blog":
        return f"{base_query} 观鸟 博客 攻略"
    return base_query


def fetch_json_api(url: str, headers: dict[str, str] | None = None, payload: Any = None, timeout: int = 20) -> Any:
    data = None
    method = "GET"
    request_headers = {
        "Accept": "application/json",
        "User-Agent": "BirdRoute/1.0 Local Research Tool",
    }
    if headers:
        request_headers.update(headers)
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
        method = "POST"

    req = Request(url, data=data, headers=request_headers, method=method)
    with urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def geocode_cache_key(query: str, limit: int) -> str:
    normalized = normalize_space(query).casefold()
    raw = f"nominatim|zh-CN|limit={limit}|{normalized}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def load_geocode_cache() -> dict[str, Any]:
    data = read_json(GEOCODE_CACHE_FILE, {})
    if not isinstance(data, dict):
        return {}
    entries = data.get("entries")
    return entries if isinstance(entries, dict) else {}


def save_geocode_cache(entries: dict[str, Any]) -> None:
    atomic_write_json(GEOCODE_CACHE_FILE, {
        "version": 1,
        "updatedAt": utc_now(),
        "provider": "nominatim",
        "entries": entries,
    })


def geocode_cache_entry_age_days(entry: dict[str, Any]) -> int | None:
    cached_at = str(entry.get("cachedAt") or "").strip()
    if not cached_at:
        return None
    try:
        parsed = datetime.fromisoformat(cached_at.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - parsed.astimezone(timezone.utc)).days


def cached_geocode_payload(query: str, limit: int, allow_stale: bool = False) -> dict[str, Any] | None:
    key = geocode_cache_key(query, limit)
    entry = load_geocode_cache().get(key)
    if not isinstance(entry, dict):
        return None
    age_days = geocode_cache_entry_age_days(entry)
    if age_days is None:
        return None
    if not allow_stale and age_days > GEOCODE_CACHE_MAX_AGE_DAYS:
        return None
    results = entry.get("results")
    if not isinstance(results, list):
        return None
    return {
        "results": results,
        "cacheHit": True,
        "cacheStale": age_days > GEOCODE_CACHE_MAX_AGE_DAYS,
        "cachedAt": entry.get("cachedAt"),
        "provider": "nominatim",
    }


def store_geocode_payload(query: str, limit: int, results: list[dict[str, Any]]) -> None:
    entries = load_geocode_cache()
    entries[geocode_cache_key(query, limit)] = {
        "query": normalize_space(query),
        "limit": limit,
        "cachedAt": utc_now(),
        "results": results,
    }
    save_geocode_cache(entries)


def throttle_geocode_request() -> None:
    global _GEOCODE_LAST_REQUEST_AT
    with _GEOCODE_REQUEST_LOCK:
        elapsed = time.monotonic() - _GEOCODE_LAST_REQUEST_AT
        if elapsed < GEOCODE_REQUEST_MIN_INTERVAL_SECONDS:
            time.sleep(GEOCODE_REQUEST_MIN_INTERVAL_SECONDS - elapsed)
        _GEOCODE_LAST_REQUEST_AT = time.monotonic()


def normalize_geocode_result(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    try:
        lat = float(item.get("lat"))
        lon = float(item.get("lon"))
    except (TypeError, ValueError):
        return None
    display_name = normalize_space(str(item.get("display_name") or item.get("name") or ""))
    if not display_name:
        return None
    return {
        "display_name": display_name,
        "lat": f"{lat:.7f}",
        "lon": f"{lon:.7f}",
        "class": normalize_space(str(item.get("class") or "")),
        "type": normalize_space(str(item.get("type") or "")),
        "importance": item.get("importance"),
        "boundingbox": item.get("boundingbox") if isinstance(item.get("boundingbox"), list) else [],
        "source": "nominatim",
    }


def fetch_geocode_results(query: str, limit: int = 5) -> dict[str, Any]:
    normalized_query = normalize_space(query)
    limit = max(1, min(limit, 10))
    cached = cached_geocode_payload(normalized_query, limit)
    if cached:
        return cached

    params = {
        "format": "jsonv2",
        "limit": str(limit),
        "q": normalized_query,
        "addressdetails": "1",
        "namedetails": "1",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    url = "https://nominatim.openstreetmap.org/search?" + urlencode(params)
    headers = {
        "Accept": "application/json",
        "User-Agent": "BirdRoute/1.0 geocoding proxy",
        "Referer": "https://github.com/IndanthronBlue/BirdRoute",
    }

    try:
        throttle_geocode_request()
        data = fetch_json_api(url, headers=headers, timeout=20)
    except HTTPError as exc:
        stale = cached_geocode_payload(normalized_query, limit, allow_stale=True)
        if stale:
            stale["warnings"] = [f"Nominatim 返回 HTTP {exc.code}，已使用本地旧缓存。"]
            return stale
        raise

    results = [
        normalized
        for normalized in (normalize_geocode_result(item) for item in (data if isinstance(data, list) else []))
        if normalized
    ][:limit]
    store_geocode_payload(normalized_query, limit, results)
    return {
        "results": results,
        "cacheHit": False,
        "cacheStale": False,
        "provider": "nominatim",
    }


def query_param(name: str, value: str, note: str = "", enabled: bool = True) -> dict[str, Any]:
    return {"name": name, "value": value, "note": note, "enabled": enabled}


def normalize_query_param_rows(rows: Any, fallback: list[dict[str, Any]]) -> list[dict[str, Any]]:
    has_explicit_rows = isinstance(rows, list)
    source = rows if has_explicit_rows else fallback
    normalized: list[dict[str, Any]] = []
    for row in source:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip()
        value = str(row.get("value") or "").strip()
        note = str(row.get("note") or "").strip()
        enabled = row.get("enabled")
        if enabled is None:
            enabled = True
        if not name and not value and not note:
            continue
        normalized.append({
            "name": name,
            "value": value,
            "note": note,
            "enabled": bool(enabled),
        })
    if has_explicit_rows:
        return normalized
    return normalized if normalized else [dict(row) for row in fallback]


def render_query_value(value: Any, query: str, context: dict[str, Any] | None = None) -> str:
    rendered = str(value or "")
    context = context or {}
    for token in QUERY_VALUE_TOKENS:
        rendered = rendered.replace(token, query)
    for key, context_value in context.items():
        rendered = rendered.replace("{" + key + "}", str(context_value))
        rendered = rendered.replace("{{" + key + "}}", str(context_value))
    return rendered


def build_url_with_query_params(endpoint: str, query: str, rows: Any, fallback: list[dict[str, Any]], context: dict[str, Any] | None = None) -> str:
    params: dict[str, str] = {}
    for row in normalize_query_param_rows(rows, fallback):
        if not row.get("enabled", True):
            continue
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        value = render_query_value(row.get("value", ""), query, context)
        if value == "":
            continue
        params[name] = value
    separator = "&" if "?" in endpoint else "?"
    return endpoint + (separator + urlencode(params) if params else "")


def api_secret_headers(secret: str, mode: str, header_name: str = "") -> dict[str, str]:
    if not secret or mode in {"none", "query_param"}:
        return {}
    if mode == "x_api_key":
        return {"X-API-Key": secret}
    if mode == "header":
        return {header_name or "Authorization": secret}
    return {"Authorization": f"Bearer {secret}"}


def append_secret_query_param(url: str, secret: str, mode: str, param_name: str = "api_key") -> str:
    if not secret or mode != "query_param":
        return url
    separator = "&" if "?" in url else "?"
    return url + separator + urlencode({param_name or "api_key": secret})


def normalize_search_result(title: Any, url: Any, source: str, snippet: Any = "", provider: str = "") -> dict[str, Any] | None:
    title_text = normalize_space(str(title or ""))
    url_text = str(url or "").strip()
    if not title_text or not url_text or not url_text.startswith(("http://", "https://")):
        return None
    return {
        "title": title_text,
        "url": url_text,
        "source": source,
        "snippet": normalize_space(str(snippet or "")),
        "provider": provider,
    }


def search_brave_api(query: str, source: str, settings: dict[str, Any]) -> list[dict[str, Any]]:
    api_key = str(settings.get("braveApiKey") or "")
    if not api_key:
        raise ValueError("Brave Search API Key 未配置。")
    url = "https://api.search.brave.com/res/v1/web/search?" + urlencode({
        "q": query,
        "count": 8,
        "search_lang": "zh-hans",
        "country": "CN",
    })
    data = fetch_json_api(url, headers={"X-Subscription-Token": api_key})
    results = []
    for item in (data.get("web", {}) or {}).get("results", [])[:8]:
        normalized = normalize_search_result(item.get("title"), item.get("url"), source, item.get("description"), "brave")
        if normalized:
            results.append(normalized)
    return results


def search_bing_api(query: str, source: str, settings: dict[str, Any]) -> list[dict[str, Any]]:
    api_key = str(settings.get("bingApiKey") or "")
    if not api_key:
        raise ValueError("Bing Web Search API Key 未配置。")
    endpoint = str(settings.get("bingEndpoint") or "https://api.bing.microsoft.com/v7.0/search").rstrip("?")
    url = endpoint + "?" + urlencode({"q": query, "mkt": "zh-CN", "count": 8})
    data = fetch_json_api(url, headers={"Ocp-Apim-Subscription-Key": api_key})
    results = []
    for item in (data.get("webPages", {}) or {}).get("value", [])[:8]:
        normalized = normalize_search_result(item.get("name"), item.get("url"), source, item.get("snippet"), "bing_api")
        if normalized:
            results.append(normalized)
    return results


def search_serpapi(query: str, source: str, settings: dict[str, Any]) -> list[dict[str, Any]]:
    api_key = str(settings.get("serpApiKey") or "")
    if not api_key:
        raise ValueError("SerpAPI Key 未配置。")
    url = "https://serpapi.com/search.json?" + urlencode({
        "engine": "google",
        "q": query,
        "api_key": api_key,
        "hl": "zh-cn",
        "num": 8,
    })
    data = fetch_json_api(url)
    results = []
    for item in data.get("organic_results", [])[:8]:
        normalized = normalize_search_result(item.get("title"), item.get("link"), source, item.get("snippet"), "serpapi")
        if normalized:
            results.append(normalized)
    return results


def search_tavily(query: str, source: str, settings: dict[str, Any]) -> list[dict[str, Any]]:
    api_key = str(settings.get("tavilyApiKey") or "")
    if not api_key:
        raise ValueError("Tavily API Key 未配置。")
    data = fetch_json_api(
        "https://api.tavily.com/search",
        payload={
            "api_key": api_key,
            "query": query,
            "search_depth": "basic",
            "max_results": 8,
            "include_answer": False,
            "include_raw_content": False,
        },
    )
    results = []
    for item in data.get("results", [])[:8]:
        normalized = normalize_search_result(item.get("title"), item.get("url"), source, item.get("content"), "tavily")
        if normalized:
            results.append(normalized)
    return results


def sogou_wechat_headers() -> dict[str, str]:
    return {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
        "Referer": "https://weixin.sogou.com/",
    }


def clean_search_html_text(html: str) -> str:
    html = re.sub(r"<!--\s*red_(?:beg|end)\s*-->", "", html, flags=re.I)
    return re.sub(r"\s+", " ", strip_html_text(html)).strip()


def bounded_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        number = int(float(str(value).strip()))
    except Exception:
        number = default
    return max(minimum, min(maximum, number))


def query_rows_with_page(rows: Any, page: int, fallback: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = normalize_query_param_rows(rows, fallback)
    result: list[dict[str, Any]] = []
    found_page = False
    for row in normalized:
        next_row = dict(row)
        if str(next_row.get("name") or "").strip().lower() == "page":
            next_row["value"] = str(page)
            next_row["enabled"] = True
            found_page = True
        result.append(next_row)
    if not found_page:
        result.append(query_param("page", str(page), "页码"))
    return result


def parse_wechat_sogou_results(html: str, page: int = 1, index_offset: int = 0) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    blocks = re.findall(r"<li[^>]+id=[\"']sogou_vr_11002601_box_\d+[\"'][^>]*>(.*?)</li>", html, flags=re.I | re.S)
    if not blocks:
        blocks = re.findall(r"<li[^>]*>(.*?)</li>", html, flags=re.I | re.S)
    for index, block in enumerate(blocks[:12]):
        title_match = re.search(r"<h3[^>]*>\s*<a[^>]+href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", block, flags=re.I | re.S)
        if not title_match:
            continue
        raw_href = unescape(title_match.group(1))
        article_url = quote(urljoin("https://weixin.sogou.com/", raw_href), safe=":/?&=%._-")
        title = clean_search_html_text(title_match.group(2))
        snippet_match = re.search(r"<p[^>]+class=[\"'][^\"']*txt-info[^\"']*[\"'][^>]*>(.*?)</p>", block, flags=re.I | re.S)
        snippet = clean_search_html_text(snippet_match.group(1)) if snippet_match else ""
        account_match = re.search(r"<span[^>]+class=[\"'][^\"']*all-time-y2[^\"']*[\"'][^>]*>(.*?)</span>", block, flags=re.I | re.S)
        account = clean_search_html_text(account_match.group(1)) if account_match else ""
        normalized = normalize_search_result(title, article_url, "wechat", snippet, "sogou_weixin")
        if not normalized:
            continue
        if account:
            normalized["account"] = account
        normalized["needsDetail"] = True
        normalized["sogouPage"] = page
        normalized["sogouIndex"] = index_offset + index
        results.append(normalized)
    return results


def search_wechat_sogou(query: str, settings: dict[str, Any]) -> list[dict[str, Any]]:
    wechat = settings.get("wechat") if isinstance(settings.get("wechat"), dict) else {}
    endpoint = str(wechat.get("sogouSearchUrl") or WECHAT_SOGOU_SEARCH_ENDPOINT).strip() or WECHAT_SOGOU_SEARCH_ENDPOINT
    start_page = bounded_int(wechat.get("sogouPage"), 1, 1, 20)
    page_count = bounded_int(wechat.get("sogouPages"), 3, 1, 5)
    result_limit = bounded_int(wechat.get("sogouResultLimit"), 18, 8, 40)
    results: list[dict[str, Any]] = []
    errors: list[Exception] = []

    for page in range(start_page, start_page + page_count):
        try:
            url = build_url_with_query_params(
                endpoint,
                query,
                query_rows_with_page(
                    wechat.get("sogouQueryParams"),
                    page,
                    default_wechat_sogou_query_params(str(page)),
                ),
                default_wechat_sogou_query_params(str(page)),
                {"page": str(page)},
            )
            html, _, final_url = fetch_url_html_response(url, timeout=15, headers=sogou_wechat_headers())
            if "antispider" in final_url or "请输入验证码" in html or "验证码" in html and "antispider" in html:
                raise ValueError("搜狗微信搜索触发验证码/反爬限制，请稍后再试或改用其他内容源。")
            if "news-list" not in html:
                raise ValueError("搜狗微信搜索没有返回可解析的文章列表。")
            results.extend(parse_wechat_sogou_results(html, page, len(results)))
            results = unique_search_results(results, result_limit)
            if len(results) >= result_limit:
                break
        except Exception as exc:
            errors.append(exc)
            if not results:
                raise
            break

    if not results and errors:
        raise errors[-1]
    return results[:result_limit]


def search_wechat_third_party(query: str, settings: dict[str, Any]) -> list[dict[str, Any]]:
    wechat = settings.get("wechat") if isinstance(settings.get("wechat"), dict) else {}
    endpoint = str(wechat.get("thirdPartyBaseUrl") or "").strip()
    api_key = str(settings.get("wechatThirdPartyApiKey") or "").strip()
    if not endpoint:
        raise ValueError("微信公众号第三方 API Base URL 未配置。")

    key_mode = str(wechat.get("thirdPartyKeyMode") or "authorization_bearer")
    url = build_url_with_query_params(endpoint, query, wechat.get("thirdPartyQueryParams"), default_wechat_third_party_query_params())
    url = append_secret_query_param(url, api_key, key_mode, str(wechat.get("thirdPartyKeyParam") or "api_key"))
    headers = api_secret_headers(api_key, key_mode, str(wechat.get("thirdPartyKeyHeader") or "Authorization"))
    data = fetch_json_api(url, headers=headers)

    results: list[dict[str, Any]] = []
    for item in iter_possible_items(data)[:10]:
        if not isinstance(item, dict):
            continue
        title = deep_first_value(item, ("title", "name", "article_title", "articleTitle"))
        article_url = deep_first_value(item, ("url", "link", "article_url", "articleUrl", "content_url", "contentUrl"))
        snippet = deep_first_value(item, ("snippet", "summary", "desc", "description", "content"))
        normalized = normalize_search_result(title, article_url, "wechat", snippet, "wechat_third_party")
        if normalized:
            normalized["needsDetail"] = True
            results.append(normalized)
    return results


def resolve_sogou_wechat_article_url(url: str) -> str:
    encoded_url = quote(str(url or "").strip(), safe=":/?&=%._-")
    html, _, final_url = fetch_url_html_response(encoded_url, timeout=15, headers=sogou_wechat_headers())
    if "antispider" in final_url or "验证码" in html and "antispider" in html:
        raise ValueError("搜狗微信跳转触发验证码/反爬限制，暂时无法解析真实公众号链接。")
    parsed = urlparse(final_url)
    if parsed.netloc.endswith("mp.weixin.qq.com"):
        return final_url
    client_redirect = extract_client_redirect_url(final_url, html)
    if client_redirect and urlparse(client_redirect).netloc.endswith("mp.weixin.qq.com"):
        return client_redirect
    for pattern in (
        r"(https?://mp\.weixin\.qq\.com/s\?[^\"'<>\\]+)",
        r"(https?://mp\.weixin\.qq\.com/s/[^\"'<>\\]+)",
    ):
        match = re.search(pattern, html)
        if match:
            return unescape(match.group(1))
    raise ValueError("未能从搜狗微信搜索结果解析到真实公众号文章链接。")


def ingest_sogou_wechat_article(url: str) -> dict[str, Any]:
    article_url = resolve_sogou_wechat_article_url(url)
    html, content_type = fetch_url_html(article_url, timeout=15)
    article = extract_wechat_article_from_html(article_url, html, content_type)
    article["provider"] = "sogou_weixin"
    article["sogouUrl"] = url
    return article


def iter_possible_items(data: Any) -> list[Any]:
    if isinstance(data, list):
        return data
    if not isinstance(data, dict):
        return []
    containers = [
        data.get("data"),
        data.get("result"),
        data.get("results"),
        data.get("items"),
        data.get("notes"),
        data.get("list"),
    ]
    for container in containers:
        if isinstance(container, list):
            return container
        if isinstance(container, dict):
            for key in ("list", "items", "notes", "results", "records"):
                if isinstance(container.get(key), list):
                    return container.get(key)
    return []


def first_value(item: dict[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        value = item.get(key)
        if value:
            return value
    return ""


def deep_first_value(data: Any, keys: tuple[str, ...], max_depth: int = 5) -> Any:
    if max_depth < 0:
        return ""
    if isinstance(data, dict):
        for key in keys:
            value = data.get(key)
            if value:
                return value
        for value in data.values():
            found = deep_first_value(value, keys, max_depth - 1)
            if found:
                return found
    elif isinstance(data, list):
        for item in data:
            found = deep_first_value(item, keys, max_depth - 1)
            if found:
                return found
    return ""


def collect_text_values(data: Any, keys: tuple[str, ...], max_depth: int = 6) -> list[str]:
    values: list[str] = []

    def visit(value: Any, depth: int, parent_key: str = "") -> None:
        if depth < 0:
            return
        if isinstance(value, dict):
            for key, child in value.items():
                if key in keys and isinstance(child, (str, int, float)):
                    text = normalize_space(str(child))
                    if text and not text.startswith(("http://", "https://")):
                        values.append(text)
                elif key in keys and isinstance(child, list):
                    list_text = " ".join(normalize_space(str(part)) for part in child if isinstance(part, (str, int, float)))
                    if list_text:
                        values.append(list_text)
                visit(child, depth - 1, key)
        elif isinstance(value, list):
            for child in value:
                visit(child, depth - 1, parent_key)

    visit(data, max_depth)
    seen: set[str] = set()
    unique: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        unique.append(value)
    return unique


def collect_url_values(data: Any, key_hints: tuple[str, ...], max_depth: int = 6, limit: int = 20) -> list[str]:
    urls: list[str] = []

    def visit(value: Any, depth: int, parent_key: str = "") -> None:
        if depth < 0 or len(urls) >= limit:
            return
        if isinstance(value, dict):
            for key, child in value.items():
                key_text = key.lower()
                if isinstance(child, str) and child.startswith(("http://", "https://")) and any(hint in key_text for hint in key_hints):
                    urls.append(child)
                visit(child, depth - 1, key)
        elif isinstance(value, list):
            for child in value:
                visit(child, depth - 1, parent_key)

    visit(data, max_depth)
    seen: set[str] = set()
    unique: list[str] = []
    for url in urls:
        if url in seen:
            continue
        seen.add(url)
        unique.append(url)
    return unique[:limit]


def normalize_rnote_note_type(value: Any) -> str:
    text = normalize_space(str(value or "")).lower()
    if not text:
        return ""
    if "video" in text or "视频" in text:
        return "video"
    if any(token in text for token in ("image", "normal", "ordinary", "图文", "普通", "图片")):
        return "image"
    return ""


def rnote_note_id_from_item(item: dict[str, Any], fallback_url: str = "") -> str:
    note_id = deep_first_value(item, ("note_id", "noteId"))
    if not note_id:
        note_id = item.get("id")
    if note_id:
        return str(note_id).strip()
    return extract_note_id_from_url(fallback_url)


def rnote_url_from_item(item: dict[str, Any], note_id: str) -> str:
    note_url = deep_first_value(item, ("url", "link", "note_url", "noteUrl", "share_url", "shareUrl", "web_url", "webUrl"))
    if note_url:
        return str(note_url).strip()
    if not note_id:
        return ""
    url = f"https://www.xiaohongshu.com/explore/{note_id}"
    xsec_token = deep_first_value(item, ("xsec_token", "xsecToken"))
    if xsec_token:
        url += "?" + urlencode({"xsec_token": str(xsec_token), "xsec_source": "pc_search"})
    return url


def rnote_detail_endpoint(settings: dict[str, Any], note_type: str) -> str:
    xhs = settings.get("xiaohongshu") if isinstance(settings.get("xiaohongshu"), dict) else {}
    if note_type == "video":
        return str(xhs.get("videoDetailUrl") or RNOTE_XHS_VIDEO_DETAIL_ENDPOINT).strip()
    return str(xhs.get("imageDetailUrl") or RNOTE_XHS_IMAGE_DETAIL_ENDPOINT).strip()


def rnote_detail_url(endpoint: str, note_id: str) -> str:
    endpoint = endpoint or RNOTE_XHS_IMAGE_DETAIL_ENDPOINT
    if "{note_id}" in endpoint:
        return endpoint.replace("{note_id}", quote_plus(note_id))
    separator = "&" if "?" in endpoint else "?"
    return endpoint + separator + urlencode({"note_id": note_id})


def fetch_rnote_json(settings: dict[str, Any], note_id: str, note_type: str) -> tuple[Any, str]:
    api_key = str(settings.get("xhsThirdPartyApiKey") or "").strip()
    if not api_key:
        raise ValueError("小红书第三方 API Key 未配置。")

    preferred = normalize_rnote_note_type(note_type) or "image"
    fallback = "video" if preferred == "image" else "image"
    errors: list[Exception] = []
    for current_type in (preferred, fallback):
        endpoint = rnote_detail_endpoint(settings, current_type)
        try:
            data = fetch_json_api(rnote_detail_url(endpoint, note_id), headers={"X-API-Key": api_key})
            if data in (None, {}, []):
                raise ValueError("Rnote 返回为空。")
            return data, current_type
        except Exception as exc:
            errors.append(exc)
    raise ValueError(f"Rnote 笔记详情抓取失败：{errors[-1] if errors else '未知错误'}")


def rnote_article_from_detail(data: Any, note_id: str, note_type: str, source_url: str = "") -> dict[str, Any]:
    title = deep_first_value(data, ("title", "display_title", "displayTitle", "note_title", "noteTitle", "share_title", "shareTitle"))
    desc_parts = collect_text_values(
        data,
        (
            "desc",
            "description",
            "content",
            "note_desc",
            "noteDesc",
            "note_text",
            "noteText",
            "text",
            "share_desc",
            "shareDesc",
        ),
    )
    title_text = normalize_space(str(title or "")) or "小红书笔记"
    author = deep_first_value(data, ("nickname", "nick_name", "nickName", "user_name", "userName", "author_name", "authorName"))
    tags = collect_text_values(data, ("tag_name", "tagName", "hashtag", "hash_tag", "hashTag"), max_depth=5)
    metrics = {
        "liked": deep_first_value(data, ("liked_count", "likedCount", "like_count", "likeCount")),
        "collected": deep_first_value(data, ("collected_count", "collectedCount", "collect_count", "collectCount")),
        "commented": deep_first_value(data, ("comment_count", "commentCount", "comments_count", "commentsCount")),
    }

    text_parts = [title_text, *desc_parts]
    if author:
        text_parts.append(f"作者：{author}")
    if tags:
        text_parts.append("标签：" + " ".join(tags[:20]))
    metric_text = " ".join(f"{key}:{value}" for key, value in metrics.items() if value not in ("", None))
    if metric_text:
        text_parts.append("互动数据：" + metric_text)

    text = normalize_space("\n".join(text_parts))[:MAX_ARTICLE_TEXT_CHARS]
    url = source_url or f"https://www.xiaohongshu.com/explore/{note_id}"
    return {
        "title": title_text,
        "url": url,
        "text": text,
        "textLength": len(text),
        "images": collect_url_values(data, ("image", "img", "cover", "url_default", "url_pre")),
        "videoUrls": collect_url_values(data, ("video", "stream", "play", "media"), limit=8),
        "source": "xiaohongshu",
        "provider": "rnote",
        "note_id": note_id,
        "note_type": note_type,
        "fetchedAt": utc_now(),
    }


def fetch_rnote_note_detail(settings: dict[str, Any], note_id: str, note_type: str = "", source_url: str = "") -> dict[str, Any]:
    note_id = str(note_id or "").strip()
    if not note_id:
        note_id = extract_note_id_from_url(source_url)
    if not note_id:
        raise ValueError("缺少 Rnote note_id，无法抓取小红书笔记详情。")
    data, resolved_type = fetch_rnote_json(settings, note_id, note_type)
    return rnote_article_from_detail(data, note_id, resolved_type, source_url)


def search_xhs_third_party(query: str, settings: dict[str, Any]) -> list[dict[str, Any]]:
    xhs = settings.get("xiaohongshu") if isinstance(settings.get("xiaohongshu"), dict) else {}
    endpoint = str(xhs.get("thirdPartyBaseUrl") or RNOTE_XHS_SEARCH_ENDPOINT).strip()
    api_key = str(settings.get("xhsThirdPartyApiKey") or "").strip()
    if not endpoint:
        endpoint = RNOTE_XHS_SEARCH_ENDPOINT
    if not api_key:
        raise ValueError("小红书第三方 API Key 未配置。")

    key_mode = str(xhs.get("thirdPartyKeyMode") or "x_api_key")
    url = build_url_with_query_params(endpoint, query, xhs.get("thirdPartyQueryParams"), default_xhs_third_party_query_params(xhs))
    url = append_secret_query_param(url, api_key, key_mode, str(xhs.get("thirdPartyKeyParam") or "api_key"))
    headers = api_secret_headers(api_key, key_mode, str(xhs.get("thirdPartyKeyHeader") or "X-API-Key"))
    data = fetch_json_api(url, headers=headers)
    results: list[dict[str, Any]] = []
    for item in iter_possible_items(data)[:10]:
        if not isinstance(item, dict):
            continue
        title = deep_first_value(item, ("title", "display_title", "displayTitle", "desc", "content", "note_title", "noteTitle"))
        note_type = normalize_rnote_note_type(deep_first_value(item, ("type", "note_type", "noteType"))) or "image"
        note_id = rnote_note_id_from_item(item)
        note_url = rnote_url_from_item(item, note_id)
        snippet = deep_first_value(item, ("desc", "content", "description", "note_desc", "noteDesc"))
        normalized = normalize_search_result(title or note_id, note_url, "xiaohongshu", snippet, "rnote")
        if normalized:
            normalized["note_id"] = note_id
            normalized["note_type"] = note_type
            normalized["needsDetail"] = True
            results.append(normalized)
    return results


def xhs_official_search_url(endpoint: str, query: str, xhs: dict[str, Any], token: str, token_mode: str) -> str:
    url = build_url_with_query_params(
        endpoint,
        query,
        xhs.get("officialSearchQueryParams"),
        default_xhs_official_search_query_params(xhs),
        {"page": str(xhs.get("officialPage") or "1")},
    )
    if token_mode == "query_access_token":
        return append_secret_query_param(url, token, "query_param", str(xhs.get("officialTokenParam") or "access_token"))
    return url


def xhs_official_headers(xhs: dict[str, Any], token: str, token_mode: str) -> dict[str, str]:
    if token_mode == "query_access_token":
        return {}
    if token_mode == "header_access_token":
        header_name = str(xhs.get("officialTokenHeader") or "access-token").strip() or "access-token"
        return {header_name: token}
    return {"Authorization": f"Bearer {token}"}


def parse_optional_datetime(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    normalized = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def ensure_xhs_official_token_not_expired(settings: dict[str, Any]) -> None:
    xhs = settings.get("xiaohongshu") if isinstance(settings.get("xiaohongshu"), dict) else {}
    expires_at = parse_optional_datetime(xhs.get("officialAccessTokenExpiresAt"))
    if expires_at and expires_at <= datetime.now(timezone.utc):
        raise ValueError("小红书官方 Access Token 已过期，请重新授权/扫码登录后更新 token 和过期时间。")


def search_xhs_official_token(query: str, settings: dict[str, Any]) -> list[dict[str, Any]]:
    xhs = settings.get("xiaohongshu") if isinstance(settings.get("xiaohongshu"), dict) else {}
    endpoint = str(xhs.get("officialSearchUrl") or "").strip()
    token = str(settings.get("xhsOfficialAccessToken") or "").strip()
    if not endpoint:
        raise ValueError("小红书官方搜索 API URL 未配置。请在开放平台授权模式下填写可调用的搜索端点。")
    if not token:
        raise ValueError("小红书官方 Access Token 未配置。请先完成官方授权/扫码登录并保存 token。")
    ensure_xhs_official_token_not_expired(settings)

    token_mode = str(xhs.get("officialTokenMode") or "authorization_bearer").strip()
    url = xhs_official_search_url(endpoint, query, xhs, token, token_mode)
    data = fetch_json_api(url, headers=xhs_official_headers(xhs, token, token_mode))

    results: list[dict[str, Any]] = []
    for item in iter_possible_items(data)[:10]:
        if not isinstance(item, dict):
            continue
        title = deep_first_value(item, ("title", "display_title", "displayTitle", "note_title", "noteTitle", "name"))
        note_id = str(deep_first_value(item, ("note_id", "noteId", "id", "noteIdStr")) or "").strip()
        url = deep_first_value(item, ("url", "link", "note_url", "noteUrl", "share_url", "shareUrl", "web_url", "webUrl"))
        if not url and note_id:
            url = f"https://www.xiaohongshu.com/explore/{note_id}"
        snippet = deep_first_value(item, ("desc", "content", "description", "note_desc", "noteDesc", "summary", "text"))
        normalized = normalize_search_result(title or note_id, url, "xiaohongshu", snippet, "xhs_official")
        if normalized:
            if note_id:
                normalized["note_id"] = note_id
            normalized["needsDetail"] = bool(xhs.get("officialDetailUrl"))
            results.append(normalized)
    return results


def xhs_official_detail_url(endpoint: str, note_id: str, xhs: dict[str, Any], token: str, token_mode: str) -> str:
    if "{note_id}" in endpoint:
        url = endpoint.replace("{note_id}", quote_plus(note_id))
        if token_mode != "query_access_token":
            return url
        separator = "&" if "?" in url else "?"
        token_param = str(xhs.get("officialTokenParam") or "access_token").strip() or "access_token"
        return url + separator + urlencode({token_param: token})
    separator = "&" if "?" in endpoint else "?"
    id_param = str(xhs.get("officialDetailIdParam") or "note_id").strip() or "note_id"
    params = {id_param: note_id}
    if token_mode == "query_access_token":
        params[str(xhs.get("officialTokenParam") or "access_token").strip() or "access_token"] = token
    return endpoint + separator + urlencode(params)


def xhs_official_article_from_detail(data: Any, note_id: str, source_url: str = "") -> dict[str, Any]:
    title = deep_first_value(data, ("title", "display_title", "displayTitle", "note_title", "noteTitle", "name"))
    desc_parts = collect_text_values(
        data,
        (
            "desc",
            "description",
            "content",
            "note_desc",
            "noteDesc",
            "note_text",
            "noteText",
            "summary",
            "text",
        ),
    )
    title_text = normalize_space(str(title or "")) or "小红书笔记"
    author = deep_first_value(data, ("nickname", "nick_name", "nickName", "user_name", "userName", "author_name", "authorName"))
    tags = collect_text_values(data, ("tag_name", "tagName", "hashtag", "hash_tag", "hashTag"), max_depth=5)
    text_parts = [title_text, *desc_parts]
    if author:
        text_parts.append(f"作者：{author}")
    if tags:
        text_parts.append("标签：" + " ".join(tags[:20]))
    text = normalize_space("\n".join(text_parts))[:MAX_ARTICLE_TEXT_CHARS]
    return {
        "title": title_text,
        "url": source_url or (f"https://www.xiaohongshu.com/explore/{note_id}" if note_id else ""),
        "text": text,
        "textLength": len(text),
        "images": collect_url_values(data, ("image", "img", "cover", "url_default", "url_pre")),
        "videoUrls": collect_url_values(data, ("video", "stream", "play", "media"), limit=8),
        "source": "xiaohongshu",
        "provider": "xhs_official",
        "note_id": note_id,
        "fetchedAt": utc_now(),
    }


def fetch_xhs_official_note_detail(settings: dict[str, Any], note_id: str = "", source_url: str = "") -> dict[str, Any]:
    xhs = settings.get("xiaohongshu") if isinstance(settings.get("xiaohongshu"), dict) else {}
    endpoint = str(xhs.get("officialDetailUrl") or "").strip()
    token = str(settings.get("xhsOfficialAccessToken") or "").strip()
    note_id = str(note_id or "").strip() or extract_note_id_from_url(source_url)
    if not endpoint:
        raise ValueError("小红书官方详情 API URL 未配置。")
    if not token:
        raise ValueError("小红书官方 Access Token 未配置。")
    ensure_xhs_official_token_not_expired(settings)
    if not note_id:
        raise ValueError("缺少 note_id，无法调用小红书官方详情接口。")

    token_mode = str(xhs.get("officialTokenMode") or "authorization_bearer").strip()
    data = fetch_json_api(
        xhs_official_detail_url(endpoint, note_id, xhs, token, token_mode),
        headers=xhs_official_headers(xhs, token, token_mode),
    )
    return xhs_official_article_from_detail(data, note_id, source_url)


def playwright_install_hint() -> str:
    return "本机浏览器会话需要安装 Playwright：pip install -r requirements.txt && python -m playwright install chromium"


def xhs_browser_environment_status() -> dict[str, Any]:
    try:
        playwright_module = __import__("playwright.sync_api", fromlist=["sync_playwright"])
    except Exception:
        return {
            "ready": False,
            "playwrightInstalled": False,
            "chromiumInstalled": False,
            "message": "Playwright Python 包未安装。",
            "installHint": playwright_install_hint(),
        }

    pw = None
    try:
        pw = playwright_module.sync_playwright().start()
        executable = str(pw.chromium.executable_path or "")
        chromium_installed = bool(executable and Path(executable).exists())
        return {
            "ready": chromium_installed,
            "playwrightInstalled": True,
            "chromiumInstalled": chromium_installed,
            "chromiumExecutable": executable if chromium_installed else "",
            "message": "Playwright / Chromium 已就绪。" if chromium_installed else "Playwright 已安装，但 Chromium 浏览器尚未安装。",
            "installHint": "" if chromium_installed else "请运行：python -m playwright install chromium",
        }
    except Exception as exc:
        return {
            "ready": False,
            "playwrightInstalled": True,
            "chromiumInstalled": False,
            "message": f"Playwright 环境检测失败：{exc}",
            "installHint": playwright_install_hint(),
        }
    finally:
        if pw:
            try:
                pw.stop()
            except Exception:
                pass


class XhsBrowserWorker:
    def __init__(self, username: str):
        self.username = username
        self.started_at = utc_now()
        self.requests: queue.Queue[tuple[str, dict[str, Any], queue.Queue[tuple[bool, Any]]]] = queue.Queue()
        self.ready = threading.Event()
        self.start_error = ""
        self.started = False
        self.thread = threading.Thread(target=self._run, name=f"xhs-browser-{username}", daemon=True)

    def start(self) -> None:
        if not self.started:
            self.thread.start()
            self.started = True
        elif not self.thread.is_alive():
            raise ValueError("小红书浏览器会话已退出，请重新启动。")
        if not self.ready.wait(timeout=90):
            raise ValueError("启动小红书本机浏览器超时。")
        if self.start_error:
            raise ValueError(self.start_error)

    def call(self, op: str, payload: dict[str, Any] | None = None, timeout: int = 75) -> Any:
        self.start()
        response: queue.Queue[tuple[bool, Any]] = queue.Queue(maxsize=1)
        self.requests.put((op, payload or {}, response))
        try:
            ok, result = response.get(timeout=timeout)
        except queue.Empty as exc:
            raise ValueError(f"小红书浏览器任务超时：{op}") from exc
        if not ok:
            raise ValueError(str(result))
        return result

    def close(self) -> None:
        if not self.thread.is_alive():
            return
        response: queue.Queue[tuple[bool, Any]] = queue.Queue(maxsize=1)
        self.requests.put(("close", {}, response))
        try:
            response.get(timeout=20)
        except Exception:
            pass

    def _run(self) -> None:
        pw = None
        context = None
        page = None
        try:
            from playwright.sync_api import sync_playwright

            profile_dir = user_dir(self.username) / "browser_profiles" / "xiaohongshu"
            profile_dir.mkdir(parents=True, exist_ok=True)

            pw = sync_playwright().start()
            context = pw.chromium.launch_persistent_context(
                str(profile_dir),
                headless=False,
                viewport={"width": 1280, "height": 900},
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--no-first-run",
                    "--no-default-browser-check",
                ],
            )
            page = context.pages[0] if context.pages else context.new_page()
            page.set_default_timeout(20_000)
            self.ready.set()

            while True:
                op, payload, response = self.requests.get()
                try:
                    if op == "status":
                        response.put((True, xhs_browser_status_from_page(page, self.started_at)))
                    elif op == "ensure_home":
                        if "xiaohongshu.com" not in str(page.url or ""):
                            page.goto("https://www.xiaohongshu.com", wait_until="domcontentloaded", timeout=45_000)
                        response.put((True, xhs_browser_status_from_page(page, self.started_at)))
                    elif op == "search":
                        response.put((True, xhs_browser_search_on_page(page, str(payload.get("query") or ""), int(payload.get("limit") or 12))))
                    elif op == "read_note":
                        response.put((True, xhs_browser_read_note_on_page(page, str(payload.get("url") or ""))))
                    elif op == "close":
                        response.put((True, xhs_browser_status_from_page(page, self.started_at)))
                        break
                    else:
                        raise ValueError(f"未知小红书浏览器任务：{op}")
                except Exception as exc:
                    response.put((False, exc))
        except Exception as exc:
            self.start_error = f"启动 Chromium 失败：{exc}。{playwright_install_hint()}"
            self.ready.set()
        finally:
            if context:
                try:
                    context.close()
                except Exception:
                    pass
            if pw:
                try:
                    pw.stop()
                except Exception:
                    pass


def get_xhs_browser_session(username: str, create: bool = False) -> XhsBrowserWorker:
    worker = XHS_BROWSER_SESSIONS.get(username)
    if worker and worker.thread.is_alive():
        return worker
    if worker:
        XHS_BROWSER_SESSIONS.pop(username, None)
    if not create:
        raise ValueError("小红书本机浏览器会话尚未启动。请先在设置里点击“启动扫码登录浏览器”。")

    worker = XhsBrowserWorker(username)
    XHS_BROWSER_SESSIONS[username] = worker
    try:
        worker.start()
    except Exception:
        XHS_BROWSER_SESSIONS.pop(username, None)
        raise
    return worker


def close_xhs_browser_session(username: str) -> None:
    worker = XHS_BROWSER_SESSIONS.pop(username, None)
    if worker:
        worker.close()


def cleanup_xhs_sessions() -> None:
    for username in list(XHS_BROWSER_SESSIONS.keys()):
        close_xhs_browser_session(username)


atexit.register(cleanup_xhs_sessions)


def xhs_browser_status(username: str) -> dict[str, Any]:
    worker = XHS_BROWSER_SESSIONS.get(username)
    if not worker or not worker.thread.is_alive():
        if worker:
            XHS_BROWSER_SESSIONS.pop(username, None)
        environment = xhs_browser_environment_status()
        return {
            "running": False,
            "loggedIn": False,
            "environment": environment,
            "message": "浏览器会话未启动。" if environment.get("ready") else str(environment.get("message") or "浏览器环境未就绪。"),
        }
    try:
        return worker.call("status", timeout=20)
    except Exception as exc:
        return {
            "running": False,
            "loggedIn": False,
            "environment": {"ready": False, "message": str(exc), "installHint": ""},
            "message": f"浏览器会话异常：{exc}",
        }


def xhs_browser_status_from_page(page: Any, started_at: str) -> dict[str, Any]:
    current_url = ""
    title = ""
    try:
        current_url = page.url
        title = page.title()
    except Exception:
        pass
    return {
        "running": True,
        "loggedIn": "login" not in current_url.lower(),
        "currentUrl": current_url,
        "title": title,
        "startedAt": started_at,
        "environment": {"ready": True, "message": "浏览器会话已启动。"},
        "message": "如果浏览器中仍显示登录页，请在打开的窗口里扫码登录。",
    }


def extract_note_id_from_url(url: str) -> str:
    match = re.search(r"/explore/([^/?#]+)", url)
    if match:
        return match.group(1)
    match = re.search(r"/discovery/item/([^/?#]+)", url)
    return match.group(1) if match else ""


def xhs_browser_search(username: str, query: str, limit: int = 12) -> list[dict[str, Any]]:
    worker = get_xhs_browser_session(username, create=False)
    return worker.call("search", {"query": query, "limit": limit}, timeout=75)


def xhs_browser_search_on_page(page: Any, query: str, limit: int = 12) -> list[dict[str, Any]]:
    search_url = "https://www.xiaohongshu.com/search_result?" + urlencode({"keyword": query})
    page.goto(search_url, wait_until="domcontentloaded", timeout=45_000)
    try:
        page.wait_for_load_state("networkidle", timeout=12_000)
    except Exception:
        pass
    for _ in range(2):
        try:
            page.mouse.wheel(0, 900)
            page.wait_for_timeout(900)
        except Exception:
            break

    items = page.evaluate(
        """
        (limit) => {
          const anchors = Array.from(document.querySelectorAll('a[href*="/explore/"], a[href*="/discovery/item/"]'));
          const seen = new Set();
          const rows = [];
          for (const a of anchors) {
            let href = a.getAttribute('href') || '';
            try { href = new URL(href, location.href).href; } catch (e) {}
            if (!href || seen.has(href)) continue;
            seen.add(href);
            const card = a.closest('section, article, .note-item, .feeds-page, .cover, div') || a;
            const text = ((card && card.innerText) || a.innerText || '').replace(/\\s+\\n/g, '\\n').trim();
            const lines = text.split('\\n').map(s => s.trim()).filter(Boolean);
            const img = card && card.querySelector ? card.querySelector('img') : null;
            rows.push({
              title: lines[0] || a.getAttribute('title') || '小红书笔记',
              url: href,
              snippet: lines.slice(0, 8).join('\\n'),
              image: img ? img.src : ''
            });
            if (rows.length >= limit) break;
          }
          return rows;
        }
        """,
        limit,
    )

    results: list[dict[str, Any]] = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "")
        title = str(item.get("title") or "小红书笔记")
        if not url:
            continue
        results.append({
            "title": normalize_space(title),
            "url": url,
            "source": "xiaohongshu",
            "provider": "xhs_local_browser",
            "snippet": normalize_space(str(item.get("snippet") or ""))[:600],
            "note_id": extract_note_id_from_url(url),
            "image": item.get("image") or "",
        })
    return results


def xhs_browser_read_note(username: str, url: str) -> dict[str, Any]:
    worker = get_xhs_browser_session(username, create=False)
    return worker.call("read_note", {"url": url}, timeout=75)


def xhs_browser_read_note_on_page(page: Any, url: str) -> dict[str, Any]:
    page.goto(url, wait_until="domcontentloaded", timeout=45_000)
    try:
        page.wait_for_load_state("networkidle", timeout=12_000)
    except Exception:
        pass
    try:
        page.wait_for_timeout(1200)
    except Exception:
        pass
    data = page.evaluate(
        """
        () => {
          const title = document.querySelector('meta[property="og:title"]')?.content
            || document.querySelector('title')?.innerText
            || document.querySelector('h1')?.innerText
            || '小红书笔记';
          const desc = document.querySelector('meta[property="og:description"]')?.content || '';
          const main = document.querySelector('#detail-desc, .note-content, .content, main') || document.body;
          const text = ((main && main.innerText) || document.body.innerText || '').trim();
          const images = Array.from(document.querySelectorAll('img')).map(img => img.src).filter(Boolean).slice(0, 20);
          return { title, desc, text, images, url: location.href };
        }
        """
    )
    text = normalize_space("\n".join([str(data.get("desc") or ""), str(data.get("text") or "")]))
    return {
        "title": normalize_space(str(data.get("title") or "小红书笔记")),
        "url": str(data.get("url") or url),
        "text": text[:MAX_ARTICLE_TEXT_CHARS],
        "textLength": min(len(text), MAX_ARTICLE_TEXT_CHARS),
        "images": data.get("images") or [],
        "source": "xiaohongshu",
        "provider": "xhs_local_browser",
        "note_id": extract_note_id_from_url(str(data.get("url") or url)),
        "fetchedAt": utc_now(),
    }


def content_source_settings_path(username: str) -> Path:
    return user_settings_dir(username) / "content_sources.json"


def default_wechat_sogou_query_params(page: str = "{page}") -> list[dict[str, Any]]:
    return [
        query_param("type", "2", "搜狗微信文章搜索类型"),
        query_param("query", "{query}", "搜索关键词"),
        query_param("ie", "utf8", "字符集"),
        query_param("page", str(page or "{page}"), "页码"),
    ]


def default_wechat_third_party_query_params() -> list[dict[str, Any]]:
    return [
        query_param("keyword", "{query}", "搜索关键词"),
        query_param("page", "1", "页码"),
    ]


def default_xhs_third_party_query_params(xhs: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    xhs = xhs or {}
    return [
        query_param("keyword", "{query}", "搜索关键词"),
        query_param("page", str(xhs.get("rnotePage") or "1"), "页码"),
        query_param("sort_type", str(xhs.get("rnoteSortType") or "general"), "排序字段，例如 general / time_descending / popularity_descending"),
        query_param("note_type", str(xhs.get("rnoteNoteType") or "不限"), "笔记类型；如接口不需要可关闭", str(xhs.get("rnoteNoteType") or "不限") != "不限"),
        query_param("time_filter", str(xhs.get("rnoteTimeFilter") or "不限"), "发布时间；如接口不需要可关闭", str(xhs.get("rnoteTimeFilter") or "不限") != "不限"),
    ]


def default_xhs_official_search_query_params(xhs: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    xhs = xhs or {}
    return [
        query_param(str(xhs.get("officialKeywordParam") or "keyword"), "{query}", "搜索关键词"),
        query_param(str(xhs.get("officialPageParam") or "page"), str(xhs.get("officialPage") or "1"), "页码"),
    ]


def default_content_source_settings() -> dict[str, Any]:
    return {
        "searchProvider": "html",
        "bingEndpoint": "https://api.bing.microsoft.com/v7.0/search",
        "llmCandidateFilter": False,
        "defaultSources": {
            "wechat": True,
            "xiaohongshu": True,
            "blog": True,
            "web": True,
        },
        "wechat": {
            "mode": "search_index",
            "appId": "",
            "thirdPartyBaseUrl": "",
            "thirdPartyKeyMode": "authorization_bearer",
            "thirdPartyKeyHeader": "Authorization",
            "thirdPartyKeyParam": "api_key",
            "thirdPartyQueryParams": default_wechat_third_party_query_params(),
            "sogouSearchUrl": WECHAT_SOGOU_SEARCH_ENDPOINT,
            "sogouPage": "1",
            "sogouPages": "3",
            "sogouResultLimit": "18",
            "sogouQueryParams": default_wechat_sogou_query_params(),
            "notes": "默认通过搜索引擎索引查找 mp.weixin.qq.com 公开文章；可切换到搜狗微信搜索，先取搜索结果，再跟随搜狗跳转抓取公众号正文。",
        },
        "xiaohongshu": {
            "mode": "search_index",
            "appId": "",
            "officialAuthUrl": "https://ark.xiaohongshu.com/ark/authorization",
            "officialRedirectUri": "",
            "officialSearchUrl": "",
            "officialDetailUrl": "",
            "officialDetailIdParam": "note_id",
            "officialAccessTokenExpiresAt": "",
            "officialKeywordParam": "keyword",
            "officialPageParam": "page",
            "officialPage": "1",
            "officialSearchQueryParams": default_xhs_official_search_query_params(),
            "officialTokenMode": "authorization_bearer",
            "officialTokenHeader": "Authorization",
            "officialTokenParam": "access_token",
            "thirdPartyBaseUrl": RNOTE_XHS_SEARCH_ENDPOINT,
            "thirdPartyKeyMode": "x_api_key",
            "thirdPartyKeyHeader": "X-API-Key",
            "thirdPartyKeyParam": "api_key",
            "thirdPartyQueryParams": default_xhs_third_party_query_params(),
            "imageDetailUrl": RNOTE_XHS_IMAGE_DETAIL_ENDPOINT,
            "videoDetailUrl": RNOTE_XHS_VIDEO_DETAIL_ENDPOINT,
            "rnoteSortType": "general",
            "rnoteNoteType": "不限",
            "rnoteTimeFilter": "不限",
            "rnotePage": "1",
            "localBrowserExperimental": False,
            "notes": "默认通过搜索引擎索引查找 xiaohongshu.com 公开页面。第三方 API 默认流程为 Rnote 搜索笔记，再按 note_id 调图文/视频详情。",
        },
    }


def sanitize_public_settings_template(value: Any) -> Any:
    if isinstance(value, dict):
        cleaned: dict[str, Any] = {}
        for key, item in value.items():
            if key in SETTINGS_TEMPLATE_SECRET_FIELDS:
                continue
            cleaned[str(key)] = sanitize_public_settings_template(item)
        return cleaned
    if isinstance(value, list):
        return [sanitize_public_settings_template(item) for item in value]
    return value


def merge_content_source_defaults(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    merged.update(override)
    for section in ("defaultSources", "wechat", "xiaohongshu"):
        if isinstance(base.get(section), dict):
            section_override = override.get(section) if isinstance(override.get(section), dict) else {}
            merged[section] = {**base[section], **section_override}
    return merged


def default_settings_template_payload() -> dict[str, Any]:
    return sanitize_public_settings_template({
        "version": 1,
        "updatedAt": utc_now(),
        "llm": default_llm_settings(),
        "contentSources": default_content_source_settings(),
    })


def normalize_settings_template(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    llm_override = data.get("llm") if isinstance(data.get("llm"), dict) else {}
    content_override = data.get("contentSources") if isinstance(data.get("contentSources"), dict) else {}

    llm = dict(default_llm_settings())
    llm.update(llm_override)
    llm = sanitize_public_settings_template(llm)
    llm["promptTemplate"] = normalize_research_prompt_template(str(llm.get("promptTemplate") or ""))
    llm["candidateFilterEnabled"] = bool(llm.get("candidateFilterEnabled"))
    llm["candidateFilterPrompt"] = normalize_llm_candidate_filter_prompt(str(llm.get("candidateFilterPrompt") or ""))
    llm["provider"] = str(llm.get("provider") or "deepseek").strip() or "deepseek"
    llm["baseUrl"] = str(llm.get("baseUrl") or "https://api.deepseek.com").strip() or "https://api.deepseek.com"
    llm["model"] = str(llm.get("model") or "deepseek-chat").strip() or "deepseek-chat"

    content_sources = merge_content_source_defaults(default_content_source_settings(), content_override)
    content_sources = sanitize_public_settings_template(content_sources)

    return {
        "version": int(data.get("version") or 1) if str(data.get("version") or "1").isdigit() else 1,
        "updatedAt": str(data.get("updatedAt") or utc_now()),
        "llm": llm,
        "contentSources": content_sources,
    }


def ensure_settings_template() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not SETTINGS_TEMPLATE_FILE.exists():
        atomic_write_json(SETTINGS_TEMPLATE_FILE, default_settings_template_payload())
        return
    saved = read_json(SETTINGS_TEMPLATE_FILE, {})
    sanitized_saved = sanitize_public_settings_template(saved)
    normalized = normalize_settings_template(saved)
    if saved != sanitized_saved or sanitized_saved != normalized:
        normalized["updatedAt"] = utc_now()
        atomic_write_json(SETTINGS_TEMPLATE_FILE, normalized)


def load_settings_template() -> dict[str, Any]:
    ensure_settings_template()
    return normalize_settings_template(read_json(SETTINGS_TEMPLATE_FILE, {}))


def template_content_source_settings() -> dict[str, Any]:
    return load_settings_template().get("contentSources", default_content_source_settings())


def template_llm_settings() -> dict[str, Any]:
    return load_settings_template().get("llm", default_llm_settings())


def load_content_source_settings(username: str, include_secrets: bool = False) -> dict[str, Any]:
    template_defaults = template_content_source_settings()
    settings = template_defaults
    saved = read_json(content_source_settings_path(username), {})
    if isinstance(saved, dict):
        settings.update(saved)
        for section in ("defaultSources", "wechat", "xiaohongshu"):
            if isinstance(saved.get(section), dict):
                settings[section] = {**template_defaults[section], **saved[section]}
    if not settings["xiaohongshu"].get("thirdPartyBaseUrl"):
        settings["xiaohongshu"]["thirdPartyBaseUrl"] = RNOTE_XHS_SEARCH_ENDPOINT
    if not settings["xiaohongshu"].get("imageDetailUrl"):
        settings["xiaohongshu"]["imageDetailUrl"] = RNOTE_XHS_IMAGE_DETAIL_ENDPOINT
    if not settings["xiaohongshu"].get("videoDetailUrl"):
        settings["xiaohongshu"]["videoDetailUrl"] = RNOTE_XHS_VIDEO_DETAIL_ENDPOINT
    if not settings["wechat"].get("sogouSearchUrl"):
        settings["wechat"]["sogouSearchUrl"] = WECHAT_SOGOU_SEARCH_ENDPOINT

    wechat = settings["wechat"]
    xhs = settings["xiaohongshu"]
    wechat.setdefault("sogouPage", "1")
    wechat.setdefault("sogouPages", "3")
    wechat.setdefault("sogouResultLimit", "18")
    wechat["sogouQueryParams"] = normalize_query_param_rows(
        wechat.get("sogouQueryParams"),
        default_wechat_sogou_query_params(str(wechat.get("sogouPage") or "1")),
    )
    wechat["thirdPartyQueryParams"] = normalize_query_param_rows(
        wechat.get("thirdPartyQueryParams"),
        default_wechat_third_party_query_params(),
    )
    xhs["thirdPartyQueryParams"] = normalize_query_param_rows(
        xhs.get("thirdPartyQueryParams"),
        default_xhs_third_party_query_params(xhs),
    )
    xhs["officialSearchQueryParams"] = normalize_query_param_rows(
        xhs.get("officialSearchQueryParams"),
        default_xhs_official_search_query_params(xhs),
    )
    settings = decrypt_secret_fields(settings, CONTENT_SECRET_FIELDS)
    if has_plaintext_secret(saved, CONTENT_SECRET_FIELDS):
        atomic_write_json(content_source_settings_path(username), encrypt_secret_fields(settings, CONTENT_SECRET_FIELDS))

    for field in CONTENT_SECRET_FIELDS:
        settings["has" + field[:1].upper() + field[1:]] = secret_value_present(settings.get(field))
        if not include_secrets:
            settings.pop(field, None)
    return settings


def save_content_source_settings(username: str, payload: dict[str, Any]) -> dict[str, Any]:
    existing = load_content_source_settings(username, include_secrets=True)
    template_defaults = template_content_source_settings()
    settings = template_defaults
    settings.update(existing)
    for section in ("defaultSources", "wechat", "xiaohongshu"):
        settings[section] = {**template_defaults[section], **existing.get(section, {})}

    if "searchProvider" in payload:
        provider = str(payload.get("searchProvider") or "html").strip()
        if provider in {"html", "brave", "bing_api", "serpapi", "tavily"}:
            settings["searchProvider"] = provider
    if "bingEndpoint" in payload:
        settings["bingEndpoint"] = str(payload.get("bingEndpoint") or "").strip() or "https://api.bing.microsoft.com/v7.0/search"
    if "llmCandidateFilter" in payload:
        settings["llmCandidateFilter"] = bool(payload.get("llmCandidateFilter"))

    default_sources = payload.get("defaultSources")
    if isinstance(default_sources, dict):
        settings["defaultSources"].update({k: bool(default_sources.get(k)) for k in ("wechat", "xiaohongshu", "blog", "web")})

    for section in ("wechat", "xiaohongshu"):
        incoming = payload.get(section)
        if isinstance(incoming, dict):
            for key, value in incoming.items():
                if key not in {"appSecret", "thirdPartyApiKey", "officialAccessToken"}:
                    if key.endswith("QueryParams"):
                        current = settings[section].get(key)
                        fallback = current if isinstance(current, list) else []
                        settings[section][key] = normalize_query_param_rows(value, fallback)
                    elif isinstance(value, bool):
                        settings[section][key] = value
                    else:
                        settings[section][key] = str(value or "").strip()

    secret_map = {
        "braveApiKey": "braveApiKey",
        "bingApiKey": "bingApiKey",
        "serpApiKey": "serpApiKey",
        "tavilyApiKey": "tavilyApiKey",
        "wechatAppSecret": "wechatAppSecret",
        "wechatThirdPartyApiKey": "wechatThirdPartyApiKey",
        "xhsAppSecret": "xhsAppSecret",
        "xhsOfficialAccessToken": "xhsOfficialAccessToken",
        "xhsThirdPartyApiKey": "xhsThirdPartyApiKey",
    }
    for payload_key, settings_key in secret_map.items():
        if payload_key in payload:
            value = str(payload.get(payload_key) or "").strip()
            if is_masked_existing_secret(value, existing.get(settings_key)):
                continue
            elif value:
                settings[settings_key] = value
            else:
                settings.pop(settings_key, None)

    clear_map = {
        "clearBraveApiKey": "braveApiKey",
        "clearBingApiKey": "bingApiKey",
        "clearSerpApiKey": "serpApiKey",
        "clearTavilyApiKey": "tavilyApiKey",
        "clearWechatAppSecret": "wechatAppSecret",
        "clearWechatThirdPartyApiKey": "wechatThirdPartyApiKey",
        "clearXhsAppSecret": "xhsAppSecret",
        "clearXhsOfficialAccessToken": "xhsOfficialAccessToken",
        "clearXhsThirdPartyApiKey": "xhsThirdPartyApiKey",
    }
    for payload_key, settings_key in clear_map.items():
        if payload.get(payload_key):
            settings.pop(settings_key, None)

    settings["updatedAt"] = utc_now()
    atomic_write_json(content_source_settings_path(username), encrypt_secret_fields(settings, CONTENT_SECRET_FIELDS))
    return load_content_source_settings(username, include_secrets=True)


def search_with_content_provider(query: str, source: str, settings: dict[str, Any]) -> list[dict[str, Any]]:
    if source == "wechat":
        wechat = settings.get("wechat") if isinstance(settings.get("wechat"), dict) else {}
        if wechat.get("mode") == "sogou_weixin":
            try:
                return search_wechat_sogou(query, settings)
            except Exception as exc:
                fallback_query = source_query(query, "wechat")
                fallback = search_web(fallback_query, "wechat", apply_rule_filter=not bool(settings.get("llmCandidateFilter")))
                if fallback:
                    for item in fallback:
                        item["providerFallback"] = "sogou_weixin"
                        item["providerFallbackError"] = str(exc)
                    return fallback
                raise
        if wechat.get("mode") == "third_party":
            return search_wechat_third_party(query, settings)
    if source == "xiaohongshu":
        xhs = settings.get("xiaohongshu") if isinstance(settings.get("xiaohongshu"), dict) else {}
        if xhs.get("mode") == "third_party":
            return search_xhs_third_party(query, settings)
        if xhs.get("mode") == "open_platform":
            return search_xhs_official_token(query, settings)
        if xhs.get("mode") == "local_browser_experimental":
            raise ValueError("小红书本机浏览器会话搜索需要当前用户上下文。")
    provider = str(settings.get("searchProvider") or "html")
    if provider == "brave":
        return search_brave_api(query, source, settings)
    if provider == "bing_api":
        return search_bing_api(query, source, settings)
    if provider == "serpapi":
        return search_serpapi(query, source, settings)
    if provider == "tavily":
        return search_tavily(query, source, settings)
    return search_web(query, source, apply_rule_filter=not bool(settings.get("llmCandidateFilter")))


def default_llm_settings() -> dict[str, Any]:
    return {
        "provider": "deepseek",
        "baseUrl": "https://api.deepseek.com",
        "model": "deepseek-chat",
        "promptTemplate": DEFAULT_RESEARCH_PROMPT,
        "candidateFilterEnabled": False,
        "candidateFilterPrompt": LLM_CANDIDATE_FILTER_PROMPT,
    }


def api_credentials_path(username: str) -> Path:
    return user_settings_dir(username) / "api_credentials.json"


def load_api_credentials(username: str, include_secrets: bool = False) -> dict[str, Any]:
    saved = read_json(api_credentials_path(username), {})
    settings = saved if isinstance(saved, dict) else {}
    settings = decrypt_secret_fields(settings, API_CREDENTIAL_SECRET_FIELDS)
    if has_plaintext_secret(saved, API_CREDENTIAL_SECRET_FIELDS):
        atomic_write_json(api_credentials_path(username), encrypt_secret_fields(settings, API_CREDENTIAL_SECRET_FIELDS))
    result = {
        "hasEbirdToken": secret_value_present(settings.get("ebirdToken")),
        "hasXcToken": secret_value_present(settings.get("xcToken")),
        "updatedAt": settings.get("updatedAt", ""),
    }
    if include_secrets:
        result["ebirdToken"] = str(settings.get("ebirdToken") or "")
        result["xcToken"] = str(settings.get("xcToken") or "")
    return result


def save_api_credentials(username: str, payload: dict[str, Any]) -> dict[str, Any]:
    saved = read_json(api_credentials_path(username), {})
    settings = decrypt_secret_fields(saved if isinstance(saved, dict) else {}, API_CREDENTIAL_SECRET_FIELDS)

    if "ebirdToken" in payload:
        value = str(payload.get("ebirdToken") or "").strip()
        if is_masked_existing_secret(value, settings.get("ebirdToken")):
            pass
        elif value:
            settings["ebirdToken"] = value
        else:
            settings.pop("ebirdToken", None)
    if "xcToken" in payload:
        value = str(payload.get("xcToken") or "").strip()
        if is_masked_existing_secret(value, settings.get("xcToken")):
            pass
        elif value:
            settings["xcToken"] = value
        else:
            settings.pop("xcToken", None)

    if payload.get("clearEbirdToken"):
        settings.pop("ebirdToken", None)
    if payload.get("clearXcToken"):
        settings.pop("xcToken", None)

    settings["updatedAt"] = utc_now()
    atomic_write_json(api_credentials_path(username), encrypt_secret_fields(settings, API_CREDENTIAL_SECRET_FIELDS))
    return load_api_credentials(username, include_secrets=True)


def normalize_quick_info_items(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        value = value.get("items")
    if not isinstance(value, list):
        return []

    items: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    now = utc_now()
    for raw in value:
        if not isinstance(raw, dict):
            continue
        key = normalize_space(str(raw.get("key") or raw.get("name") or ""))
        info_value = str(raw.get("value") or raw.get("url") or raw.get("text") or "").strip()
        if not key or not info_value:
            continue

        item_id = safe_record_id(raw.get("id") or uuid.uuid4().hex)
        while item_id in seen_ids:
            item_id = safe_record_id(uuid.uuid4().hex)
        seen_ids.add(item_id)

        items.append({
            "id": item_id,
            "key": key[:QUICK_INFO_KEY_MAX_CHARS],
            "value": info_value[:QUICK_INFO_VALUE_MAX_CHARS],
            "createdAt": str(raw.get("createdAt") or now)[:80],
            "updatedAt": str(raw.get("updatedAt") or now)[:80],
        })
        if len(items) >= QUICK_INFO_MAX_ITEMS:
            break
    return items


def save_trip_quick_info(username: str, trip_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    trip = get_user_trip(username, trip_id)
    if not trip:
        return None
    existing_items = normalize_quick_info_items(trip.get("quickInfo"))
    existing_by_id = {item["id"]: item for item in existing_items if item.get("id")}
    now = utc_now()
    items = []
    for item in normalize_quick_info_items(payload.get("items") if isinstance(payload, dict) else []):
        previous = existing_by_id.get(item["id"], {})
        item["createdAt"] = previous.get("createdAt") or item.get("createdAt") or now
        item["updatedAt"] = now
        items.append(item)

    trip["quickInfo"] = items
    trip["quickInfoUpdatedAt"] = now if items else ""
    saved = save_user_trip(username, trip)
    return {
        "updatedAt": saved.get("quickInfoUpdatedAt", ""),
        "items": saved.get("quickInfo") or [],
        "trip": saved,
    }


def trip_quick_info_payload(trip: dict[str, Any]) -> dict[str, Any]:
    return {
        "updatedAt": str(trip.get("quickInfoUpdatedAt") or ""),
        "items": normalize_quick_info_items(trip.get("quickInfo")),
    }


def clear_all_api_secrets(username: str) -> dict[str, Any]:
    llm = load_llm_settings(username, include_key=True)
    llm.pop("apiKey", None)
    atomic_write_json(llm_settings_path(username), encrypt_secret_fields(llm, LLM_SECRET_FIELDS))

    content = load_content_source_settings(username, include_secrets=True)
    for key in (
        "braveApiKey",
        "bingApiKey",
        "serpApiKey",
        "tavilyApiKey",
        "wechatAppSecret",
        "wechatThirdPartyApiKey",
        "xhsAppSecret",
        "xhsOfficialAccessToken",
        "xhsThirdPartyApiKey",
    ):
        content.pop(key, None)
    atomic_write_json(content_source_settings_path(username), encrypt_secret_fields(content, CONTENT_SECRET_FIELDS))

    atomic_write_json(api_credentials_path(username), {"updatedAt": utc_now()})
    return {
        "llm": public_llm_settings(load_llm_settings(username, include_key=True)),
        "contentSources": public_content_source_settings(load_content_source_settings(username, include_secrets=True)),
        "apiCredentials": public_api_credentials(load_api_credentials(username, include_secrets=True)),
    }


def llm_settings_path(username: str) -> Path:
    return user_settings_dir(username) / "llm.json"


def load_llm_settings(username: str, include_key: bool = False) -> dict[str, Any]:
    template_defaults = template_llm_settings()
    settings = dict(template_defaults)
    saved = read_json(llm_settings_path(username), {})
    if isinstance(saved, dict):
        settings.update(saved)
        if "candidateFilterEnabled" not in saved:
            legacy_content = read_json(content_source_settings_path(username), {})
            if isinstance(legacy_content, dict) and "llmCandidateFilter" in legacy_content:
                settings["candidateFilterEnabled"] = bool(legacy_content.get("llmCandidateFilter"))
    settings = decrypt_secret_fields(settings, LLM_SECRET_FIELDS)
    if has_plaintext_secret(saved, LLM_SECRET_FIELDS):
        atomic_write_json(llm_settings_path(username), encrypt_secret_fields(settings, LLM_SECRET_FIELDS))
    settings["promptTemplate"] = normalize_research_prompt_template(str(settings.get("promptTemplate") or ""))
    settings["candidateFilterEnabled"] = bool(settings.get("candidateFilterEnabled"))
    settings["candidateFilterPrompt"] = normalize_llm_candidate_filter_prompt(str(settings.get("candidateFilterPrompt") or ""))
    api_key = str(settings.get("apiKey") or "")
    settings["hasApiKey"] = bool(api_key)
    if not include_key:
        settings.pop("apiKey", None)
    return settings


def save_llm_settings(username: str, payload: dict[str, Any]) -> dict[str, Any]:
    existing = load_llm_settings(username, include_key=True)
    template_defaults = template_llm_settings()
    settings = dict(template_defaults)
    settings.update(existing)

    for key in ("provider", "baseUrl", "model", "promptTemplate", "candidateFilterPrompt"):
        if key in payload:
            settings[key] = str(payload.get(key) or "").strip()
    if "candidateFilterEnabled" in payload:
        settings["candidateFilterEnabled"] = bool(payload.get("candidateFilterEnabled"))

    if "apiKey" in payload:
        api_key = str(payload.get("apiKey") or "").strip()
        if is_masked_existing_secret(api_key, existing.get("apiKey")):
            pass
        elif api_key:
            settings["apiKey"] = api_key
        else:
            settings.pop("apiKey", None)
    elif payload.get("clearApiKey"):
        settings.pop("apiKey", None)

    if not settings.get("promptTemplate"):
        settings["promptTemplate"] = template_defaults.get("promptTemplate") or DEFAULT_RESEARCH_PROMPT
    if not settings.get("candidateFilterPrompt"):
        settings["candidateFilterPrompt"] = template_defaults.get("candidateFilterPrompt") or LLM_CANDIDATE_FILTER_PROMPT
    if not settings.get("baseUrl"):
        settings["baseUrl"] = template_defaults.get("baseUrl") or "https://api.deepseek.com"
    if not settings.get("model"):
        settings["model"] = template_defaults.get("model") or "deepseek-chat"
    settings["updatedAt"] = utc_now()
    atomic_write_json(llm_settings_path(username), encrypt_secret_fields(settings, LLM_SECRET_FIELDS))
    return load_llm_settings(username, include_key=True)


def chat_completions_url(base_url: str) -> str:
    base = str(base_url or "").rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    return base + "/chat/completions"


def build_research_user_prompt(
    trip: dict[str, Any],
    stop: dict[str, Any],
    articles: list[dict[str, Any]],
    keywords: list[str] | None = None,
    search_query: str = "",
) -> str:
    days = (trip.get("days") if isinstance(trip, dict) else []) or []
    trip_context = {
        "title": trip.get("title"),
        "subtitle": trip.get("subtitle"),
        "summary": trip.get("summary"),
        "days": [
            {
                "day": day.get("day"),
                "title": day.get("title"),
                "stay": day.get("stay"),
            }
            for day in days[:14]
            if isinstance(day, dict)
        ],
    }
    compact_articles = []
    for article in articles[:8]:
        compact_articles.append({
            "title": article.get("title") or article.get("url"),
            "url": article.get("url"),
            "source": article.get("source", ""),
            "snippet": article.get("snippet", ""),
            "text": str(article.get("text") or "")[:MAX_ARTICLE_TEXT_CHARS],
        })

    return json.dumps({
        "searchQuery": search_query,
        "selectedAndInputKeywords": keywords or [],
        "birdPoint": stop,
        "tripContext": trip_context,
        "articles": compact_articles,
    }, ensure_ascii=False, indent=2)


def normalize_research_prompt_template(prompt: str) -> str:
    text = str(prompt or "").strip()
    if not text:
        return DEFAULT_RESEARCH_PROMPT
    old_json_markers = ("请严格输出 JSON", "输出结构", '"overview"', '"targetBirds"')
    if any(marker in text for marker in old_json_markers):
        return DEFAULT_RESEARCH_PROMPT
    return text


def normalize_llm_candidate_filter_prompt(prompt: str) -> str:
    text = str(prompt or "").strip()
    return text or LLM_CANDIDATE_FILTER_PROMPT


def auth_token_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(os.environ.get("BIRDROUTE_SECRET_KEY") or load_secret_key(), salt=AUTH_TOKEN_SALT)


def make_auth_token(username: str) -> str:
    return auth_token_serializer().dumps({"username": normalize_username(username)})


def username_from_auth_token(token: str) -> str:
    try:
        data = auth_token_serializer().loads(token, max_age=AUTH_TOKEN_MAX_AGE_SECONDS)
    except (BadSignature, SignatureExpired):
        return ""
    if not isinstance(data, dict):
        return ""
    username = normalize_username(str(data.get("username") or ""))
    if not username:
        return ""
    users = users_db()
    return username if username in users else ""


def call_llm_json(settings: dict[str, Any], system_prompt: str, user_prompt: str) -> dict[str, Any]:
    api_key = str(settings.get("apiKey") or "")
    if not api_key:
        raise ValueError("请先保存大模型 API Key。")

    payload = {
        "model": settings.get("model") or "deepseek-chat",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
    }

    req = Request(
        chat_completions_url(str(settings.get("baseUrl") or "https://api.deepseek.com")),
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(req, timeout=60) as res:
            data = json.loads(res.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise ValueError(f"LLM API 返回 HTTP {exc.code}: {detail[:500]}") from exc
    except URLError as exc:
        raise ValueError(f"LLM API 连接失败：{exc.reason}") from exc

    content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
    if not content:
        raise ValueError("LLM API 没有返回内容。")

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", content, flags=re.S)
        parsed = json.loads(match.group(0)) if match else {"raw": content}

    return {
        "summary": parsed,
        "raw": content,
        "model": payload["model"],
        "updatedAt": utc_now(),
    }


def call_llm_text(settings: dict[str, Any], system_prompt: str, user_prompt: str) -> dict[str, Any]:
    api_key = str(settings.get("apiKey") or "")
    if not api_key:
        raise ValueError("请先保存大模型 API Key。")

    payload = {
        "model": settings.get("model") or "deepseek-chat",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.25,
    }

    req = Request(
        chat_completions_url(str(settings.get("baseUrl") or "https://api.deepseek.com")),
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(req, timeout=90) as res:
            data = json.loads(res.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise ValueError(f"LLM API 返回 HTTP {exc.code}: {detail[:500]}") from exc
    except URLError as exc:
        raise ValueError(f"LLM API 连接失败：{exc.reason}") from exc

    content = str(data.get("choices", [{}])[0].get("message", {}).get("content", "")).strip()
    if not content:
        raise ValueError("LLM API 没有返回内容。")

    return {
        "summaryMarkdown": content,
        "markdown": content,
        "raw": content,
        "model": payload["model"],
        "updatedAt": utc_now(),
    }


LLM_CANDIDATE_FILTER_PROMPT = """你是观鸟旅行攻略搜索结果筛选器。你只判断搜索候选是否可能对用户查询的鸟点、观鸟路线、鸟种观察或实地攻略有帮助。

保留：
- 明确与观鸟、赏鸟、鸟类摄影、自然观察、保护区、湿地、鸟点路线、鸟种记录相关的文章或笔记。
- 微信公众号、小红书、个人博客、游记中提到具体地点、路线、季节、鸟种、交通或现场经验的候选。
- 标题或摘要信息不足但 URL/来源/片段显示它很可能是相关攻略的候选。

舍弃：
- 词典百科、软件/AI/GitHub、游戏、购物、餐饮、酒店、泛旅游页面。
- 只匹配地名，但完全没有观鸟、鸟类、自然观察或攻略线索的候选。
- 明显重复或低信息量页面。

请严格输出 JSON，不要输出 Markdown。最多保留 12 条，按相关性从高到低排序：
{"keep":[{"index":0,"reason":"保留原因"}]}"""


def compact_search_result_for_llm(index: int, item: dict[str, Any]) -> dict[str, Any]:
    return {
        "index": index,
        "source": str(item.get("source") or "")[:40],
        "provider": str(item.get("provider") or "")[:60],
        "title": str(item.get("title") or item.get("url") or "")[:220],
        "url": str(item.get("url") or "")[:520],
        "snippet": str(item.get("snippet") or "")[:800],
        "note_id": str(item.get("note_id") or item.get("noteId") or "")[:120],
    }


def llm_keep_entries(summary: Any) -> list[Any]:
    if isinstance(summary, list):
        return summary
    if not isinstance(summary, dict):
        return []
    for key in ("keep", "selected", "results", "items", "candidates"):
        value = summary.get(key)
        if isinstance(value, list):
            return value
    for key in ("indices", "indexes", "selectedIndexes", "selected_indices", "keepIndexes"):
        value = summary.get(key)
        if isinstance(value, list):
            return value
    return []


def llm_filter_search_results(llm_settings: dict[str, Any], query: str, results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not results:
        return []

    candidates = [compact_search_result_for_llm(index, item) for index, item in enumerate(results[:30])]
    user_prompt = json.dumps(
        {
            "query": query,
            "instruction": "请从候选搜索结果中筛选真正可能有用的观鸟攻略内容，只返回候选 index 和简短原因。",
            "candidates": candidates,
        },
        ensure_ascii=False,
        indent=2,
    )
    system_prompt = normalize_llm_candidate_filter_prompt(str(llm_settings.get("candidateFilterPrompt") or ""))
    response = call_llm_json(llm_settings, system_prompt, user_prompt)
    keep_entries = llm_keep_entries(response.get("summary"))

    selected: list[dict[str, Any]] = []
    seen_indexes: set[int] = set()
    for entry in keep_entries:
        reason = ""
        index_value: Any = entry
        if isinstance(entry, dict):
            index_value = entry.get("index", entry.get("idx", entry.get("candidateIndex")))
            reason = str(entry.get("reason") or entry.get("why") or "").strip()
        try:
            index = int(index_value)
        except (TypeError, ValueError):
            continue
        if index < 0 or index >= len(results) or index in seen_indexes:
            continue
        seen_indexes.add(index)
        item = dict(results[index])
        if reason:
            item["llmFilterReason"] = reason[:240]
        selected.append(item)
        if len(selected) >= 12:
            break

    return selected


def research_path(username: str, trip_id: str, stop_id: str) -> Path:
    return user_research_dir(username) / safe_record_id(trip_id) / f"{safe_record_id(stop_id)}.json"


def require_login() -> str | None:
    username = session.get("username")
    if isinstance(username, str) and username:
        return username
    auth_header = request.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer "):
        username = username_from_auth_token(auth_header[7:].strip())
        if username:
            return username
    return None


def api_error(message: str, status: int = 400):
    return jsonify({"ok": False, "error": message}), status


def create_app() -> Flask:
    ensure_dirs()
    app = Flask(__name__, static_folder=None)
    app.secret_key = os.environ.get("BIRDROUTE_SECRET_KEY") or load_secret_key()
    https_enabled = env_bool("BIRDROUTE_HTTPS", False)
    if env_bool("BIRDROUTE_TRUST_PROXY", False):
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE=os.environ.get("BIRDROUTE_SESSION_COOKIE_SAMESITE", "Lax"),
        SESSION_COOKIE_SECURE=env_bool("BIRDROUTE_SESSION_COOKIE_SECURE", https_enabled),
    )

    @app.after_request
    def add_local_dev_cors(response):
        origin = request.headers.get("Origin")
        allow_origin = None
        allowed_origins = configured_allowed_origins()
        if origin == "null":
            allow_origin = "null"
        elif origin and ("*" in allowed_origins or origin.rstrip("/") in allowed_origins):
            allow_origin = origin
        elif origin and re.match(r"^http://(127\.0\.0\.1|localhost)(:\d+)?$", origin):
            allow_origin = origin

        if allow_origin:
            response.headers["Access-Control-Allow-Origin"] = allow_origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Vary"] = "Origin"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, Accept, X-Requested-With, Authorization"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        if env_bool("BIRDROUTE_HSTS", https_enabled) and (request.is_secure or https_enabled):
            response.headers["Strict-Transport-Security"] = os.environ.get("BIRDROUTE_HSTS_VALUE", "max-age=31536000; includeSubDomains")
        return response

    @app.get("/")
    def index():
        return send_from_directory(BASE_DIR, "index.html")

    @app.get("/config.js")
    def frontend_config():
        return send_from_directory(BASE_DIR, "config.js")

    @app.get("/assets/<path:filename>")
    def frontend_assets(filename: str):
        return send_from_directory(BASE_DIR / "assets", filename)

    @app.get("/api/health")
    def health():
        return jsonify({"ok": True, "service": "BirdRoute backend", "time": utc_now()})

    @app.get("/api/me")
    def me():
        username = require_login()
        if not username:
            return jsonify({"ok": True, "authenticated": False})
        return jsonify({"ok": True, "authenticated": True, "user": {"username": username}})

    @app.post("/api/auth/register")
    def register():
        payload = request.get_json(silent=True) or {}
        username = normalize_username(payload.get("username", ""))
        password = str(payload.get("password") or "")

        if not validate_username(username):
            return api_error("用户名只能包含字母、数字、下划线和短横线，长度 3-32。")
        if len(password) < 6:
            return api_error("密码至少需要 6 位。")

        users = users_db()
        if username in users:
            return api_error("用户名已存在。", 409)

        users[username] = {
            "username": username,
            "passwordHash": generate_password_hash(password),
            "createdAt": utc_now(),
        }
        save_users_db(users)
        user_trips_dir(username).mkdir(parents=True, exist_ok=True)
        session["username"] = username
        return jsonify({"ok": True, "user": {"username": username}, "authToken": make_auth_token(username)})

    @app.post("/api/auth/login")
    def login():
        payload = request.get_json(silent=True) or {}
        username = normalize_username(payload.get("username", ""))
        password = str(payload.get("password") or "")

        users = users_db()
        user = users.get(username)
        if not user or not check_password_hash(str(user.get("passwordHash") or ""), password):
            return api_error("用户名或密码不正确。", 401)

        session["username"] = username
        return jsonify({"ok": True, "user": {"username": username}, "authToken": make_auth_token(username)})

    @app.post("/api/auth/logout")
    def logout():
        session.clear()
        return jsonify({"ok": True})

    @app.get("/api/trips")
    def trips_index():
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)
        return jsonify({
            "ok": True,
            "trips": list_user_trips(username),
            "defaultTripId": get_user_default_trip_id(username),
        })

    @app.put("/api/trips")
    def trips_replace():
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)

        payload = request.get_json(silent=True) or {}
        try:
            saved = replace_user_trips(username, payload.get("trips", []))
            default_trip_id = (
                set_user_default_trip_id(username, payload.get("defaultTripId"))
                if "defaultTripId" in payload
                else get_user_default_trip_id(username)
            )
        except ValueError as exc:
            return api_error(str(exc))
        return jsonify({"ok": True, "trips": saved, "defaultTripId": default_trip_id})

    @app.post("/api/trips")
    def trip_create():
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)

        payload = request.get_json(silent=True) or {}
        try:
            trip = save_user_trip(username, payload.get("trip", payload))
            default_trip_id = (
                set_user_default_trip_id(username, payload.get("defaultTripId"))
                if "defaultTripId" in payload
                else set_user_default_trip_id(username, trip["id"]) if payload.get("setDefaultTrip") else get_user_default_trip_id(username)
            )
        except ValueError as exc:
            return api_error(str(exc))
        return jsonify({"ok": True, "trip": trip, "defaultTripId": default_trip_id}), 201

    @app.get("/api/trips/<trip_id>")
    def trip_show(trip_id: str):
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)
        trip = get_user_trip(username, trip_id)
        if not trip:
            return api_error("行程不存在。", 404)
        return jsonify({"ok": True, "trip": trip})

    @app.put("/api/trips/<trip_id>")
    def trip_update(trip_id: str):
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)

        payload = request.get_json(silent=True) or {}
        trip = payload.get("trip", payload)
        if not isinstance(trip, dict):
            return api_error("trip must be an object")
        trip["id"] = safe_trip_id(trip_id)
        try:
            backup_info = backup_user_trip(username, trip_id, str(payload.get("backupReason") or "trip_update")) if payload.get("backupPrevious") else None
            saved = save_user_trip(username, trip)
            default_trip_id = (
                set_user_default_trip_id(username, payload.get("defaultTripId"))
                if "defaultTripId" in payload
                else set_user_default_trip_id(username, saved["id"]) if payload.get("setDefaultTrip") else get_user_default_trip_id(username)
            )
        except ValueError as exc:
            return api_error(str(exc))
        response = {"ok": True, "trip": saved, "defaultTripId": default_trip_id}
        if backup_info:
            response["backup"] = backup_info
        return jsonify(response)

    @app.delete("/api/trips/<trip_id>")
    def trip_delete(trip_id: str):
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)
        deleted = delete_user_trip(username, trip_id)
        if not deleted:
            return api_error("行程不存在。", 404)
        return jsonify({"ok": True, "defaultTripId": get_user_default_trip_id(username)})

    @app.get("/api/trips/<trip_id>/quick-info")
    def trip_quick_info_show(trip_id: str):
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)
        trip = get_user_trip(username, trip_id)
        if not trip:
            return api_error("行程不存在。", 404)
        return jsonify({"ok": True, **trip_quick_info_payload(trip)})

    @app.put("/api/trips/<trip_id>/quick-info")
    def trip_quick_info_update(trip_id: str):
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)
        payload = request.get_json(silent=True) or {}
        if not isinstance(payload, dict):
            return api_error("payload must be an object")
        data = save_trip_quick_info(username, trip_id, payload)
        if not data:
            return api_error("行程不存在。", 404)
        return jsonify({"ok": True, **data})

    @app.get("/api/public-trips/search")
    def public_trips_search():
        username = require_login() or ""
        query = str(request.args.get("q") or "").strip()
        try:
            limit = int(float(request.args.get("limit", "30")))
        except ValueError:
            limit = 30
        return jsonify({"ok": True, "results": search_public_trips(query, username, limit)})

    @app.post("/api/public-trips/import")
    def public_trip_import():
        username = require_login()
        payload = request.get_json(silent=True) or {}
        owner = str(payload.get("owner") or "").strip()
        trip_id = str(payload.get("tripId") or "").strip()
        if not owner or not trip_id:
            return api_error("请提供公开行程作者和行程 ID。")
        try:
            if username:
                trip = import_public_trip_for_user(username, owner, trip_id)
                persisted = True
            else:
                trip = build_public_trip_copy(owner, trip_id)
                persisted = False
        except ValueError as exc:
            return api_error(str(exc), 400)
        return jsonify({"ok": True, "trip": trip, "persisted": persisted, "source": {"owner": owner, "tripId": safe_trip_id(trip_id)}})

    @app.get("/api/llm/settings")
    def llm_settings_show():
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)
        return jsonify({"ok": True, "settings": public_llm_settings(load_llm_settings(username, include_key=True))})

    @app.put("/api/llm/settings")
    def llm_settings_update():
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)
        payload = request.get_json(silent=True) or {}
        if not isinstance(payload, dict):
            return api_error("settings must be an object")
        settings = save_llm_settings(username, payload)
        return jsonify({"ok": True, "settings": public_llm_settings(settings)})

    @app.delete("/api/llm/settings/api-key")
    def llm_settings_api_key_delete():
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)
        settings = save_llm_settings(username, {"clearApiKey": True})
        return jsonify({"ok": True, "settings": public_llm_settings(settings)})

    @app.post("/api/llm/test")
    def llm_test():
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)
        settings = load_llm_settings(username, include_key=True)
        try:
            result = call_llm_json(
                settings,
                "请只输出 JSON。",
                '{"task":"请返回 {\"ok\": true, \"message\": \"connected\"}"}',
            )
        except ValueError as exc:
            return api_error(str(exc), 400)
        return jsonify({"ok": True, "result": result.get("summary")})

    @app.get("/api/content-sources/settings")
    def content_sources_settings_show():
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)
        return jsonify({"ok": True, "settings": public_content_source_settings(load_content_source_settings(username, include_secrets=True))})

    @app.put("/api/content-sources/settings")
    def content_sources_settings_update():
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)
        payload = request.get_json(silent=True) or {}
        if not isinstance(payload, dict):
            return api_error("settings must be an object")
        settings = save_content_source_settings(username, payload)
        return jsonify({"ok": True, "settings": public_content_source_settings(settings)})

    @app.get("/api/api-credentials/settings")
    def api_credentials_show():
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)
        return jsonify({"ok": True, "settings": public_api_credentials(load_api_credentials(username, include_secrets=True))})

    @app.put("/api/api-credentials/settings")
    def api_credentials_update():
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)
        payload = request.get_json(silent=True) or {}
        if not isinstance(payload, dict):
            return api_error("settings must be an object")
        settings = save_api_credentials(username, payload)
        return jsonify({"ok": True, "settings": public_api_credentials(settings)})

    @app.get("/api/xiaohongshu/browser-session")
    def xiaohongshu_browser_session_show():
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)
        return jsonify({
            "ok": True,
            "status": {
                "running": False,
                "loggedIn": False,
                "environment": {
                    "ready": False,
                    "message": "小红书本机浏览器会话已迁移到用户电脑上的 xhs_helper.py，本后端不再启动 Chromium。",
                    "installHint": "在你的电脑运行：python xhs_helper.py",
                },
                "message": "请让前端连接 http://127.0.0.1:5127 的本地助手。",
            },
        })

    @app.post("/api/xiaohongshu/browser-session")
    def xiaohongshu_browser_session_start():
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)
        return api_error("小红书本机浏览器会话已迁移到本地助手。请在用户电脑运行 python xhs_helper.py，并由前端连接 127.0.0.1:5127。", 400)

    @app.delete("/api/xiaohongshu/browser-session")
    def xiaohongshu_browser_session_close():
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)
        return jsonify({
            "ok": True,
            "status": {
                "running": False,
                "loggedIn": False,
                "environment": {"ready": False, "message": "云后端没有本地浏览器会话。"},
                "message": "如需关闭浏览器，请在本地助手窗口关闭，或从前端连接本地助手后点击关闭。",
            },
        })

    @app.delete("/api/api-credentials/settings")
    def api_credentials_delete():
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)
        data = clear_all_api_secrets(username)
        return jsonify({"ok": True, **data})

    @app.post("/api/bird-mappings/lookup")
    def bird_mappings_lookup():
        payload = request.get_json(silent=True) or {}
        names = payload.get("names") or []
        if not isinstance(names, list):
            return api_error("names must be an array")
        mappings, missing = lookup_bird_mappings(names)
        return jsonify({"ok": True, "mappings": mappings, "missing": missing})

    @app.put("/api/bird-mappings")
    def bird_mappings_update():
        payload = request.get_json(silent=True) or {}
        mappings = payload.get("mappings") or []
        if not isinstance(mappings, list):
            return api_error("mappings must be an array")
        username = require_login() or ""
        saved = upsert_bird_mappings(mappings, str(payload.get("source") or "manual"), username)
        return jsonify({"ok": True, "mappings": saved})

    @app.post("/api/bird-mappings/resolve")
    def bird_mappings_resolve():
        payload = request.get_json(silent=True) or {}
        names_payload = payload.get("names") or []
        if not isinstance(names_payload, list):
            return api_error("names must be an array")
        names = []
        seen: set[str] = set()
        for raw_name in names_payload:
            name = normalize_bird_name(raw_name)
            key = normalize_bird_mapping_key(name)
            if name and key not in seen:
                seen.add(key)
                names.append(name)
        if not names:
            return api_error("请提供需要补全的鸟名。")

        method = str(payload.get("method") or "llm").strip().lower()
        if method != "llm":
            return api_error("鸟名映射补全只支持 LLM。", 400)

        username = require_login()
        if not username:
            return api_error("请先登录账号并保存 LLM API Key，再使用 LLM 补全。", 401)

        content_settings = load_content_source_settings(username, include_secrets=True)
        llm_settings = load_llm_settings(username, include_key=True)
        try:
            mappings = resolve_bird_mappings_by_llm(names, llm_settings, content_settings)
        except ValueError as exc:
            return api_error(str(exc), 400)
        return jsonify({"ok": True, "method": "llm", "mappings": mappings})

    @app.get("/api/geocode/search")
    def geocode_search():
        query = normalize_space(str(request.args.get("q") or ""))
        if not query:
            return api_error("请提供地点关键词 q。")
        if len(query) > 200:
            return api_error("地点关键词过长，请缩短后再查询。")
        try:
            limit = int(float(request.args.get("limit", "5")))
        except ValueError:
            limit = 5
        limit = max(1, min(limit, 10))
        try:
            payload = fetch_geocode_results(query, limit)
        except HTTPError as exc:
            return api_error(f"坐标查询服务返回 HTTP {exc.code}，请稍后再试。", 502)
        except Exception as exc:
            return api_error(f"坐标查询失败：{exc}", 502)
        return jsonify({
            "ok": True,
            "query": query,
            "limit": limit,
            **payload,
        })

    @app.get("/api/ebird/hotspots")
    def ebird_hotspots():
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)
        credentials = load_api_credentials(username, include_secrets=True)
        token = str(credentials.get("ebirdToken") or "").strip()
        if not token:
            return api_error("请先在账号 API 设置里保存 eBird API Token。", 400)
        try:
            lat = float(request.args.get("lat", ""))
            lng = float(request.args.get("lng", ""))
        except ValueError:
            return api_error("lat/lng 参数格式不正确。")
        if not -90 <= lat <= 90 or not -180 <= lng <= 180:
            return api_error("lat/lng 超出范围。")
        try:
            dist = int(float(request.args.get("dist", "50")))
        except ValueError:
            dist = 50
        dist = max(1, min(dist, 100))
        url = "https://api.ebird.org/v2/ref/hotspot/geo?" + urlencode({
            "lat": f"{lat:.6f}",
            "lng": f"{lng:.6f}",
            "fmt": "json",
            "dist": str(dist),
        })
        try:
            data = fetch_json_api(url, headers={"X-eBirdApiToken": token})
        except Exception as exc:
            return api_error(f"eBird 热点加载失败：{exc}", 502)
        return jsonify({"ok": True, "hotspots": data if isinstance(data, list) else []})

    @app.get("/api/ebird/token-status")
    def ebird_token_status():
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)
        credentials = load_api_credentials(username, include_secrets=True)
        token = str(credentials.get("ebirdToken") or "").strip()
        if not token:
            return jsonify({"ok": True, "hasToken": False, "valid": False})
        url = "https://api.ebird.org/v2/ref/hotspot/geo?" + urlencode({
            "lat": "0.000000",
            "lng": "0.000000",
            "fmt": "json",
            "dist": "1",
        })
        try:
            fetch_json_api(url, headers={"X-eBirdApiToken": token})
        except Exception as exc:
            return jsonify({
                "ok": True,
                "hasToken": True,
                "valid": False,
                "error": str(exc),
            })
        return jsonify({"ok": True, "hasToken": True, "valid": True})

    @app.get("/api/ebird/hotspot-species")
    def ebird_hotspot_species():
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)
        credentials = load_api_credentials(username, include_secrets=True)
        token = str(credentials.get("ebirdToken") or "").strip()
        if not token:
            return api_error("请先在账号 API 设置里保存 eBird API Token。", 400)

        loc_id = str(request.args.get("locId") or "").strip()
        if not re.match(r"^L\d+$", loc_id):
            return api_error("locId 参数格式不正确。")

        target_date = parse_iso_date(request.args.get("date") or "")
        if not target_date:
            return api_error("请提供活动日期 date=YYYY-MM-DD。")

        try:
            years = int(float(request.args.get("years", "2")))
        except ValueError:
            years = 2
        try:
            day_window = int(float(request.args.get("window", "7")))
        except ValueError:
            day_window = 7
        years = max(1, min(years, 5))
        day_window = max(0, min(day_window, 14))

        try:
            payload = fetch_ebird_hotspot_species(token, loc_id, target_date, years, day_window)
        except Exception as exc:
            return api_error(f"eBird 热点鸟种查询失败：{exc}", 502)
        saved_mappings = upsert_ebird_species_mappings(payload.get("species") or [], username, loc_id)

        return jsonify({
            "ok": True,
            "locId": loc_id,
            "targetDate": target_date.isoformat(),
            "years": years,
            "window": day_window,
            "locale": "zh_SIM",
            "mappings": saved_mappings,
            "mappingsSaved": len(saved_mappings),
            **payload,
        })

    @app.get("/api/xeno-canto/recordings")
    def xeno_canto_recordings():
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)
        query = str(request.args.get("query") or "").strip()
        if not query:
            return api_error("请提供 query。")
        credentials = load_api_credentials(username, include_secrets=True)
        token = str(credentials.get("xcToken") or "").strip()
        errors: list[str] = []
        if token:
            try:
                data = fetch_json_api(
                    "https://xeno-canto.org/api/3/recordings?" + urlencode({"query": query, "key": token}),
                    timeout=15,
                )
                return jsonify({"ok": True, "data": data, "apiUsed": "API v3 + key"})
            except Exception as exc:
                errors.append(f"API v3: {exc}")
        try:
            data = fetch_json_api(
                "https://xeno-canto.org/api/2/recordings?" + urlencode({"query": query}),
                timeout=15,
            )
            return jsonify({"ok": True, "data": data, "apiUsed": "API v2 fallback", "errors": errors})
        except Exception as exc:
            errors.append(f"API v2: {exc}")
            return api_error("xeno-canto 查询失败：" + " / ".join(errors), 502)

    @app.post("/api/research/search")
    def research_search():
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)
        payload = request.get_json(silent=True) or {}
        query = str(payload.get("query") or "").strip()
        sources = payload.get("sources") or ["wechat", "xiaohongshu", "blog", "web"]
        if not query:
            return api_error("请提供搜索关键词。")
        if not isinstance(sources, list):
            sources = ["web"]

        results: list[dict[str, Any]] = []
        errors: list[str] = []
        content_settings = load_content_source_settings(username, include_secrets=True)
        llm_public_settings = load_llm_settings(username, include_key=False)
        use_llm_filter = bool(llm_public_settings.get("candidateFilterEnabled"))
        search_settings = dict(content_settings)
        search_settings["llmCandidateFilter"] = use_llm_filter
        for source in sources[:4]:
            source_name = str(source)
            try:
                xhs = search_settings.get("xiaohongshu") if isinstance(search_settings.get("xiaohongshu"), dict) else {}
                wechat = search_settings.get("wechat") if isinstance(search_settings.get("wechat"), dict) else {}
                if source_name == "xiaohongshu" and xhs.get("mode") == "local_browser_experimental":
                    errors.append("xiaohongshu: 本地浏览器助手模式由前端直连 xhs_helper.py 处理，云后端不会启动 Chromium。")
                    continue
                else:
                    use_raw_query = (
                        source_name == "xiaohongshu" and xhs.get("mode") in {"third_party", "open_platform"}
                    ) or (
                        source_name == "wechat" and wechat.get("mode") == "sogou_weixin"
                    )
                    provider_query = query if use_raw_query else source_query(query, source_name)
                    source_results = search_with_content_provider(provider_query, source_name, search_settings)
                    if not use_llm_filter:
                        source_results = filter_relevant_search_results(provider_query, source_name, source_results)
                    results.extend(source_results)
            except Exception as exc:
                errors.append(f"{source_name}: {exc}")

        seen: set[str] = set()
        unique: list[dict[str, Any]] = []
        unique_limit = 30 if use_llm_filter else 20
        for item in results:
            url = item.get("url")
            if not url or url in seen:
                continue
            seen.add(url)
            unique.append(item)
            if len(unique) >= unique_limit:
                break

        filter_mode = "rules"
        if use_llm_filter:
            try:
                llm_settings = load_llm_settings(username, include_key=True)
                unique = llm_filter_search_results(llm_settings, query, unique)
                filter_mode = "llm"
            except Exception as exc:
                errors.append(f"llm_filter: {exc}")
                fallback: list[dict[str, Any]] = []
                for item in unique:
                    source_name = str(item.get("source") or "web")
                    fallback.extend(filter_relevant_search_results(query, source_name, [item]))
                unique = fallback[:20]
                filter_mode = "rules_fallback"
        else:
            unique = unique[:20]

        return jsonify({"ok": True, "results": unique, "errors": errors, "filter": filter_mode})

    @app.post("/api/research/ingest-url")
    def research_ingest_url():
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)
        payload = request.get_json(silent=True) or {}
        url = str(payload.get("url") or "").strip()
        incoming_article = payload.get("article") if isinstance(payload.get("article"), dict) else {}
        if not url:
            url = str(incoming_article.get("url") or "").strip()
        note_id = str(incoming_article.get("note_id") or incoming_article.get("noteId") or "").strip()
        if not note_id and url:
            note_id = extract_note_id_from_url(url)
        if not url and note_id:
            url = f"https://www.xiaohongshu.com/explore/{note_id}"
        if not url:
            return api_error("请提供文章 URL。")
        try:
            provider = str(incoming_article.get("provider") or "")
            source_name = str(incoming_article.get("source") or "")
            content_settings = load_content_source_settings(username, include_secrets=True)
            xhs = content_settings.get("xiaohongshu") if isinstance(content_settings.get("xiaohongshu"), dict) else {}
            if provider == "xhs_local_browser":
                return api_error("小红书本地浏览器正文请通过前端连接 xhs_helper.py 抓取，云后端不会启动 Chromium。", 400)
            elif provider == "rnote" or (source_name == "xiaohongshu" and note_id and xhs.get("mode") == "third_party"):
                article = fetch_rnote_note_detail(content_settings, note_id, str(incoming_article.get("note_type") or incoming_article.get("noteType") or ""), url)
            elif provider == "xhs_official" or (source_name == "xiaohongshu" and note_id and xhs.get("mode") == "open_platform"):
                article = fetch_xhs_official_note_detail(content_settings, note_id, url)
            elif provider == "sogou_weixin":
                article = ingest_sogou_wechat_article(url)
            else:
                article = ingest_article_url(url)
        except Exception as exc:
            return api_error(f"文章抓取失败：{exc}", 400)
        return jsonify({"ok": True, "article": article})

    @app.post("/api/research/summarize")
    def research_summarize():
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)
        payload = request.get_json(silent=True) or {}
        trip = payload.get("trip") or {}
        stop = payload.get("stop") or {}
        articles = payload.get("articles") or []
        raw_keywords = payload.get("keywords") or []
        keywords = [str(item).strip() for item in raw_keywords if str(item).strip()] if isinstance(raw_keywords, list) else []
        search_query = str(payload.get("searchQuery") or payload.get("query") or "").strip()
        if not isinstance(trip, dict) or not isinstance(stop, dict) or not isinstance(articles, list):
            return api_error("trip、stop 和 articles 格式不正确。")
        if not articles:
            return api_error("请至少提供一篇文章或候选链接。")

        settings = load_llm_settings(username, include_key=True)
        prompt_template = normalize_research_prompt_template(str(settings.get("promptTemplate") or DEFAULT_RESEARCH_PROMPT))
        try:
            result = call_llm_text(settings, prompt_template, build_research_user_prompt(trip, stop, articles, keywords, search_query))
        except ValueError as exc:
            return api_error(str(exc), 400)

        return jsonify({"ok": True, "result": result})

    @app.get("/api/trips/<trip_id>/research/<stop_id>")
    def trip_research_show(trip_id: str, stop_id: str):
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)
        data = read_json(research_path(username, trip_id, stop_id), {})
        return jsonify({"ok": True, "research": data if isinstance(data, dict) else {}})

    @app.put("/api/trips/<trip_id>/research/<stop_id>")
    def trip_research_update(trip_id: str, stop_id: str):
        username = require_login()
        if not username:
            return api_error("请先登录。", 401)
        payload = request.get_json(silent=True) or {}
        data = {
            "tripId": safe_record_id(trip_id),
            "stopId": safe_record_id(stop_id),
            "stopName": payload.get("stopName", ""),
            "query": payload.get("query", ""),
            "keywords": payload.get("keywords", []),
            "articles": payload.get("articles", []),
            "summary": payload.get("summary", {}),
            "summaryMarkdown": payload.get("summaryMarkdown", ""),
            "updatedAt": utc_now(),
        }
        atomic_write_json(research_path(username, trip_id, stop_id), data)
        return jsonify({"ok": True, "research": data})

    return app


app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="127.0.0.1", port=port, debug=debug, use_reloader=False, ssl_context=ssl_context_from_env())
