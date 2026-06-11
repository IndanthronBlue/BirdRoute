const STORAGE_KEY = "birdroute_v1_2";
const SETTINGS_KEY = STORAGE_KEY + "_settings";
const WECHAT_SOGOU_SEARCH_ENDPOINT = "https://weixin.sogou.com/weixin";
const RNOTE_XHS_SEARCH_ENDPOINT = "https://rnote.dev/api/v2/crawler/search/notes";
const RNOTE_XHS_IMAGE_DETAIL_ENDPOINT = "https://rnote.dev/api/v2/crawler/note/image";
const RNOTE_XHS_VIDEO_DETAIL_ENDPOINT = "https://rnote.dev/api/v2/crawler/note/video";
const BIRDROUTE_CONFIG = {
  apiBase: "",
  localApiBase: "http://127.0.0.1:5000",
  xhsHelperBase: "http://127.0.0.1:5127",
  ...(window.BIRDROUTE_CONFIG || {})
};

function normalizeApiBase(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!text || text === "." || text === "/" || text === "same-origin") return "";
  return text;
}

function autoDetectedApiBase() {
  if (window.location.protocol === "file:") return normalizeApiBase(BIRDROUTE_CONFIG.localApiBase);
  if (
    ["127.0.0.1", "localhost"].includes(window.location.hostname) &&
    window.location.port &&
    window.location.port !== "5000"
  ) {
    return normalizeApiBase(BIRDROUTE_CONFIG.localApiBase);
  }
  return "";
}

function resolveApiBase() {
  const fromConfig = normalizeApiBase(BIRDROUTE_CONFIG.apiBase);
  if (fromConfig) return fromConfig;
  return autoDetectedApiBase();
}

const API_BASE = resolveApiBase();
const XHS_HELPER_BASE = normalizeApiBase(BIRDROUTE_CONFIG.xhsHelperBase || "http://127.0.0.1:5127");

const taiwanTemplateTrips = [
  {
    title: "台湾观鸟 8 天行程",
    subtitle: "香港出发｜公共交通为主｜大雪山包车｜10月初秋迁季",
    currency: "CNY",
    summary: "香港 → 台北植物园/大安森林公园 → 大雪山 23K/35K/43K/49.5K → 台中 → 垦丁龙銮潭/龙磐/社顶/垦丁国家森林游乐区 → 高雄 → 香港。",
    center: { lat: 23.7, lng: 121.0, zoom: 7 },
    days: [
      {
        day: "D1",
        title: "香港 → 台北｜台北植物园热身",
        stay: "住宿：台北车站周边",
        stops: [
          { name: "桃园国际机场", type: "airport", time: "中午", lat: 25.0797, lng: 121.2342, birds: "抵达台湾", transport: "桃园机场捷运 → 台北车站，约35–50分钟。", note: "入境后可购买悠游卡。", costMin: 0, costMax: 0 },
          { name: "台北车站住宿区", type: "hotel", time: "14:00", lat: 25.0478, lng: 121.5170, birds: "住宿与交通枢纽", transport: "机场捷运直达台北车站。", note: "预算：350–600 RMB/晚。", costMin: 350, costMax: 600 },
          { name: "台北植物园", type: "bird", time: "15:00–18:00", lat: 25.0318, lng: 121.5108, birds: "黑冠麻鹭、五色鸟、白头翁、红耳鹎、绿绣眼", transport: "台北车站 → MRT小南门站 → 步行约10分钟。", note: "城市林地鸟与黑冠麻鹭的重点地点。", costMin: 0, costMax: 50 }
        ]
      },
      {
        day: "D2",
        title: "台北城市观鸟｜轻松不赶路",
        stay: "住宿：台北车站周边",
        stops: [
          { name: "大安森林公园", type: "bird", time: "06:00–09:00", lat: 25.0316, lng: 121.5355, birds: "五色鸟、红耳鹎、白头翁、绿绣眼、凤头苍鹰", transport: "MRT至大安森林公园站，出站即到。", note: "清晨鸟活跃，适合拍摄常见台湾城市鸟。", costMin: 20, costMax: 60 },
          { name: "台北植物园（二刷）", type: "bird", time: "09:30–12:00", lat: 25.0318, lng: 121.5108, birds: "黑冠麻鹭、五色鸟、灰树鹊、绿绣眼", transport: "MRT或出租车从大安森林公园前往。", note: "补拍黑冠麻鹭，下午不再安排高强度观鸟。", costMin: 20, costMax: 120 },
          { name: "台北车站住宿区", type: "hotel", time: "晚上", lat: 25.0478, lng: 121.5170, birds: "休息与整理记录", transport: "MRT返回台北车站周边。", note: "早点休息，D3上大雪山。", costMin: 350, costMax: 600 }
        ]
      },
      {
        day: "D3",
        title: "台北 → 大雪山｜包车上山",
        stay: "住宿：大雪山宾馆",
        stops: [
          { name: "台北车站", type: "transport", time: "07:00", lat: 25.0478, lng: 121.5170, birds: "交通节点", transport: "搭台湾高铁：台北 → 台中，约1小时。", note: "建议提前买票。", costMin: 160, costMax: 220 },
          { name: "高铁台中站 / 新乌日站", type: "transport", time: "08:10", lat: 24.1117, lng: 120.6150, birds: "高铁转台铁", transport: "高铁台中站步行连通新乌日站，再搭台铁到丰原。", note: "转乘时间预留20–30分钟更稳。", costMin: 10, costMax: 20 },
          { name: "丰原车站", type: "transport", time: "09:30", lat: 24.2542, lng: 120.7229, birds: "包车接站点", transport: "包车师傅在丰原车站接人。", note: "给司机写明：Fengyuan Railway Station pickup.", costMin: 0, costMax: 0 },
          { name: "大雪山林道 23K", type: "bird", time: "11:00–12:30", lat: 24.2452, lng: 120.8680, birds: "台湾噪鹛、绣眼画眉、白耳画眉、栗背林鸲", transport: "丰原车站 → 包车上山。", note: "作为上山第一站，节奏不要太赶。", costMin: 400, costMax: 900 },
          { name: "大雪山 35K / 游客中心区域", type: "bird", time: "13:30–15:00", lat: 24.2530, lng: 120.9480, birds: "黄山雀、台湾鹛、白耳画眉", transport: "包车从23K前往。", note: "大雪山宾馆就在游客中心附近。", costMin: 0, costMax: 0 },
          { name: "大雪山 43K", type: "bird", time: "15:30–17:00", lat: 24.2745, lng: 120.9850, birds: "黄山雀、台湾鹛、白耳画眉、栗背林鸲", transport: "包车从35K前往。", note: "经典高山鸟点，D4还会重点刷。", costMin: 0, costMax: 0 },
          { name: "大雪山宾馆", type: "hotel", time: "17:30", lat: 24.2510, lng: 120.9510, birds: "夜宿山顶，方便清晨出鸟", transport: "包车送到宾馆。", note: "预算约650–800 RMB/晚。", costMin: 650, costMax: 800 }
        ]
      },
      {
        day: "D4",
        title: "大雪山核心观鸟日｜特有种重点",
        stay: "住宿：大雪山宾馆",
        stops: [
          { name: "大雪山宾馆", type: "hotel", time: "05:30", lat: 24.2510, lng: 120.9510, birds: "清晨出发", transport: "包车在宾馆门口接。", note: "带保暖衣物，10月清晨山上偏冷。", costMin: 650, costMax: 800 },
          { name: "大雪山 43K", type: "bird", time: "06:00–08:00", lat: 24.2745, lng: 120.9850, birds: "黄山雀、台湾鹛、白耳画眉", transport: "包车从宾馆前往。", note: "清晨活跃度高。", costMin: 400, costMax: 900 },
          { name: "大雪山 47K", type: "bird", time: "08:00–09:00", lat: 24.2880, lng: 121.0010, birds: "蓝腹鹇、帝雉机会", transport: "包车从43K前往。", note: "遇到鸡形目需要耐心。", costMin: 0, costMax: 0 },
          { name: "49.5K 神木步道入口", type: "bird", time: "09:00–13:00", lat: 24.3005, lng: 121.0115, birds: "帝雉、蓝腹鹇、台湾鹪鹛", transport: "包车从47K前往。", note: "全程核心鸟点之一，可多留时间。", costMin: 0, costMax: 0 },
          { name: "天池", type: "bird", time: "14:00–16:00", lat: 24.3000, lng: 121.0175, birds: "台湾蓝鹊、白耳画眉、山地林鸟", transport: "包车前往。", note: "下午轻松补种。", costMin: 0, costMax: 0 },
          { name: "大雪山宾馆", type: "hotel", time: "16:30", lat: 24.2510, lng: 120.9510, birds: "回宾馆休息", transport: "包车返回。", note: "晚餐建议在园区解决或提前确认。", costMin: 0, costMax: 0 }
        ]
      },
      {
        day: "D5",
        title: "大雪山补种 → 台中",
        stay: "住宿：台中高铁站/乌日附近",
        stops: [
          { name: "大雪山 35K / 游客中心区域", type: "bird", time: "06:00–08:00", lat: 24.2530, lng: 120.9480, birds: "黄山雀、台湾鹛、白耳画眉", transport: "从宾馆步行或短程包车。", note: "补D3/D4没看到的种。", costMin: 0, costMax: 0 },
          { name: "大雪山 43K（二刷）", type: "bird", time: "08:30–11:00", lat: 24.2745, lng: 120.9850, birds: "帝雉机会、台湾鹛、黄山雀", transport: "包车前往。", note: "上午结束后回宾馆收拾。", costMin: 400, costMax: 900 },
          { name: "大雪山宾馆", type: "hotel", time: "15:00", lat: 24.2510, lng: 120.9510, birds: "退房下山", transport: "包车从宾馆送回丰原车站。", note: "建议15:00左右下山，不赶夜路。", costMin: 0, costMax: 0 },
          { name: "丰原车站", type: "transport", time: "17:00", lat: 24.2542, lng: 120.7229, birds: "转台铁", transport: "丰原站 → 新乌日站 / 台中高铁站附近住宿。", note: "台中住宿预算约300–450 RMB。", costMin: 10, costMax: 40 },
          { name: "台中高铁站住宿区", type: "hotel", time: "晚上", lat: 24.1117, lng: 120.6150, birds: "休息中转", transport: "台铁/出租车到住宿。", note: "D6早上南下左营最方便。", costMin: 300, costMax: 450 }
        ]
      },
      {
        day: "D6",
        title: "台中 → 垦丁｜龙銮潭水鸟",
        stay: "住宿：船帆石或鹅銮鼻附近",
        stops: [
          { name: "高铁台中站", type: "transport", time: "08:00", lat: 24.1117, lng: 120.6150, birds: "交通节点", transport: "台湾高铁：台中 → 左营，约50分钟。", note: "建议不要太晚出发。", costMin: 110, costMax: 160 },
          { name: "左营高铁站", type: "transport", time: "09:00", lat: 22.6873, lng: 120.3090, birds: "转垦丁快线", transport: "9189 垦丁快线：左营 → 垦丁，约2小时20分钟。", note: "到垦丁后再转出租车到住宿。", costMin: 70, costMax: 120 },
          { name: "船帆石住宿区", type: "hotel", time: "12:00", lat: 21.9343, lng: 120.8245, birds: "靠近龙磐与鹅銮鼻", transport: "垦丁快线到垦丁后，出租车到船帆石。", note: "住宿预算约300–500 RMB/晚。", costMin: 300, costMax: 500 },
          { name: "龙銮潭自然中心", type: "bird", time: "15:00–18:00", lat: 21.9778, lng: 120.7440, birds: "苍鹭、白鹭、水鸟、猛禽机会", transport: "从船帆石/垦丁住宿区打车前往，约15–25分钟。", note: "傍晚适合看水鸟与光线。", costMin: 50, costMax: 150 }
        ]
      },
      {
        day: "D7",
        title: "垦丁国家公园｜猛禽迁徙与珊瑚礁森林",
        stay: "住宿：船帆石或鹅銮鼻附近",
        stops: [
          { name: "龙磐公园", type: "bird", time: "06:00–10:00", lat: 21.9466, lng: 120.8539, birds: "灰面鵟鹰、赤腹鹰、凤头蜂鹰", transport: "住宿地 → 出租车，清晨建议预约。", note: "10月初垦丁猛禽迁徙重点。", costMin: 80, costMax: 200 },
          { name: "风吹砂", type: "bird", time: "10:00–12:00", lat: 21.9525, lng: 120.8678, birds: "猛禽迁徙、鹰流", transport: "从龙磐公园打车或包短程车前往。", note: "与龙磐可连看。", costMin: 30, costMax: 100 },
          { name: "社顶自然公园", type: "bird", time: "15:00–16:30", lat: 21.9595, lng: 120.8114, birds: "过境雀形目、画眉类、林鸟", transport: "午休后出租车前往。", note: "下午轻松步行。", costMin: 50, costMax: 150 },
          { name: "垦丁国家森林游乐区", type: "bird", time: "16:30–18:00", lat: 21.9590, lng: 120.8158, birds: "台湾蓝鹊、红嘴黑鹎、白头翁、绿绣眼", transport: "从社顶附近短程出租车或步行/接驳视住宿位置而定。", note: "补珊瑚礁森林生态环境。", costMin: 50, costMax: 150 },
          { name: "船帆石住宿区", type: "hotel", time: "晚上", lat: 21.9343, lng: 120.8245, birds: "休息", transport: "出租车返回。", note: "若第二天早班回高雄，提前确认车班。", costMin: 300, costMax: 500 }
        ]
      },
      {
        day: "D8",
        title: "垦丁 → 高雄 → 香港",
        stay: "返程",
        stops: [
          { name: "船帆石住宿区", type: "hotel", time: "08:00", lat: 21.9343, lng: 120.8245, birds: "退房", transport: "出租车到垦丁快线站点。", note: "预留充足时间返高雄。", costMin: 50, costMax: 150 },
          { name: "左营高铁站", type: "transport", time: "约11:00", lat: 22.6873, lng: 120.3090, birds: "转高雄机场", transport: "9189 垦丁快线：垦丁 → 左营，约2小时20分钟。", note: "可从左营搭捷运或出租车去高雄机场。", costMin: 70, costMax: 120 },
          { name: "高雄国际机场", type: "airport", time: "下午", lat: 22.5771, lng: 120.3500, birds: "返程", transport: "左营 → 高雄机场：捷运或出租车。", note: "飞回香港。", costMin: 1200, costMax: 2500 }
        ]
      }
    ]
  }
];

const defaultTrips = [];

let trips = loadTrips();
let currentTripIndex = 0;
let currentFilter = "ALL";
let displayCurrency = "";
let fxCache = {
  base: "",
  rates: {},
  updatedAt: "",
  source: ""
};
let sessionMode = "pending"; // pending | guest | account
let currentUser = null;
let backendSyncTimer = null;
let backendSyncInFlight = false;
let backendSyncPending = false;
let mapTileEngine = "leaflet_osm";
let navigationEngine = "google";
let map, baseTileLayer, markerLayer, routeLayer, ebirdLayer;
let currentResearchDayIndex = null;
let currentResearchStopIndex = null;
let researchArticles = [];
let researchSummaryResult = null;
let researchKeywordTokens = [];
let researchBusy = false;
let quickInfoItems = [];
const birdNameMappingCache = {};
let birdMappingDialogState = null;
let stopSaveInProgress = false;
let contentSourceDefaults = {
  wechat: true,
  xiaohongshu: true,
  blog: true,
  web: true
};
const TRIP_VISIBILITY_LABELS = {
  private: "私有",
  public: "公开"
};
const DEFAULT_TRIP_PACE = "休闲";
let lastContentSourceSettings = null;
let lastAccountApiCredentials = null;
let ebirdTokenStatus = { hasToken: false, valid: false, checked: false };
let ebirdSpeciesPickerState = { locId: "", locName: "", targetDate: "", species: [] };
const pendingSecretUpdates = {
  apiCredentials: {},
  contentSources: {},
  llm: {}
};
let activeSecretInputId = "";
let authSessionToken = "";

const typeColors = {
  bird: "#2f6f4e",
  hotel: "#315f88",
  transport: "#c06a2b",
  airport: "#7d5bbd"
};

const typeLabels = {
  bird: "鸟点",
  hotel: "住宿",
  transport: "交通节点",
  airport: "机场/航班"
};

const mapTileEngines = {
  leaflet_osm: {
    label: "Leaflet / OpenStreetMap",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }
  },
  gaode_road: {
    label: "高德路网",
    url: "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
    options: {
      maxZoom: 18,
      subdomains: ["1", "2", "3", "4"],
      attribution: '&copy; 高德地图'
    }
  },
  gaode_satellite: {
    label: "高德卫星影像",
    url: "https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}",
    options: {
      maxZoom: 18,
      subdomains: ["1", "2", "3", "4"],
      attribution: '&copy; 高德地图'
    }
  }
};

const navigationEngines = {
  google: "Google 地图",
  gaode: "高德地图",
  baidu: "百度地图",
  osm: "OpenStreetMap"
};


const BR = window.BR || (window.BR = {});

BR.stopMainLabel = function(stop) {
  if (!stop || !stop.type) return "内容";
  if (stop.type === "bird") return "目标鸟种";
  if (stop.type === "hotel") return "住宿说明";
  if (stop.type === "transport") return "交通说明";
  if (stop.type === "airport") return "航班/机场说明";
  return "内容";
};

BR.stopBudgetLabel = function(stop) {
  if (!stop || !stop.type) return "预算";
  if (stop.type === "hotel") return "住宿预算";
  if (stop.type === "transport") return "交通预算";
  if (stop.type === "airport") return "航班/机场预算";
  if (stop.type === "bird") return "鸟点相关费用";
  return "预算";
};

BR.updateTypeHelp = function() {
  const type = document.getElementById("typeInput")?.value || "bird";
  const birdsLabel = document.getElementById("birdsLabel");
  const typeHelp = document.getElementById("typeHelp");

  if (!birdsLabel || !typeHelp) return;

  if (type === "bird") {
    birdsLabel.textContent = "目标鸟种";
    typeHelp.textContent = "鸟点：请重点填写目标鸟种；预算可用于门票、打车、向导费等。";
  } else if (type === "hotel") {
    birdsLabel.textContent = "住宿说明";
    typeHelp.textContent = "住宿节点：请填写住宿预算最低/最高费用，这会计入总预算统计。";
  } else if (type === "transport") {
    birdsLabel.textContent = "交通说明";
    typeHelp.textContent = "交通节点：请填写交通预算最低/最高费用，例如高铁、巴士、包车、出租车。";
  } else if (type === "airport") {
    birdsLabel.textContent = "航班/机场说明";
    typeHelp.textContent = "机场/航班节点：请填写机票或机场交通预算，这会计入总预算统计。";
  } else {
    birdsLabel.textContent = "活动内容";
    typeHelp.textContent = "请填写活动内容和预算。";
  }
  renderEbirdSpeciesPickerButton();
};

// Backward-compatible globals for inline handlers and old saved snippets.
window.stopMainLabel = BR.stopMainLabel;
window.stopBudgetLabel = BR.stopBudgetLabel;
window.updateTypeHelp = BR.updateTypeHelp;
var stopMainLabel = BR.stopMainLabel;
var stopBudgetLabel = BR.stopBudgetLabel;
var updateTypeHelp = BR.updateTypeHelp;


const tripSelect = document.getElementById("tripSelect");
const buttonsEl = document.getElementById("dayButtons");
const itineraryEl = document.getElementById("itinerary");
const dialog = document.getElementById("editDialog");
const dayDialog = document.getElementById("dayDialog");
const tripDialog = document.getElementById("tripDialog");
const settingsDialog = document.getElementById("settingsDialog");
const publicTripSearchDialog = document.getElementById("publicTripSearchDialog");
const birdPreviewDialog = document.getElementById("birdPreviewDialog");
const birdMappingDialog = document.getElementById("birdMappingDialog");
const ebirdSpeciesDialog = document.getElementById("ebirdSpeciesDialog");
const ebirdHelpDialog = document.getElementById("ebirdHelpDialog");
const xcHelpDialog = document.getElementById("xcHelpDialog");
const xhsThirdPartyHelpDialog = document.getElementById("xhsThirdPartyHelpDialog");
const secretInputDialog = document.getElementById("secretInputDialog");
const quickInfoDialog = document.getElementById("quickInfoDialog");
const checklistDialog = document.getElementById("checklistDialog");
const researchDialog = document.getElementById("researchDialog");

function hasTrips() { return trips.length > 0 && trips[currentTripIndex]; }

function currentTrip() {
  return hasTrips() ? trips[currentTripIndex] : {
    title: "BirdRoute",
    subtitle: "观鸟行程规划与野外清单",
    currency: "CNY",
    summary: "当前没有载入行程。请先创建新行程，或导入已有 JSON 文件。",
    visibility: "private",
    primaryLocation: "未设置地点",
    tripPace: DEFAULT_TRIP_PACE,
    birdTags: [],
    locationTags: [],
    quickInfo: [],
    center: { lat: 23.7, lng: 121.0, zoom: 3 },
    days: []
  };
}

function currentDays() { return currentTrip().days || []; }

function deepCopy(obj) { return JSON.parse(JSON.stringify(obj)); }

function normalizeTripVisibility(value) {
  return value === "public" ? "public" : "private";
}

function normalizeTripTag(value) {
  return String(value || "").trim().replace(/\s+/g, " ").replace(/^[\s,，、;；|｜-]+|[\s,，、;；|｜-]+$/g, "");
}

function todayDateString() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function normalizeDateOnly(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function addDaysToDate(dateText, offset) {
  const normalized = normalizeDateOnly(dateText);
  if (!normalized) return "";
  const date = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + offset);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function defaultDayDate(dayIndex = currentDays().length) {
  const startDate = normalizeDateOnly(currentTrip().startDate);
  return addDaysToDate(startDate, dayIndex) || "";
}

function scheduleDateFromStop(stop, day = {}) {
  return normalizeDateOnly(day?.date) || normalizeDateOnly(stop?.date);
}

function completeStopSchedule(stop, day = {}) {
  if (!stop || typeof stop !== "object") return stop;
  stop.time = String(stop.time || stop.timeLabel || "").trim() || "待定";
  stop.date = scheduleDateFromStop(stop, day);
  delete stop.startTime;
  delete stop.endTime;
  delete stop.start;
  delete stop.end;
  delete stop.startsAt;
  delete stop.endsAt;
  return stop;
}

function normalizeTripScheduleFields(trip) {
  if (!trip || typeof trip !== "object") return trip;
  trip.startDate = normalizeDateOnly(trip.startDate || trip.tripStartDate || trip.dateStart || "");
  trip.endDate = normalizeDateOnly(trip.endDate || trip.tripEndDate || trip.dateEnd || "");
  if (trip.startDate && (!trip.endDate || trip.endDate < trip.startDate)) {
    trip.endDate = addDaysToDate(trip.startDate, Math.max(0, ((trip.days || []).length || 1) - 1));
  }
  (trip.days || []).forEach((day, dayIndex) => {
    day.day = String(day.day || `D${dayIndex + 1}`).trim() || `D${dayIndex + 1}`;
    day.date = addDaysToDate(trip.startDate, dayIndex) || normalizeDateOnly(day.date || day.dayDate || "");
    (day.stops || []).forEach(stop => completeStopSchedule(stop, day));
  });
  return trip;
}

function dayMetaLabel(day) {
  const parts = [];
  if (normalizeDateOnly(day?.date)) parts.push(`日期：${normalizeDateOnly(day.date)}`);
  else parts.push("日期未设置");
  if (day?.stay) parts.push(day.stay);
  return parts.join("｜");
}

function daySelectLabel(day) {
  const date = normalizeDateOnly(day?.date);
  return `${day?.day || ""}${date ? `（${date}）` : ""}｜${day?.title || ""}`;
}

function stopDateTimeLabel(stop, day = {}) {
  const human = String(stop?.time || "").trim();
  return human || "待定";
}

function uniqueTripTags(values, limit = 40) {
  const seen = new Set();
  const tags = [];
  values.forEach(value => {
    const tag = normalizeTripTag(value);
    if (!tag) return;
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    tags.push(tag.slice(0, 48));
  });
  return tags.slice(0, limit);
}

function extractTripBirdTags(trip) {
  const names = [];
  (trip.days || []).forEach(day => {
    (day.stops || []).forEach(stop => {
      if (stop.type === "bird") names.push(...parseBirdNames(stop.birds));
    });
  });
  return uniqueTripTags(names, 50);
}

function extractTripLocationTags(trip) {
  const values = [trip.primaryLocation];
  (trip.days || []).forEach(day => {
    (day.stops || []).forEach(stop => values.push(stop.name));
  });
  return uniqueTripTags(values, 50);
}

function deriveTripPrimaryLocation(trip) {
  const explicit = normalizeTripTag(trip.primaryLocation);
  if (explicit) return explicit;
  const firstStop = (trip.days || []).flatMap(day => day.stops || []).find(stop => normalizeTripTag(stop.name));
  if (firstStop) return normalizeTripTag(firstStop.name);
  const firstTitlePart = String(trip.title || "").split(/[｜|—\-·,，/]+/)[0];
  return normalizeTripTag(firstTitlePart) || "未设置地点";
}

function prepareTripForSave(trip) {
  if (!trip || typeof trip !== "object") return trip;
  normalizeTripScheduleFields(trip);
  trip.quickInfo = normalizeQuickInfoItems(trip.quickInfo || []);
  if (trip.quickInfo.length && !trip.quickInfoUpdatedAt) {
    trip.quickInfoUpdatedAt = new Date().toISOString();
  } else if (!trip.quickInfo.length) {
    delete trip.quickInfoUpdatedAt;
  }
  trip.visibility = normalizeTripVisibility(trip.visibility);
  trip.tripPace = normalizeTripTag(trip.tripPace) || DEFAULT_TRIP_PACE;
  trip.primaryLocation = deriveTripPrimaryLocation(trip);
  trip.birdTags = extractTripBirdTags(trip);
  trip.locationTags = extractTripLocationTags(trip);
  return trip;
}

function markTripLocallyModified(trip = currentTrip()) {
  if (trip && trip.copiedFromPublic) trip.copyModified = true;
}

function loadTrips() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {}
  return [];
}

function makeClientId(prefix = "trip") {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

function ensureTripRecordIds() {
  trips.forEach(trip => {
    if (!trip.id) trip.id = makeClientId("trip");
    if (!trip.createdAt) trip.createdAt = new Date().toISOString();
    prepareTripForSave(trip);
    (trip.days || []).forEach(day => {
      (day.stops || []).forEach(stop => {
        if (!stop.id) stop.id = makeClientId("stop");
      });
    });
  });
}

function persistLocalTripsOnly() {
  if (sessionMode !== "account") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trips));
}

function saveTrips() {
  ensureTripRecordIds();
  persistLocalTripsOnly();
  scheduleBackendSync();
}
