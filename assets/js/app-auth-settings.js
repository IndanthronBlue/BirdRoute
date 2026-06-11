function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 1800);
}

function setAuthStatus(message, isError = false) {
  const el = document.getElementById("authStatus");
  if (!el) return;
  el.textContent = message || "";
  el.classList.toggle("error", Boolean(isError));
}

function updateAccountStatus(message = "") {
  const el = document.getElementById("accountStatus");
  const logoutButton = document.getElementById("logoutButton");
  const guestLoginButton = document.getElementById("guestLoginButton");
  const saveButton = document.getElementById("saveCurrentTripButton");
  if (!el) return;

  if (sessionMode === "account" && currentUser) {
    el.textContent = message || `已登录：${currentUser.username}`;
    if (logoutButton) logoutButton.style.display = "";
    if (guestLoginButton) guestLoginButton.style.display = "none";
    if (saveButton) saveButton.style.display = "";
  } else if (sessionMode === "guest") {
    el.textContent = message || "游客模式：临时内存，不缓存行程";
    if (logoutButton) logoutButton.style.display = "none";
    if (guestLoginButton) guestLoginButton.style.display = "";
    if (saveButton) saveButton.style.display = "none";
  } else {
    el.textContent = message || "等待登录";
    if (logoutButton) logoutButton.style.display = "none";
    if (guestLoginButton) guestLoginButton.style.display = "none";
      if (saveButton) saveButton.style.display = "none";
  }
  renderEbirdHotspotActions();
}

function hasSavedEbirdToken() {
  if (pendingSecretUpdates.apiCredentials.clearEbirdToken) return false;
  if (pendingSecretUpdates.apiCredentials.ebirdToken) return false;
  return Boolean(lastAccountApiCredentials?.hasEbirdToken || lastAccountApiCredentials?.ebirdToken);
}

function renderEbirdHotspotActions() {
  const el = document.getElementById("headerEbirdActions");
  if (!el) return;
  const visible = sessionMode === "account"
    && currentUser
    && hasSavedEbirdToken()
    && (!ebirdTokenStatus.checked || ebirdTokenStatus.valid);
  el.style.display = visible ? "inline-flex" : "none";
}

async function validateEbirdTokenWithHotspotFallback() {
  try {
    const data = await apiFetch("/api/ebird/token-status");
    return {
      hasToken: Boolean(data.hasToken),
      valid: Boolean(data.valid),
      checked: true,
      error: data.error || ""
    };
  } catch (statusError) {
    try {
      await apiFetch("/api/ebird/hotspots?lat=0&lng=0&dist=1");
      return {
        hasToken: true,
        valid: true,
        checked: true,
        error: "",
        fallback: true
      };
    } catch (hotspotError) {
      return {
        hasToken: hasSavedEbirdToken(),
        valid: false,
        checked: true,
        error: statusError.message || hotspotError.message || "校验失败"
      };
    }
  }
}

async function refreshEbirdTokenStatus(showError = false) {
  ebirdTokenStatus = { hasToken: hasSavedEbirdToken(), valid: false, checked: false };
  renderEbirdHotspotActions();
  if (sessionMode !== "account" || !currentUser || !hasSavedEbirdToken()) return ebirdTokenStatus;

  ebirdTokenStatus = await validateEbirdTokenWithHotspotFallback();
  if (showError && ebirdTokenStatus.hasToken && !ebirdTokenStatus.valid) {
    alert("eBird API Token 校验失败：" + (ebirdTokenStatus.error || "请在设置里重新保存有效 token。"));
  }
  renderEbirdHotspotActions();
  return ebirdTokenStatus;
}

function loadAuthSessionToken() {
  try {
    authSessionToken = sessionStorage.getItem(STORAGE_KEY + "_auth_token") || "";
  } catch (e) {
    authSessionToken = "";
  }
}

function saveAuthSessionToken(token = "") {
  authSessionToken = String(token || "");
  try {
    if (authSessionToken) {
      sessionStorage.setItem(STORAGE_KEY + "_auth_token", authSessionToken);
    } else {
      sessionStorage.removeItem(STORAGE_KEY + "_auth_token");
    }
  } catch (e) {}
}

async function apiFetch(path, options = {}) {
  const headers = {
    "Accept": "application/json",
    ...(options.headers || {})
  };
  if (authSessionToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${authSessionToken}`;
  }

  let body = options.body;
  if (body && typeof body !== "string" && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  } else if (typeof body === "string" && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  let res;
  try {
    res = await fetch(API_BASE + path, {
      credentials: API_BASE ? "include" : "same-origin",
      ...options,
      headers,
      body
    });
  } catch (e) {
    throw new Error("无法连接后端。请确认部署配置正确，且后端服务已启动。");
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

async function xhsHelperFetch(path, options = {}) {
  if (!XHS_HELPER_BASE) {
    throw new Error("小红书本地助手地址未配置。请在 config.js 设置 xhsHelperBase。");
  }
  const headers = {
    "Accept": "application/json",
    ...(options.headers || {})
  };
  let body = options.body;
  if (body && typeof body !== "string" && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  } else if (typeof body === "string" && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  let res;
  try {
    res = await fetch(XHS_HELPER_BASE + path, {
      mode: "cors",
      targetAddressSpace: "loopback",
      ...options,
      headers,
      body
    });
  } catch (e) {
    throw new Error(`无法连接小红书本地助手（${XHS_HELPER_BASE}）。请在你的电脑运行：python xhs_helper.py`);
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

function enterApp(mode) {
  sessionMode = mode;
  document.body.classList.remove("welcome-mode");
  updateAccountStatus();
  render(currentFilter || "ALL");
  if (mode === "account") {
    loadAllAccountApiSettings(false).catch(() => {});
  }
  setTimeout(() => {
    if (map) map.invalidateSize();
  }, 100);
}

function clearTripRuntimeState() {
  trips = [];
  currentTripIndex = 0;
  currentFilter = "ALL";
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {}
  clearEbirdHotspots();
}

function continueAsGuest() {
  saveAuthSessionToken("");
  currentUser = null;
  clearTripRuntimeState();
  setAuthStatus("");
  enterApp("guest");
  render("ALL");
  showToast("已进入游客模式，本次行程不会缓存");
}

function returnToWelcomeForLogin() {
  if (sessionMode === "guest" && hasTrips()) {
    const ok = confirm("游客模式的行程只在内存中，返回欢迎页会丢弃当前未导出的行程。确定继续吗？");
    if (!ok) return;
  }
  saveAuthSessionToken("");
  currentUser = null;
  sessionMode = "pending";
  clearTripRuntimeState();
  document.body.classList.add("welcome-mode");
  setAuthStatus("可以登录/注册账号，或重新以游客身份开始一个空白临时行程。");
  updateAccountStatus();
  render("ALL");
}

async function initAuth() {
  loadAuthSessionToken();
  try {
    const data = await apiFetch("/api/me");
    if (data.authenticated && data.user) {
      currentUser = data.user;
      sessionMode = "account";
      await loadTripsFromBackend();
      enterApp("account");
      setAuthStatus("");
      showToast("已恢复登录状态");
    } else {
      sessionMode = "pending";
      currentUser = null;
      setAuthStatus("后端已连接。请选择游客模式，或登录/注册后保存行程。");
      updateAccountStatus();
    }
  } catch (e) {
    sessionMode = "pending";
    currentUser = null;
    setAuthStatus("未连接到后端。可以先以游客身份使用；如需账号功能，请检查部署配置和后端服务。", true);
    updateAccountStatus("后端未连接");
  }
}

function readAuthForm() {
  return {
    username: document.getElementById("authUsernameInput").value.trim(),
    password: document.getElementById("authPasswordInput").value
  };
}

async function loginAccount() {
  const payload = readAuthForm();
  setAuthStatus("正在登录...");
  try {
    clearTripRuntimeState();
    const data = await apiFetch("/api/auth/login", { method: "POST", body: payload });
    saveAuthSessionToken(data.authToken || "");
    currentUser = data.user;
    sessionMode = "account";
    await loadTripsFromBackend();
    enterApp("account");
    setAuthStatus("");
    showToast("登录成功");
  } catch (e) {
    setAuthStatus("登录失败：" + e.message, true);
  }
}

async function registerAccount() {
  const payload = readAuthForm();
  setAuthStatus("正在注册...");
  try {
    clearTripRuntimeState();
    const data = await apiFetch("/api/auth/register", { method: "POST", body: payload });
    saveAuthSessionToken(data.authToken || "");
    currentUser = data.user;
    sessionMode = "account";
    trips = [];
    currentTripIndex = 0;
    currentFilter = "ALL";
    persistLocalTripsOnly();
    enterApp("account");
    setAuthStatus("");
    showToast("注册成功");
  } catch (e) {
    setAuthStatus("注册失败：" + e.message, true);
  }
}

async function logoutAccount() {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } catch (e) {}
  saveAuthSessionToken("");
  currentUser = null;
  sessionMode = "pending";
  clearTripRuntimeState();
  document.body.classList.add("welcome-mode");
  setAuthStatus("已退出登录。可以重新登录，或以游客身份继续使用。");
  updateAccountStatus();
  render("ALL");
}

async function loadTripsFromBackend() {
  const data = await apiFetch("/api/trips");
  trips = Array.isArray(data.trips) ? data.trips : [];
  ensureTripRecordIds();
  currentTripIndex = 0;
  currentFilter = "ALL";
  persistLocalTripsOnly();
  clearEbirdHotspots();
  render("ALL");
}

function scheduleBackendSync() {
  if (sessionMode !== "account" || !currentUser) return;
  clearTimeout(backendSyncTimer);
  backendSyncTimer = setTimeout(syncTripsToBackend, 500);
}

function cancelScheduledBackendSync() {
  clearTimeout(backendSyncTimer);
  backendSyncTimer = null;
  backendSyncPending = false;
}

function waitForBackendSyncIdle(timeoutMs = 5000) {
  if (!backendSyncInFlight) return Promise.resolve(true);
  const startedAt = Date.now();
  return new Promise(resolve => {
    const check = () => {
      if (!backendSyncInFlight) {
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

async function flushScheduledBackendSync(timeoutMs = 5000) {
  if (backendSyncTimer) {
    clearTimeout(backendSyncTimer);
    backendSyncTimer = null;
    await syncTripsToBackend();
  }
  return waitForBackendSyncIdle(timeoutMs);
}

async function syncTripsToBackend() {
  if (sessionMode !== "account" || !currentUser) return;
  backendSyncTimer = null;
  if (backendSyncInFlight) {
    backendSyncPending = true;
    return;
  }

  backendSyncInFlight = true;
  backendSyncPending = false;
  updateAccountStatus(`正在同步：${currentUser.username}`);

  try {
    const activeTripId = currentTrip()?.id || "";
    const data = await apiFetch("/api/trips", {
      method: "PUT",
      body: { trips }
    });
    if (Array.isArray(data.trips)) {
      trips = data.trips;
      ensureTripRecordIds();
      const nextIndex = trips.findIndex(trip => trip.id === activeTripId);
      if (nextIndex >= 0) currentTripIndex = nextIndex;
      persistLocalTripsOnly();
      render(currentFilter);
    }
    updateAccountStatus(`已同步：${currentUser.username}`);
  } catch (e) {
    updateAccountStatus(`同步失败：${e.message}`);
  } finally {
    backendSyncInFlight = false;
    if (backendSyncPending) scheduleBackendSync();
  }
}

async function saveCurrentTripToBackend() {
  if (sessionMode !== "account" || !currentUser) {
    alert("请先登录账号，再保存行程到后端。");
    return;
  }
  if (!hasTrips()) {
    alert("当前没有可保存的行程。");
    return;
  }

  ensureTripRecordIds();
  persistLocalTripsOnly();

  const trip = currentTrip();
  updateAccountStatus(`正在保存当前行程：${trip.title || "未命名行程"}`);

  try {
    const data = await apiFetch(`/api/trips/${encodeURIComponent(trip.id)}`, {
      method: "PUT",
      body: { trip }
    });
    if (data.trip) {
      trips[currentTripIndex] = data.trip;
      persistLocalTripsOnly();
      render(currentFilter);
    }
    updateAccountStatus(`已保存当前行程：${currentUser.username}`);
    showToast("当前行程已保存到账号");
  } catch (e) {
    updateAccountStatus(`保存失败：${e.message}`);
    alert("保存当前行程失败：" + e.message);
  }
}

function relocateSettingsPanels() {
  const target = document.getElementById("settingsDialogBody");
  if (!target || target.dataset.ready === "1") return;
  document.querySelectorAll(".settings-panel").forEach(panel => {
    target.appendChild(panel);
  });
  target.dataset.ready = "1";
}

function openSettingsDialog() {
  relocateSettingsPanels();
  renderMapSettings();
  updateFxStatus();
  if (sessionMode === "account") {
    loadAllAccountApiSettings(false).catch(() => {});
  }
  settingsDialog.showModal();
}

function closeSettingsDialog() {
  settingsDialog.close();
}

function openPublicTripSearchDialog() {
  publicTripSearchDialog.showModal();
  setPublicTripSearchStatus("可搜索其他用户公开的行程。游客导入后只保存在本次页面内存；登录用户导入后保存为账号私有副本。");
  setTimeout(() => {
    document.getElementById("publicTripSearchInput")?.focus();
  }, 50);
}

function closePublicTripSearchDialog() {
  publicTripSearchDialog.close();
}

function setApiSettingsStatus(message, isError = false) {
  const el = document.getElementById("apiSettingsStatus");
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "var(--red)" : "var(--muted)";
}

const SECRET_FIELD_DEFS = {
  ebirdTokenInput: { scope: "apiCredentials", payloadKey: "ebirdToken", label: "eBird API Token" },
  xcTokenInput: { scope: "apiCredentials", payloadKey: "xcToken", label: "xeno-canto API Key" },
  llmApiKeyInput: { scope: "llm", payloadKey: "apiKey", label: "LLM API Key" },
  braveApiKeyInput: { scope: "contentSources", payloadKey: "braveApiKey", label: "Brave Search API Key" },
  bingApiKeyInput: { scope: "contentSources", payloadKey: "bingApiKey", label: "Bing Web Search API Key" },
  serpApiKeyInput: { scope: "contentSources", payloadKey: "serpApiKey", label: "SerpAPI Key" },
  tavilyApiKeyInput: { scope: "contentSources", payloadKey: "tavilyApiKey", label: "Tavily API Key" },
  wechatAppSecretInput: { scope: "contentSources", payloadKey: "wechatAppSecret", label: "微信公众号 AppSecret" },
  wechatThirdPartyApiKeyInput: { scope: "contentSources", payloadKey: "wechatThirdPartyApiKey", label: "微信公众号第三方 API Key" },
  xhsAppSecretInput: { scope: "contentSources", payloadKey: "xhsAppSecret", label: "小红书 AppSecret" },
  xhsOfficialAccessTokenInput: { scope: "contentSources", payloadKey: "xhsOfficialAccessToken", label: "小红书官方 Access Token" },
  xhsThirdPartyApiKeyInput: { scope: "contentSources", payloadKey: "xhsThirdPartyApiKey", label: "小红书第三方 API Key" }
};

function maskSecretClient(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 4) return text.slice(0, 1) + "*".repeat(Math.max(1, text.length - 1));
  if (text.length <= 10) return text.slice(0, 2) + "*".repeat(Math.max(4, text.length - 4)) + text.slice(-2);
  return text.slice(0, 4) + "*".repeat(Math.max(6, text.length - 8)) + text.slice(-4);
}

function setupSecretDisplayInputs() {
  Object.entries(SECRET_FIELD_DEFS).forEach(([id, def]) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.readOnly = true;
    input.autocomplete = "off";
    input.classList.add("secret-display");
    input.title = `点击更新 ${def.label}`;
    input.onclick = () => openSecretInputDialog(id);
    setSecretDisplayValue(id, input.value);
  });
}

function setSecretDisplayValue(id, value = "") {
  const input = document.getElementById(id);
  if (!input) return;
  input.value = value || "";
  const def = SECRET_FIELD_DEFS[id];
  input.placeholder = value ? "已保存，点击更新" : `未设置，点击设置 ${def?.label || "API Key"}`;
}

function openSecretInputDialog(inputId) {
  const def = SECRET_FIELD_DEFS[inputId];
  if (!def || !secretInputDialog) return;
  activeSecretInputId = inputId;
  document.getElementById("secretInputTitle").textContent = `更新 ${def.label}`;
  document.getElementById("secretInputLabel").textContent = `新的 ${def.label}`;
  const valueInput = document.getElementById("secretInputValue");
  valueInput.value = "";
  valueInput.placeholder = "输入新的 key/token";
  secretInputDialog.showModal();
  setTimeout(() => valueInput.focus(), 50);
}

function closeSecretInputDialog() {
  activeSecretInputId = "";
  document.getElementById("secretInputValue").value = "";
  secretInputDialog.close();
}

function confirmSecretInputDialog() {
  const def = SECRET_FIELD_DEFS[activeSecretInputId];
  if (!def) return;
  const value = document.getElementById("secretInputValue").value.trim();
  if (!value) {
    alert("请输入新的 key/token。若要删除，请使用对应的清空按钮。");
    return;
  }
  pendingSecretUpdates[def.scope][def.payloadKey] = value;
  setSecretDisplayValue(activeSecretInputId, maskSecretClient(value));
  if (activeSecretInputId === "ebirdTokenInput") {
    ebirdTokenStatus = { hasToken: true, valid: false, checked: false };
    renderEbirdHotspotActions();
  }
  closeSecretInputDialog();
  showToast("新的 key 已暂存，请点击保存生效");
}

function clearPendingSecrets(scope) {
  if (scope) {
    pendingSecretUpdates[scope] = {};
    return;
  }
  Object.keys(pendingSecretUpdates).forEach(key => {
    pendingSecretUpdates[key] = {};
  });
}

async function loadAccountApiCredentials(showToastOnDone = true) {
  if (sessionMode !== "account") {
    setApiSettingsStatus("请先登录账号，再载入账号 API 配置。", true);
    return;
  }

  try {
    const data = await apiFetch("/api/api-credentials/settings");
    const s = data.settings || {};
    lastAccountApiCredentials = s;
    clearPendingSecrets("apiCredentials");
    setSecretDisplayValue("ebirdTokenInput", s.ebirdToken || "");
    setSecretDisplayValue("xcTokenInput", s.xcToken || "");
    await refreshEbirdTokenStatus(false);
    if (showToastOnDone) showToast("eBird / xeno-canto API 配置已载入");
  } catch (e) {
    setApiSettingsStatus("载入 eBird / xeno-canto API 配置失败：" + e.message, true);
    ebirdTokenStatus = { hasToken: false, valid: false, checked: true, error: e.message };
    renderEbirdHotspotActions();
  }
}

async function saveAccountApiCredentials() {
  if (sessionMode !== "account") {
    alert("请先登录账号，再保存 API Key。游客模式不会保存 API Key。");
    return;
  }

  const payload = { ...pendingSecretUpdates.apiCredentials };

  setApiSettingsStatus("正在保存 eBird / xeno-canto API 配置...");
  try {
    const data = await apiFetch("/api/api-credentials/settings", { method: "PUT", body: payload });
    lastAccountApiCredentials = data.settings || {};
    clearPendingSecrets("apiCredentials");
    setSecretDisplayValue("ebirdTokenInput", lastAccountApiCredentials.ebirdToken || "");
    setSecretDisplayValue("xcTokenInput", lastAccountApiCredentials.xcToken || "");
    await refreshEbirdTokenStatus(true);
    setApiSettingsStatus("eBird / xeno-canto API 配置已保存。");
    showToast("API 配置已保存");
  } catch (e) {
    setApiSettingsStatus("保存 eBird / xeno-canto API 配置失败：" + e.message, true);
  }
}

async function loadAllAccountApiSettings(showToastOnDone = true) {
  if (sessionMode !== "account") return;
  setApiSettingsStatus("正在载入全部账号 API 配置...");
  await Promise.allSettled([
    loadContentSourceSettings(false),
    loadLlmSettings(false),
    loadAccountApiCredentials(false)
  ]);
  setApiSettingsStatus("全部账号 API 配置已载入。");
  if (showToastOnDone) showToast("全部 API 配置已载入");
}

async function saveAllApiSettings() {
  if (sessionMode !== "account") {
    alert("请先登录账号，再保存 API 配置。");
    return;
  }
  setApiSettingsStatus("正在保存全部 API 配置...");
  try {
    await saveContentSourceSettings();
    await saveLlmSettings();
    await saveAccountApiCredentials();
    setApiSettingsStatus("全部 API 配置已保存到当前账号。");
  } catch (e) {
    setApiSettingsStatus("保存全部 API 配置失败：" + e.message, true);
  }
}

async function clearAllAccountApiSecrets() {
  if (sessionMode !== "account") {
    alert("请先登录账号。");
    return;
  }
  if (!confirm("确定清空当前账号保存的全部 API Key / Token 吗？这不会删除行程。")) return;

  setApiSettingsStatus("正在清空全部 API Key...");
  try {
    await apiFetch("/api/api-credentials/settings", { method: "DELETE" });
    clearPendingSecrets();
    lastAccountApiCredentials = null;
    ebirdTokenStatus = { hasToken: false, valid: false, checked: true };
    renderEbirdHotspotActions();
    ["ebirdTokenInput", "xcTokenInput", "llmApiKeyInput", "braveApiKeyInput", "bingApiKeyInput", "serpApiKeyInput", "tavilyApiKeyInput",
     "wechatAppSecretInput", "wechatThirdPartyApiKeyInput", "xhsAppSecretInput", "xhsOfficialAccessTokenInput", "xhsThirdPartyApiKeyInput"]
      .forEach(id => {
        setSecretDisplayValue(id, "");
      });
    await loadAllAccountApiSettings(false);
    setApiSettingsStatus("全部 API Key 已清空。");
    showToast("全部 API Key 已清空");
  } catch (e) {
    setApiSettingsStatus("清空全部 API Key 失败：" + e.message, true);
  }
}

async function clearEbirdToken() {
  delete pendingSecretUpdates.apiCredentials.ebirdToken;
  setSecretDisplayValue("ebirdTokenInput", "");
  lastAccountApiCredentials = {
    ...(lastAccountApiCredentials || {}),
    hasEbirdToken: false,
    ebirdToken: ""
  };
  ebirdTokenStatus = { hasToken: false, valid: false, checked: true };
  renderEbirdHotspotActions();
  if (sessionMode !== "account") {
    showToast("已清空当前页面的 eBird Token");
    return;
  }
  try {
    await apiFetch("/api/api-credentials/settings", { method: "PUT", body: { clearEbirdToken: true } });
    await loadAccountApiCredentials(false);
    showToast("已清空账号保存的 eBird Token");
  } catch (e) {
    alert("清空 eBird Token 失败：" + e.message);
  }
}

function setContentSourceStatus(message, isError = false) {
  const el = document.getElementById("contentSourceStatus");
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "var(--red)" : "var(--muted)";
}

function contentSearchKeyField(provider) {
  if (provider === "brave") return "braveApiKey";
  if (provider === "bing_api") return "bingApiKey";
  if (provider === "serpapi") return "serpApiKey";
  if (provider === "tavily") return "tavilyApiKey";
  return "";
}

function updateContentSearchApiKeyPlaceholder() {
  const provider = document.getElementById("contentSearchProviderInput")?.value || "html";
  const activeField = contentSearchKeyField(provider);
  const map = {
    braveApiKeyInput: "braveApiKey",
    bingApiKeyInput: "bingApiKey",
    serpApiKeyInput: "serpApiKey",
    tavilyApiKeyInput: "tavilyApiKey"
  };
  const labels = {
    braveApiKeyInput: "Brave Search API Key",
    bingApiKeyInput: "Bing Web Search API Key",
    serpApiKeyInput: "SerpAPI Key",
    tavilyApiKeyInput: "Tavily API Key"
  };
  Object.entries(map).forEach(([id, field]) => {
    const input = document.getElementById(id);
    if (!input) return;
    const activeText = field === activeField ? "（当前启用）" : "";
    input.placeholder = `${labels[id] || "API Key"}${activeText}`;
  });
}

const API_PARAM_DEFAULTS = {
  wechatSogou: [
    { name: "type", value: "2", note: "搜狗微信文章搜索类型", enabled: true },
    { name: "query", value: "{query}", note: "搜索关键词", enabled: true },
    { name: "ie", value: "utf8", note: "字符集", enabled: true },
    { name: "page", value: "{page}", note: "页码", enabled: true }
  ],
  wechatThirdParty: [
    { name: "keyword", value: "{query}", note: "搜索关键词", enabled: true },
    { name: "page", value: "1", note: "页码", enabled: true }
  ],
  xhsThirdParty: [
    { name: "keyword", value: "{query}", note: "搜索关键词", enabled: true },
    { name: "page", value: "1", note: "页码", enabled: true },
    { name: "sort_type", value: "general", note: "排序字段", enabled: true },
    { name: "note_type", value: "不限", note: "笔记类型；接口不需要可关闭", enabled: false },
    { name: "time_filter", value: "不限", note: "发布时间；接口不需要可关闭", enabled: false }
  ],
  xhsOfficial: [
    { name: "keyword", value: "{query}", note: "搜索关键词", enabled: true },
    { name: "page", value: "1", note: "页码", enabled: true }
  ]
};

function cloneApiParamRows(rows) {
  return (rows || []).map(row => ({
    name: row.name || "",
    value: row.value || "",
    note: row.note || "",
    enabled: row.enabled !== false
  }));
}

function normalizeApiParamRows(rows, kind) {
  const fallback = cloneApiParamRows(API_PARAM_DEFAULTS[kind] || []);
  const hasExplicitRows = Array.isArray(rows);
  const source = hasExplicitRows ? rows : fallback;
  const normalized = source
    .filter(row => row && typeof row === "object")
    .map(row => ({
      name: String(row.name || ""),
      value: String(row.value || ""),
      note: String(row.note || ""),
      enabled: row.enabled !== false
    }))
    .filter(row => row.name || row.value || row.note);
  return hasExplicitRows ? normalized : (normalized.length ? normalized : fallback);
}

function apiParamInputId(kind, index, field) {
  return `${kind}Param${field}${index}`;
}

function renderApiParamEditor(kind, rows) {
  const target = document.getElementById(`${kind}ParamRows`);
  if (!target) return;
  const normalized = normalizeApiParamRows(rows, kind);
  target.innerHTML = normalized.map((row, index) => `
    <div class="api-param-row" data-param-index="${index}">
      <input id="${apiParamInputId(kind, index, "Enabled")}" type="checkbox" ${row.enabled ? "checked" : ""} title="启用">
      <input id="${apiParamInputId(kind, index, "Name")}" class="full param-name" placeholder="字段名" value="${escapeHtml(row.name)}">
      <input id="${apiParamInputId(kind, index, "Value")}" class="full param-value" placeholder="默认值，可用 {query}" value="${escapeHtml(row.value)}">
      <input id="${apiParamInputId(kind, index, "Note")}" class="full param-note" placeholder="备注" value="${escapeHtml(row.note)}">
      <button class="small-btn danger" onclick="removeApiParamRow('${kind}', ${index})">删除</button>
    </div>
  `).join("");
}

function collectApiParamRows(kind) {
  const target = document.getElementById(`${kind}ParamRows`);
  if (!target) return cloneApiParamRows(API_PARAM_DEFAULTS[kind] || []);
  return Array.from(target.querySelectorAll(".api-param-row")).map(row => {
    const index = Number(row.dataset.paramIndex);
    return {
      name: document.getElementById(apiParamInputId(kind, index, "Name"))?.value.trim() || "",
      value: document.getElementById(apiParamInputId(kind, index, "Value"))?.value.trim() || "",
      note: document.getElementById(apiParamInputId(kind, index, "Note"))?.value.trim() || "",
      enabled: Boolean(document.getElementById(apiParamInputId(kind, index, "Enabled"))?.checked)
    };
  }).filter(row => row.name || row.value || row.note);
}

function addApiParamRow(kind) {
  const rows = collectApiParamRows(kind);
  rows.push({ name: "", value: "", note: "", enabled: true });
  renderApiParamEditor(kind, rows);
}

function removeApiParamRow(kind, index) {
  const rows = collectApiParamRows(kind);
  rows.splice(index, 1);
  renderApiParamEditor(kind, rows);
}

function resetApiParamRows(kind) {
  renderApiParamEditor(kind, cloneApiParamRows(API_PARAM_DEFAULTS[kind] || []));
}

function datetimeLocalFromSaved(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text.slice(0, 16);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function savedDatetimeFromLocalInput(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

function updateXhsOfficialTokenStatus() {
  const el = document.getElementById("xhsOfficialTokenStatus");
  const input = document.getElementById("xhsOfficialAccessTokenExpiresAtInput");
  if (!el || !input) return;
  const value = input.value.trim();
  if (!value) {
    el.textContent = "未设置官方 token 过期时间；如果接口 token 有时效，建议填写。";
    el.style.color = "var(--muted)";
    return;
  }
  const expiresAt = new Date(value);
  if (Number.isNaN(expiresAt.getTime())) {
    el.textContent = "过期时间格式无法识别。";
    el.style.color = "var(--red)";
    return;
  }
  if (expiresAt.getTime() <= Date.now()) {
    el.textContent = "官方 token 已过期，请重新授权/扫码登录后更新。";
    el.style.color = "var(--red)";
  } else {
    el.textContent = `官方 token 将于 ${value.replace("T", " ")} 过期。`;
    el.style.color = "var(--muted)";
  }
}

function updateWechatModeHelp() {
  const mode = document.getElementById("wechatModeInput")?.value || "search_index";
  const el = document.getElementById("wechatModeHelp");
  const officialSettings = document.getElementById("wechatOfficialSettings");
  const sogouSettings = document.getElementById("wechatSogouSettings");
  const thirdPartySettings = document.getElementById("wechatThirdPartySettings");
  if (officialSettings) officialSettings.style.display = mode === "official_api" ? "" : "none";
  if (sogouSettings) sogouSettings.style.display = mode === "sogou_weixin" ? "" : "none";
  if (thirdPartySettings) thirdPartySettings.style.display = mode === "third_party" ? "" : "none";
  if (!el) return;
  if (mode === "sogou_weixin") {
    const input = document.getElementById("wechatSogouSearchUrlInput");
    if (input && !input.value.trim()) input.value = WECHAT_SOGOU_SEARCH_ENDPOINT;
    el.textContent = "搜狗微信搜索模式：先请求搜狗微信文章搜索，候选结果保留搜狗跳转链接；点击抓取正文时，后端会尝试解析真实 mp.weixin.qq.com 链接并抽取公众号正文。搜狗可能出现验证码/反爬限制。";
  } else if (mode === "official_api") {
    el.textContent = "官方接口 / 授权公众号模式：适用于你拥有公众号或授权权限；通用全网公众号文章搜索通常不可用。";
  } else if (mode === "third_party") {
    el.textContent = "第三方数据 API 模式：保留自定义 Base URL 和 Key 配置位，适合后续接入专门的公众号数据服务。";
  } else if (mode === "disabled") {
    el.textContent = "已选择禁用微信公众号来源；攻略搜索时请取消微信公众号来源勾选，或保存默认来源配置。";
  } else {
    el.textContent = "当前默认通过搜索引擎索引查找 mp.weixin.qq.com 公开文章；正文抓取可能受平台限制。";
  }
}

function updateXhsModeHelp() {
  const mode = document.getElementById("xhsModeInput")?.value || "search_index";
  const el = document.getElementById("xhsModeHelp");
  const openPlatformSettings = document.getElementById("xhsOpenPlatformSettings");
  const thirdPartySettings = document.getElementById("xhsThirdPartySettings");
  const localBrowserSettings = document.getElementById("xhsLocalBrowserSettings");
  if (openPlatformSettings) openPlatformSettings.style.display = mode === "open_platform" ? "" : "none";
  if (thirdPartySettings) thirdPartySettings.style.display = mode === "third_party" ? "" : "none";
  if (localBrowserSettings) localBrowserSettings.style.display = mode === "local_browser_experimental" ? "" : "none";
  if (!el) return;
  if (mode === "local_browser_experimental") {
    el.textContent = `本地浏览器助手模式：请在自己的电脑运行 python xhs_helper.py，前端会连接 ${XHS_HELPER_BASE} 并启动本机 Chromium；云后端不会启动浏览器。`;
    if (sessionMode === "account") refreshXhsLocalBrowserStatus(false);
  } else if (mode === "third_party") {
    const baseInput = document.getElementById("xhsThirdPartyBaseUrlInput");
    if (baseInput && !baseInput.value.trim()) baseInput.value = RNOTE_XHS_SEARCH_ENDPOINT;
    const imageInput = document.getElementById("xhsImageDetailUrlInput");
    const videoInput = document.getElementById("xhsVideoDetailUrlInput");
    if (imageInput && !imageInput.value.trim()) imageInput.value = RNOTE_XHS_IMAGE_DETAIL_ENDPOINT;
    if (videoInput && !videoInput.value.trim()) videoInput.value = RNOTE_XHS_VIDEO_DETAIL_ENDPOINT;
    el.textContent = "第三方数据 API 模式：先用搜索端点拿候选笔记和 note_id，点击抓取正文时再按图文/视频详情端点读取完整内容。";
  } else if (mode === "open_platform") {
    el.textContent = "开放平台授权模式：打开官方授权/扫码登录后保存 Access Token，再由后端调用你填写的官方搜索 API URL。是否可搜索公开笔记取决于账号和应用权限。";
  } else if (mode === "disabled") {
    el.textContent = "已选择禁用小红书来源；攻略搜索时请取消小红书来源勾选，或保存默认来源配置。";
  } else {
    el.textContent = "当前默认通过搜索引擎索引查找小红书公开页面；正文抓取可能受平台限制。";
  }
}

function setXhsLocalBrowserStatus(message, isError = false) {
  const el = document.getElementById("xhsLocalBrowserStatus");
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "var(--red)" : "var(--muted)";
}

function renderXhsLocalBrowserStatus(status = {}) {
  const running = Boolean(status.running);
  const env = status.environment || {};
  const loginText = running
    ? (status.loggedIn ? "可能已登录" : "等待扫码/登录确认")
    : "未启动";
  const parts = [`状态：${running ? "浏览器会话运行中" : "浏览器会话未启动"}`, loginText];
  if (!running && env.message) parts.push(`环境：${env.message}`);
  if (!running && env.ready === false && env.installHint) parts.push(env.installHint);
  if (status.title) parts.push(`页面：${status.title}`);
  if (status.currentUrl) parts.push(`URL：${status.currentUrl}`);
  if (status.message) parts.push(status.message);
  setXhsLocalBrowserStatus(parts.join("；"), env.ready === false);
}

function xhsHelperUsername() {
  return currentUser?.username || "guest";
}

function isXhsLocalBrowserMode() {
  return document.getElementById("xhsModeInput")?.value === "local_browser_experimental";
}

async function startXhsLocalBrowser() {
  if (sessionMode !== "account") {
    alert("请先登录账号，再启动小红书本机浏览器会话。");
    return;
  }
  setXhsLocalBrowserStatus("正在连接本地助手并启动小红书浏览器，请稍候...");
  try {
    const data = await xhsHelperFetch("/api/xiaohongshu/browser-session", {
      method: "POST",
      body: { username: xhsHelperUsername() }
    });
    renderXhsLocalBrowserStatus(data.status || {});
    showToast("小红书浏览器会话已启动");
  } catch (e) {
    setXhsLocalBrowserStatus("启动失败：" + e.message, true);
  }
}

async function refreshXhsLocalBrowserStatus(showToastOnDone = true) {
  if (sessionMode !== "account") {
    setXhsLocalBrowserStatus("请先登录账号，再查看小红书本机浏览器会话。", true);
    return;
  }
  try {
    const data = await xhsHelperFetch(`/api/xiaohongshu/browser-session?username=${encodeURIComponent(xhsHelperUsername())}`);
    renderXhsLocalBrowserStatus(data.status || {});
    if (showToastOnDone) showToast("小红书浏览器状态已刷新");
  } catch (e) {
    setXhsLocalBrowserStatus("读取状态失败：" + e.message, true);
  }
}

async function closeXhsLocalBrowser() {
  if (sessionMode !== "account") {
    setXhsLocalBrowserStatus("请先登录账号。", true);
    return;
  }
  setXhsLocalBrowserStatus("正在关闭小红书本机浏览器会话...");
  try {
    const data = await xhsHelperFetch("/api/xiaohongshu/browser-session", {
      method: "DELETE",
      body: { username: xhsHelperUsername() }
    });
    renderXhsLocalBrowserStatus(data.status || {});
    showToast("小红书浏览器会话已关闭");
  } catch (e) {
    setXhsLocalBrowserStatus("关闭失败：" + e.message, true);
  }
}

function openXhsOfficialAuth() {
  const authUrl = document.getElementById("xhsOfficialAuthUrlInput")?.value.trim();
  const appId = document.getElementById("xhsAppIdInput")?.value.trim();
  const redirectUri = document.getElementById("xhsOfficialRedirectUriInput")?.value.trim();
  if (!authUrl) {
    alert("请先填写官方授权/扫码登录 URL。");
    return;
  }
  if (!appId) {
    alert("请先填写小红书开放平台 AppID。");
    return;
  }
  const url = new URL(authUrl);
  url.searchParams.set("appId", appId);
  if (redirectUri) url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", `birdroute_${Date.now()}`);
  window.open(url.toString(), "_blank", "noopener,noreferrer");
}

function openXhsThirdPartyHelp() {
  xhsThirdPartyHelpDialog.showModal();
}

function closeXhsThirdPartyHelp() {
  xhsThirdPartyHelpDialog.close();
}

function applyContentSourceDefaultsToResearch() {
  const map = {
    wechat: "wechat",
    xiaohongshu: "xiaohongshu",
    blog: "blog",
    web: "web"
  };
  document.querySelectorAll(".research-source").forEach(input => {
    const key = map[input.value];
    if (key) input.checked = Boolean(contentSourceDefaults[key]);
  });
}

async function loadContentSourceSettings(showToastOnDone = true) {
  if (sessionMode !== "account") {
    setContentSourceStatus("请先登录账号，再保存内容源设置。", true);
    return;
  }

  try {
    const data = await apiFetch("/api/content-sources/settings");
    const s = data.settings || {};
    lastContentSourceSettings = s;
    const defaults = s.defaultSources || {};
    contentSourceDefaults = {
      wechat: defaults.wechat !== false,
      xiaohongshu: defaults.xiaohongshu !== false,
      blog: defaults.blog !== false,
      web: defaults.web !== false
    };

    document.getElementById("contentSearchProviderInput").value = s.searchProvider || "html";
    document.getElementById("contentBingEndpointInput").value = s.bingEndpoint || "https://api.bing.microsoft.com/v7.0/search";
    clearPendingSecrets("contentSources");
    setSecretDisplayValue("braveApiKeyInput", s.braveApiKey || "");
    setSecretDisplayValue("bingApiKeyInput", s.bingApiKey || "");
    setSecretDisplayValue("serpApiKeyInput", s.serpApiKey || "");
    setSecretDisplayValue("tavilyApiKeyInput", s.tavilyApiKey || "");
    document.getElementById("contentDefaultWechatInput").checked = contentSourceDefaults.wechat;
    document.getElementById("contentDefaultXhsInput").checked = contentSourceDefaults.xiaohongshu;
    document.getElementById("contentDefaultBlogInput").checked = contentSourceDefaults.blog;
    document.getElementById("contentDefaultWebInput").checked = contentSourceDefaults.web;
    const wechat = s.wechat || {};
    document.getElementById("wechatModeInput").value = wechat.mode || "search_index";
    document.getElementById("wechatAppIdInput").value = wechat.appId || "";
    setSecretDisplayValue("wechatAppSecretInput", s.wechatAppSecret || "");
    document.getElementById("wechatThirdPartyBaseUrlInput").value = wechat.thirdPartyBaseUrl || "";
    document.getElementById("wechatSogouSearchUrlInput").value = wechat.sogouSearchUrl || WECHAT_SOGOU_SEARCH_ENDPOINT;
    document.getElementById("wechatSogouPagesInput").value = wechat.sogouPages || "3";
    document.getElementById("wechatSogouResultLimitInput").value = wechat.sogouResultLimit || "18";
    renderApiParamEditor("wechatSogou", wechat.sogouQueryParams);
    document.getElementById("wechatThirdPartyKeyModeInput").value = wechat.thirdPartyKeyMode || "authorization_bearer";
    document.getElementById("wechatThirdPartyKeyHeaderInput").value = wechat.thirdPartyKeyHeader || "Authorization";
    document.getElementById("wechatThirdPartyKeyParamInput").value = wechat.thirdPartyKeyParam || "api_key";
    renderApiParamEditor("wechatThirdParty", wechat.thirdPartyQueryParams);
    setSecretDisplayValue("wechatThirdPartyApiKeyInput", s.wechatThirdPartyApiKey || "");

    const xhs = s.xiaohongshu || {};
    document.getElementById("xhsModeInput").value = xhs.mode || "search_index";
    document.getElementById("xhsAppIdInput").value = xhs.appId || "";
    setSecretDisplayValue("xhsAppSecretInput", s.xhsAppSecret || "");
    document.getElementById("xhsOfficialAuthUrlInput").value = xhs.officialAuthUrl || "https://ark.xiaohongshu.com/ark/authorization";
    document.getElementById("xhsOfficialRedirectUriInput").value = xhs.officialRedirectUri || "";
    setSecretDisplayValue("xhsOfficialAccessTokenInput", s.xhsOfficialAccessToken || "");
    document.getElementById("xhsOfficialAccessTokenExpiresAtInput").value = datetimeLocalFromSaved(xhs.officialAccessTokenExpiresAt || "");
    document.getElementById("xhsOfficialSearchUrlInput").value = xhs.officialSearchUrl || "";
    document.getElementById("xhsOfficialDetailUrlInput").value = xhs.officialDetailUrl || "";
    document.getElementById("xhsOfficialTokenModeInput").value = xhs.officialTokenMode || "authorization_bearer";
    document.getElementById("xhsOfficialTokenHeaderInput").value = xhs.officialTokenHeader || "Authorization";
    document.getElementById("xhsOfficialTokenParamInput").value = xhs.officialTokenParam || "access_token";
    document.getElementById("xhsOfficialDetailIdParamInput").value = xhs.officialDetailIdParam || "note_id";
    renderApiParamEditor("xhsOfficial", xhs.officialSearchQueryParams);
    document.getElementById("xhsThirdPartyBaseUrlInput").value = xhs.thirdPartyBaseUrl || RNOTE_XHS_SEARCH_ENDPOINT;
    document.getElementById("xhsImageDetailUrlInput").value = xhs.imageDetailUrl || RNOTE_XHS_IMAGE_DETAIL_ENDPOINT;
    document.getElementById("xhsVideoDetailUrlInput").value = xhs.videoDetailUrl || RNOTE_XHS_VIDEO_DETAIL_ENDPOINT;
    renderApiParamEditor("xhsThirdParty", xhs.thirdPartyQueryParams);
    document.getElementById("xhsThirdPartyKeyModeInput").value = xhs.thirdPartyKeyMode || "x_api_key";
    document.getElementById("xhsThirdPartyKeyHeaderInput").value = xhs.thirdPartyKeyHeader || "X-API-Key";
    document.getElementById("xhsThirdPartyKeyParamInput").value = xhs.thirdPartyKeyParam || "api_key";
    setSecretDisplayValue("xhsThirdPartyApiKeyInput", s.xhsThirdPartyApiKey || "");

    updateContentSearchApiKeyPlaceholder();
    updateXhsOfficialTokenStatus();
    updateWechatModeHelp();
    updateXhsModeHelp();
    setContentSourceStatus(`内容源设置已读取。当前搜索 Provider：${s.searchProvider || "html"}。`);
    if (showToastOnDone) showToast("内容源设置已读取");
  } catch (e) {
    setContentSourceStatus("读取内容源设置失败：" + e.message, true);
  }
}

async function saveContentSourceSettings() {
  if (sessionMode !== "account") {
    alert("请先登录账号，再保存内容源设置。");
    return;
  }

  const provider = document.getElementById("contentSearchProviderInput").value;
  const payload = {
    searchProvider: provider,
    bingEndpoint: document.getElementById("contentBingEndpointInput").value.trim(),
    defaultSources: {
      wechat: document.getElementById("contentDefaultWechatInput").checked,
      xiaohongshu: document.getElementById("contentDefaultXhsInput").checked,
      blog: document.getElementById("contentDefaultBlogInput").checked,
      web: document.getElementById("contentDefaultWebInput").checked
    },
    wechat: {
      mode: document.getElementById("wechatModeInput").value,
      appId: document.getElementById("wechatAppIdInput").value.trim(),
      thirdPartyBaseUrl: document.getElementById("wechatThirdPartyBaseUrlInput").value.trim(),
      thirdPartyKeyMode: document.getElementById("wechatThirdPartyKeyModeInput").value || "authorization_bearer",
      thirdPartyKeyHeader: document.getElementById("wechatThirdPartyKeyHeaderInput").value.trim() || "Authorization",
      thirdPartyKeyParam: document.getElementById("wechatThirdPartyKeyParamInput").value.trim() || "api_key",
      thirdPartyQueryParams: collectApiParamRows("wechatThirdParty"),
      sogouSearchUrl: document.getElementById("wechatSogouSearchUrlInput").value.trim() || WECHAT_SOGOU_SEARCH_ENDPOINT,
      sogouPages: document.getElementById("wechatSogouPagesInput").value || "3",
      sogouResultLimit: document.getElementById("wechatSogouResultLimitInput").value || "18",
      sogouQueryParams: collectApiParamRows("wechatSogou")
    },
    xiaohongshu: {
      mode: document.getElementById("xhsModeInput").value,
      appId: document.getElementById("xhsAppIdInput").value.trim(),
      officialAuthUrl: document.getElementById("xhsOfficialAuthUrlInput").value.trim() || "https://ark.xiaohongshu.com/ark/authorization",
      officialRedirectUri: document.getElementById("xhsOfficialRedirectUriInput").value.trim(),
      officialSearchUrl: document.getElementById("xhsOfficialSearchUrlInput").value.trim(),
      officialDetailUrl: document.getElementById("xhsOfficialDetailUrlInput").value.trim(),
      officialAccessTokenExpiresAt: savedDatetimeFromLocalInput(document.getElementById("xhsOfficialAccessTokenExpiresAtInput").value),
      officialTokenMode: document.getElementById("xhsOfficialTokenModeInput").value || "authorization_bearer",
      officialTokenHeader: document.getElementById("xhsOfficialTokenHeaderInput").value.trim() || "Authorization",
      officialTokenParam: document.getElementById("xhsOfficialTokenParamInput").value.trim() || "access_token",
      officialDetailIdParam: document.getElementById("xhsOfficialDetailIdParamInput").value.trim() || "note_id",
      officialSearchQueryParams: collectApiParamRows("xhsOfficial"),
      thirdPartyBaseUrl: document.getElementById("xhsThirdPartyBaseUrlInput").value.trim() || RNOTE_XHS_SEARCH_ENDPOINT,
      thirdPartyKeyMode: document.getElementById("xhsThirdPartyKeyModeInput").value || "x_api_key",
      thirdPartyKeyHeader: document.getElementById("xhsThirdPartyKeyHeaderInput").value.trim() || "X-API-Key",
      thirdPartyKeyParam: document.getElementById("xhsThirdPartyKeyParamInput").value.trim() || "api_key",
      thirdPartyQueryParams: collectApiParamRows("xhsThirdParty"),
      imageDetailUrl: document.getElementById("xhsImageDetailUrlInput").value.trim() || RNOTE_XHS_IMAGE_DETAIL_ENDPOINT,
      videoDetailUrl: document.getElementById("xhsVideoDetailUrlInput").value.trim() || RNOTE_XHS_VIDEO_DETAIL_ENDPOINT
    }
  };

  Object.assign(payload, pendingSecretUpdates.contentSources);

  setContentSourceStatus("正在保存内容源设置...");
  try {
    const data = await apiFetch("/api/content-sources/settings", { method: "PUT", body: payload });
    lastContentSourceSettings = data.settings || {};
    clearPendingSecrets("contentSources");
    await loadContentSourceSettings(false);
    updateWechatModeHelp();
    updateXhsModeHelp();
    setContentSourceStatus("内容源设置已保存。搜索和正文抓取由这里的内容源配置完成；LLM 相关选项请在 AI 设置中管理。");
    showToast("内容源设置已保存");
  } catch (e) {
    setContentSourceStatus("保存内容源设置失败：" + e.message, true);
  }
}

async function clearContentSourceApiKeys() {
  if (sessionMode !== "account") {
    clearPendingSecrets("contentSources");
    ["braveApiKeyInput", "bingApiKeyInput", "serpApiKeyInput", "tavilyApiKeyInput",
     "wechatAppSecretInput", "wechatThirdPartyApiKeyInput", "xhsAppSecretInput", "xhsOfficialAccessTokenInput", "xhsThirdPartyApiKeyInput"]
      .forEach(id => {
        setSecretDisplayValue(id, "");
      });
    showToast("已清空当前页面的内容源 Key");
    return;
  }
  if (!confirm("确定清空当前账号保存的全部内容源 API Key / Secret 吗？")) return;
  setContentSourceStatus("正在清空内容源 API Key...");
  try {
    await apiFetch("/api/content-sources/settings", {
      method: "PUT",
      body: {
        clearBraveApiKey: true,
        clearBingApiKey: true,
        clearSerpApiKey: true,
        clearTavilyApiKey: true,
        clearWechatAppSecret: true,
        clearWechatThirdPartyApiKey: true,
        clearXhsAppSecret: true,
        clearXhsOfficialAccessToken: true,
        clearXhsThirdPartyApiKey: true
      }
    });
    clearPendingSecrets("contentSources");
    ["braveApiKeyInput", "bingApiKeyInput", "serpApiKeyInput", "tavilyApiKeyInput",
     "wechatAppSecretInput", "wechatThirdPartyApiKeyInput", "xhsAppSecretInput", "xhsOfficialAccessTokenInput", "xhsThirdPartyApiKeyInput"]
      .forEach(id => {
        setSecretDisplayValue(id, "");
      });
    await loadContentSourceSettings(false);
    setContentSourceStatus("内容源 API Key 已清空。");
    showToast("内容源 API Key 已清空");
  } catch (e) {
    setContentSourceStatus("清空内容源 API Key 失败：" + e.message, true);
  }
}

function setLlmSettingsStatus(message, isError = false) {
  const el = document.getElementById("llmSettingsStatus");
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "var(--red)" : "var(--muted)";
}

async function loadLlmSettings(showToastOnDone = true) {
  if (sessionMode !== "account") {
    setLlmSettingsStatus("请先登录账号，再保存 AI 设置。", true);
    return;
  }

  try {
    const data = await apiFetch("/api/llm/settings");
    const s = data.settings || {};
    document.getElementById("llmProviderInput").value = s.provider || "deepseek";
    document.getElementById("llmBaseUrlInput").value = s.baseUrl || "https://api.deepseek.com";
    document.getElementById("llmModelInput").value = s.model || "deepseek-chat";
    clearPendingSecrets("llm");
    setSecretDisplayValue("llmApiKeyInput", s.apiKey || "");
    document.getElementById("llmCandidateFilterInput").checked = Boolean(s.candidateFilterEnabled);
    document.getElementById("llmCandidateFilterPromptInput").value = s.candidateFilterPrompt || "";
    document.getElementById("llmPromptInput").value = s.promptTemplate || "";
    setLlmSettingsStatus(s.hasApiKey ? "AI 设置已读取。" : "AI 设置已读取，但还没有保存 API Key。");
    if (showToastOnDone) showToast("AI 设置已读取");
  } catch (e) {
    setLlmSettingsStatus("读取 AI 设置失败：" + e.message, true);
  }
}

async function saveLlmSettings() {
  if (sessionMode !== "account") {
    alert("请先登录账号，再保存 AI 设置。");
    return;
  }

  const payload = {
    provider: document.getElementById("llmProviderInput").value,
    baseUrl: document.getElementById("llmBaseUrlInput").value.trim(),
    model: document.getElementById("llmModelInput").value.trim(),
    candidateFilterEnabled: document.getElementById("llmCandidateFilterInput").checked,
    candidateFilterPrompt: document.getElementById("llmCandidateFilterPromptInput").value,
    promptTemplate: document.getElementById("llmPromptInput").value
  };
  Object.assign(payload, pendingSecretUpdates.llm);

  setLlmSettingsStatus("正在保存 AI 设置...");
  try {
    const data = await apiFetch("/api/llm/settings", { method: "PUT", body: payload });
    const s = data.settings || {};
    clearPendingSecrets("llm");
    setSecretDisplayValue("llmApiKeyInput", s.apiKey || "");
    setLlmSettingsStatus(s.hasApiKey ? "AI 设置已保存。" : "AI 设置已保存，API Key 已清空。");
    showToast("AI 设置已保存");
  } catch (e) {
    setLlmSettingsStatus("保存 AI 设置失败：" + e.message, true);
  }
}

async function testLlmSettings() {
  if (sessionMode !== "account") {
    alert("请先登录账号，再测试 AI 设置。");
    return;
  }
  setLlmSettingsStatus("正在测试 LLM 连接...");
  try {
    await apiFetch("/api/llm/test", { method: "POST", body: {} });
    setLlmSettingsStatus("LLM 连接测试成功。");
    showToast("LLM 连接成功");
  } catch (e) {
    setLlmSettingsStatus("LLM 连接测试失败：" + e.message, true);
  }
}

async function clearLlmApiKey() {
  if (sessionMode !== "account") {
    delete pendingSecretUpdates.llm.apiKey;
    setSecretDisplayValue("llmApiKeyInput", "");
    showToast("已清空当前页面的 LLM Key");
    return;
  }
  if (!confirm("确定清空当前账号保存的 LLM API Key 吗？")) return;
  setLlmSettingsStatus("正在清空 LLM API Key...");
  try {
    const data = await apiFetch("/api/llm/settings/api-key", { method: "DELETE" });
    const s = data.settings || {};
    clearPendingSecrets("llm");
    setSecretDisplayValue("llmApiKeyInput", "");
    setLlmSettingsStatus("LLM API Key 已清空。");
    showToast("LLM API Key 已清空");
  } catch (e) {
    setLlmSettingsStatus("清空 LLM API Key 失败：" + e.message, true);
  }
}
