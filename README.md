# BirdRoute

![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Web-blue)
![Birding](https://img.shields.io/badge/focus-Birding-brightgreen)

# BirdRoute

**观鸟行程规划与野外清单**

BirdRoute 是一个专为观鸟旅行设计的轻量级 Web 工具，集成地图、路线规划、目标鸟种管理、预算统计、每日 Checklist、eBird 热点查询以及鸟种预习功能。

BirdRoute 采用纯前端架构，无需安装软件、无需数据库、无需后端服务，打开浏览器即可使用。

---

# 功能特性

## 行程规划

* 多行程管理
* 按天组织活动
* 创建、编辑、删除行程
* 创建、编辑、删除日期
* 创建、编辑、删除活动节点
* 地图点击新增活动

---

## 地图功能

基于 Leaflet + OpenStreetMap：

* 地图浏览
* 活动位置显示
* 路线自动绘制
* 地点自动定位
* 地图点击添加活动
* 自动中心定位

---

## 观鸟功能

### 鸟点管理

* 鸟点记录
* 目标鸟种管理
* 观鸟路线规划

### 鸟种预习

支持：

* 鸟类图片
* 鸟鸣试听
* 中文名检索
* 英文名检索
* 学名检索

系统优先使用：

```text
学名
↓
英文名
↓
中文名
```

进行图片与鸟声查询。

---

## 每日 Checklist

自动根据目标鸟种生成每日清单：

* 自动汇总鸟种
* 勾选已观察鸟种
* 保存观察状态
* 导出 Checklist

适用于：

* 查漏补缺
* 野外记录
* 目标种追踪

---

## eBird 集成

支持：

* eBird Hotspots
* 当前地图范围热点查询
* eBird API Token

获取 Token：

[https://ebird.org/api/keygen](https://ebird.org/api/keygen)

---

## xeno-canto 集成

支持：

* 鸟声检索
* 鸟声试听
* API Key 配置

用于鸟种预习功能。

---

## 预算管理

支持：

* 住宿预算
* 交通预算
* 活动预算
* 每日预算统计
* 总预算统计

支持多币种显示：

* CNY
* TWD
* HKD
* USD
* EUR
* GBP
* JPY
* PLN

支持实时汇率换算。

---

## 数据管理

支持：

* JSON 导入
* JSON 导出
* Checklist 导出
* 本地自动保存

所有数据默认存储在浏览器本地。

---

# 快速开始

## 直接使用

下载项目后：

```text
index.html
```

直接使用浏览器打开即可。

推荐浏览器：

* Chrome
* Edge
* Firefox
* Safari

---

# GitHub Pages 部署

BirdRoute 可以直接部署到 GitHub Pages。

## 1. 创建仓库

例如：

```text
BirdRoute
```

项目结构：

```text
BirdRoute/
├── index.html
├── README.md
└── examples/
│   └── taiwan_birding_8day.json
```

---

## 2. 开启 GitHub Pages

进入：

```text
Settings
→ Pages
```

选择：

```text
Source:
Deploy from a branch
```

Branch：

```text
main
```

Folder：

```text
/ (root)
```

点击：

```text
Save
```

---

## 3. 访问网站

部署完成后：

```text
https://YOUR_USERNAME.github.io/BirdRoute/
```

即可访问。

---

## 4. 更新网站

后续只需：

```bash
git add .
git commit -m "update"
git push
```

GitHub Pages 会自动重新部署。

---

# 数据隐私

BirdRoute 不会主动上传用户数据。

默认保存在浏览器 LocalStorage 中：

* 行程
* Checklist
* 预算
* eBird Token
* xeno-canto Token

导出的 JSON 文件完全由用户自行管理。

---

# 示例数据

仓库提供：

```text
examples/taiwan_birding_8day.json
```

内容包括：

* 台北植物园
* 大安森林公园
* 大雪山
* 龙銮潭
* 龙磐公园
* 垦丁国家公园

等经典台湾观鸟地点。

---

# 技术栈

* HTML5
* CSS3
* Vanilla JavaScript
* Leaflet
* OpenStreetMap
* eBird API
* xeno-canto API

无框架依赖。

无构建步骤。

无后端服务。

---

# Roadmap

未来计划：

* [ ] GPX 导入导出
* [ ] eBird Observation 导入
* [ ] Merlin Bird ID 集成
* [ ] 离线地图缓存
* [ ] PWA 支持
* [ ] 移动端优化
* [ ] 鸟种图库增强
* [ ] 统计报表
* [ ] 多语言支持
* [ ] 观鸟旅行模板库

---

# Contributing

欢迎提交：

* Issue
* Feature Request
* Pull Request

包括但不限于：

* 新功能
* Bug 修复
* UI 改进
* 鸟种数据库扩充
* 多语言翻译

---
