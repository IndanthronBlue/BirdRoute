function loadXcToken() {
  return getXcToken();
}

function getXcToken() {
  return pendingSecretUpdates.apiCredentials.xcToken || "";
}

function saveXcToken() {
  return saveAccountApiCredentials();
}

async function clearXcToken() {
  delete pendingSecretUpdates.apiCredentials.xcToken;
  setSecretDisplayValue("xcTokenInput", "");
  if (sessionMode !== "account") {
    showToast("已清除当前页面的 xeno-canto key");
    return;
  }
  try {
    await apiFetch("/api/api-credentials/settings", { method: "PUT", body: { clearXcToken: true } });
    await loadAccountApiCredentials(false);
    showToast("已清除账号保存的 xeno-canto key");
  } catch (e) {
    alert("清除 xeno-canto key 失败：" + e.message);
  }
}

function openXcHelp() {
  xcHelpDialog.showModal();
}

function closeXcHelp() {
  xcHelpDialog.close();
}

function normalizeBirdName(raw) {
  return String(raw || "")
    .replace(/\（.*?\）|\(.*?\)/g, "")
    .replace(/机会|高活跃期|迁徙群|过境|重点|補種|补种/g, "")
    .trim();
}

function birdMappingKey(name) {
  return normalizeBirdName(name).toLowerCase();
}

function looksScientificBirdName(name) {
  const clean = normalizeBirdName(name);
  if (!/^[A-Z][a-z]{2,}(?:\s+[a-z][a-z-]{2,}){1,2}$/.test(clean)) return false;
  const parts = clean.split(/\s+/);
  return !["species", "sp", "spp"].includes((parts[1] || "").toLowerCase());
}

function detectBirdNameLanguage(name) {
  const clean = normalizeBirdName(name);
  if (!clean) return "unknown";
  if (/[\u4e00-\u9fff]/.test(clean)) return "chinese";
  if (looksScientificBirdName(clean)) return "scientific";
  if (/[A-Za-z]/.test(clean)) return "english";
  return "unknown";
}

function birdNameLanguageLabel(language) {
  return {
    chinese: "中文名",
    english: "英文名",
    scientific: "学名",
    unknown: "未识别"
  }[language] || "未识别";
}

function seedBirdMappingFromName(name) {
  const clean = normalizeBirdName(name);
  const language = detectBirdNameLanguage(clean);
  const item = { originalName: clean, nameLanguage: language, chinese: "", english: "", scientific: "" };
  if (language === "chinese") item.chinese = clean;
  else if (language === "english") item.english = clean;
  else if (language === "scientific") item.scientific = clean;
  else item.chinese = clean;
  return item;
}

function birdMappingAliasKeys(item = {}) {
  return [item.chinese, item.english, item.scientific, item.name, item.originalName, item.matchedName]
    .map(birdMappingKey)
    .filter(Boolean);
}

function cacheBirdMappings(mappings = []) {
  mappings.forEach(item => {
    if (!item || typeof item !== "object") return;
    const chinese = normalizeBirdName(item.chinese || item.name || "");
    if (!chinese) return;
    const entry = {
      chinese,
      english: String(item.english || item.englishName || "").trim(),
      scientific: String(item.scientific || item.scientificName || "").trim(),
      source: item.source || "",
      confidence: item.confidence || "",
      notes: item.notes || "",
      sourceUrls: Array.isArray(item.sourceUrls) ? item.sourceUrls : []
    };
    birdMappingAliasKeys({ ...item, ...entry }).forEach(key => {
      birdNameMappingCache[key] = entry;
    });
  });
}

function cachedBirdMapping(name) {
  return birdNameMappingCache[birdMappingKey(name)] || null;
}

function resolveBirdName(raw) {
  const clean = normalizeBirdName(raw);
  const mapped = cachedBirdMapping(clean);

  if (mapped) {
    return {
      input: clean,
      original: mapped.chinese || clean,
      chinese: mapped.chinese || "",
      english: mapped.english,
      scientific: mapped.scientific,
      queries: [mapped.scientific, mapped.english, mapped.chinese || clean].filter(Boolean)
    };
  }

  // 如果用户已经填了英文名或学名，就直接作为高优先级 query
  const language = detectBirdNameLanguage(clean);
  const looksScientific = language === "scientific";
  const looksEnglish = language === "english";

  return {
    input: clean,
    original: clean,
    chinese: language === "chinese" || language === "unknown" ? clean : "",
    english: looksEnglish && !looksScientific ? clean : "",
    scientific: looksScientific ? clean : "",
    queries: looksScientific ? [clean] : looksEnglish ? [clean] : [clean]
  };
}

function parseBirdNames(text) {
  const ignored = new Set([
    "目标", "机会", "水鸟", "林鸟", "猛禽", "过境雀形目", "画眉类", "山地林鸟", "交通节点", "休息", "抵达台湾",
    "shorebirds", "waders", "duck species", "gull species", "seabirds", "waterbirds", "sea birds"
  ]);
  return String(text || "")
    .split(/[、,，;；\n\/]+/)
    .map(normalizeBirdName)
    .filter(Boolean)
    .filter(s => !ignored.has(s) && !ignored.has(s.toLowerCase()))
    .slice(0, 200);
}

function uniqueBirdNames(names) {
  const seen = new Set();
  return names
    .map(normalizeBirdName)
    .filter(Boolean)
    .filter(name => {
      const key = birdMappingKey(name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function lookupBirdMappings(names) {
  const data = await apiFetch("/api/bird-mappings/lookup", {
    method: "POST",
    body: { names }
  });
  cacheBirdMappings(data.mappings || []);
  return {
    mappings: data.mappings || [],
    missing: data.missing || []
  };
}

async function ensureBirdMappingsForNames(names, options = {}) {
  const uniqueNames = uniqueBirdNames(names);
  if (!uniqueNames.length) return true;

  const unknown = uniqueNames.filter(name => !cachedBirdMapping(name));
  let missing = [];
  if (unknown.length) {
    try {
      const data = await lookupBirdMappings(unknown);
      missing = uniqueBirdNames(data.missing || []);
    } catch (e) {
      if (options.promptMissing) {
        return confirm(`无法连接后端鸟名映射表：${e.message}\n\n仍然保存活动吗？Checklist 将暂时只使用原始鸟名。`);
      }
      return true;
    }
  }

  missing = missing.filter(name => !cachedBirdMapping(name));
  if (missing.length && options.promptMissing) {
    return openBirdMappingDialog(missing);
  }
  return true;
}

async function ensureCurrentTripBirdMappings() {
  const names = [];
  currentDays().forEach(day => {
    (day.stops || [])
      .filter(stop => stop.type === "bird")
      .forEach(stop => {
        names.push(...parseBirdNames(stop.birds));
      });
  });
  await ensureBirdMappingsForNames(names, { promptMissing: false });
}

function collectBirdNamesFromTrips(tripList = []) {
  const names = [];
  tripList.forEach(trip => {
    (trip.days || []).forEach(day => {
      (day.stops || [])
        .filter(stop => stop.type === "bird")
        .forEach(stop => {
          names.push(...parseBirdNames(stop.birds));
        });
    });
  });
  return uniqueBirdNames(names);
}

function setBirdMappingStatus(message, isError = false) {
  const el = document.getElementById("birdMappingStatus");
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "var(--red)" : "var(--muted)";
}

function renderBirdMappingRows(names, mappings = []) {
  const rowsEl = document.getElementById("birdMappingRows");
  if (!rowsEl) return;
  const byKey = {};
  mappings.forEach(item => {
    birdMappingAliasKeys(item).forEach(key => {
      byKey[key] = item;
    });
  });
  rowsEl.innerHTML = names.map((name, index) => {
    const seed = seedBirdMappingFromName(name);
    const item = { ...seed, ...(byKey[birdMappingKey(name)] || {}) };
    const language = item.nameLanguage || seed.nameLanguage;
    const chineseValue = item.chinese || "";
    const englishValue = item.english || (language === "english" ? seed.english : "");
    const scientificValue = item.scientific || (language === "scientific" ? seed.scientific : "");
    const sourceText = [
      `识别：${birdNameLanguageLabel(language)}`,
      item.source ? `来源：${item.source}` : "",
      item.confidence ? `置信度：${item.confidence}` : "",
      item.notes || ""
    ].filter(Boolean).join("｜");
    return `
      <div class="bird-mapping-row" data-bird-index="${index}" data-original-name="${escapeHtml(seed.originalName)}" data-name-language="${escapeHtml(language)}">
        <label>原始鸟名
          <input class="bird-mapping-original" value="${escapeHtml(seed.originalName)}" readonly>
        </label>
        <label>中文名
          <input class="bird-mapping-chinese" value="${escapeHtml(chineseValue)}" placeholder="例如 大天鹅">
        </label>
        <label>英文名
          <input class="bird-mapping-english" value="${escapeHtml(englishValue)}" placeholder="例如 Whooper Swan">
        </label>
        <label>学名
          <input class="bird-mapping-scientific" value="${escapeHtml(scientificValue)}" placeholder="例如 Cygnus cygnus">
        </label>
        <div class="bird-mapping-meta">${escapeHtml(sourceText || "等待填写或自动补全。")}</div>
      </div>
    `;
  }).join("");
}

function collectBirdMappingRows() {
  return Array.from(document.querySelectorAll("#birdMappingRows .bird-mapping-row")).map(row => ({
    originalName: row.dataset.originalName || row.querySelector(".bird-mapping-original")?.value.trim() || "",
    nameLanguage: row.dataset.nameLanguage || "unknown",
    chinese: row.querySelector(".bird-mapping-chinese")?.value.trim() || "",
    english: row.querySelector(".bird-mapping-english")?.value.trim() || "",
    scientific: row.querySelector(".bird-mapping-scientific")?.value.trim() || "",
    source: "user_confirmed",
    confidence: "confirmed"
  }));
}

function openBirdMappingDialog(missingNames) {
  return new Promise(resolve => {
    const names = uniqueBirdNames(missingNames);
    birdMappingDialogState = { names, resolve };
    renderBirdMappingRows(names);
    setBirdMappingStatus("请手动填写，或先用 LLM 补全后确认。");
    birdMappingDialog.showModal();
  });
}

async function resolveBirdMappingsWithLlm() {
  if (!birdMappingDialogState) return;
  const names = birdMappingDialogState.names || [];
  if (!names.length) return;
  const batchSize = 8;
  const batches = [];
  for (let i = 0; i < names.length; i += batchSize) {
    batches.push(names.slice(i, i + batchSize));
  }

  const mappings = [];
  try {
    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index];
      const start = index * batchSize + 1;
      const end = Math.min(start + batch.length - 1, names.length);
      setBirdMappingStatus(`正在使用 LLM 补全第 ${index + 1}/${batches.length} 批（${start}-${end}/${names.length}），请稍候...`);
      const data = await apiFetch("/api/bird-mappings/resolve", {
        method: "POST",
        body: { names: batch, method: "llm" }
      });
      mappings.push(...(data.mappings || []));
      renderBirdMappingRows(names, mappings);
    }

    const resolvedKeys = new Set(
      mappings
        .map(item => birdMappingKey(item.originalName || item.chinese || item.english || item.scientific || ""))
        .filter(Boolean)
    );
    setBirdMappingStatus(`LLM 已分 ${batches.length} 批生成 ${resolvedKeys.size}/${names.length} 个候选，请核对后点击“确认并保存映射”。`);
  } catch (e) {
    if (mappings.length) {
      renderBirdMappingRows(names, mappings);
      setBirdMappingStatus(`LLM 部分补全失败：${e.message}。已保留前面批次生成的候选。`, true);
    } else {
      setBirdMappingStatus(`LLM 补全失败：${e.message}`, true);
    }
  }
}

async function confirmBirdMappings() {
  if (!birdMappingDialogState) return;
  const rows = collectBirdMappingRows();
  const incomplete = rows.filter(item => (item.english || item.scientific) && !item.chinese);
  const mappings = rows.filter(item => item.chinese && (item.english || item.scientific));
  if (!mappings.length) {
    setBirdMappingStatus(incomplete.length
      ? "请先为英文名或学名补上中文名，再保存映射。"
      : "请至少为一个鸟名填写完整的中文名，并保留英文名或学名。", true);
    return;
  }
  if (incomplete.length && !confirm(`还有 ${incomplete.length} 个鸟名缺少中文名。只保存已填写完整的映射并继续吗？`)) {
    return;
  }
  setBirdMappingStatus("正在保存到后端全局映射表...");
  try {
    const data = await apiFetch("/api/bird-mappings", {
      method: "PUT",
      body: { mappings, source: "user_confirmed" }
    });
    cacheBirdMappings(data.mappings?.length ? data.mappings : mappings);
    const resolve = birdMappingDialogState.resolve;
    birdMappingDialogState = null;
    birdMappingDialog.close();
    resolve(true);
    showToast("鸟名映射已保存");
  } catch (e) {
    setBirdMappingStatus("保存映射失败：" + e.message, true);
  }
}

function skipBirdMappingsAndContinue() {
  if (!birdMappingDialogState) return;
  const resolve = birdMappingDialogState.resolve;
  birdMappingDialogState = null;
  birdMappingDialog.close();
  resolve(true);
}

function cancelBirdMappings() {
  if (!birdMappingDialogState) return;
  const resolve = birdMappingDialogState.resolve;
  birdMappingDialogState = null;
  birdMappingDialog.close();
  resolve(false);
}

async function openBirdPreview(dayIndex, stopIndex) {
  const stop = currentDays()[dayIndex].stops[stopIndex];
  const names = parseBirdNames(stop.birds);

  document.getElementById("birdPreviewTitle").textContent = `鸟种预习｜${stop.name}`;
  const content = document.getElementById("birdPreviewContent");

  if (!names.length) {
    content.innerHTML = `<div class="hint">没有从“目标鸟种”字段解析到具体鸟名。请用顿号、逗号或换行分隔鸟种。</div>`;
    birdPreviewDialog.showModal();
    return;
  }

  await ensureBirdMappingsForNames(names, { promptMissing: false });

  content.innerHTML = names.map(name => `
    <div class="bird-preview-card" id="bird-card-${safeDomId(name)}">
      <div class="bird-preview-card-header">${escapeHtml(name)}</div>
      <div class="bird-preview-body">
        <div class="hint">加载图片中...</div>
        <div class="bird-preview-meta">加载鸟声中...</div>
      </div>
    </div>
  `).join("");

  birdPreviewDialog.showModal();

  for (const name of names) {
    loadBirdPreviewCard(name);
  }
}

function closeBirdPreview() {
  birdPreviewDialog.close();
}

function safeDomId(s) {
  return btoa(unescape(encodeURIComponent(s))).replaceAll("=", "").replaceAll("+", "-").replaceAll("/", "_");
}

function birdPreviewDisplayName(resolved, fallback = "") {
  return resolved.chinese || resolved.english || resolved.scientific || resolved.input || fallback;
}

async function loadBirdPreviewCard(name) {
  const card = document.getElementById(`bird-card-${safeDomId(name)}`);
  if (!card) return;

  const resolved = resolveBirdName(name);
  const displayName = birdPreviewDisplayName(resolved, name);
  const header = card.querySelector(".bird-preview-card-header");
  if (header) header.textContent = displayName;

  const imagePromise = fetchBirdImageResolved(resolved);
  const soundPromise = fetchBirdSoundResolved(resolved);

  const [image, sound] = await Promise.allSettled([imagePromise, soundPromise]);

  const imageData = image.status === "fulfilled" ? image.value : null;
  const soundData = sound.status === "fulfilled" ? sound.value : null;

  const displayNames = [
    resolved.input && resolved.input !== displayName ? `<div><b>原始输入：</b>${escapeHtml(resolved.input)}</div>` : "",
    resolved.chinese ? `<div><b>中文名：</b>${escapeHtml(resolved.chinese)}</div>` : "",
    resolved.english ? `<div><b>英文名：</b>${escapeHtml(resolved.english)}</div>` : "",
    resolved.scientific ? `<div><b>学名：</b><i>${escapeHtml(resolved.scientific)}</i></div>` : ""
  ].join("");

  const imgHtml = imageData?.url
    ? `<a href="${escapeHtml(imageData.url)}" target="_blank" rel="noopener" title="打开原图"><img src="${escapeHtml(imageData.url)}" alt="${escapeHtml(displayName)}"></a>`
    : `<div class="hint">未找到可用图片</div>`;

  const imgLink = imageData?.page
    ? `<a class="bird-preview-link" href="${escapeHtml(imageData.page)}" target="_blank" rel="noopener">查看图片来源</a>`
    : "";

  const soundHtml = soundData?.file
    ? `
      <div><b>鸟声：</b>${escapeHtml(soundData.en || resolved.english || displayName)} ${soundData.type ? "｜" + escapeHtml(soundData.type) : ""}</div>
      <div class="hint">检索词：${escapeHtml(soundData.queryUsed || "")}｜${escapeHtml(soundData.apiUsed || "")}</div>
      <audio controls preload="none" src="${escapeHtml(soundData.file)}"></audio>
      <a class="bird-preview-link" href="${escapeHtml(soundData.url)}" target="_blank" rel="noopener">打开 xeno-canto 记录</a>
    `
    : `
      <div>未能通过 API 直接加载鸟声。可能需要 xeno-canto API key，或浏览器阻止了本地 HTML 的跨域请求。</div>
      <a class="bird-preview-link" href="https://xeno-canto.org/explore?query=${encodeURIComponent(resolved.scientific || resolved.english || displayName)}" target="_blank" rel="noopener">在 xeno-canto 搜索</a>
    `;

  card.querySelector(".bird-preview-body").innerHTML = `
    <div>
      ${imgHtml}
      ${imgLink}
    </div>
    <div class="bird-preview-meta">
      ${displayNames}
      ${soundHtml}
      <a class="bird-preview-link" href="https://www.google.com/search?q=${encodeURIComponent((resolved.scientific || resolved.english || displayName) + " bird")}" target="_blank" rel="noopener">Google 搜索该鸟种</a>
    </div>
  `;
}

async function fetchBirdImageResolved(resolved) {
  // 优先用英文名/学名检索英文 Wikipedia，再用中文名，最后 Commons
  const wikiTerms = [
    resolved.english,
    resolved.scientific,
    resolved.original
  ].filter(Boolean);

  for (const term of wikiTerms) {
    const wikiUrls = [
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`,
      `https://zh.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`
    ];

    for (const url of wikiUrls) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        const img = data.thumbnail?.source || data.originalimage?.source;
        if (img) return { url: img, page: data.content_urls?.desktop?.page || "" };
      } catch (e) {}
    }
  }

  for (const term of resolved.queries) {
    try {
      const commonsUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(term + " bird")}&gsrlimit=1&prop=imageinfo&iiprop=url&iiurlwidth=500&format=json&origin=*`;
      const res = await fetch(commonsUrl);
      if (!res.ok) continue;
      const data = await res.json();
      const pages = data.query?.pages ? Object.values(data.query.pages) : [];
      const first = pages[0];
      const info = first?.imageinfo?.[0];
      if (info?.thumburl || info?.url) {
        return { url: info.thumburl || info.url, page: info.descriptionurl || "" };
      }
    } catch (e) {}
  }

  return null;
}

async function fetchBirdSoundResolved(resolved) {
  // xeno-canto 对学名/英文名支持最好：学名 → 英文名 → 原名
  const queries = buildXcQueries(resolved);

  // 1) 登录模式优先走后端代理，由后端解密并使用完整 key
  if (sessionMode === "account") {
    for (const query of queries) {
      try {
        const payload = await apiFetch(`/api/xeno-canto/recordings?query=${encodeURIComponent(query)}`);
        const data = payload.data || {};
        const rec = selectBestXcRecording(data.recordings || data.recs || []);
        if (rec) return normalizeXcRecording(rec, query, payload.apiUsed || "backend proxy");
      } catch (e) {
        // 继续尝试下一个 query / fallback
      }
    }
  }

  // 2) 未登录或后端代理失败时，尝试无需 key 的旧 v2 接口
  for (const query of queries) {
    try {
      const url = `https://xeno-canto.org/api/2/recordings?query=${encodeURIComponent(query)}`;
      const data = await fetchJsonWithTimeout(url, 12000);
      const rec = selectBestXcRecording(data.recordings || data.recs || []);
      if (rec) return normalizeXcRecording(rec, query, "API v2 fallback");
    } catch (e) {
      // 本地 HTML 可能被 CORS / redirect 阻止
    }
  }

  return null;
}

function buildXcQueries(resolved) {
  const queries = [];
  if (resolved.scientific) {
    queries.push(resolved.scientific);
    queries.push(`sp:"${resolved.scientific}"`);
  }
  if (resolved.english) {
    queries.push(resolved.english);
    queries.push(`en:"${resolved.english}"`);
  }
  if (resolved.original) queries.push(resolved.original);

  return [...new Set(queries.filter(Boolean))];
}

async function fetchJsonWithTimeout(url, ms = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

function selectBestXcRecording(recordings) {
  if (!Array.isArray(recordings) || !recordings.length) return null;
  return recordings.find(r => r.file && (r.q === "A" || r.q === "B")) ||
         recordings.find(r => r.file) ||
         recordings[0];
}

function normalizeXcRecording(rec, queryUsed, apiUsed) {
  let file = rec.file || rec.fileUrl || "";
  if (file && file.startsWith("//")) file = "https:" + file;
  if (file && file.startsWith("http://")) file = file.replace("http://", "https://");

  const id = rec.id || rec.nr || "";
  let pageUrl = rec.url || (id ? `https://xeno-canto.org/${id}` : "");
  if (pageUrl && pageUrl.startsWith("//")) pageUrl = "https:" + pageUrl;

  // 有些情况下 API 返回 file 无法直接跨域播放，但页面链接仍可用
  return {
    file,
    url: pageUrl,
    en: rec.en || rec.english || "",
    type: rec.type || rec.sono?.type || "",
    cnt: rec.cnt || "",
    loc: rec.loc || "",
    queryUsed,
    apiUsed
  };
}



function checklistStorageKey() {
  return STORAGE_KEY + "_checklist_seen_" + safeFileName(currentTrip().title || "trip");
}

function loadChecklistSeen() {
  try {
    return JSON.parse(localStorage.getItem(checklistStorageKey()) || "{}");
  } catch (e) {
    return {};
  }
}

function saveChecklistSeen(seen) {
  try {
    localStorage.setItem(checklistStorageKey(), JSON.stringify(seen));
  } catch (e) {}
}

function birdChecklistKey(bird) {
  return (bird.scientific || bird.english || bird.chinese || "").toLowerCase();
}

function toggleChecklistSeen(key, checked) {
  const seen = loadChecklistSeen();
  seen[key] = Boolean(checked);
  saveChecklistSeen(seen);
  showToast(checked ? "已标记为看到" : "已取消看到标记");
}

function previewChecklistBird(chinese, english, scientific) {
  const name = chinese || english || scientific;
  const fakeDay = {
    day: "预习",
    title: "Checklist 鸟种预习",
    stay: "",
    stops: [{
      name: name,
      type: "bird",
      time: "",
      lat: 0,
      lng: 0,
      birds: [chinese, english, scientific].filter(Boolean).join("、"),
      transport: "",
      note: "",
      costMin: 0,
      costMax: 0
    }]
  };

  document.getElementById("birdPreviewTitle").textContent = `鸟种预习｜${name}`;
  const content = document.getElementById("birdPreviewContent");
  const names = [chinese || english || scientific].filter(Boolean);
  content.innerHTML = names.map(n => `
    <div class="bird-preview-card" id="bird-card-${safeDomId(n)}">
      <div class="bird-preview-card-header">${escapeHtml(n)}</div>
      <div class="bird-preview-body">
        <div class="hint">加载图片中...</div>
        <div class="bird-preview-meta">加载鸟声中...</div>
      </div>
    </div>
  `).join("");
  birdPreviewDialog.showModal();
  names.forEach(n => loadBirdPreviewCard(n));
}

function resetChecklistSeen() {
  if (!confirm("确定清空当前行程的 Checklist 已看到标记吗？")) return;
  saveChecklistSeen({});
  openChecklist();
  showToast("已清空看到标记");
}

function buildDailyChecklist() {
  return currentDays().map(day => {
    const birds = [];
    day.stops
      .filter(stop => stop.type === "bird")
      .forEach(stop => {
        parseBirdNames(stop.birds).forEach(name => {
          const resolved = resolveBirdName(name);
          birds.push({
            chinese: resolved.chinese || "",
            english: resolved.english || "",
            scientific: resolved.scientific || "",
            site: stop.name,
            date: scheduleDateFromStop(stop, day),
            time: stop.time || "待定"
          });
        });
      });

    const seen = new Set();
    const unique = birds.filter(b => {
      const key = (b.scientific || b.english || b.chinese).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      day: day.day,
      date: normalizeDateOnly(day.date),
      title: day.title,
      stay: day.stay,
      birds: unique
    };
  });
}

async function openChecklist() {
  await ensureCurrentTripBirdMappings();
  const checklist = buildDailyChecklist();
  const seen = loadChecklistSeen();
  const content = document.getElementById("checklistContent");

  content.innerHTML = `
    <div class="row" style="margin:10px 0 14px 0;">
      <button class="warn" onclick="resetChecklistSeen()">清空已看到标记</button>
      <span class="hint">勾选状态会自动保存在当前浏览器。</span>
    </div>
    ${checklist.map(day => {
      const seenCount = day.birds.filter(b => seen[birdChecklistKey(b)]).length;
      return `
        <div class="day-card" style="box-shadow:none;border:1px solid var(--line);">
          <div class="day-card-header">
            <h3>${escapeHtml(day.day)}｜${escapeHtml(day.title)}</h3>
            <p>${escapeHtml(dayMetaLabel(day))}｜${seenCount}/${day.birds.length} 已看到</p>
          </div>
          <div class="stop">
            ${day.birds.length ? `
              <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead>
                  <tr>
                    <th style="text-align:left;border-bottom:1px solid var(--line);padding:6px;">看到</th>
                    <th style="text-align:left;border-bottom:1px solid var(--line);padding:6px;">中文名 / 预习</th>
                    <th style="text-align:left;border-bottom:1px solid var(--line);padding:6px;">英文名</th>
                    <th style="text-align:left;border-bottom:1px solid var(--line);padding:6px;">学名</th>
                    <th style="text-align:left;border-bottom:1px solid var(--line);padding:6px;">鸟点</th>
                  </tr>
                </thead>
                <tbody>
                  ${day.birds.map(b => {
                    const key = birdChecklistKey(b);
                    const checked = seen[key] ? "checked" : "";
                    const displayName = b.chinese || b.english || b.scientific || "-";
                    return `
                      <tr>
                        <td style="border-bottom:1px solid var(--line);padding:6px;">
                          <input type="checkbox" ${checked}
                                 onchange="toggleChecklistSeen('${escapeHtml(key)}', this.checked)"
                                 style="width:auto;">
                        </td>
                        <td style="border-bottom:1px solid var(--line);padding:6px;">
                          <a href="#"
                             onclick="event.preventDefault(); previewChecklistBird('${escapeHtml(b.chinese)}','${escapeHtml(b.english)}','${escapeHtml(b.scientific)}')">
                             ${escapeHtml(displayName)}
                          </a>
                        </td>
                        <td style="border-bottom:1px solid var(--line);padding:6px;">${escapeHtml(b.english || "-")}</td>
                        <td style="border-bottom:1px solid var(--line);padding:6px;"><i>${escapeHtml(b.scientific || "-")}</i></td>
                        <td style="border-bottom:1px solid var(--line);padding:6px;">${escapeHtml(b.site)}</td>
                      </tr>
                    `;
                  }).join("")}
                </tbody>
              </table>
            ` : `<div class="hint">这一天没有鸟点目标鸟种。</div>`}
          </div>
        </div>
      `;
    }).join("")}
  `;

  checklistDialog.showModal();
}

function closeChecklist() {
  checklistDialog.close();
}

async function exportChecklist() {
  await ensureCurrentTripBirdMappings();
  const seen = loadChecklistSeen();
  const checklist = buildDailyChecklist().map(day => ({
    ...day,
    birds: day.birds.map(b => ({
      ...b,
      seen: Boolean(seen[birdChecklistKey(b)])
    }))
  }));

  const data = {
    exportedAt: new Date().toISOString(),
    tripTitle: currentTrip().title,
    checklist
  };
  downloadJson(data, `${safeFileName(currentTrip().title)}_daily_checklist.json`);
}

function init() {
  loadUiSettings();
  loadFxCache();
  loadXcToken();
  relocateSettingsPanels();
  setupSecretDisplayInputs();
  if (typeof L === "undefined") {
    document.getElementById("mapError").style.display = "block";
    renderTripSelect();
    renderButtons();
    renderSummary();
    renderCards(currentDays());
    initAuth();
    return;
  }

  const c = currentTrip().center || { lat: 23.7, lng: 121, zoom: 7 };
  map = L.map("map", {
    scrollWheelZoom: true,
    preferCanvas: true
  }).setView([c.lat, c.lng], c.zoom || 7);

  applyMapTileEngine();

  markerLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  ebirdLayer = L.layerGroup().addTo(map);

  map.on("click", (e) => {
    const dayIndex = currentFilter !== "ALL" ? currentDays().findIndex(d => d.day === currentFilter) : 0;
    openAddDialog(dayIndex >= 0 ? dayIndex : 0, {
      name: "地图点击新增点",
      type: "bird",
      time: "待定",
      lat: Number(e.latlng.lat.toFixed(6)),
      lng: Number(e.latlng.lng.toFixed(6)),
      birds: "",
      transport: "",
      note: "通过点击地图新增。",
      costMin: 0,
      costMax: 0
    });
  });

  render("ALL");
  setTimeout(() => map.invalidateSize(), 300);
  window.addEventListener("resize", () => map.invalidateSize());
  initAuth();
}


// Expose functions used by inline HTML event handlers.
// This avoids ReferenceError on GitHub Pages if the script is later bundled or partially refactored.
Object.assign(window, {
  continueAsGuest,
  returnToWelcomeForLogin,
  loginAccount,
  registerAccount,
  logoutAccount,
  openSettingsDialog,
  closeSettingsDialog,
  openPublicTripSearchDialog,
  closePublicTripSearchDialog,
  openSecretInputDialog,
  closeSecretInputDialog,
  confirmSecretInputDialog,
  saveCurrentTripToBackend,
  loadAllAccountApiSettings,
  saveAllApiSettings,
  clearAllAccountApiSecrets,
  loadAccountApiCredentials,
  saveAccountApiCredentials,
  clearEbirdToken,
  loadContentSourceSettings,
  saveContentSourceSettings,
  clearContentSourceApiKeys,
  updateContentSearchApiKeyPlaceholder,
  updateWechatModeHelp,
  updateXhsModeHelp,
  addApiParamRow,
  removeApiParamRow,
  resetApiParamRows,
  updateXhsOfficialTokenStatus,
  openXhsOfficialAuth,
  startXhsLocalBrowser,
  refreshXhsLocalBrowserStatus,
  closeXhsLocalBrowser,
  openXhsThirdPartyHelp,
  closeXhsThirdPartyHelp,
  openQuickInfoDialog,
  closeQuickInfoDialog,
  startQuickInfoAdd,
  editQuickInfoItem,
  deleteQuickInfoItem,
  confirmQuickInfoEditor,
  cancelQuickInfoEditor,
  addQuickInfoRow,
  removeQuickInfoRow,
  renderQuickInfoPreviewFromRows,
  saveQuickInfo,
  loadLlmSettings,
  saveLlmSettings,
  testLlmSettings,
  clearLlmApiKey,
  openResearchDialog,
  closeResearchDialog,
  toggleResearchKeyword,
  syncResearchKeywordSelectionFromInput,
  searchResearchArticles,
  fetchResearchArticleText,
  ingestResearchUrl,
  summarizeResearchArticles,
  saveResearchToBackend,
  searchPublicTrips,
  importPublicTrip,
  resolveBirdMappingsWithLlm,
  confirmBirdMappings,
  skipBirdMappingsAndContinue,
  cancelBirdMappings,
  importTrips,
  openTripDialog,
  closeTripDialog,
  saveTripFromDialog,
  deleteTrip,
  switchTrip,
  setDisplayCurrency,
  refreshExchangeRates,
  openAddDialog,
  addEbirdHotspotActivity,
  openEbirdSpeciesPicker,
  closeEbirdSpeciesDialog,
  setAllEbirdSpeciesChecked,
  confirmEbirdSpeciesSelection,
  openDayDialog,
  exportCurrentTrip,
  exportAllTrips,
  resetAll,
  openChecklist,
  loadEbirdHotspots,
  clearEbirdHotspots,
  openEbirdHelp,
  closeEbirdHelp,
  openXcHelp,
  closeXcHelp,
  clearXcToken,
  saveXcToken,
  updateTypeHelp,
  geocodeIntoForm,
  closeDialog,
  saveStopFromDialog,
  closeDayDialog,
  saveDayFromDialog,
  closeBirdPreview,
  exportChecklist,
  closeChecklist,
  stopMainLabel,
  stopBudgetLabel,
  setMapTileEngine,
  setNavigationEngine,
  googleMapsDirectionsUrl,
  openGoogleMaps,
  googleMapsButtonHtml
});

window.addEventListener("load", init);
