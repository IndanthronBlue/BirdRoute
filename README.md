# BirdRoute

![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Web%20%2B%20Flask-blue)
![Focus](https://img.shields.io/badge/focus-Birding-brightgreen)

BirdRoute 是一个面向观鸟旅行的行程规划工具。它把路线、鸟点、目标鸟种、eBird 热点、鸟鸣预习、预算、攻略文章、Checklist、公开行程检索和 JSON 数据管理放在同一个工作台里，适合出发前规划，也适合旅行途中记录和整理。

这个项目目前是一个小成本 demo / 个人工具型项目，不是高安全、高并发的生产级 SaaS。它更适合个人、小团队、观鸟旅行规划、野外调查前期整理和开源交流。如果要开放给大量用户使用，请自行补充更严格的鉴权、限流、日志、备份、监控和生产级 WSGI 部署。

## 在线体验

- GitHub: https://github.com/IndanthronBlue/BirdRoute
- GitHub Pages: https://indanthronblue.github.io/BirdRoute/

前端可以托管在 GitHub Pages；后端是轻量 Flask API，需要部署在你自己的服务器或本机。小红书相关的浏览器会话能力独立为用户本机小助手，默认只连接 `127.0.0.1:5127`。

## 核心功能

### 行程管理

- 支持多个行程。
- 行程包含名称、简介、地点、属性、起止日期、公开/私有状态。
- 属性可用于区分休闲、猛推等不同旅行风格。
- 每个行程按天组织，每天包含多个活动。
- 活动类型包括鸟点、住宿、交通、机场、普通活动等。
- 支持修改当前行程、删除当前行程、导入 JSON、导出 JSON。
- 登录账号后，行程保存到后端本地目录 `backend_data/users/<username>/trips/`。
- 游客模式不写入浏览器缓存，离开页面前需要导出 JSON。

### 地图与路线

- 使用 Leaflet / OpenStreetMap 显示行程地图。
- 支持地图点击新增活动。
- 支持鸟点、住宿、交通等不同类型标记。
- 支持路线连线和每天活动顺序展示。
- 支持地址/坐标查询，后端代理并带缓存，减少直接暴露第三方请求。
- 活动弹窗提供“在地图打开”和“攻略文章”等入口。
- eBird 热点可作为独立图层显示。

### eBird 热点与鸟种

- 填写有效 eBird API Token 后，顶部工具栏显示“加载 eBird 热点”和“清除热点”。
- 可按当前地图范围加载 eBird 热点。
- 点击 eBird 热点后，可在 eBird 打开原热点页面。
- 可从 eBird 热点直接新增鸟点活动。
- 从 eBird 热点新增活动时，目标鸟种区域会显示“从 eBird 选取”按钮。
- “从 eBird 选取”会查询该热点在目标日期近两年前后一周的历史记录。
- 查询结果以带勾选框的表格展示，用户确认后写入目标鸟种文本框。
- eBird 返回的鸟种会尽量补齐中文名、英文名和学名，并写入全局鸟名映射表。
- 后端带 eBird 查询缓存，减少重复请求和 429 风险。

### 鸟名映射

BirdRoute 不再依赖前端内置鸟名表。鸟名映射由后端全局维护：

```text
backend_data/bird_name_mappings.json
```

映射字段包括：

- 原始输入名
- 中文名
- 英文名
- 学名
- 输入语言判断
- 来源
- 置信度
- 备注

触发鸟名映射校验的场景包括：

- 保存鸟点活动
- 导入行程 JSON
- 编辑当前行程 JSON
- 从 eBird 选择鸟种
- 生成 Checklist
- 鸟种预习

如果缺少映射，用户可以：

- 手动填写
- 使用 LLM 批量补全
- 确认补全结果后写回后端全局映射表

系统会先判断鸟名更像中文名、英文名还是学名，避免把英文名误写进中文名字段。

### 鸟种预习

- 支持按目标鸟种查看图片候选。
- 支持查询 xeno-canto 鸟鸣。
- 显示时优先使用已确认的中文名，同时保留英文名和学名。
- 当外部服务不可用时，前端会给出错误提示，不影响行程本身。

### Checklist

- 按每天目标鸟种自动生成 Checklist。
- 支持勾选已见鸟种。
- 支持导出 Checklist JSON。
- 鸟名来自全局映射，尽量保证中文名、英文名和学名一致。

### 预算

- 活动可以记录最低费用和最高费用。
- 行程级别统计预算区间。
- 支持多币种字段。
- 适合粗略估算住宿、交通、门票、船票等成本。

### 信息速查

每个行程都有独立的“信息速查”备忘录。

- 入口在行程管理区域。
- 每条信息是一个 key/value。
- value 如果是网址，前端会把 key 渲染为可点击链接。
- 支持新增、修改、删除。
- 编辑框只在新增或修改时出现；平时以卡片展示。
- 登录模式保存到当前行程后端 JSON。
- 游客模式保存到当前内存行程，可随行程 JSON 导出。

适合记录：

- 预约入口
- 船票官网
- 住宿地址
- 司机联系方式
- 天气预警
- 道路信息
- 备用路线

### 当前行程 JSON 高级编辑

行程管理里提供“编辑当前行程 JSON”高级功能。

功能包括：

- 大文本框直接编辑当前行程 JSON。
- JSON 格式化。
- 解析校验。
- 恢复为当前后端版本。
- 保存前 diff。
- 保存前确认摘要。
- 保存前鸟名映射校验。
- 自动备份上一个后端版本。
- 保存后重新渲染当前行程。

保护逻辑：

- 只允许编辑当前单个行程，不允许保存多行程数组。
- 会保护当前行程 `id`，避免误覆盖其他行程。
- 会保护公开行程副本相关字段。
- 会校验 `days`、`stops`、活动类型、坐标、预算等字段。
- 登录模式保存前会先备份旧版本。

### 公开行程检索

登录后，每个原创行程可以设置为私有或公开。

- 公开行程可以被其他用户或游客搜索。
- 可按行程名称、地点、属性、目标鸟种、简介等检索。
- 检索结果以卡片显示，包含公开用户名、行程名称、简介、地点、鸟种标签等。
- 用户可以把公开行程导入自己的账号。
- 游客也可以搜索和导入公开行程，但仍然只保存在当前页面内存中。

防污染逻辑：

- 从公开行程导入的副本默认私有。
- 未修改前不能重新设置为公开。
- 用户在副本基础上修改后，才允许重新开放检索。

### 攻略文章

每个鸟点都可以打开“攻略文章”面板。

入口包括：

- 左侧活动卡片。
- 地图上鸟点弹窗底部。

流程：

1. 根据鸟点名、地点、目标鸟种生成关键词。
2. 搜索微信公众号、小红书、博客和网页候选文章。
3. 可抓取候选文章正文。
4. 可手动输入 URL 抓取正文。
5. 可用 LLM 筛选候选文章。
6. 可用 LLM 总结攻略。
7. 用户确认后保存到后端。

支持的内容来源包括：

- 普通网页
- 微信公众号文章
- 搜狗微信搜索结果
- 小红书第三方接口
- 小红书本地浏览器助手
- Brave Search
- Bing Web Search
- SerpAPI
- Tavily

抓取正文或调用 AI 总结时，前端会显示加载状态和进度提示。

### LLM 设置

当前有三处使用 LLM：

- 搜索候选内容筛选
- 攻略文章总结
- 鸟名映射补全

相关设置集中在同一个 LLM 设置区域，包括：

- Provider
- Base URL
- Model
- API Key
- 攻略总结提示词
- 搜索候选筛选提示词

提示词默认值由后端公共模板提供，新账号会有初始提示词。API Key 不会写入公共模板文件。

### 内容源与 API Key

后端支持保存用户自己的内容源设置和 API 凭据。

- LLM API Key
- eBird API Token
- xeno-canto Token
- 搜索引擎 API Key
- 小红书第三方接口配置

API Key 会保存到登录用户自己的后端目录，并通过后端密钥加密。不要把 API Key 写入 `config.js`、README 或公共模板文件。

## 项目结构

```text
BirdRoute/
├── app.py                         # Flask 后端
├── xhs_helper.py                  # 可选：小红书本地浏览器助手
├── requirements.txt               # Python 依赖
├── index.html                     # 前端入口
├── config.js                      # 前端部署配置
├── assets/
│   ├── css/app.css
│   └── js/
│       ├── leaflet-loader.js
│       ├── app-core.js
│       ├── app-auth-settings.js
│       ├── app-research-quickinfo.js
│       ├── app-map-trips.js
│       ├── app-birds-checklist.js
│       └── app-json-editor.js
├── example/                       # 示例行程 JSON
├── backend_data/                  # 运行时数据，默认不提交
├── LICENSE
└── README.md
```

`backend_data/` 是运行时数据目录，不应该提交到开源仓库。

## 快速开始

### 1. 安装依赖

Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

macOS / Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. 启动后端

```bash
python app.py
```

默认监听：

```text
http://127.0.0.1:5000
```

打开这个地址即可使用同源版本。

### 3. 游客模式

游客模式适合快速试用：

- 不需要注册。
- 可以创建行程。
- 可以导入/导出 JSON。
- 可以搜索公开行程并导入。
- 不写入浏览器缓存。
- 刷新或关闭页面前请导出 JSON。

### 4. 账号模式

注册或登录后：

- 行程保存到后端本地目录。
- 设置保存到用户目录。
- API Key 可加密保存。
- 可以公开原创行程。
- 可以搜索并导入其他人的公开行程。
- 可以保存攻略文章、信息速查、鸟名映射等数据。

## 前后端分离配置

前端不会在页面里提供“后端链接设置”输入框。部署时通过 `config.js` 配置：

```js
window.BIRDROUTE_CONFIG = {
  apiBase: "https://your-backend.example.com",
  localApiBase: "http://127.0.0.1:5000",
  xhsHelperBase: "http://127.0.0.1:5127"
};
```

说明：

- `apiBase`: 线上前端连接的后端地址。
- `localApiBase`: 本地开发时使用的后端地址。
- `xhsHelperBase`: 用户电脑上的小红书本地助手地址。

不要把任何 API Key、Token、密码写入 `config.js`。

后端 CORS 通过环境变量配置：

```bash
BIRDROUTE_ALLOWED_ORIGINS=https://your-github-user.github.io
```

后端端口通过环境变量配置：

```bash
PORT=5000
```

## GitHub Pages + 云后端部署

一种常见部署方式是：

- 前端：GitHub Pages。
- 后端：Ubuntu 云服务器。
- HTTPS：Nginx + Certbot。
- 没有域名时：使用 `sslip.io` 把 IP 映射成可签证书的域名。

### 前端

修改 `config.js`：

```js
window.BIRDROUTE_CONFIG = {
  apiBase: "https://your-ip.sslip.io",
  localApiBase: "http://127.0.0.1:5000",
  xhsHelperBase: "http://127.0.0.1:5127"
};
```

提交并推送到 GitHub，GitHub Pages 会发布静态文件。

### 后端最小部署文件

如果服务器只提供 API，最小只需要上传：

```text
app.py
requirements.txt
```

服务器上的这些目录应该保留：

```text
backend_data/
.venv/
```

部署前建议备份：

```bash
cd /opt/birdroute
sudo tar -czf /opt/birdroute-backend_data-$(date +%F-%H%M%S).tgz backend_data
```

### systemd 示例

```ini
[Unit]
Description=BirdRoute Backend
After=network.target

[Service]
WorkingDirectory=/opt/birdroute
ExecStart=/opt/birdroute/.venv/bin/python /opt/birdroute/app.py
Restart=always
RestartSec=3
User=ubuntu
Environment=PORT=5000
Environment=PYTHONUNBUFFERED=1
Environment=BIRDROUTE_TRUST_PROXY=1
Environment=BIRDROUTE_ALLOWED_ORIGINS=https://your-github-user.github.io
Environment=BIRDROUTE_SESSION_COOKIE_SAMESITE=None
Environment=BIRDROUTE_SESSION_COOKIE_SECURE=1

[Install]
WantedBy=multi-user.target
```

启用服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable birdroute
sudo systemctl restart birdroute
sudo systemctl status birdroute --no-pager
```

### Nginx 示例

```nginx
server {
    listen 80;
    server_name your-ip.sslip.io;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name your-ip.sslip.io;

    ssl_certificate /etc/letsencrypt/live/your-ip.sslip.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-ip.sslip.io/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }

    location = /robots.txt {
        return 204;
    }

    location / {
        return 404;
    }
}
```

验证：

```bash
curl http://127.0.0.1:5000/api/health
curl https://your-ip.sslip.io/api/health
curl -I -H "Origin: https://your-github-user.github.io" https://your-ip.sslip.io/api/health
```

## 小红书本地浏览器助手

小红书登录态、验证码和真实浏览器环境不适合放在云服务器里跑，因此 BirdRoute 把这部分拆成用户电脑上的本地小服务。

安装：

```bash
pip install -r requirements.txt
python -m playwright install chromium
```

启动：

```bash
python xhs_helper.py
```

默认监听：

```text
http://127.0.0.1:5127
```

前端会通过 `xhsHelperBase` 连接它。由于浏览器安全策略限制，HTTPS 页面访问本机 loopback 服务可能受 Private Network Access / CORS 影响；如果浏览器拦截，请使用本地前端调试，或根据浏览器策略调整本地助手的访问方式。

## 数据与隐私

账号模式下，后端数据默认保存在：

```text
backend_data/users/<username>/
```

典型结构：

```text
backend_data/
├── users.json
├── bird_name_mappings.json
├── ebird_species_cache.json
├── geocode_cache.json
├── settings_template.json
├── .secret_key
├── .secrets_key
└── users/
    └── <username>/
        ├── trips/
        ├── settings/
        ├── research/
        └── browser_profiles/
```

注意：

- `backend_data/` 不应该提交到 GitHub。
- `.secret_key` 和 `.secrets_key` 用于后端密钥和 API Key 加密，迁移服务器时要妥善保管。
- `settings_template.json` 只应保存公共默认配置和提示词，不应包含任何 API Key。
- 这是个人 demo 项目，公开部署时请自行做好服务器安全、账号策略、备份和访问控制。

## 示例数据

`example/` 目录包含可导入的行程 JSON。页面中点击“导入 JSON”即可导入。

导入逻辑：

- 新行程会追加到当前账号或游客会话。
- 不会覆盖已有行程。
- 会校验目标鸟种映射。
- 英文名、中文名、学名会尽量通过后端映射统一。

## 常见问题

### GitHub Pages 能读取同仓库里的 config.js 吗？

可以。`config.js` 是静态文件，GitHub Pages 会一起发布。改完后如果页面仍然使用旧配置，通常是浏览器缓存或 Pages 部署延迟，等一会儿或强制刷新即可。

### 为什么游客模式不保存到浏览器缓存？

这是为了避免用户误以为游客数据已经持久化。游客模式用于临时试用和导入导出，重要数据请导出 JSON 或登录账号保存。

### 为什么公开行程副本不能直接再次公开？

公开行程导入后默认是别人的内容副本。为了避免重复复制污染公开检索，副本必须经过用户修改后，才允许重新设置为公开。

### 为什么小红书功能需要本地助手？

小红书依赖登录态、验证码和真实浏览器环境，云服务器上很难稳定运行，也容易触发风控。本地助手让用户自己的电脑处理浏览器会话，云后端只做通用 API 和数据保存。

### 为什么 xeno-canto 或外部文章抓取会失败？

外部服务可能限流、封禁、返回错误、网络不可达，或网页本身禁止抓取。BirdRoute 会尽量显示错误提示，但不能保证所有第三方内容都可抓取。

### 后端能兼容旧数据吗？

当前后端以 JSON 文件保存数据，并在读取、保存时做兼容和字段补全。部署新版前仍建议备份整个 `backend_data/`，尤其是用户行程、鸟名映射、API Key 加密密钥和设置文件。

## 开发

启动：

```bash
python app.py
```

检查 Python 语法：

```bash
python -m py_compile app.py
```

检查拆分后的前端 JS：

```bash
node --check assets/js/app-core.js
node --check assets/js/app-auth-settings.js
node --check assets/js/app-research-quickinfo.js
node --check assets/js/app-map-trips.js
node --check assets/js/app-birds-checklist.js
node --check assets/js/app-json-editor.js
```

## 技术栈

- HTML / CSS / Vanilla JavaScript
- Leaflet / OpenStreetMap
- Flask
- cryptography
- Playwright
- OpenAI-compatible Chat Completions API
- eBird API
- xeno-canto API

## Roadmap

- GPX / KML 导入导出
- eBird observation 导入
- 离线地图缓存
- PWA 支持
- 更完整的鸟种资料源
- 统计报表
- 多语言界面
- 更细的公开行程权限和协作能力
- 生产级 WSGI / Docker 部署样例

## Contributing

欢迎提交 Issue、Feature Request 和 Pull Request。适合贡献的方向包括：

- Bug 修复
- 示例行程
- 内容源适配
- 鸟种资料增强
- UI/UX 改进
- 文档和部署说明

## License

MIT
