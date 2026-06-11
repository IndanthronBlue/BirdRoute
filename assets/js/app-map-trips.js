function normalizeCurrency(code) {
  const c = String(code || "").trim().toUpperCase();
  if (c === "RMB") return "CNY";
  return c || "CNY";
}

function money(n) {
  const num = Number(n);
  return Number.isFinite(num) ? num : 0;
}

function activeBaseCurrency() {
  return normalizeCurrency(currentTrip().currency || "CNY");
}

function activeDisplayCurrency() {
  return normalizeCurrency(displayCurrency || activeBaseCurrency());
}

function canConvert() {
  const base = activeBaseCurrency();
  const target = activeDisplayCurrency();
  if (base === target) return true;
  return fxCache.base === base && fxCache.rates && Number.isFinite(Number(fxCache.rates[target]));
}

function convertAmount(amount) {
  const n = money(amount);
  const base = activeBaseCurrency();
  const target = activeDisplayCurrency();
  if (base === target) return n;
  if (canConvert()) return n * Number(fxCache.rates[target]);
  return n;
}

function formatAmount(amount, currency = activeDisplayCurrency()) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return `0 ${currency}`;
  const digits = Math.abs(n) >= 100 ? 0 : 2;
  return `${n.toLocaleString(undefined, { maximumFractionDigits: digits })} ${currency}`;
}

function formatBudgetRange(min, max) {
  const base = activeBaseCurrency();
  const target = activeDisplayCurrency();
  const cmin = convertAmount(min);
  const cmax = convertAmount(max);
  const suffix = base !== target && canConvert() ? `（原 ${formatAmount(money(min), base)}–${formatAmount(money(max), base)}）` : "";
  return `${formatAmount(cmin, target)}–${formatAmount(cmax, target)}${suffix}`;
}

function loadUiSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    mapTileEngine = mapTileEngines[saved.mapTileEngine] ? saved.mapTileEngine : "leaflet_osm";
    navigationEngine = navigationEngines[saved.navigationEngine] ? saved.navigationEngine : "google";
  } catch (e) {
    mapTileEngine = "leaflet_osm";
    navigationEngine = "google";
  }
}

function saveUiSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ mapTileEngine, navigationEngine }));
  } catch (e) {}
}

function renderMapSettings() {
  const tileSelect = document.getElementById("mapTileEngineSelect");
  const navSelect = document.getElementById("navigationEngineSelect");
  const status = document.getElementById("mapEngineStatus");
  if (tileSelect) tileSelect.value = mapTileEngine;
  if (navSelect) navSelect.value = navigationEngine;
  if (status) {
    const tileLabel = mapTileEngines[mapTileEngine]?.label || "Leaflet / OpenStreetMap";
    const navLabel = navigationEngines[navigationEngine] || "Google 地图";
    status.textContent = `当前底图：${tileLabel}；外部导航：${navLabel}。`;
  }
}

function createBaseTileLayer(engine = mapTileEngine) {
  const config = mapTileEngines[engine] || mapTileEngines.leaflet_osm;
  return L.tileLayer(config.url, config.options);
}

function applyMapTileEngine() {
  if (!map || typeof L === "undefined") return;
  if (baseTileLayer) map.removeLayer(baseTileLayer);
  baseTileLayer = createBaseTileLayer(mapTileEngine);
  baseTileLayer.addTo(map);
}

function setMapTileEngine(engine) {
  mapTileEngine = mapTileEngines[engine] ? engine : "leaflet_osm";
  saveUiSettings();
  applyMapTileEngine();
  renderMapSettings();
  showToast(`已切换底图：${mapTileEngines[mapTileEngine].label}`);
}

function setNavigationEngine(engine) {
  navigationEngine = navigationEngines[engine] ? engine : "google";
  saveUiSettings();
  renderMapSettings();
  render(currentFilter);
  showToast(`已切换导航：${navigationEngines[navigationEngine]}`);
}

function navigationEngineLabel() {
  return navigationEngines[navigationEngine] || "Google 地图";
}

function navigationUrl(stop) {
  const lat = Number(stop?.lat);
  const lng = Number(stop?.lng);
  const hasCoord = Number.isFinite(lat) && Number.isFinite(lng);
  const name = String(stop?.name || "").trim();
  const encodedName = encodeURIComponent(name || "BirdRoute 目的地");

  if (navigationEngine === "gaode") {
    if (hasCoord) {
      return `https://uri.amap.com/navigation?to=${encodeURIComponent(lng + "," + lat + "," + (name || "目的地"))}&mode=car&policy=1&src=BirdRoute&coordinate=wgs84&callnative=1`;
    }
    return name ? `https://uri.amap.com/search?keyword=${encodedName}&src=BirdRoute&callnative=1` : "https://ditu.amap.com/";
  }

  if (navigationEngine === "baidu") {
    if (hasCoord) {
      return `https://api.map.baidu.com/direction?destination=${encodeURIComponent(lat + "," + lng)}&mode=driving&region=全球&output=html&src=BirdRoute`;
    }
    return name ? `https://map.baidu.com/search/${encodedName}` : "https://map.baidu.com/";
  }

  if (navigationEngine === "osm") {
    if (hasCoord) {
      return `https://www.openstreetmap.org/directions?to=${encodeURIComponent(lat + "," + lng)}#map=13/${lat}/${lng}`;
    }
    return name ? `https://www.openstreetmap.org/search?query=${encodedName}` : "https://www.openstreetmap.org/";
  }

  if (hasCoord) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(lat + "," + lng)}&travelmode=driving`;
  }

  if (name) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodedName}&travelmode=driving`;
  }

  return "https://www.google.com/maps";
}

function budgetTotals() {
  let min = 0, max = 0;
  currentDays().forEach(day => {
    day.stops.forEach(stop => {
      min += convertAmount(stop.costMin);
      max += convertAmount(stop.costMax);
    });
  });
  return { min, max };
}

function renderTripSelect() {
  tripSelect.innerHTML = "";
  if (!hasTrips()) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "当前没有行程";
    option.selected = true;
    tripSelect.appendChild(option);
    return;
  }

  trips.forEach((trip, idx) => {
    const option = document.createElement("option");
    option.value = idx;
    option.textContent = trip.title || `行程 ${idx + 1}`;
    if (idx === currentTripIndex) option.selected = true;
    tripSelect.appendChild(option);
  });
}

function switchTrip(idx) {
  if (!Number.isFinite(idx)) return;
  currentTripIndex = idx;
  currentFilter = "ALL";
  clearEbirdHotspots();
  render("ALL");
}

function makeIcon(type, day) {
  const color = typeColors[type] || "#2f6f4e";
  return L.divIcon({
    html: `<div style="
      background:${color}; color:white; width:30px; height:30px; border-radius:50%;
      display:flex; align-items:center; justify-content:center; border:2px solid white;
      box-shadow:0 2px 8px rgba(0,0,0,.35); font-size:11px; font-weight:700;">${day}</div>`,
    className: "",
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
}

function makeEbirdIcon() {
  return L.divIcon({
    html: `<div style="
      background:#1d78b5; width:18px; height:18px; border-radius:50%;
      border:2px solid white; box-shadow:0 2px 8px rgba(0,0,0,.35);"></div>`,
    className: "",
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
}

function ebirdHotspotUrl(locId) {
  return locId ? `https://ebird.org/hotspot/${encodeURIComponent(locId)}` : "https://ebird.org/hotspots";
}

function ebirdHotspotPopupHtml(hotspot = {}) {
  const locId = String(hotspot.locId || "").trim();
  const locName = String(hotspot.locName || "Unnamed hotspot").trim();
  const payload = {
    locId,
    locName,
    lat: Number(hotspot.lat),
    lng: Number(hotspot.lng)
  };
  return `
    <div class="popup-title">eBird 热点</div>
    <div class="popup-line"><b>${escapeHtml(locName)}</b></div>
    <div class="popup-line">locId: ${escapeHtml(locId)}</div>
    <div class="popup-line">坐标：${escapeHtml(hotspot.lat)}, ${escapeHtml(hotspot.lng)}</div>
    <div class="popup-actions">
      <a class="small-btn ebird" href="${escapeHtml(ebirdHotspotUrl(locId))}" target="_blank" rel="noopener noreferrer">在 eBird 打开</a>
      <button class="small-btn primary" onclick="addEbirdHotspotActivity(${escapeHtml(JSON.stringify(payload))})">添加活动</button>
    </div>
  `;
}

function addEbirdHotspotActivity(hotspot = {}) {
  if (!hotspot.locId) {
    alert("这个热点缺少 eBird locId，无法关联鸟种记录。");
    return;
  }
  const dayIndex = currentFilter !== "ALL" ? currentDays().findIndex(d => d.day === currentFilter) : 0;
  const targetDayIndex = dayIndex >= 0 ? dayIndex : 0;
  openAddDialog(targetDayIndex, {
    name: hotspot.locName || "eBird 热点",
    type: "bird",
    time: "待定",
    lat: Number(hotspot.lat),
    lng: Number(hotspot.lng),
    birds: "",
    transport: "",
    note: `来自 eBird 热点：${hotspot.locId}`,
    costMin: 0,
    costMax: 0,
    ebirdLocId: hotspot.locId,
    ebirdLocName: hotspot.locName || "",
    ebirdHotspotUrl: ebirdHotspotUrl(hotspot.locId)
  });
}


function stopMainLabel(stop) {
  if (!stop || !stop.type) return "内容";
  if (stop.type === "bird") return "目标鸟种";
  if (stop.type === "hotel") return "住宿说明";
  if (stop.type === "transport") return "交通说明";
  if (stop.type === "airport") return "航班/机场说明";
  return "内容";
}

function stopBudgetLabel(stop) {
  if (!stop || !stop.type) return "预算";
  if (stop.type === "hotel") return "住宿预算";
  if (stop.type === "transport") return "交通预算";
  if (stop.type === "airport") return "航班/机场预算";
  if (stop.type === "bird") return "鸟点相关费用";
  return "预算";
}

function updateTypeHelp() {
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
}



function stopMainLabel(stop) {
  if (!stop || !stop.type) return "内容";
  if (stop.type === "bird") return "目标鸟种";
  if (stop.type === "hotel") return "住宿说明";
  if (stop.type === "transport") return "交通说明";
  if (stop.type === "airport") return "航班/机场说明";
  return "内容";
}

function stopBudgetLabel(stop) {
  if (!stop || !stop.type) return "预算";
  if (stop.type === "hotel") return "住宿预算";
  if (stop.type === "transport") return "交通预算";
  if (stop.type === "airport") return "航班/机场预算";
  if (stop.type === "bird") return "鸟点相关费用";
  return "预算";
}

function updateTypeHelp() {
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
}



function googleMapsDirectionsUrl(stop) {
  return navigationUrl(stop);
}

function openGoogleMaps(stop) {
  const url = googleMapsDirectionsUrl(stop);
  window.open(url, "_blank", "noopener,noreferrer");
}

function googleMapsButtonHtml(stop, extraClass = "") {
  const url = googleMapsDirectionsUrl(stop);
  return `<a class="small-btn blue ${extraClass}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">在 ${escapeHtml(navigationEngineLabel())} 打开</a>`;
}


function popupHtml(stop, day, dayIndex = -1, stopIndex = -1) {
  const dayLabel = typeof day === "object" ? daySelectLabel(day) : day;
  const researchButton = stop.type === "bird" && dayIndex >= 0 && stopIndex >= 0
    ? `<button class="small-btn blue" onclick="openResearchDialog(${dayIndex}, ${stopIndex})">攻略文章</button>`
    : "";
  return `
    <div class="popup-title">${escapeHtml(dayLabel)}｜${escapeHtml(stop.name)}</div>
    <div class="popup-line"><b>类型：</b>${typeLabels[stop.type] || stop.type}</div>
    <div class="popup-line"><b>时间：</b>${escapeHtml(stopDateTimeLabel(stop, day))}</div>
    <div class="popup-line"><b>交通：</b>${escapeHtml(stop.transport)}</div>
    <div class="popup-birds"><b>${stopMainLabel(stop)}：</b>${escapeHtml(stop.birds)}</div>
    <div class="popup-birds">${renderNoteHtml(stop.note || "")}</div>
    <div class="popup-line"><b>${stopBudgetLabel(stop)}：</b>${escapeHtml(formatBudgetRange(stop.costMin, stop.costMax))}</div>
    <div class="popup-actions">${googleMapsButtonHtml(stop)}${researchButton}</div>
  `;
}

function renderButtons() {
  buttonsEl.innerHTML = "";
  if (!hasTrips()) {
    const btn = document.createElement("button");
    btn.textContent = "无行程";
    btn.className = "active";
    buttonsEl.appendChild(btn);
    return;
  }

  const allBtn = document.createElement("button");
  allBtn.textContent = "全部";
  allBtn.className = currentFilter === "ALL" ? "active" : "";
  allBtn.onclick = () => render("ALL");
  buttonsEl.appendChild(allBtn);

  currentDays().forEach(day => {
    const btn = document.createElement("button");
    btn.textContent = day.day;
    btn.className = currentFilter === day.day ? "active" : "";
    btn.onclick = () => render(day.day);
    buttonsEl.appendChild(btn);
  });
}

function renderCards(days) {
  itineraryEl.innerHTML = "";

  if (!hasTrips()) {
    itineraryEl.innerHTML = "";
    return;
  }
  const allDays = currentDays();

  days.forEach((day) => {
    const actualDayIndex = allDays.findIndex(d => d === day);
    const card = document.createElement("div");
    card.className = "day-card";
    card.innerHTML = `
      <div class="day-card-header">
        <h3>${escapeHtml(day.day)}｜${escapeHtml(day.title)}</h3>
        <p>${escapeHtml(dayMetaLabel(day))}</p>
        <div class="day-header-actions">
          <button class="small-btn primary" onclick="openAddDialog(${actualDayIndex})">＋ 给这一天新增活动</button>
          <button class="small-btn" onclick="openDayDialog(${actualDayIndex})">修改这一天</button>
          <button class="small-btn" onclick="moveDay(${actualDayIndex}, -1)">上移这一天</button>
          <button class="small-btn" onclick="moveDay(${actualDayIndex}, 1)">下移这一天</button>
          <button class="small-btn danger" onclick="deleteDay(${actualDayIndex})">删除这一天</button>
        </div>
      </div>
      ${day.stops.map((stop, stopIndex) => `
        <div class="stop">
          <div class="stop-top">
            <h4>${escapeHtml(stop.name)}</h4>
            <span class="time">${escapeHtml(stopDateTimeLabel(stop, day))}</span>
          </div>
          <div class="meta">${renderNoteHtml(stop.note || "")}</div>
          <div class="birds"><b>${stopMainLabel(stop)}：</b>${escapeHtml(stop.birds)}</div>
          <div class="transport-text"><b>交通：</b>${escapeHtml(stop.transport)}</div>
          <div class="cost-text"><b>${stopBudgetLabel(stop)}：</b>${escapeHtml(formatBudgetRange(stop.costMin, stop.costMax))}</div>
          <div class="stop-actions">
            ${stop.type === "bird" ? `<button class="small-btn blue" onclick="openBirdPreview(${actualDayIndex}, ${stopIndex})">鸟种预习</button>` : ""}
            ${stop.type === "bird" ? `<button class="small-btn blue" onclick="openResearchDialog(${actualDayIndex}, ${stopIndex})">攻略文章</button>` : ""}
            ${googleMapsButtonHtml(stop)}
            <button class="small-btn" onclick="openEditDialog(${actualDayIndex}, ${stopIndex})">修改</button>
            <button class="small-btn" onclick="moveStop(${actualDayIndex}, ${stopIndex}, -1)">上移</button>
            <button class="small-btn" onclick="moveStop(${actualDayIndex}, ${stopIndex}, 1)">下移</button>
            <button class="small-btn danger" onclick="deleteStop(${actualDayIndex}, ${stopIndex})">删除</button>
          </div>
        </div>
      `).join("")}
    `;
    itineraryEl.appendChild(card);
  });
}

function renderMap(days) {
  if (!map) return;

  if (!hasTrips()) {
    markerLayer.clearLayers();
    routeLayer.clearLayers();
    map.setView([23.7, 121.0], 3);
    setTimeout(() => map.invalidateSize(), 100);
    return;
  }

  markerLayer.clearLayers();
  routeLayer.clearLayers();

  const bounds = [];
  const allDays = currentDays();
  days.forEach(day => {
    const actualDayIndex = allDays.findIndex(d => d === day);
    const points = [];

    day.stops.forEach((stop, stopIndex) => {
      const lat = Number(stop.lat);
      const lng = Number(stop.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const marker = L.marker([lat, lng], {
        icon: makeIcon(stop.type, day.day.replace("D",""))
      }).bindPopup(popupHtml(stop, day, actualDayIndex, stopIndex));

      marker.addTo(markerLayer);
      bounds.push([lat, lng]);
      points.push([lat, lng]);
    });

    if (points.length > 1) {
      L.polyline(points, {
        color: "#2f6f4e",
        weight: 3,
        opacity: 0.55,
        dashArray: "8,8"
      }).addTo(routeLayer);
    }
  });

  if (bounds.length > 0) {
    map.fitBounds(bounds, { padding: [42, 42], maxZoom: 12 });
  } else {
    const c = currentTrip().center || { lat: 23.7, lng: 121, zoom: 7 };
    map.setView([c.lat, c.lng], c.zoom || 7);
  }

  setTimeout(() => map.invalidateSize(), 100);
}

function renderSummary() {
  const trip = currentTrip();
  if (hasTrips()) prepareTripForSave(trip);
  document.title = hasTrips() ? `BirdRoute · ${trip.title || "未命名行程"}` : "BirdRoute · Birding Trip Planner";
  document.getElementById("pageTitle").textContent = hasTrips() ? `BirdRoute · ${trip.title || "未命名行程"}` : "BirdRoute";
  document.getElementById("pageSubtitle").textContent = trip.subtitle || "观鸟行程规划与野外清单";
  document.getElementById("tripSummaryTitle").textContent = trip.title || "路线概览";
  document.getElementById("tripSummaryText").textContent = trip.summary || "暂无概览。";
  renderTripSocialMeta(trip);

  const totals = budgetTotals();
  const currency = activeDisplayCurrency();
  document.getElementById("costMin").textContent = formatAmount(totals.min, currency);
  document.getElementById("costMax").textContent = formatAmount(totals.max, currency);
  const select = document.getElementById("displayCurrencySelect");
  if (select) select.value = displayCurrency || "";
  updateFxStatus();
  renderMapSettings();
}

function renderTripSocialMeta(trip) {
  const el = document.getElementById("tripSocialMeta");
  if (!el) return;
  if (!hasTrips()) {
    el.innerHTML = "";
    return;
  }
  const visibility = normalizeTripVisibility(trip.visibility);
  const chips = [
    `<span class="chip ${visibility}">${TRIP_VISIBILITY_LABELS[visibility]}</span>`,
    `<span class="chip">地点：${escapeHtml(trip.primaryLocation || "未设置地点")}</span>`,
    `<span class="chip">属性：${escapeHtml(trip.tripPace || DEFAULT_TRIP_PACE)}</span>`,
    trip.copiedFromPublic ? `<span class="chip copy">${trip.copyModified ? "公开副本已修改" : "公开副本未修改"}</span>` : ""
  ];
  (trip.birdTags || []).slice(0, 6).forEach(tag => chips.push(`<span class="chip">${escapeHtml(tag)}</span>`));
  el.innerHTML = chips.filter(Boolean).join("");
}

function publicTripSearchDomIds(context = "app") {
  return context === "welcome"
    ? {
        input: "welcomePublicTripSearchInput",
        status: "welcomePublicTripSearchStatus",
        results: "welcomePublicTripSearchResults"
      }
    : {
        input: "publicTripSearchInput",
        status: "publicTripSearchStatus",
        results: "publicTripSearchResults"
      };
}

function setPublicTripSearchStatus(message, isError = false, context = "app") {
  const el = document.getElementById(publicTripSearchDomIds(context).status);
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "var(--red)" : "var(--muted)";
}

function renderPublicTripSearchResults(results = [], context = "app") {
  const el = document.getElementById(publicTripSearchDomIds(context).results);
  if (!el) return;
  if (!results.length) {
    el.innerHTML = `<div class="hint">没有找到匹配的公开行程。</div>`;
    return;
  }
  el.innerHTML = results.map(card => {
    const tags = [
      card.primaryLocation ? `地点：${card.primaryLocation}` : "",
      card.tripPace ? `属性：${card.tripPace}` : "",
      `${card.dayCount || 0} 天`,
      `${card.stopCount || 0} 个活动`,
      ...(card.birdTags || []).slice(0, 5),
      ...(card.locationTags || []).slice(0, 3)
    ].filter(Boolean);
    return `
      <div class="public-trip-card">
        <h3>${escapeHtml(card.title || "未命名公开行程")}</h3>
        <div class="hint">开放用户：${escapeHtml(card.owner || "")}${card.isOwn ? "｜你的公开行程" : ""}</div>
        <p>${escapeHtml(card.summary || card.subtitle || "暂无简介。")}</p>
        <div class="chip-row">
          ${tags.map(tag => `<span class="chip">${escapeHtml(tag)}</span>`).join("")}
        </div>
        <div class="row" style="margin-top:10px;">
          <button class="small-btn blue" onclick="importPublicTrip(${escapeHtml(JSON.stringify(card.owner || ""))}, ${escapeHtml(JSON.stringify(card.tripId || ""))}, ${escapeHtml(JSON.stringify(context))})">导入为私有副本</button>
        </div>
      </div>
    `;
  }).join("");
}

async function searchPublicTrips(context = "app") {
  const query = document.getElementById(publicTripSearchDomIds(context).input)?.value.trim() || "";
  setPublicTripSearchStatus("正在搜索公开行程...", false, context);
  try {
    const data = await apiFetch(`/api/public-trips/search?q=${encodeURIComponent(query)}&limit=30`);
    renderPublicTripSearchResults(data.results || [], context);
    setPublicTripSearchStatus(`已找到 ${(data.results || []).length} 条公开行程。`, false, context);
  } catch (e) {
    setPublicTripSearchStatus("搜索公开行程失败：" + e.message, true, context);
  }
}

async function importPublicTrip(owner, tripId, context = "app") {
  setPublicTripSearchStatus("正在导入公开行程...", false, context);
  try {
    const data = await apiFetch("/api/public-trips/import", {
      method: "POST",
      body: { owner, tripId }
    });
    const trip = data.trip;
    if (trip) {
      if (sessionMode === "pending") {
        currentUser = null;
        clearTripRuntimeState();
        sessionMode = "guest";
        document.body.classList.remove("welcome-mode");
        setAuthStatus("");
        updateAccountStatus();
      }
      trips.push(trip);
      currentTripIndex = trips.length - 1;
      currentFilter = "ALL";
      persistLocalTripsOnly();
      clearEbirdHotspots();
      render("ALL");
    }
    setPublicTripSearchStatus(data.persisted
      ? "已导入为账号私有副本。修改并保存后，才可以再次设为公开。"
      : "已导入为游客临时私有副本。本次页面可导出 JSON，但不会写入浏览器缓存。", false, context);
    showToast("公开行程已导入");
    if (context === "app") closePublicTripSearchDialog();
  } catch (e) {
    setPublicTripSearchStatus("导入公开行程失败：" + e.message, true, context);
  }
}

function render(filter = currentFilter) {
  document.body.classList.toggle("no-trip", !hasTrips());
  document.body.classList.toggle("has-trip", hasTrips());
  currentFilter = filter;
  const days = filter === "ALL" ? currentDays() : currentDays().filter(d => d.day === filter);
  renderTripSelect();
  renderButtons();
  renderSummary();
  renderCards(days);
  renderMap(days);
}

function populateDaySelect(selectedIndex = 0) {
  const select = document.getElementById("daySelect");
  select.innerHTML = "";
  currentDays().forEach((day, index) => {
    const option = document.createElement("option");
    option.value = index;
    option.textContent = daySelectLabel(day);
    if (index === selectedIndex) option.selected = true;
    select.appendChild(option);
  });
}

function syncActivityDateToSelectedDay() {
  renderEbirdSpeciesPickerButton();
}

function renderEbirdSpeciesPickerButton() {
  const row = document.getElementById("ebirdSpeciesPickerRow");
  const hint = document.getElementById("ebirdSpeciesPickerHint");
  if (!row) return;
  const locId = document.getElementById("ebirdLocIdInput")?.value.trim();
  const isNewStop = !document.getElementById("editStopIndex")?.value;
  const isBirdStop = (document.getElementById("typeInput")?.value || "bird") === "bird";
  const visible = Boolean(locId && isNewStop && isBirdStop);
  row.style.display = visible ? "flex" : "none";
  if (hint && visible) {
    const locName = document.getElementById("ebirdLocNameInput")?.value.trim() || locId;
    hint.textContent = `当前热点：${locName}`;
  }
}

function setFormStop(stop = {}, dayIndex = 0) {
  const day = currentDays()[dayIndex] || {};
  completeStopSchedule(stop, day);
  document.getElementById("timeInput").value = stop.time || "";
  document.getElementById("nameInput").value = stop.name || "";
  document.getElementById("typeInput").value = stop.type || "bird";
  document.getElementById("latInput").value = stop.lat ?? "";
  document.getElementById("lngInput").value = stop.lng ?? "";
  document.getElementById("birdsInput").value = stop.birds || "";
  document.getElementById("transportInput").value = stop.transport || "";
  document.getElementById("noteInput").value = stop.note || "";
  document.getElementById("costMinInput").value = stop.costMin ?? "";
  document.getElementById("costMaxInput").value = stop.costMax ?? "";
  document.getElementById("ebirdLocIdInput").value = stop.ebirdLocId || "";
  document.getElementById("ebirdLocNameInput").value = stop.ebirdLocName || "";
  document.getElementById("ebirdHotspotUrlInput").value = stop.ebirdHotspotUrl || "";
  document.getElementById("geocodeResults").innerHTML = "";
  BR.updateTypeHelp();
  renderEbirdSpeciesPickerButton();
}

function openAddDialog(dayIndex = null, preset = {}) {
  if (!hasTrips()) {
    alert("请先创建或导入一个整体行程。");
    openTripDialog();
    return;
  }
  if (currentDays().length === 0) {
    currentDays().push({ day: "D1", date: defaultDayDate(0), title: "新的一天", stay: "住宿：待定", stops: [] });
  }

  if (dayIndex === null || dayIndex === undefined) {
    dayIndex = currentFilter !== "ALL" ? currentDays().findIndex(d => d.day === currentFilter) : 0;
  }
  if (dayIndex < 0) dayIndex = 0;

  document.getElementById("dialogTitle").textContent = "新增活动";
  document.getElementById("editDayIndex").value = dayIndex;
  document.getElementById("editStopIndex").value = "";

  populateDaySelect(dayIndex);
  setFormStop(preset, dayIndex);
  dialog.showModal();
}

function openEditDialog(dayIndex, stopIndex) {
  const stop = currentDays()[dayIndex].stops[stopIndex];

  document.getElementById("dialogTitle").textContent = "修改活动";
  document.getElementById("editDayIndex").value = dayIndex;
  document.getElementById("editStopIndex").value = stopIndex;

  populateDaySelect(dayIndex);
  setFormStop(stop, dayIndex);
  dialog.showModal();
}

function currentEbirdPickerTarget() {
  const dayIndex = Number(document.getElementById("daySelect").value);
  const day = currentDays()[dayIndex] || {};
  const targetDate = normalizeDateOnly(day.date);
  return {
    locId: document.getElementById("ebirdLocIdInput").value.trim(),
    locName: document.getElementById("ebirdLocNameInput").value.trim(),
    targetDate,
    day
  };
}

function setEbirdSpeciesStatus(message, isError = false) {
  const el = document.getElementById("ebirdSpeciesStatus");
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "var(--red)" : "var(--muted)";
}

function renderEbirdSpeciesRows(species = []) {
  const el = document.getElementById("ebirdSpeciesRows");
  if (!el) return;
  if (!species.length) {
    el.innerHTML = `<div class="hint" style="margin-top:12px;">没有查到该热点在近两年同期前后一周的鸟种记录。</div>`;
    return;
  }
  el.innerHTML = `
    <table class="ebird-species-table">
      <thead>
        <tr>
          <th>选择</th>
          <th>中文名</th>
          <th>英文名</th>
          <th>学名</th>
          <th>记录</th>
        </tr>
      </thead>
      <tbody>
        ${species.map((item, index) => `
          <tr>
            <td><input type="checkbox" class="ebird-species-check" data-index="${index}"></td>
            <td>${escapeHtml(item.chineseName || item.commonName || "-")}</td>
            <td>${escapeHtml(item.englishName || "-")}</td>
            <td><i>${escapeHtml(item.scientificName || "-")}</i></td>
            <td>${escapeHtml(String(item.observationCount || 0))} 次${item.observationDates?.length ? `｜${escapeHtml(item.observationDates.slice(0, 4).join(", "))}` : ""}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

async function openEbirdSpeciesPicker() {
  const target = currentEbirdPickerTarget();
  if (!target.locId) {
    alert("当前活动没有关联 eBird 热点。");
    return;
  }
  if (!target.targetDate) {
    alert("请先在“修改行程”里填写行程开始日期。");
    return;
  }
  if (!ebirdTokenStatus.valid) {
    const status = await refreshEbirdTokenStatus(true);
    if (!status.valid) return;
  }

  ebirdSpeciesPickerState = {
    locId: target.locId,
    locName: target.locName || target.locId,
    targetDate: target.targetDate,
    species: []
  };
  document.getElementById("ebirdSpeciesDialogTitle").textContent = `从 eBird 选取鸟种｜${ebirdSpeciesPickerState.locName}`;
  document.getElementById("ebirdSpeciesRows").innerHTML = "";
  setEbirdSpeciesStatus(`正在查询 ${target.locId} 在 ${target.targetDate} 近两年同期前后一周的鸟种记录...`);
  ebirdSpeciesDialog.showModal();

  try {
    const data = await apiFetch(`/api/ebird/hotspot-species?locId=${encodeURIComponent(target.locId)}&date=${encodeURIComponent(target.targetDate)}&years=2&window=7`);
    const species = Array.isArray(data.species) ? data.species : [];
    cacheBirdMappings(data.mappings || []);
    ebirdSpeciesPickerState.species = species;
    const windows = Array.isArray(data.windows) ? data.windows : [];
    const windowText = windows.map(w => `${w.startDate}~${w.endDate}`).join("；");
    const warnings = Array.isArray(data.warnings) ? data.warnings.filter(Boolean) : [];
    const cacheText = data.cacheHit ? (data.cacheStale ? "使用旧缓存。" : "使用缓存。") : "";
    const warningText = warnings.length ? `提示：${warnings.join("；")}` : "";
    setEbirdSpeciesStatus(`查到 ${species.length} 个鸟种。查询窗口：${windowText || "无"}。已写入/更新 ${data.mappingsSaved || 0} 条鸟名映射。${cacheText}${warningText}`, Boolean(data.partial && !species.length));
    renderEbirdSpeciesRows(species);
  } catch (e) {
    setEbirdSpeciesStatus("eBird 鸟种查询失败：" + e.message, true);
    renderEbirdSpeciesRows([]);
  }
}

function closeEbirdSpeciesDialog() {
  ebirdSpeciesDialog.close();
}

function setAllEbirdSpeciesChecked(checked) {
  document.querySelectorAll(".ebird-species-check").forEach(input => {
    input.checked = checked;
  });
}

function confirmEbirdSpeciesSelection() {
  const selected = Array.from(document.querySelectorAll(".ebird-species-check:checked"))
    .map(input => ebirdSpeciesPickerState.species[Number(input.dataset.index)])
    .filter(Boolean)
    .map(item => item.chineseName || item.commonName || item.englishName || item.scientificName || "")
    .filter(Boolean);
  if (!selected.length) {
    alert("请先勾选至少一个鸟种。");
    return;
  }
  const input = document.getElementById("birdsInput");
  const existing = String(input.value || "").split(/[、,，;；\n\/]+/).map(normalizeBirdName).filter(Boolean);
  input.value = uniqueBirdNames([...existing, ...selected]).join("、");
  closeEbirdSpeciesDialog();
  showToast(`已写入 ${selected.length} 个 eBird 鸟种`);
}

function closeDialog() { dialog.close(); }

async function saveStopFromDialog() {
  if (stopSaveInProgress) return;
  const oldDayIndex = Number(document.getElementById("editDayIndex").value);
  const stopIndexRaw = document.getElementById("editStopIndex").value;
  const stopIndex = stopIndexRaw === "" ? null : Number(stopIndexRaw);
  const newDayIndex = Number(document.getElementById("daySelect").value);
  const days = currentDays();
  const selectedDay = days[newDayIndex] || {};

  const stop = {
    id: stopIndex === null ? makeClientId("stop") : (currentDays()[oldDayIndex]?.stops?.[stopIndex]?.id || makeClientId("stop")),
    name: document.getElementById("nameInput").value.trim() || "未命名活动",
    type: document.getElementById("typeInput").value,
    time: document.getElementById("timeInput").value.trim() || "待定",
    date: scheduleDateFromStop({}, selectedDay),
    lat: Number(document.getElementById("latInput").value),
    lng: Number(document.getElementById("lngInput").value),
    birds: document.getElementById("birdsInput").value.trim(),
    transport: document.getElementById("transportInput").value.trim(),
    note: document.getElementById("noteInput").value.trim(),
    costMin: money(document.getElementById("costMinInput").value),
    costMax: money(document.getElementById("costMaxInput").value),
    ebirdLocId: document.getElementById("ebirdLocIdInput").value.trim(),
    ebirdLocName: document.getElementById("ebirdLocNameInput").value.trim(),
    ebirdHotspotUrl: document.getElementById("ebirdHotspotUrlInput").value.trim()
  };
  if (!stop.ebirdLocId) {
    delete stop.ebirdLocId;
    delete stop.ebirdLocName;
    delete stop.ebirdHotspotUrl;
  }
  completeStopSchedule(stop, selectedDay);
  if (!normalizeDateOnly(selectedDay.date) && stop.date) selectedDay.date = stop.date;

  if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) {
    alert("请填写有效经纬度，否则地图无法显示该活动。");
    return;
  }

  if (stop.type === "bird") {
    const names = parseBirdNames(stop.birds);
    if (names.length) {
      stopSaveInProgress = true;
      try {
        const ok = await ensureBirdMappingsForNames(names, { promptMissing: true });
        if (!ok) {
          showToast("已取消保存活动");
          return;
        }
      } finally {
        stopSaveInProgress = false;
      }
    }
  }

  if (stopIndex === null) {
    days[newDayIndex].stops.push(stop);
  } else {
    if (oldDayIndex === newDayIndex) {
      days[oldDayIndex].stops[stopIndex] = stop;
    } else {
      days[oldDayIndex].stops.splice(stopIndex, 1);
      days[newDayIndex].stops.push(stop);
    }
  }

  markTripLocallyModified();
  saveTrips();
  dialog.close();
  render(currentFilter);
  showToast("活动已保存");
}

function deleteStop(dayIndex, stopIndex) {
  const stop = currentDays()[dayIndex].stops[stopIndex];
  if (!confirm(`确定删除「${stop.name}」吗？`)) return;
  currentDays()[dayIndex].stops.splice(stopIndex, 1);
  markTripLocallyModified();
  saveTrips();
  render(currentFilter);
  showToast("已删除活动");
}

function moveStop(dayIndex, stopIndex, direction) {
  const stops = currentDays()[dayIndex].stops;
  const newIndex = stopIndex + direction;
  if (newIndex < 0 || newIndex >= stops.length) return;
  [stops[stopIndex], stops[newIndex]] = [stops[newIndex], stops[stopIndex]];
  markTripLocallyModified();
  saveTrips();
  render(currentFilter);
  showToast("活动顺序已调整");
}

function openDayDialog(dayIndex = null) {
  if (!hasTrips()) {
    alert("请先创建或导入一个整体行程。");
    openTripDialog();
    return;
  }
  document.getElementById("editDayOnlyIndex").value = dayIndex === null || dayIndex === undefined ? "" : dayIndex;

  if (dayIndex === null || dayIndex === undefined) {
    document.getElementById("dayDialogTitle").textContent = "新增一天";
    document.getElementById("dayCodeInput").value = `D${currentDays().length + 1}`;
    document.getElementById("dayTitleInput").value = "";
    document.getElementById("dayStayInput").value = "";
  } else {
    const day = currentDays()[dayIndex];
    document.getElementById("dayDialogTitle").textContent = "修改这一天";
    document.getElementById("dayCodeInput").value = day.day || "";
    document.getElementById("dayTitleInput").value = day.title || "";
    document.getElementById("dayStayInput").value = day.stay || "";
  }

  dayDialog.showModal();
}

function closeDayDialog() { dayDialog.close(); }

function saveDayFromDialog() {
  const idxRaw = document.getElementById("editDayOnlyIndex").value;
  const idx = idxRaw === "" ? null : Number(idxRaw);
  const days = currentDays();
  const nextDate = defaultDayDate(idx === null ? days.length : idx);

  const day = {
    day: document.getElementById("dayCodeInput").value.trim() || `D${days.length + 1}`,
    date: nextDate,
    title: document.getElementById("dayTitleInput").value.trim() || "未命名行程日",
    stay: document.getElementById("dayStayInput").value.trim() || "住宿：待定",
    stops: idx === null ? [] : days[idx].stops
  };
  day.stops.forEach(stop => completeStopSchedule(stop, day));

  if (idx === null) {
    days.push(day);
    currentFilter = day.day;
  } else {
    const oldDayCode = days[idx].day;
    days[idx] = day;
    if (currentFilter === oldDayCode) currentFilter = day.day;
  }

  markTripLocallyModified();
  saveTrips();
  dayDialog.close();
  render(currentFilter);
  showToast("当天行程已保存");
}

function deleteDay(dayIndex) {
  const day = currentDays()[dayIndex];
  if (!confirm(`确定删除「${day.day}｜${day.title}」以及其中 ${day.stops.length} 个活动吗？`)) return;
  currentDays().splice(dayIndex, 1);
  markTripLocallyModified();
  saveTrips();
  if (currentFilter === day.day) currentFilter = "ALL";
  render(currentFilter);
  showToast("已删除这一天");
}

function moveDay(dayIndex, direction) {
  const days = currentDays();
  const newIndex = dayIndex + direction;
  if (newIndex < 0 || newIndex >= days.length) return;
  [days[dayIndex], days[newIndex]] = [days[newIndex], days[dayIndex]];
  markTripLocallyModified();
  saveTrips();
  render(currentFilter);
  showToast("天顺序已调整");
}


function openTripDialog(tripIndex = null) {
  document.getElementById("editTripIndex").value = tripIndex === null || tripIndex === undefined ? "" : tripIndex;

  if (tripIndex === null || tripIndex === undefined) {
    document.getElementById("tripDialogTitle").textContent = "新增整体行程";
    document.getElementById("tripTitleInput").value = "";
    document.getElementById("tripSubtitleInput").value = "";
    document.getElementById("tripCurrencyInput").value = "CNY";
    document.getElementById("tripStartDateInput").value = todayDateString();
    document.getElementById("tripEndDateInput").value = todayDateString();
    document.getElementById("tripPrimaryLocationInput").value = "";
    document.getElementById("tripPaceInput").value = DEFAULT_TRIP_PACE;
    document.getElementById("tripVisibilityInput").value = "private";
    document.getElementById("tripVisibilityHint").textContent = "新建行程默认为私有；公开后可被其他用户搜索并导入。";
    document.getElementById("tripSummaryInput").value = "";
    document.getElementById("tripCenterLatInput").value = "";
    document.getElementById("tripCenterLngInput").value = "";
  } else {
    const trip = trips[tripIndex];
    document.getElementById("tripDialogTitle").textContent = "修改整体行程";
    document.getElementById("tripTitleInput").value = trip.title || "";
    document.getElementById("tripSubtitleInput").value = trip.subtitle || "";
    document.getElementById("tripCurrencyInput").value = normalizeCurrency(trip.currency || "CNY");
    document.getElementById("tripStartDateInput").value = normalizeDateOnly(trip.startDate);
    document.getElementById("tripEndDateInput").value = normalizeDateOnly(trip.endDate) || addDaysToDate(trip.startDate, Math.max(0, (trip.days || []).length - 1));
    document.getElementById("tripPrimaryLocationInput").value = trip.primaryLocation || deriveTripPrimaryLocation(trip);
    document.getElementById("tripPaceInput").value = trip.tripPace || DEFAULT_TRIP_PACE;
    document.getElementById("tripVisibilityInput").value = normalizeTripVisibility(trip.visibility);
    document.getElementById("tripVisibilityHint").textContent = trip.copiedFromPublic && !trip.copyModified
      ? "这是从公开行程导入的副本。请先修改并保存一次，再设置为公开检索。"
      : "公开后可被其他用户按名称、地点、属性和目标鸟种搜索到。";
    document.getElementById("tripSummaryInput").value = trip.summary || "";
    document.getElementById("tripCenterLatInput").value = trip.center?.lat ?? "";
    document.getElementById("tripCenterLngInput").value = trip.center?.lng ?? "";
  }

  tripDialog.showModal();
}

function closeTripDialog() { tripDialog.close(); }

function saveTripFromDialog() {
  const idxRaw = document.getElementById("editTripIndex").value;
  const idx = idxRaw === "" ? null : Number(idxRaw);

  const title = document.getElementById("tripTitleInput").value.trim() || "未命名整体行程";
  const centerLat = Number(document.getElementById("tripCenterLatInput").value);
  const centerLng = Number(document.getElementById("tripCenterLngInput").value);
  const startDate = normalizeDateOnly(document.getElementById("tripStartDateInput").value);
  const endDate = normalizeDateOnly(document.getElementById("tripEndDateInput").value);
  if (startDate && endDate && endDate < startDate) {
    alert("行程结束日期不能早于开始日期。");
    return;
  }
  let visibility = normalizeTripVisibility(document.getElementById("tripVisibilityInput").value);
  const existingTrip = idx === null ? null : trips[idx];
  if (visibility === "public" && existingTrip?.copiedFromPublic && !existingTrip.copyModified) {
    alert("这是从公开行程导入的副本。请先对行程内容进行修改并保存后，再设置为公开检索。");
    visibility = "private";
  }

  const trip = {
    id: idx === null ? makeClientId("trip") : (trips[idx].id || makeClientId("trip")),
    title,
    subtitle: document.getElementById("tripSubtitleInput").value.trim() || "自定义旅行行程",
    currency: normalizeCurrency(document.getElementById("tripCurrencyInput").value.trim() || "CNY"),
    startDate,
    endDate,
    summary: document.getElementById("tripSummaryInput").value.trim() || "暂无概览。",
    primaryLocation: document.getElementById("tripPrimaryLocationInput").value.trim(),
    tripPace: document.getElementById("tripPaceInput").value || DEFAULT_TRIP_PACE,
    visibility,
    center: {
      lat: Number.isFinite(centerLat) ? centerLat : 23.7,
      lng: Number.isFinite(centerLng) ? centerLng : 121.0,
      zoom: 7
    },
    createdAt: idx === null ? new Date().toISOString() : (trips[idx].createdAt || new Date().toISOString()),
    quickInfo: idx === null ? [] : normalizeQuickInfoItems(existingTrip?.quickInfo || []),
    quickInfoUpdatedAt: idx === null ? "" : (existingTrip?.quickInfoUpdatedAt || ""),
    days: idx === null ? [{ day: "D1", title: "第一天", stay: "住宿：待定", stops: [] }] : trips[idx].days,
    copiedFromPublic: existingTrip?.copiedFromPublic || false,
    sourcePublicTripOwner: existingTrip?.sourcePublicTripOwner || "",
    sourcePublicTripId: existingTrip?.sourcePublicTripId || "",
    sourcePublicTripTitle: existingTrip?.sourcePublicTripTitle || "",
    sourceFingerprint: existingTrip?.sourceFingerprint || "",
    copyModified: existingTrip?.copyModified || false
  };
  prepareTripForSave(trip);

  if (idx === null) {
    trips.push(trip);
    currentTripIndex = trips.length - 1;
    currentFilter = "ALL";
  } else {
    trips[idx] = trip;
  }

  saveTrips();
  tripDialog.close();
  render(currentFilter);
  showToast("整体行程已保存");
}

async function deleteTrip() {
  if (!hasTrips()) {
    alert("当前没有行程。");
    return;
  }

  const selectedIndex = Number(document.getElementById("tripSelect")?.value);
  const targetIndex = Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < trips.length
    ? selectedIndex
    : currentTripIndex;
  const trip = trips[targetIndex];
  if (!trip) {
    alert("当前没有选中的行程。");
    return;
  }
  currentTripIndex = targetIndex;
  if (!confirm(`确定删除当前行程「${trip.title || "未命名行程"}」吗？`)) return;

  const tripId = trip.id || "";
  if (sessionMode === "account" && currentUser) {
    if (!tripId) {
      alert("当前行程缺少 ID，无法安全删除。请先刷新账号行程后再试。");
      return;
    }

    updateAccountStatus("正在保存当前修改后删除行程...");
    const syncIdle = await flushScheduledBackendSync();
    if (!syncIdle) {
      updateAccountStatus("删除已暂停：当前同步尚未完成");
      alert("当前账号同步还没有完成。请稍后再删除这个行程。");
      return;
    }

    try {
      updateAccountStatus(`正在删除当前行程：${trip.title || "未命名行程"}`);
      await apiFetch(`/api/trips/${encodeURIComponent(tripId)}`, { method: "DELETE" });
      const nextIndex = Math.max(0, Math.min(targetIndex, trips.length - 2));
      await loadTripsFromBackend();
      currentTripIndex = Math.max(0, Math.min(nextIndex, trips.length - 1));
      currentFilter = "ALL";
      persistLocalTripsOnly();
      clearEbirdHotspots();
      render("ALL");
      updateAccountStatus(`已删除当前行程：${currentUser.username}`);
      showToast("已删除当前行程");
      return;
    } catch (e) {
      if (!/行程不存在/.test(e.message || "")) {
        updateAccountStatus(`删除失败：${e.message}`);
        alert("删除当前行程失败：" + e.message);
        return;
      }
      await loadTripsFromBackend();
      showToast("当前行程已不存在，已刷新行程列表");
      return;
    }
  }

  const removeIndex = tripId ? trips.findIndex(item => item.id === tripId) : currentTripIndex;
  trips.splice(removeIndex >= 0 ? removeIndex : currentTripIndex, 1);
  currentTripIndex = Math.max(0, Math.min(currentTripIndex, trips.length - 1));
  currentFilter = "ALL";
  persistLocalTripsOnly();
  clearEbirdHotspots();
  render("ALL");
  updateAccountStatus();
  showToast("已删除当前行程");
}


function setDisplayCurrency(code) {
  displayCurrency = normalizeCurrency(code || "");
  if (!code) displayCurrency = "";
  saveFxCache();
  if (!displayCurrency) {
    render(currentFilter);
    return;
  }
  const base = activeBaseCurrency();
  if (displayCurrency !== base && !canConvert()) {
    refreshExchangeRates().finally(() => render(currentFilter));
  } else {
    render(currentFilter);
  }
}

function updateFxStatus() {
  const el = document.getElementById("fxStatus");
  if (!el) return;
  const base = activeBaseCurrency();
  const target = activeDisplayCurrency();
  if (!displayCurrency || base === target) {
    el.textContent = `汇率状态：使用原币种 ${base}`;
    return;
  }
  if (canConvert()) {
    const rate = Number(fxCache.rates[target]);
    const t = fxCache.updatedAt ? new Date(fxCache.updatedAt).toLocaleString() : "未知时间";
    el.textContent = `汇率状态：1 ${base} = ${rate.toFixed(4)} ${target}｜${t}`;
  } else {
    el.textContent = `汇率状态：暂无 ${base} → ${target} 汇率，预算暂按原数值显示`;
  }
}

async function refreshExchangeRates() {
  const base = activeBaseCurrency();
  const target = activeDisplayCurrency();
  if (!displayCurrency || base === target) {
    updateFxStatus();
    showToast(`当前使用原币种 ${base}`);
    return;
  }

  const status = document.getElementById("fxStatus");
  if (status) status.textContent = `汇率状态：正在查询 ${base} → ${target}...`;

  const symbols = encodeURIComponent(target);
  const urls = [
    `https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}&to=${symbols}`,
    `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`
  ];

  let lastError = null;

  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      let rates = {};
      if (data.rates) rates = data.rates;
      else if (data.conversion_rates) rates = data.conversion_rates;

      const rate = Number(rates[target]);
      if (!Number.isFinite(rate)) throw new Error(`未返回 ${target} 汇率`);

      fxCache = {
        base,
        rates: { ...rates, [base]: 1 },
        updatedAt: new Date().toISOString(),
        source: url.includes("frankfurter") ? "Frankfurter" : "open.er-api.com"
      };

      saveFxCache();
      updateFxStatus();
      showToast(`已更新汇率：1 ${base} = ${rate.toFixed(4)} ${target}`);
      return;
    } catch (e) {
      lastError = e;
    }
  }

  updateFxStatus();
  alert("实时汇率查询失败：" + (lastError?.message || "未知错误") + "\\n请检查网络，或稍后再试。");
}

function saveFxCache() {
  try {
    localStorage.setItem(STORAGE_KEY + "_fx", JSON.stringify({ displayCurrency, fxCache }));
  } catch (e) {}
}

function loadFxCache() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY + "_fx") || "{}");
    displayCurrency = saved.displayCurrency || "";
    fxCache = saved.fxCache || fxCache;
  } catch (e) {}
}

async function geocodeIntoForm() {
  const q = document.getElementById("nameInput").value.trim();
  const resultsEl = document.getElementById("geocodeResults");
  resultsEl.innerHTML = "";

  if (!q) {
    alert("请先填写地点/活动名称。");
    return;
  }

  resultsEl.innerHTML = `<div class="hint">查询中...</div>`;

  try {
    const payload = await apiFetch(`/api/geocode/search?q=${encodeURIComponent(q)}&limit=5`);
    const data = Array.isArray(payload.results) ? payload.results : [];
    resultsEl.innerHTML = "";

    if (!data.length) {
      resultsEl.innerHTML = `<div class="hint">没有找到结果。可以换成英文名或更完整地址。</div>`;
      return;
    }
    if (payload.cacheHit) {
      const cacheText = payload.cacheStale ? "使用旧缓存结果。" : "使用缓存结果。";
      resultsEl.innerHTML = `<div class="hint">${cacheText}</div>`;
    }
    if (Array.isArray(payload.warnings) && payload.warnings.length) {
      const warning = document.createElement("div");
      warning.className = "hint";
      warning.textContent = payload.warnings.join("；");
      resultsEl.appendChild(warning);
    }

    data.forEach(item => {
      const div = document.createElement("div");
      div.className = "search-result";
      div.innerHTML = `<b>${escapeHtml(item.display_name)}</b><br><span class="hint">lat ${item.lat}, lng ${item.lon}</span>`;
      div.onclick = () => {
        document.getElementById("latInput").value = Number(item.lat).toFixed(6);
        document.getElementById("lngInput").value = Number(item.lon).toFixed(6);
        resultsEl.innerHTML = `<div class="hint">已填入坐标：${Number(item.lat).toFixed(6)}, ${Number(item.lon).toFixed(6)}</div>`;
      };
      resultsEl.appendChild(div);
    });
  } catch (e) {
    resultsEl.innerHTML = `<div class="hint">查询失败：${escapeHtml(e.message)}。请检查网络或手动填写坐标。</div>`;
  }
}


function openEbirdHelp() {
  ebirdHelpDialog.showModal();
}

function closeEbirdHelp() {
  ebirdHelpDialog.close();
}

async function loadEbirdHotspots() {
  if (!map || !ebirdLayer) return;
  if (sessionMode !== "account") {
    alert("请先登录账号并保存 eBird API Token。游客模式不会把 token 暴露给前端。");
    return;
  }
  if (!hasSavedEbirdToken()) {
    renderEbirdHotspotActions();
    alert("请先在设置里保存 eBird API Token。");
    return;
  }
  if (!ebirdTokenStatus.valid) {
    const status = await refreshEbirdTokenStatus(true);
    if (!status.valid) return;
  }

  const center = map.getCenter();
  const url = `/api/ebird/hotspots?lat=${encodeURIComponent(center.lat.toFixed(6))}&lng=${encodeURIComponent(center.lng.toFixed(6))}&dist=50`;

  try {
    const payload = await apiFetch(url);
    const data = Array.isArray(payload.hotspots) ? payload.hotspots : [];
    ebirdLayer.clearLayers();

    data.forEach(h => {
      if (!h.lat || !h.lng) return;
      L.marker([h.lat, h.lng], { icon: makeEbirdIcon() })
        .bindPopup(ebirdHotspotPopupHtml(h))
        .addTo(ebirdLayer);
    });

    showToast(`已加载 ${data.length} 个 eBird 热点`);
    ebirdTokenStatus = { hasToken: true, valid: true, checked: true };
    renderEbirdHotspotActions();
  } catch (e) {
    ebirdTokenStatus = { hasToken: true, valid: false, checked: true, error: e.message };
    renderEbirdHotspotActions();
    alert("eBird 热点加载失败：" + e.message);
  }
}

function clearEbirdHotspots() {
  if (ebirdLayer) ebirdLayer.clearLayers();
}

function exportCurrentTrip() {
  if (!hasTrips()) { alert("当前没有可导出的行程。"); return; }
  const data = {
    exportedAt: new Date().toISOString(),
    type: "single-trip",
    trip: currentTrip()
  };
  downloadJson(data, `${safeFileName(currentTrip().title)}.json`);
  showToast("已导出当前行程");
}

function exportAllTrips() {
  if (!trips.length) { alert("当前没有可导出的行程。"); return; }
  const data = {
    exportedAt: new Date().toISOString(),
    type: "multi-trip",
    trips
  };
  downloadJson(data, "all_trips_map_planner.json");
  showToast("已导出全部行程");
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function safeFileName(name) {
  return String(name || "trip").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_");
}

function validateImported(data) {
  if (Array.isArray(data)) return data;
  if (data.trips && Array.isArray(data.trips)) return data.trips;
  if (data.trip) return [data.trip];

  if (data.itinerary && Array.isArray(data.itinerary)) {
    return [{
      title: data.title || "导入行程",
      subtitle: "从旧版 itinerary JSON 导入",
      currency: "CNY",
      summary: "旧版行程导入。",
      center: { lat: 23.7, lng: 121.0, zoom: 7 },
      days: data.itinerary
    }];
  }

  throw new Error("JSON 格式不支持。请导入当前行程/全部行程导出的 JSON。");
}

function normalizeImportedTripsForAppend(imported) {
  const usedIds = new Set(trips.map(trip => trip.id).filter(Boolean));
  return imported.map(rawTrip => {
    const trip = deepCopy(rawTrip);
    trip.title = trip.title || "导入行程";
    trip.subtitle = trip.subtitle || "自定义旅行行程";
    trip.currency = normalizeCurrency(trip.currency || "CNY");
    trip.summary = trip.summary || "暂无概览。";
    trip.center = trip.center || { lat: 23.7, lng: 121.0, zoom: 7 };
    trip.days = trip.days || [];
    trip.visibility = "private";
    trip.copiedFromPublic = false;
    trip.copyModified = false;
    trip.sourceFingerprint = "";
    trip.id = makeClientId("trip");
    while (usedIds.has(trip.id)) trip.id = makeClientId("trip");
    usedIds.add(trip.id);
    trip.createdAt = new Date().toISOString();
    prepareTripForSave(trip);
    return trip;
  });
}

async function commitImportedTrips(imported) {
  if (!imported.length) return;

  if (sessionMode === "account" && currentUser) {
    updateAccountStatus("正在保存当前修改后导入行程...");
    const syncIdle = await flushScheduledBackendSync();
    if (!syncIdle) {
      throw new Error("当前账号同步还没有完成，请稍后再导入。");
    }

    updateAccountStatus(`正在导入 ${imported.length} 个行程...`);
    const saved = [];
    for (const trip of imported) {
      const data = await apiFetch(`/api/trips/${encodeURIComponent(trip.id)}`, {
        method: "PUT",
        body: { trip }
      });
      saved.push(data.trip || trip);
    }

    const firstImportedId = saved[0]?.id || imported[0]?.id || "";
    await loadTripsFromBackend();
    const importedIndex = trips.findIndex(trip => trip.id === firstImportedId);
    if (importedIndex >= 0) currentTripIndex = importedIndex;
    currentFilter = "ALL";
    persistLocalTripsOnly();
    clearEbirdHotspots();
    render("ALL");
    updateAccountStatus(`已导入行程：${currentUser.username}`);
    return;
  }

  const firstImportedIndex = trips.length;
  trips.push(...imported);
  currentTripIndex = firstImportedIndex;
  currentFilter = "ALL";
  saveTrips();
  clearEbirdHotspots();
  render("ALL");
}

function importTrips(event) {
  const fileInput = event.target;
  const file = fileInput.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const imported = normalizeImportedTripsForAppend(validateImported(JSON.parse(reader.result)));

      const birdNames = collectBirdNamesFromTrips(imported);
      const mappingOk = await ensureBirdMappingsForNames(birdNames, { promptMissing: true });
      if (!mappingOk) {
        showToast("已取消导入");
        return;
      }

      await commitImportedTrips(imported);
      showToast(`导入成功：新增 ${imported.length} 个行程`);
    } catch (e) {
      alert("导入失败：" + e.message);
    } finally {
      fileInput.value = "";
    }
  };
  reader.readAsText(file, "utf-8");
}

function resetAll() {
  const message = sessionMode === "account"
    ? "确定清空当前账号的全部行程吗？此操作会同步到后端本地 JSON。"
    : "确定清空当前游客临时行程吗？游客模式不会保存浏览器缓存。";
  if (!confirm(message)) return;
  trips = deepCopy(defaultTrips);
  currentTripIndex = 0;
  currentFilter = "ALL";
  saveTrips();
  clearEbirdHotspots();
  render("ALL");
  showToast("已恢复默认");
}
