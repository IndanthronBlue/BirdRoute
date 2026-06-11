let tripJsonEditorState = {
  tripId: "",
  loadedFromBackend: false,
  idChanged: false,
  sourceTrip: null,
  sourceLabel: ""
};

function tripJsonEditorEl(id) {
  return document.getElementById(id);
}

function setTripJsonEditorStatus(message, isError = false) {
  const el = tripJsonEditorEl("tripJsonEditorStatus");
  if (!el) return;
  el.textContent = message || "";
  el.style.color = isError ? "var(--red)" : "var(--muted)";
}

function setTripJsonEditorSummaryHtml(html = "") {
  const el = tripJsonEditorEl("tripJsonEditorSummary");
  if (el) el.innerHTML = html;
}

function setTripJsonEditorDiffHtml(html = "") {
  const el = tripJsonEditorEl("tripJsonEditorDiff");
  if (!el) return;
  el.innerHTML = html;
  el.style.display = html ? "block" : "none";
}

function tripJsonTextarea() {
  return tripJsonEditorEl("tripJsonEditorInput");
}

function prettyTripJson(trip) {
  return JSON.stringify(trip, null, 2);
}

function parseTripJsonEditorText() {
  const text = tripJsonTextarea()?.value.trim() || "";
  if (!text) throw new Error("JSON 内容不能为空。");

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error("JSON 解析失败：" + e.message);
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.trip && typeof parsed.trip === "object") {
    parsed = parsed.trip;
  }
  if (Array.isArray(parsed) || (parsed && Array.isArray(parsed.trips))) {
    throw new Error("这里只能编辑当前单个行程 JSON，不能保存多行程数组。");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("行程 JSON 必须是一个对象。");
  }
  return parsed;
}

function protectedTripJsonFieldsFromCurrent() {
  const trip = currentTrip();
  return {
    id: trip.id || "",
    createdAt: trip.createdAt || "",
    copiedFromPublic: Boolean(trip.copiedFromPublic),
    sourcePublicTripOwner: trip.sourcePublicTripOwner || "",
    sourcePublicTripId: trip.sourcePublicTripId || "",
    sourcePublicTripTitle: trip.sourcePublicTripTitle || "",
    sourceFingerprint: trip.sourceFingerprint || ""
  };
}

function validateTripJsonNumber(value, label, min, max, warnings) {
  if (value === undefined || value === null || value === "") return;
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) {
    throw new Error(`${label} 必须是 ${min} 到 ${max} 之间的数字。`);
  }
  if (typeof value !== "number") warnings.push(`${label} 已按数字处理。`);
}

function validateTripJsonStop(stop, dayIndex, stopIndex, warnings) {
  if (!stop || typeof stop !== "object" || Array.isArray(stop)) {
    throw new Error(`第 ${dayIndex + 1} 天第 ${stopIndex + 1} 个活动必须是对象。`);
  }

  const validTypes = new Set(Object.keys(typeLabels || {}));
  const type = String(stop.type || "bird").trim();
  if (type && !validTypes.has(type)) {
    throw new Error(`第 ${dayIndex + 1} 天第 ${stopIndex + 1} 个活动 type 无效：${type}`);
  }
  if (!String(stop.name || "").trim()) {
    warnings.push(`第 ${dayIndex + 1} 天第 ${stopIndex + 1} 个活动缺少 name，保存后会显示为未命名活动。`);
  }
  validateTripJsonNumber(stop.lat, `第 ${dayIndex + 1} 天第 ${stopIndex + 1} 个活动 lat`, -90, 90, warnings);
  validateTripJsonNumber(stop.lng, `第 ${dayIndex + 1} 天第 ${stopIndex + 1} 个活动 lng`, -180, 180, warnings);
  validateTripJsonNumber(stop.costMin, `第 ${dayIndex + 1} 天第 ${stopIndex + 1} 个活动 costMin`, 0, 999999999, warnings);
  validateTripJsonNumber(stop.costMax, `第 ${dayIndex + 1} 天第 ${stopIndex + 1} 个活动 costMax`, 0, 999999999, warnings);
}

function normalizeTripJsonEditorCandidate(raw) {
  const current = currentTrip();
  const protectedFields = protectedTripJsonFieldsFromCurrent();
  const trip = deepCopy(raw);
  const originalEditedId = String(trip.id || "");
  const targetId = tripJsonEditorState.tripId || protectedFields.id || originalEditedId || makeClientId("trip");
  const warnings = [];

  trip.id = targetId;
  if (protectedFields.createdAt) trip.createdAt = protectedFields.createdAt;
  trip.copiedFromPublic = protectedFields.copiedFromPublic;
  trip.sourcePublicTripOwner = protectedFields.sourcePublicTripOwner;
  trip.sourcePublicTripId = protectedFields.sourcePublicTripId;
  trip.sourcePublicTripTitle = protectedFields.sourcePublicTripTitle;
  trip.sourceFingerprint = protectedFields.sourceFingerprint;

  if (!String(trip.title || "").trim()) warnings.push("缺少 title，保存时会使用默认标题。");
  if (!trip.currency) trip.currency = current.currency || "CNY";
  trip.currency = normalizeCurrency(trip.currency || "CNY");
  const fallbackCenter = current.center || { lat: 23.7, lng: 121.0, zoom: 7 };
  if (!trip.center || typeof trip.center !== "object" || Array.isArray(trip.center)) {
    trip.center = { ...fallbackCenter };
    warnings.push("center 缺失或格式不正确，已使用当前行程中心点。");
  }
  if (!Number.isFinite(Number(trip.center.lat))) {
    trip.center.lat = fallbackCenter.lat ?? 23.7;
    warnings.push("center.lat 缺失，已使用当前行程中心点纬度。");
  }
  if (!Number.isFinite(Number(trip.center.lng))) {
    trip.center.lng = fallbackCenter.lng ?? 121.0;
    warnings.push("center.lng 缺失，已使用当前行程中心点经度。");
  }
  if (!Number.isFinite(Number(trip.center.zoom))) {
    trip.center.zoom = fallbackCenter.zoom ?? 7;
  }
  validateTripJsonNumber(trip.center.lat, "center.lat", -90, 90, warnings);
  validateTripJsonNumber(trip.center.lng, "center.lng", -180, 180, warnings);

  if (!Array.isArray(trip.days)) {
    throw new Error("days 必须是数组。");
  }
  trip.days.forEach((day, dayIndex) => {
    if (!day || typeof day !== "object" || Array.isArray(day)) {
      throw new Error(`第 ${dayIndex + 1} 天必须是对象。`);
    }
    if (day.stops === undefined) day.stops = [];
    if (!Array.isArray(day.stops)) {
      throw new Error(`第 ${dayIndex + 1} 天的 stops 必须是数组。`);
    }
    day.stops.forEach((stop, stopIndex) => validateTripJsonStop(stop, dayIndex, stopIndex, warnings));
  });

  if (trip.copiedFromPublic) {
    markTripLocallyModified(trip);
  }
  prepareTripForSave(trip);

  return {
    trip,
    warnings,
    idChanged: Boolean(originalEditedId && originalEditedId !== targetId)
  };
}

function tripJsonEditorStats(trip) {
  const days = Array.isArray(trip.days) ? trip.days : [];
  const stops = days.flatMap(day => Array.isArray(day.stops) ? day.stops : []);
  const birdStops = stops.filter(stop => stop.type === "bird");
  const birdNames = collectBirdNamesFromTrips([trip]);
  const quickInfoCount = Array.isArray(trip.quickInfo) ? trip.quickInfo.length : 0;
  return {
    dayCount: days.length,
    stopCount: stops.length,
    birdStopCount: birdStops.length,
    birdNameCount: birdNames.length,
    quickInfoCount,
    birdNames
  };
}

function tripJsonDiffSourceTrip() {
  const source = tripJsonEditorState.sourceTrip || currentTrip();
  return deepCopy(source);
}

function buildTripJsonDiff(oldText, newText, maxRows = 420) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  if (oldText === newText) {
    return {
      changed: false,
      added: 0,
      deleted: 0,
      rows: [{ type: "note", text: "没有检测到变化。" }],
      truncated: false
    };
  }

  const m = oldLines.length;
  const n = newLines.length;
  const rows = [];
  let added = 0;
  let deleted = 0;

  if (m * n <= 180000) {
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i -= 1) {
      for (let j = n - 1; j >= 0; j -= 1) {
        dp[i][j] = oldLines[i] === newLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }

    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (oldLines[i] === newLines[j]) {
        rows.push({ type: "same", text: "  " + oldLines[i] });
        i += 1;
        j += 1;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        rows.push({ type: "del", text: "- " + oldLines[i] });
        deleted += 1;
        i += 1;
      } else {
        rows.push({ type: "add", text: "+ " + newLines[j] });
        added += 1;
        j += 1;
      }
    }
    while (i < m) {
      rows.push({ type: "del", text: "- " + oldLines[i] });
      deleted += 1;
      i += 1;
    }
    while (j < n) {
      rows.push({ type: "add", text: "+ " + newLines[j] });
      added += 1;
      j += 1;
    }
  } else {
    const max = Math.max(m, n);
    for (let i = 0; i < max; i += 1) {
      if (oldLines[i] === newLines[i]) {
        rows.push({ type: "same", text: "  " + (oldLines[i] || "") });
      } else {
        if (i < m) {
          rows.push({ type: "del", text: "- " + oldLines[i] });
          deleted += 1;
        }
        if (i < n) {
          rows.push({ type: "add", text: "+ " + newLines[i] });
          added += 1;
        }
      }
    }
  }

  const truncated = rows.length > maxRows;
  const visibleRows = truncated
    ? [
        ...rows.slice(0, Math.floor(maxRows * 0.65)),
        { type: "note", text: `... diff 过长，已省略 ${rows.length - maxRows} 行 ...` },
        ...rows.slice(rows.length - Math.ceil(maxRows * 0.35))
      ]
    : rows;

  return { changed: true, added, deleted, rows: visibleRows, truncated };
}

function renderTripJsonDiff(result) {
  const sourceText = prettyTripJson(tripJsonDiffSourceTrip());
  const targetText = prettyTripJson(result.trip);
  const diff = buildTripJsonDiff(sourceText, targetText);
  const label = tripJsonEditorState.sourceLabel || "当前行程版本";
  const body = diff.rows.map(row => (
    `<span class="json-diff-line ${row.type}">${escapeHtml(row.text)}</span>`
  )).join("");
  setTripJsonEditorDiffHtml(`
    <div class="json-editor-diff-header">
      保存前 Diff：对比 ${escapeHtml(label)}。新增 ${diff.added} 行，删除 ${diff.deleted} 行。${diff.truncated ? "内容较长，已截断显示。" : ""}
    </div>
    <pre class="json-editor-diff-body">${body}</pre>
  `);
  return diff;
}

function renderTripJsonEditorSummary(result) {
  const stats = result.stats || tripJsonEditorStats(result.trip);
  const warningHtml = result.warnings.length
    ? `<div class="json-editor-summary-item"><b>提示</b><br>${result.warnings.map(escapeHtml).join("<br>")}</div>`
    : "";
  const idHtml = result.idChanged
    ? `<div class="json-editor-summary-item"><b>ID 保护</b><br>你修改了 id，但保存时会继续使用当前行程 ID，避免覆盖其他行程。</div>`
    : "";

  setTripJsonEditorSummaryHtml(`
    <div class="json-editor-summary-item">
      <b>校验摘要</b><br>
      行程：${escapeHtml(result.trip.title || "未命名行程")}<br>
      可见性：${escapeHtml(TRIP_VISIBILITY_LABELS[normalizeTripVisibility(result.trip.visibility)] || result.trip.visibility || "private")}<br>
      天数：${stats.dayCount}｜活动：${stats.stopCount}｜鸟点：${stats.birdStopCount}<br>
      目标鸟种：${stats.birdNameCount}｜信息速查：${stats.quickInfoCount}
    </div>
    ${idHtml}
    ${warningHtml}
  `);
}

function readAndValidateTripJsonEditor() {
  const raw = parseTripJsonEditorText();
  const result = normalizeTripJsonEditorCandidate(raw);
  result.stats = tripJsonEditorStats(result.trip);
  renderTripJsonEditorSummary(result);
  tripJsonEditorState.idChanged = result.idChanged;
  return result;
}

function formatTripJsonEditor() {
  try {
    const result = readAndValidateTripJsonEditor();
    tripJsonTextarea().value = prettyTripJson(result.trip);
    setTripJsonEditorDiffHtml("");
    setTripJsonEditorStatus("JSON 已格式化，校验通过。");
  } catch (e) {
    setTripJsonEditorStatus(e.message, true);
  }
}

function previewTripJsonDiff() {
  const result = validateTripJsonEditor();
  if (!result) return null;
  const diff = renderTripJsonDiff(result);
  setTripJsonEditorStatus(diff.changed
    ? `已生成保存前 Diff：新增 ${diff.added} 行，删除 ${diff.deleted} 行。`
    : "已生成保存前 Diff：没有检测到变化。");
  return result;
}

function validateTripJsonEditor() {
  try {
    const result = readAndValidateTripJsonEditor();
    setTripJsonEditorStatus(`解析校验通过：${result.stats.dayCount} 天，${result.stats.stopCount} 个活动，${result.stats.birdNameCount} 个目标鸟种。`);
    return result;
  } catch (e) {
    setTripJsonEditorSummaryHtml("");
    setTripJsonEditorStatus(e.message, true);
    return null;
  }
}

async function restoreTripJsonFromBackend() {
  if (!hasTrips()) {
    alert("请先创建或导入一个行程。");
    return;
  }

  const activeTrip = currentTrip();
  setTripJsonEditorDiffHtml("");
  if (sessionMode === "account" && currentUser && activeTrip.id) {
    setTripJsonEditorStatus("正在恢复当前后端版本...");
    try {
      const idle = await flushScheduledBackendSync();
      if (!idle) throw new Error("当前账号同步尚未完成，请稍后再恢复。");
      const data = await apiFetch(`/api/trips/${encodeURIComponent(activeTrip.id)}`);
      const sourceTrip = data.trip || activeTrip;
      tripJsonEditorState.sourceTrip = deepCopy(sourceTrip);
      tripJsonEditorState.sourceLabel = "当前后端版本";
      tripJsonEditorState.loadedFromBackend = true;
      tripJsonTextarea().value = prettyTripJson(sourceTrip);
      validateTripJsonEditor();
      setTripJsonEditorStatus("已恢复为当前后端版本。");
    } catch (e) {
      setTripJsonEditorStatus("恢复当前后端版本失败：" + e.message, true);
    }
    return;
  }

  const sourceTrip = deepCopy(activeTrip);
  tripJsonEditorState.sourceTrip = sourceTrip;
  tripJsonEditorState.sourceLabel = "当前内存版本";
  tripJsonEditorState.loadedFromBackend = false;
  tripJsonTextarea().value = prettyTripJson(sourceTrip);
  validateTripJsonEditor();
  setTripJsonEditorStatus("游客模式下已恢复为当前内存版本。");
}

function buildTripJsonEditorConfirmMessage(result) {
  const stats = result.stats || tripJsonEditorStats(result.trip);
  return [
    "确认保存当前行程 JSON？",
    "",
    `行程：${result.trip.title || "未命名行程"}`,
    `天数：${stats.dayCount}`,
    `活动：${stats.stopCount}`,
    `鸟点：${stats.birdStopCount}`,
    `目标鸟种：${stats.birdNameCount}`,
    `信息速查：${stats.quickInfoCount}`,
    `可见性：${TRIP_VISIBILITY_LABELS[normalizeTripVisibility(result.trip.visibility)] || result.trip.visibility || "private"}`,
    result.idChanged ? "注意：你修改了 id，但系统会继续使用当前行程 ID。" : "",
    result.warnings.length ? `提示：${result.warnings.length} 条字段提示已显示在弹窗内。` : "",
    "保存前 Diff 已显示在弹窗内。",
    sessionMode === "account" && currentUser ? "后端保存前会自动备份当前旧版本。" : "",
    "",
    "确认后会保存并重新渲染当前行程。"
  ].filter(Boolean).join("\n");
}

async function openTripJsonEditor() {
  if (!hasTrips()) {
    alert("请先创建或导入一个行程，再编辑 JSON。");
    return;
  }

  const dialog = tripJsonEditorEl("tripJsonEditorDialog");
  const textarea = tripJsonTextarea();
  const activeTrip = currentTrip();
  tripJsonEditorState = {
    tripId: activeTrip.id || "",
    loadedFromBackend: false,
    idChanged: false,
    sourceTrip: deepCopy(activeTrip),
    sourceLabel: "当前页面版本"
  };

  dialog.showModal();
  textarea.value = prettyTripJson(activeTrip);
  setTripJsonEditorSummaryHtml("");
  setTripJsonEditorDiffHtml("");
  setTripJsonEditorStatus("正在读取当前行程 JSON...");

  let sourceTrip = deepCopy(activeTrip);
  if (sessionMode === "account" && currentUser && activeTrip.id) {
    try {
      const idle = await flushScheduledBackendSync();
      if (!idle) throw new Error("当前账号同步尚未完成，请稍后再打开 JSON 编辑。");
      const data = await apiFetch(`/api/trips/${encodeURIComponent(activeTrip.id)}`);
      sourceTrip = data.trip || sourceTrip;
      tripJsonEditorState.loadedFromBackend = true;
      tripJsonEditorState.sourceTrip = deepCopy(sourceTrip);
      tripJsonEditorState.sourceLabel = "当前后端版本";
      setTripJsonEditorStatus("已读取后端当前行程 JSON。");
    } catch (e) {
      setTripJsonEditorStatus("读取后端 JSON 失败，已显示当前页面中的行程数据：" + e.message, true);
    }
  } else {
    tripJsonEditorState.sourceTrip = deepCopy(sourceTrip);
    tripJsonEditorState.sourceLabel = "当前内存版本";
    setTripJsonEditorStatus("游客模式：正在编辑当前内存行程 JSON。");
  }

  textarea.value = prettyTripJson(sourceTrip);
  validateTripJsonEditor();
}

function closeTripJsonEditor() {
  tripJsonEditorEl("tripJsonEditorDialog")?.close();
}

async function saveTripJsonEditor() {
  const result = validateTripJsonEditor();
  if (!result) return;
  renderTripJsonDiff(result);

  const birdNames = result.stats.birdNames || [];
  if (birdNames.length) {
    setTripJsonEditorStatus(`正在校验 ${birdNames.length} 个目标鸟种映射...`);
    const mappingOk = await ensureBirdMappingsForNames(birdNames, { promptMissing: true });
    if (!mappingOk) {
      setTripJsonEditorStatus("已取消保存：目标鸟种映射尚未确认。", true);
      return;
    }
  }

  if (!confirm(buildTripJsonEditorConfirmMessage(result))) {
    setTripJsonEditorStatus("已取消保存。");
    return;
  }

  const targetIndex = currentTripIndex;
  const trip = result.trip;
  trip.id = tripJsonEditorState.tripId || currentTrip().id || trip.id || makeClientId("trip");
  if (trip.copiedFromPublic) markTripLocallyModified(trip);
  prepareTripForSave(trip);

  if (sessionMode === "account" && currentUser) {
    setTripJsonEditorStatus("正在保存到后端当前行程文件...");
    try {
      const idle = await flushScheduledBackendSync();
      if (!idle) throw new Error("当前账号同步尚未完成，请稍后再保存。");
      const data = await apiFetch(`/api/trips/${encodeURIComponent(trip.id)}`, {
        method: "PUT",
        body: {
          trip,
          backupPrevious: true,
          backupReason: "json_editor"
        }
      });
      trips[targetIndex] = data.trip || trip;
      currentTripIndex = Math.max(0, Math.min(targetIndex, trips.length - 1));
      persistLocalTripsOnly();
      currentFilter = "ALL";
      clearEbirdHotspots();
      render("ALL");
      updateAccountStatus(`已保存当前行程：${currentUser.username}`);
      closeTripJsonEditor();
      showToast(data.backup ? "当前行程 JSON 已保存，旧版本已备份" : "当前行程 JSON 已保存");
    } catch (e) {
      setTripJsonEditorStatus("保存失败：" + e.message, true);
    }
    return;
  }

  trips[targetIndex] = trip;
  currentTripIndex = targetIndex;
  currentFilter = "ALL";
  saveTrips();
  clearEbirdHotspots();
  render("ALL");
  closeTripJsonEditor();
  showToast("当前行程 JSON 已保存到内存");
}

Object.assign(window, {
  openTripJsonEditor,
  closeTripJsonEditor,
  formatTripJsonEditor,
  restoreTripJsonFromBackend,
  validateTripJsonEditor,
  previewTripJsonDiff,
  saveTripJsonEditor
});
