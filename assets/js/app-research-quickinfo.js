function currentResearchStop() {
  if (currentResearchDayIndex === null || currentResearchStopIndex === null) return null;
  return currentDays()[currentResearchDayIndex]?.stops?.[currentResearchStopIndex] || null;
}

function researchStopId(stop) {
  if (!stop.id) stop.id = makeClientId("stop");
  return stop.id;
}

function defaultResearchQuery(stop) {
  return buildResearchQueryFromKeywords(buildResearchKeywordTokens(stop).filter(item => item.selected).map(item => item.text));
}

function uniqueResearchKeywords(values) {
  const seen = new Set();
  return values
    .map(v => String(v || "").trim())
    .filter(Boolean)
    .filter(v => {
      const key = v.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildResearchKeywordTokens(stop, selectedKeywords = null) {
  const defaults = uniqueResearchKeywords([
    stop.name,
    ...parseBirdNames(stop.birds).slice(0, 8),
    "观鸟",
    "攻略"
  ]);
  const selectedSet = selectedKeywords
    ? new Set(selectedKeywords.map(v => String(v || "").trim()).filter(Boolean))
    : new Set(defaults);
  return defaults.map(text => ({ text, selected: selectedSet.has(text) }));
}

function buildResearchQueryFromKeywords(keywords, manualText = "") {
  return uniqueResearchKeywords([...(keywords || []), ...String(manualText || "").split(/\s+/)]).join(" ");
}

function selectedResearchKeywords() {
  return researchKeywordTokens.filter(item => item.selected).map(item => item.text);
}

function inputResearchKeywords() {
  return uniqueResearchKeywords(document.getElementById("researchQueryInput").value.split(/\s+/));
}

function activeResearchKeywords() {
  return uniqueResearchKeywords([...selectedResearchKeywords(), ...inputResearchKeywords()]);
}

function renderResearchKeywordChips() {
  const el = document.getElementById("researchKeywordChips");
  if (!el) return;
  el.innerHTML = researchKeywordTokens.map((item, index) => `
    <button type="button" class="research-keyword-chip ${item.selected ? "active" : ""}" onclick="toggleResearchKeyword(${index})">
      ${escapeHtml(item.text)}
    </button>
  `).join("");
}

function syncResearchInputFromKeywords() {
  document.getElementById("researchQueryInput").value = buildResearchQueryFromKeywords(selectedResearchKeywords());
}

function syncResearchKeywordSelectionFromInput() {
  const query = document.getElementById("researchQueryInput").value;
  const terms = new Set(inputResearchKeywords());
  researchKeywordTokens = researchKeywordTokens.map(item => ({ ...item, selected: terms.has(item.text) || query.includes(item.text) }));
  renderResearchKeywordChips();
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toggleResearchKeyword(index) {
  const token = researchKeywordTokens[index];
  if (!token) return;
  const input = document.getElementById("researchQueryInput");
  const query = input.value;
  const terms = inputResearchKeywords();
  const hasTerm = terms.includes(token.text) || query.includes(token.text);
  let nextTerms;
  if (hasTerm || token.selected) {
    const nextQuery = query.replace(new RegExp(escapeRegExp(token.text), "g"), " ").replace(/\s+/g, " ").trim();
    nextTerms = uniqueResearchKeywords(nextQuery.split(/\s+/));
    input.value = nextQuery;
    researchKeywordTokens[index] = { ...token, selected: false };
  } else {
    nextTerms = [...terms, token.text];
    researchKeywordTokens[index] = { ...token, selected: true };
    input.value = buildResearchQueryFromKeywords(nextTerms);
  }
  syncResearchKeywordSelectionFromInput();
}

function setResearchStatus(message, isError = false) {
  const el = document.getElementById("researchStatus");
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "var(--red)" : "var(--muted)";
}

function setResearchProgress(active, message = "") {
  const el = document.getElementById("researchProgress");
  const text = document.getElementById("researchProgressText");
  if (!el) return;
  el.classList.toggle("active", Boolean(active));
  el.setAttribute("aria-busy", active ? "true" : "false");
  if (text) text.textContent = message || "处理中...";
}

function setResearchBusy(active, message = "") {
  researchBusy = Boolean(active);
  setResearchProgress(researchBusy, message);
  document.querySelectorAll(".research-action").forEach(button => {
    button.disabled = researchBusy;
  });
}

function selectedResearchSources() {
  return Array.from(document.querySelectorAll(".research-source:checked")).map(el => el.value);
}

function selectedResearchArticles() {
  return researchArticles.filter((_, index) => {
    const box = document.getElementById(`researchArticleSelect${index}`);
    return box && box.checked;
  });
}

function renderResearchArticles() {
  const el = document.getElementById("researchArticles");
  if (!el) return;

  if (!researchArticles.length) {
    el.innerHTML = `<div class="hint">暂无候选文章。可以先搜索，或手动粘贴链接。</div>`;
    return;
  }

  el.innerHTML = researchArticles.map((article, index) => {
    const providerText = [article.source || "manual", article.provider, article.note_id ? `note_id:${article.note_id}` : "", article.note_type ? `type:${article.note_type}` : ""].filter(Boolean).join("｜");
    const fetchLabel = article.loading ? "抓取中..." : (article.provider === "rnote" && !article.text ? "抓取详情" : (article.text ? "重新抓取正文" : "抓取正文"));
    const fetchDisabled = researchBusy || article.loading ? "disabled" : "";
    const textStatus = article.loading ? "正在抓取正文..." : (article.text ? `正文 ${article.text.length} 字` : "尚未抓取正文");
    return `
      <div class="research-article">
        <div class="research-article-title">
          <label>
            <input id="researchArticleSelect${index}" type="checkbox" ${article.selected === false ? "" : "checked"}>
            <span>${escapeHtml(article.title || article.url || "未命名文章")}</span>
          </label>
        </div>
        <div class="research-article-meta">${escapeHtml(providerText)}${article.url ? `｜${escapeHtml(article.url)}` : ""}</div>
        ${article.snippet ? `<div>${escapeHtml(article.snippet)}</div>` : ""}
        ${article.llmFilterReason ? `<div class="hint">LLM 筛选：${escapeHtml(article.llmFilterReason)}</div>` : ""}
        <div class="row" style="margin-top:8px;">
          <button class="small-btn research-action" onclick="fetchResearchArticleText(${index})" ${fetchDisabled}>${fetchLabel}</button>
          ${article.url ? `<a class="small-btn blue" href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">打开原文</a>` : ""}
          <span class="hint">${textStatus}</span>
        </div>
      </div>
    `;
  }).join("");
}

function inlineMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  return html;
}

function markdownToHtml(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let listType = "";

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = "";
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      if (listType !== "ul") {
        closeList();
        listType = "ul";
        html.push("<ul>");
      }
      html.push(`<li>${inlineMarkdown(unordered[1])}</li>`);
      continue;
    }
    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      if (listType !== "ol") {
        closeList();
        listType = "ol";
        html.push("<ol>");
      }
      html.push(`<li>${inlineMarkdown(ordered[1])}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  closeList();
  return html.join("");
}

function researchSummaryMarkdown() {
  if (!researchSummaryResult) return "";
  if (typeof researchSummaryResult === "string") return researchSummaryResult;
  return researchSummaryResult.summaryMarkdown ||
    researchSummaryResult.markdown ||
    (typeof researchSummaryResult.summary === "string" ? researchSummaryResult.summary : "") ||
    researchSummaryResult.raw ||
    "";
}

function renderResearchSummary() {
  const el = document.getElementById("researchSummary");
  if (!el) return;
  if (!researchSummaryResult) {
    el.textContent = "暂无解析结果。";
    return;
  }
  const markdown = researchSummaryMarkdown();
  if (markdown) {
    el.innerHTML = markdownToHtml(markdown);
    return;
  }
  el.textContent = JSON.stringify(researchSummaryResult.summary || researchSummaryResult, null, 2);
}

async function openResearchDialog(dayIndex, stopIndex) {
  if (sessionMode !== "account" || !currentUser) {
    alert("攻略文章模块需要登录账号，因为 API Key 和攻略结果保存在本机后端用户目录。");
    return;
  }

  ensureTripRecordIds();
  persistLocalTripsOnly();
  currentResearchDayIndex = dayIndex;
  currentResearchStopIndex = stopIndex;
  const stop = currentResearchStop();
  if (!stop) return;

  document.getElementById("researchTitle").textContent = `鸟点攻略文章｜${stop.name}`;
  researchKeywordTokens = buildResearchKeywordTokens(stop);
  renderResearchKeywordChips();
  syncResearchInputFromKeywords();
  document.getElementById("researchUrlInput").value = "";
  applyContentSourceDefaultsToResearch();
  researchArticles = [];
  researchSummaryResult = null;
  renderResearchArticles();
  renderResearchSummary();
  setResearchStatus("正在读取已保存攻略...");

  researchDialog.showModal();

  try {
    const data = await apiFetch(`/api/trips/${encodeURIComponent(currentTrip().id)}/research/${encodeURIComponent(researchStopId(stop))}`);
    const research = data.research || {};
    if (Array.isArray(research.articles)) researchArticles = research.articles;
    if (research.summaryMarkdown) {
      researchSummaryResult = { summaryMarkdown: research.summaryMarkdown };
    } else if (typeof research.summary === "string" && research.summary.trim()) {
      researchSummaryResult = { summaryMarkdown: research.summary };
    } else if (research.summary && Object.keys(research.summary).length) {
      researchSummaryResult = { summary: research.summary };
    }
    if (Array.isArray(research.keywords) && research.keywords.length) {
      researchKeywordTokens = buildResearchKeywordTokens(stop, research.keywords);
      renderResearchKeywordChips();
      if (!research.query) syncResearchInputFromKeywords();
    }
    if (research.query) {
      document.getElementById("researchQueryInput").value = research.query;
      syncResearchKeywordSelectionFromInput();
    }
    renderResearchArticles();
    renderResearchSummary();
    setResearchStatus(Object.keys(research).length ? "已读取保存过的攻略结果。" : "暂无保存过的攻略结果。");
  } catch (e) {
    setResearchStatus("读取攻略失败：" + e.message, true);
  }
}

function closeResearchDialog() {
  researchDialog.close();
}

async function searchResearchArticles() {
  const query = document.getElementById("researchQueryInput").value.trim();
  const keywords = activeResearchKeywords();
  if (!query) {
    alert("请先填写搜索关键词。");
    return;
  }

  setResearchStatus("正在搜索候选文章...");
  try {
    const sources = selectedResearchSources();
    const useLocalXhs = sources.includes("xiaohongshu") && isXhsLocalBrowserMode();
    const backendSources = useLocalXhs ? sources.filter(source => source !== "xiaohongshu") : sources;
    const errors = [];
    let filterMode = "rules";
    let incoming = [];

    if (backendSources.length) {
      try {
        const data = await apiFetch("/api/research/search", {
          method: "POST",
          body: {
            query,
            keywords,
            sources: backendSources
          }
        });
        incoming.push(...(Array.isArray(data.results) ? data.results : []));
        if (Array.isArray(data.errors) && data.errors.length) errors.push(...data.errors);
        filterMode = data.filter || filterMode;
      } catch (e) {
        errors.push("backend: " + e.message);
      }
    }

    if (useLocalXhs) {
      setResearchStatus("正在通过本地助手搜索小红书...");
      try {
        const data = await xhsHelperFetch("/api/xiaohongshu/search", {
          method: "POST",
          body: {
            username: xhsHelperUsername(),
            query,
            limit: 12
          }
        });
        incoming.push(...(Array.isArray(data.results) ? data.results : []));
      } catch (e) {
        errors.push("xiaohongshu_local: " + e.message);
      }
    }

    const seenUrls = new Set();
    incoming = incoming.filter(item => {
      const url = item?.url || "";
      if (!url || seenUrls.has(url)) return false;
      seenUrls.add(url);
      return true;
    });
    if (!incoming.length && errors.length) {
      setResearchStatus("搜索失败：" + errors.join(" / "), true);
      return;
    }

    researchArticles = incoming.map(item => ({ ...item, selected: true }));
    researchSummaryResult = null;
    renderResearchArticles();
    renderResearchSummary();
    const errorText = errors.length ? `；部分来源失败：${errors.join(" / ")}` : "";
    const filterText = filterMode === "llm"
      ? "（LLM 已筛选）"
      : (filterMode === "rules_fallback" ? "（LLM 筛选失败，已用规则兜底）" : "（规则筛选）");
    const localText = useLocalXhs ? "；小红书来自本地助手" : "";
    if (incoming.length) {
      setResearchStatus(`已刷新，找到 ${incoming.length} 条相关候选文章${filterText}${localText}${errorText}`);
    } else {
      setResearchStatus(`已刷新，但没有找到相关候选文章${filterText}${localText}；明显无关的搜索结果已被过滤${errorText}`);
    }
  } catch (e) {
    setResearchStatus("搜索失败：" + e.message, true);
  }
}

async function fetchResearchArticleText(index) {
  const article = researchArticles[index];
  if (!article?.url && !article?.note_id) return;

  researchArticles[index] = { ...article, loading: true };
  renderResearchArticles();
  setResearchStatus(`正在抓取正文：${article.title || article.url}`);
  setResearchBusy(true, `正在抓取正文：${article.title || article.url || "候选文章"}`);
  try {
    const data = article.provider === "xhs_local_browser"
      ? await xhsHelperFetch("/api/xiaohongshu/read-note", {
          method: "POST",
          body: { username: xhsHelperUsername(), url: article.url }
        })
      : await apiFetch("/api/research/ingest-url", {
          method: "POST",
          body: { url: article.url, article }
        });
    researchArticles[index] = {
      ...article,
      ...data.article,
      source: article.source || data.article.source || "manual",
      loading: false,
      selected: true
    };
    renderResearchArticles();
    setResearchStatus("正文抓取完成。");
  } catch (e) {
    if (researchArticles[index]) {
      researchArticles[index].snippet = researchArticles[index].snippet || `正文抓取失败：${e.message}`;
      researchArticles[index].loading = false;
    }
    renderResearchArticles();
    setResearchStatus("正文抓取失败：" + e.message, true);
  } finally {
    if (researchArticles[index]) {
      researchArticles[index].loading = false;
    }
    renderResearchArticles();
    setResearchBusy(false);
  }
}

async function ingestResearchUrl() {
  const url = document.getElementById("researchUrlInput").value.trim();
  if (!url) {
    alert("请先粘贴文章链接。");
    return;
  }
  const existingIndex = researchArticles.findIndex(a => a.url === url);
  if (existingIndex >= 0) {
    await fetchResearchArticleText(existingIndex);
    return;
  }
  researchArticles.unshift({ title: url, url, source: "manual", selected: true });
  renderResearchArticles();
  await fetchResearchArticleText(0);
}

async function summarizeResearchArticles() {
  const stop = currentResearchStop();
  if (!stop) return;
  const articles = selectedResearchArticles();
  if (!articles.length) {
    alert("请至少勾选一篇候选文章。");
    return;
  }

  setResearchStatus("正在调用 AI 生成攻略...");
  setResearchBusy(true, "AI 正在生成攻略...");
  try {
    const query = document.getElementById("researchQueryInput").value.trim();
    const keywords = activeResearchKeywords();
    const data = await apiFetch("/api/research/summarize", {
      method: "POST",
      body: {
        trip: currentTrip(),
        stop,
        searchQuery: query,
        keywords,
        articles
      }
    });
    researchSummaryResult = data.result;
    renderResearchSummary();
    setResearchStatus("AI 攻略文案已生成。");
    showToast("攻略解析完成");
  } catch (e) {
    setResearchStatus("AI 生成失败：" + e.message, true);
  } finally {
    setResearchBusy(false);
  }
}

async function saveResearchToBackend() {
  const stop = currentResearchStop();
  if (!stop) return;
  if (!researchArticles.length && !researchSummaryResult) {
    alert("当前没有可保存的攻略内容。");
    return;
  }

  setResearchStatus("正在保存攻略结果...");
  try {
    await apiFetch(`/api/trips/${encodeURIComponent(currentTrip().id)}/research/${encodeURIComponent(researchStopId(stop))}`, {
      method: "PUT",
      body: {
        stopName: stop.name,
        query: document.getElementById("researchQueryInput").value.trim(),
        keywords: activeResearchKeywords(),
        articles: researchArticles,
        summary: researchSummaryResult?.summary || {},
        summaryMarkdown: researchSummaryMarkdown()
      }
    });
    setResearchStatus("攻略结果已保存到本机后端。");
    showToast("攻略结果已保存");
  } catch (e) {
    setResearchStatus("保存攻略失败：" + e.message, true);
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function safeExternalUrl(value) {
  let text = String(value || "").trim();
  if (/^www\./i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.href;
  } catch (e) {
    return "";
  }
}

function renderNoteHtml(value) {
  const text = String(value || "");
  if (!text) return "";
  const pattern = /\[((?:https?:\/\/|www\.)[^\]\s]+)\]/gi;
  let html = "";
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    html += escapeHtml(text.slice(lastIndex, match.index));
    const url = safeExternalUrl(match[1]);
    if (url) {
      html += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(match[1])}</a>`;
    } else {
      html += escapeHtml(match[0]);
    }
    lastIndex = match.index + match[0].length;
  }
  html += escapeHtml(text.slice(lastIndex));
  return html;
}

function setQuickInfoStatus(message, isError = false) {
  const el = document.getElementById("quickInfoStatus");
  if (!el) return;
  el.textContent = message || "";
  el.style.color = isError ? "var(--red)" : "var(--muted)";
}

function normalizeQuickInfoItem(item = {}) {
  return {
    id: String(item.id || makeClientId("quick_info")),
    key: String(item.key || "").trim().slice(0, 120),
    value: String(item.value || "").trim().slice(0, 2000),
    createdAt: String(item.createdAt || ""),
    updatedAt: String(item.updatedAt || "")
  };
}

function normalizeQuickInfoItems(items = []) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items
    .map(normalizeQuickInfoItem)
    .filter(item => item.key || item.value)
    .filter(item => {
      if (!item.id || seen.has(item.id)) item.id = makeClientId("quick_info");
      seen.add(item.id);
      return true;
    })
    .slice(0, 300);
}

function normalizeQuickInfoEditorItems(items = []) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items
    .map(normalizeQuickInfoItem)
    .filter(item => {
      if (!item.id || seen.has(item.id)) item.id = makeClientId("quick_info");
      seen.add(item.id);
      return true;
    })
    .slice(0, 300);
}

function quickInfoPreviewItemHtml(item, index) {
  const normalized = normalizeQuickInfoItem(item);
  const key = normalized.key || "未命名";
  const value = normalized.value;
  const url = safeExternalUrl(value);
  const keyHtml = url
    ? `<a class="quick-info-key" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(key)}</a>`
    : `<div class="quick-info-key">${escapeHtml(key)}</div>`;
  return `
    <div class="quick-info-item" data-id="${escapeHtml(normalized.id)}">
      <div>
        ${keyHtml}
        <div class="quick-info-value">${escapeHtml(value || "-")}</div>
      </div>
      <div class="quick-info-actions">
        <button type="button" onclick="editQuickInfoItem(${index})">修改</button>
        <button type="button" class="danger" onclick="deleteQuickInfoItem(${index})">删除</button>
      </div>
    </div>
  `;
}

function renderQuickInfoPreview(items = quickInfoItems) {
  const el = document.getElementById("quickInfoPreview");
  if (!el) return;
  quickInfoItems = normalizeQuickInfoItems(items || []);
  if (!quickInfoItems.length) {
    el.innerHTML = `<div class="hint">还没有速查信息，点击“新增一条”开始记录。</div>`;
    return;
  }
  el.innerHTML = quickInfoItems.map(quickInfoPreviewItemHtml).join("");
}

function quickInfoEditorElements() {
  return {
    panel: document.getElementById("quickInfoEditor"),
    indexInput: document.getElementById("quickInfoEditIndex"),
    keyInput: document.getElementById("quickInfoKeyInput"),
    valueInput: document.getElementById("quickInfoValueInput")
  };
}

function setQuickInfoEditorVisible(visible) {
  const { panel, indexInput, keyInput, valueInput } = quickInfoEditorElements();
  if (!panel) return;
  panel.style.display = visible ? "grid" : "none";
  if (!visible) {
    if (indexInput) indexInput.value = "";
    if (keyInput) keyInput.value = "";
    if (valueInput) valueInput.value = "";
  }
}

function renderQuickInfoEditor(item = {}, index = "") {
  const normalized = normalizeQuickInfoItem(item);
  const { indexInput, keyInput, valueInput } = quickInfoEditorElements();
  setQuickInfoEditorVisible(true);
  if (indexInput) indexInput.value = index === "" ? "" : String(index);
  if (keyInput) keyInput.value = normalized.key;
  if (valueInput) valueInput.value = normalized.value;
  setTimeout(() => keyInput?.focus(), 30);
}

function cancelQuickInfoEditor() {
  setQuickInfoEditorVisible(false);
  setQuickInfoStatus("");
}

function startQuickInfoAdd(item = {}) {
  renderQuickInfoEditor({
    id: makeClientId("quick_info"),
    createdAt: new Date().toISOString(),
    ...item
  });
  setQuickInfoStatus("填写后点击确认，会保存到当前行程。");
}

function editQuickInfoItem(index) {
  const itemIndex = Number(index);
  if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= quickInfoItems.length) {
    setQuickInfoStatus("未找到要修改的速查信息。", true);
    return;
  }
  renderQuickInfoEditor(quickInfoItems[itemIndex], itemIndex);
  setQuickInfoStatus("正在修改这条速查信息。");
}

async function confirmQuickInfoEditor() {
  const { indexInput, keyInput, valueInput } = quickInfoEditorElements();
  const key = String(keyInput?.value || "").trim();
  const value = String(valueInput?.value || "").trim();
  if (!key || !value) {
    setQuickInfoStatus("Key 和 Value 都需要填写。", true);
    return false;
  }

  const rawIndex = String(indexInput?.value || "");
  const editIndex = Number(rawIndex);
  const isEditing = rawIndex !== "" && Number.isInteger(editIndex) && editIndex >= 0 && editIndex < quickInfoItems.length;
  const now = new Date().toISOString();
  const base = isEditing ? quickInfoItems[editIndex] : {};
  const nextItem = normalizeQuickInfoItem({
    ...base,
    id: base.id || makeClientId("quick_info"),
    key,
    value,
    createdAt: base.createdAt || now,
    updatedAt: now
  });

  const nextItems = quickInfoItems.slice();
  if (isEditing) {
    nextItems[editIndex] = nextItem;
  } else {
    nextItems.push(nextItem);
  }
  quickInfoItems = normalizeQuickInfoItems(nextItems);
  cancelQuickInfoEditor();
  renderQuickInfoPreview(quickInfoItems);
  return saveQuickInfo({ source: "editor" });
}

async function deleteQuickInfoItem(index) {
  const itemIndex = Number(index);
  if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= quickInfoItems.length) {
    setQuickInfoStatus("未找到要删除的速查信息。", true);
    return false;
  }
  const item = quickInfoItems[itemIndex];
  if (!confirm(`删除“${item.key || "未命名"}”？`)) return false;
  quickInfoItems = quickInfoItems.filter((_, i) => i !== itemIndex);
  cancelQuickInfoEditor();
  renderQuickInfoPreview(quickInfoItems);
  return saveQuickInfo({ source: "delete" });
}

function renderQuickInfoRows(items = quickInfoItems) {
  renderQuickInfoPreview(items);
}

function collectQuickInfoRows(options = {}) {
  return options.includeBlank ? quickInfoItems.slice() : normalizeQuickInfoItems(quickInfoItems);
}

function renderQuickInfoPreviewFromRows() {
  renderQuickInfoPreview(quickInfoItems);
}

function addQuickInfoRow(item = {}) {
  startQuickInfoAdd(item);
}

function removeQuickInfoRow(index) {
  return deleteQuickInfoItem(index);
}

async function openQuickInfoDialog() {
  if (!hasTrips()) {
    alert("请先创建或导入一个行程，再使用信息速查。");
    return;
  }
  quickInfoDialog.showModal();
  cancelQuickInfoEditor();
  const trip = currentTrip();
  quickInfoItems = normalizeQuickInfoItems(trip.quickInfo || []);
  renderQuickInfoPreview(quickInfoItems);
  const localStatus = sessionMode === "account" && currentUser
    ? `当前行程：${trip.title || "未命名行程"}。正在读取后端行程文件...`
    : `当前行程：${trip.title || "未命名行程"}。游客模式下仅保存在本次内存，可随行程 JSON 导出。`;
  setQuickInfoStatus(localStatus);

  if (sessionMode === "account" && currentUser && trip.id) {
    try {
      const data = await apiFetch(`/api/trips/${encodeURIComponent(trip.id)}/quick-info`);
      quickInfoItems = normalizeQuickInfoItems(data.items || []);
      trip.quickInfo = quickInfoItems;
      trip.quickInfoUpdatedAt = data.updatedAt || trip.quickInfoUpdatedAt || "";
      persistLocalTripsOnly();
      renderQuickInfoPreview(quickInfoItems);
      setQuickInfoStatus(`已载入当前行程的 ${quickInfoItems.length} 条速查信息。`);
    } catch (e) {
      setQuickInfoStatus("读取后端速查信息失败，已显示当前页面中的行程数据：" + e.message, true);
    }
  }
}

function closeQuickInfoDialog() {
  cancelQuickInfoEditor();
  quickInfoDialog.close();
}

async function saveQuickInfo(options = {}) {
  if (!hasTrips()) {
    alert("请先创建或导入一个行程，再保存信息速查。");
    return false;
  }
  const items = normalizeQuickInfoItems(quickInfoItems);
  const incomplete = items.find(item => !item.key || !item.value);
  if (incomplete) {
    setQuickInfoStatus("每条速查信息都需要同时填写 Key 和 Value。", true);
    return false;
  }

  const trip = currentTrip();
  quickInfoItems = normalizeQuickInfoItems(items);
  trip.quickInfo = quickInfoItems;
  trip.quickInfoUpdatedAt = new Date().toISOString();
  markTripLocallyModified(trip);
  prepareTripForSave(trip);
  persistLocalTripsOnly();
  renderQuickInfoPreview(quickInfoItems);

  if (sessionMode !== "account" || !currentUser) {
    render(currentFilter);
    setQuickInfoStatus(`已保存到当前内存行程，共 ${quickInfoItems.length} 条；导出行程 JSON 会带上这些信息。`);
    if (options.source !== "editor") showToast("信息速查已保存到当前行程");
    return true;
  }

  setQuickInfoStatus("正在保存到当前行程的后端文件...");
  try {
    const data = await apiFetch(`/api/trips/${encodeURIComponent(trip.id)}/quick-info`, {
      method: "PUT",
      body: { items: quickInfoItems }
    });
    quickInfoItems = normalizeQuickInfoItems(data.items || quickInfoItems);
    if (data.trip) {
      trips[currentTripIndex] = data.trip;
    } else {
      trip.quickInfo = quickInfoItems;
      trip.quickInfoUpdatedAt = data.updatedAt || trip.quickInfoUpdatedAt || "";
    }
    persistLocalTripsOnly();
    renderQuickInfoPreview(quickInfoItems);
    render(currentFilter);
    updateAccountStatus(`已保存当前行程：${currentUser.username}`);
    setQuickInfoStatus(`已保存到当前行程，共 ${quickInfoItems.length} 条。`);
    if (options.source !== "editor") showToast("信息速查已保存");
    return true;
  } catch (e) {
    setQuickInfoStatus("保存到后端失败，当前页面行程已更新但尚未确认写入后端：" + e.message, true);
    return false;
  }
}
