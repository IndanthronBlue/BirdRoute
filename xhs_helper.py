from __future__ import annotations

import os
from typing import Any
from urllib.parse import urlparse

from flask import Flask, jsonify, request

from app import (
    close_xhs_browser_session,
    get_xhs_browser_session,
    normalize_username,
    xhs_browser_environment_status,
    xhs_browser_read_note,
    xhs_browser_search,
    xhs_browser_status,
)


DEFAULT_ALLOWED_ORIGINS = {
    "https://indanthronblue.github.io",
    "http://127.0.0.1:5000",
    "http://localhost:5000",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "null",
}


def configured_allowed_origins() -> set[str]:
    raw = os.environ.get("BIRDROUTE_XHS_HELPER_ALLOWED_ORIGINS", "")
    values = {origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()}
    return DEFAULT_ALLOWED_ORIGINS | values


def origin_allowed(origin: str) -> bool:
    if not origin:
        return True
    normalized = origin.rstrip("/")
    if normalized in configured_allowed_origins():
        return True
    parsed = urlparse(normalized)
    return parsed.scheme in {"http", "https"} and parsed.hostname in {"127.0.0.1", "localhost", "::1"}


def json_error(message: str, status: int = 400):
    response = jsonify({"ok": False, "error": message})
    response.status_code = status
    return response


def request_payload() -> dict[str, Any]:
    payload = request.get_json(silent=True)
    return payload if isinstance(payload, dict) else {}


def helper_username(payload: dict[str, Any] | None = None) -> str:
    payload = payload or {}
    username = normalize_username(
        str(
            payload.get("username")
            or request.args.get("username")
            or os.environ.get("BIRDROUTE_XHS_HELPER_USER")
            or "local"
        )
    )
    return username or "local"


app = Flask(__name__)


@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        return ("", 204)
    return None


@app.after_request
def add_cors_headers(response):
    origin = request.headers.get("Origin", "")
    if origin_allowed(origin):
        response.headers["Access-Control-Allow-Origin"] = origin if origin else "*"
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Methods"] = "GET,POST,DELETE,OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type,Accept"
        response.headers["Access-Control-Allow-Private-Network"] = "true"
        response.headers["Access-Control-Max-Age"] = "86400"
    return response


@app.get("/")
def index():
    return jsonify({
        "ok": True,
        "name": "BirdRoute XHS Local Helper",
        "message": "本服务只监听 127.0.0.1，用于让 BirdRoute 前端调用本机 Playwright 浏览器会话。",
        "endpoints": [
            "GET /api/health",
            "GET /api/xiaohongshu/browser-session",
            "POST /api/xiaohongshu/browser-session",
            "DELETE /api/xiaohongshu/browser-session",
            "POST /api/xiaohongshu/search",
            "POST /api/xiaohongshu/read-note",
        ],
    })


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "service": "birdroute-xhs-helper"})


@app.get("/api/xiaohongshu/browser-session")
def browser_session_show():
    username = helper_username()
    return jsonify({"ok": True, "status": xhs_browser_status(username)})


@app.post("/api/xiaohongshu/browser-session")
def browser_session_start():
    payload = request_payload()
    username = helper_username(payload)
    try:
        worker = get_xhs_browser_session(username, create=True)
        status = worker.call("ensure_home", timeout=60)
    except Exception as exc:
        environment = xhs_browser_environment_status()
        return json_error(
            "启动小红书本地浏览器助手失败："
            + str(exc)
            + "。请确认是在有桌面环境的本机运行 python xhs_helper.py，并已执行 python -m playwright install chromium。",
            400,
        )
    status["environment"] = status.get("environment") or {"ready": True, "message": "本地浏览器助手已连接。"}
    return jsonify({"ok": True, "status": status})


@app.delete("/api/xiaohongshu/browser-session")
def browser_session_close():
    username = helper_username(request_payload())
    close_xhs_browser_session(username)
    return jsonify({"ok": True, "status": xhs_browser_status(username)})


@app.post("/api/xiaohongshu/search")
def browser_search():
    payload = request_payload()
    username = helper_username(payload)
    query = str(payload.get("query") or "").strip()
    if not query:
        return json_error("请提供搜索关键词。")
    try:
        limit = int(payload.get("limit") or 12)
    except Exception:
        limit = 12
    try:
        results = xhs_browser_search(username, query, max(1, min(limit, 30)))
    except Exception as exc:
        return json_error(f"小红书本地浏览器搜索失败：{exc}", 400)
    return jsonify({"ok": True, "results": results})


@app.post("/api/xiaohongshu/read-note")
def browser_read_note():
    payload = request_payload()
    username = helper_username(payload)
    url = str(payload.get("url") or "").strip()
    if not url:
        return json_error("请提供小红书笔记 URL。")
    try:
        article = xhs_browser_read_note(username, url)
    except Exception as exc:
        return json_error(f"小红书本地浏览器正文抓取失败：{exc}", 400)
    return jsonify({"ok": True, "article": article})


if __name__ == "__main__":
    port = int(os.environ.get("BIRDROUTE_XHS_HELPER_PORT", "5127"))
    print(f"BirdRoute XHS local helper running at http://127.0.0.1:{port}")
    print("Keep this window open while using the XHS local browser mode.")
    app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False)
