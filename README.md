# BirdRoute

![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Web%20%2B%20Flask-blue)
![Focus](https://img.shields.io/badge/focus-Birding-brightgreen)

BirdRoute 是一个面向观鸟旅行的本地优先行程规划工具。它把观鸟行程、地图路线、目标鸟种、鸟种预习、野外 checklist、攻略文章检索与 AI 总结放在同一个工作台里，适合在出行前整理鸟点，也适合在行程中记录和导出数据。

项目由一个前端单页应用、一个轻量 Flask 后端，以及一个可选的用户本机浏览器助手组成。前端负责交互和地图展示，后端负责账号、本地文件存储、API Key 加密、公开行程检索、鸟名映射、文章抓取和 LLM 调用；本机浏览器助手用于处理必须依赖用户本地浏览器环境的小红书登录、搜索和正文抓取。

## 功能概览

- 多行程管理：按天组织活动，支持鸟点、住宿、交通、机场和普通活动。
- 地图规划：Leaflet 地图、路线连线、地图点击新增活动、地理编码、Google/高德/百度/OpenStreetMap 导航入口。
- 观鸟字段：鸟点可维护目标鸟种、交通、备注、费用区间。
- 鸟种预习：基于中文名、英文名、学名检索图片和 xeno-canto 鸟声。
- 全局鸟名映射：鸟名映射保存在后端全局表中，导入或保存鸟点时会校验中英文/学名映射。
- LLM 鸟名补全：缺失映射时可手动填写，或使用已配置的 LLM 批量补全并确认后写回全局映射表。
- Checklist：按天汇总目标鸟种，支持勾选已见、导出 checklist JSON。
- 预算统计：按活动维护最低/最高费用，并汇总行程预算。
- JSON 导入导出：支持导入单个或多个行程；导入会追加到当前账号/游客会话，不覆盖已有行程。
- 公开行程检索：登录用户可将原创行程设为公开；其他用户或游客可按行程名、地点、属性、目标鸟种等搜索并导入。
- 私有副本保护：从公开行程导入的副本默认私有，未修改前不能重新开放检索。
- 鸟点攻略文章：按鸟点关键词检索微信公众号、小红书、博客和网页候选文章，抓取正文，调用 AI 生成攻略文案。
- 内容源设置：支持 HTML 搜索、Brave、Bing API、SerpAPI、Tavily、搜狗微信、小红书第三方接口和小红书本地浏览器助手。
- LLM 设置：集中管理攻略总结、搜索结果筛选、鸟名映射相关的模型配置和提示词。
- 游客模式：可以临时规划、搜索公开行程、导入导出 JSON；游客行程不写入浏览器缓存。
- 本地账号模式：行程和设置写入本机 `backend_data/users/<username>/`。

## 项目结构

```text
BirdRoute/
├─ app.py                 # Flask 后端
├─ xhs_helper.py          # 可选：用户本机小红书浏览器助手
├─ index.html             # 前端单页应用
├─ config.js              # 前端部署配置，不在页面里暴露后端地址输入框
├─ requirements.txt       # Python 依赖
├─ example/               # 示例行程 JSON
├─ backend_data/          # 本地运行时数据，默认不提交
├─ .gitignore
├─ LICENSE
└─ README.md
```

`backend_data/` 是运行时目录，包含用户、行程、加密后的 API Key、鸟名映射、攻略文章缓存和公共设置模板。开源仓库不应该提交这个目录。

## 快速开始

### 1. 创建虚拟环境

Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

macOS/Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

如果要使用“小红书本地浏览器助手”，还需要在用户自己的电脑安装 Playwright 浏览器：

```bash
python -m playwright install chromium
```

启动本地助手：

```bash
python xhs_helper.py
```

保持这个窗口打开，然后在 BirdRoute 设置里选择“小红书 / 本地浏览器助手”。前端会连接 `http://127.0.0.1:5127`，让用户自己电脑上的 Chromium 处理小红书登录、搜索和正文抓取；云服务器后端不会启动浏览器。

### 2. 启动后端

```bash
python app.py
```

默认服务地址：

```text
http://127.0.0.1:5000
```

浏览器打开上面的地址即可使用。首次使用可以在页面里注册账号，也可以进入游客模式。

### 3. 前后端分离部署

前端通过 `config.js` 读取部署地址。页面里不会提供“后端链接”输入框，避免把内部服务地址变成用户可随意修改的运行时配置。常见配置：

```js
window.BIRDROUTE_CONFIG = {
  apiBase: "",
  localApiBase: "http://127.0.0.1:5000",
  xhsHelperBase: "http://127.0.0.1:5127"
};
```

- 同源部署：`apiBase` 留空。
- 前后端分离：把 `apiBase` 改成后端地址，例如 `https://api.example.com`。
- 本地开发：保持 `apiBase` 为空，前端在 `file://` 或 localhost 下会自动连接 `localApiBase`。
- 小红书本地浏览器助手：默认连接 `xhsHelperBase`，该服务只应监听 `127.0.0.1`。
- 不要把 API Key、Token、密码写进 `config.js`。这些内容应该保存在登录用户自己的后端设置里。

后端跨域可通过环境变量配置：

```bash
BIRDROUTE_ALLOWED_ORIGINS=https://your-frontend.example.com
```

后端端口可通过环境变量配置：

```bash
PORT=5000
```

## 推荐部署方式

### 方案 A：本地单机运行

适合自己使用或开发调试：

```bash
python app.py
```

然后访问：

```text
http://127.0.0.1:5000
```

如果要使用小红书本地浏览器助手，另开一个终端：

```bash
python xhs_helper.py
```

### 方案 B：GitHub Pages 前端 + 云服务器后端

适合公开在线体验。前端放在 GitHub Pages，后端部署到自己的服务器。没有域名时，可以使用 `sslip.io` 这类把 IP 映射成域名的服务，例如：

```text
https://<your-ip>.sslip.io
```

`config.js` 示例：

```js
window.BIRDROUTE_CONFIG = {
  apiBase: "https://<your-ip>.sslip.io",
  localApiBase: "http://127.0.0.1:5000",
  xhsHelperBase: "http://127.0.0.1:5127"
};
```

云服务器上建议用 systemd 托管 Flask 后端，并用 Nginx 反向代理到 `127.0.0.1:5000`。后端的 CORS 允许来源应配置成你的 GitHub Pages 地址：

```bash
BIRDROUTE_ALLOWED_ORIGINS=https://<your-github-user>.github.io
```

后端只负责普通搜索、正文抓取、LLM、账号和数据存储；小红书本地浏览器助手仍然运行在访问者自己的电脑上。

### 方案 C：小红书本地浏览器助手

小红书登录态、验证码和浏览器环境通常无法稳定放到云服务器里运行。因此 BirdRoute 把这部分拆成一个只监听 `127.0.0.1` 的本地小服务。

用户自己的电脑需要运行：

```bash
pip install -r requirements.txt
python -m playwright install chromium
python xhs_helper.py
```

前端页面会通过 `xhsHelperBase` 连接这个本地服务。这样即使前端来自 GitHub Pages、后端来自云服务器，小红书搜索和正文抓取也仍然可以使用用户本机浏览器完成。

## 数据与隐私

BirdRoute 是本地优先工具。账号模式下，数据默认写入：

```text
backend_data/users/<username>/
├─ trips/                 # 每个行程一个 JSON
├─ settings/              # LLM、内容源、API 凭据设置
├─ research/              # 鸟点攻略文章和 AI 总结
└─ browser_profiles/      # 小红书本地浏览器助手资料
```

全局鸟名映射位于：

```text
backend_data/bird_name_mappings.json
```

公共默认设置模板位于：

```text
backend_data/settings_template.json
```

注意：`settings_template.json` 只应该保存公共默认配置和提示词，不能写入任何 API Key、Token 或密码。API Key 会保存在用户设置里，并通过 `backend_data/.secrets_key` 加密。

建议不要提交：

```text
backend_data/
.venv/
__pycache__/
*.pyc
```

## 行程与社交功能

登录后，每个行程可以设置为：

- 私有：仅自己可见。
- 公开：可被其他用户或游客搜索。

行程支持地点、属性和简介等元数据。地点标签和鸟种标签会从行程内容中自动抽取并去重，用于公开检索。

公开行程可以被其他用户导入为私有副本。为了避免复制内容污染公开检索，导入副本默认私有；如果用户未在副本基础上修改，就不能重新设为公开。

游客也可以搜索公开行程并导入，但游客行程只保存在当前页面内存中，离开前需要导出 JSON。

## 鸟名映射

BirdRoute 不把鸟名表硬编码在前端。鸟名映射由后端全局维护，结构包含：

- 中文名
- 英文名
- 学名
- 原始输入名
- 来源和置信度

新增鸟点、导入 JSON 或构建 checklist 时，会先识别鸟名语言，再查后端映射。缺少映射时可以：

- 手动填写；
- 使用 LLM 补全；
- 确认后写回全局映射表。

这样可以避免把英文名误写进中文名字段，也能让鸟种预习和 checklist 稳定显示中文名。

## 鸟点攻略文章

每个鸟点都可以打开“攻略文章”面板。入口包括：

- 左侧行程卡片里的“攻略文章”按钮；
- 地图上鸟点 popup 底部的“攻略文章”按钮。

流程：

1. 根据鸟点名称、地点和目标鸟种生成关键词。
2. 检索微信公众号、小红书、博客和网页候选文章。
3. 可抓取候选文章正文或手动粘贴链接抓取。
4. 可用 LLM 筛选候选文章。
5. 可用 LLM 生成中文 Markdown 攻略。
6. 用户确认后保存到后端。

正文抓取支持常见网页、微信公众号文章、小红书第三方接口/本地浏览器助手，并会处理部分搜索引擎跳转链接。微信公众号文章会优先解析正文容器，搜狗等搜索结果链接会先解析真实目标页，尽量避免把跳转页当成正文页。

调用正文抓取或 AI 总结时，前端会显示进度转圈和进度条，避免用户误以为页面卡住。

## LLM 设置

当前有三处使用 LLM：

- 搜索候选内容筛选；
- 攻略文章总结；
- 鸟名映射补全。

这些设置集中在同一个 LLM 设置区域，包括：

- Provider
- Base URL
- Model
- API Key
- 攻略总结提示词
- 搜索结果筛选提示词

API Key 不会写入公共模板文件。公共模板只用于给新账号提供默认模型、默认提示词和默认内容源设置。

## 外部服务

BirdRoute 可以接入以下外部服务：

- eBird Hotspot API：加载当前地图范围内的 eBird 热点。
- xeno-canto：查询鸟声；可选 API Key。
- Wikimedia Commons：鸟种图片候选。
- Nominatim：地理编码。
- Brave Search / Bing Web Search / SerpAPI / Tavily：网页搜索。
- 搜狗微信搜索：微信公众号候选文章。
- 小红书第三方接口或本地浏览器助手。
- OpenAI-compatible LLM API：用于总结、筛选和鸟名补全。

不同服务可能有使用条款、频率限制、反爬限制或 CORS 限制。请自行确认授权范围和接口限额。

## 示例数据

`example/` 目录包含可导入的观鸟行程 JSON，例如：

- 台湾观鸟 8 天行程
- 冰岛观鸟行程

在页面中点击“导入 JSON”即可导入。导入时会追加为新行程，并校验目标鸟种映射。

## 常见问题

### 为什么游客模式不保存行程？

游客模式用于临时试用和导入导出。为避免误以为数据已持久化，游客行程只保存在当前页面内存中。需要保留时请导出 JSON，或注册/登录账号。

### 为什么公开副本不能直接再次公开？

从公开行程导入的内容默认是别人的公开行程副本。只有在副本基础上做过修改后，才允许重新设为公开，避免重复复制污染公开检索结果。

### 搜索或抓正文失败怎么办？

搜索引擎和内容平台可能触发验证码、反爬或限流。可以换关键词、换内容源、手动粘贴文章链接，或配置第三方搜索 API。

### GitHub Pages 可以读取同仓库里的配置文件吗？

可以。只要 `index.html` 正常引用 `config.js`，GitHub Pages 会把它作为静态文件一起发布。修改 `config.js` 后如果页面仍然使用旧配置，可以强制刷新浏览器或等待 CDN 缓存更新。

### 为什么小红书浏览器助手不直接放在云服务器？

小红书依赖登录态、验证码和真实浏览器环境。云服务器通常没有图形界面，也更容易触发风控。BirdRoute 因此把小红书浏览器会话拆到用户自己的电脑上运行，云后端只保存配置和处理通用任务。

## 技术栈

- HTML / CSS / Vanilla JavaScript
- Leaflet / OpenStreetMap
- Flask
- cryptography
- Playwright（可选，用于小红书本地浏览器助手）
- OpenAI-compatible Chat Completions API

## 开发提示

启动开发服务：

```bash
python app.py
```

检查 Python 语法：

```bash
python -m py_compile app.py
```

如果改动前端，可直接刷新浏览器。项目没有前端构建步骤。

## Roadmap

- GPX / KML 导入导出
- eBird observation 导入
- 离线地图缓存
- PWA 支持
- 更完整的鸟种资料源
- 统计报表
- 多语言界面
- 多人协作与评论

## Contributing

欢迎提交 Issue、Feature Request 和 Pull Request。适合贡献的方向包括：

- Bug 修复
- 内容源适配
- 鸟种资料增强
- UI/UX 改进
- 示例行程
- 文档与部署说明

## License

MIT
