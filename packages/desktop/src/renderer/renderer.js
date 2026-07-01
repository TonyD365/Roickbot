// Renderer logic (plain JS, talks to main via the preload `api`).
// Wrapped in an IIFE so top-level identifiers can never collide / be
// "already declared" even if this script is evaluated more than once.
/* global window, document */
(() => {
  const el = (id) => document.getElementById(id);

  function flash(message) {
    el("msg").textContent = message;
    if (message) setTimeout(() => { el("msg").textContent = ""; }, 4000);
  }

  const api = window.api;

  // 如果 preload 没注入成功，明确提示，而不是静默失效。
  if (!api) {
    const b = el("apiError");
    if (b) b.classList.remove("hidden");
    console.error("window.api is undefined — preload did not load.");
    return;
  }

  let running = false;

  // 把 MCP clientInfo.name 映射成好看的名字。
  function prettyClient(name) {
    const n = String(name).toLowerCase();
    if (n.includes("claude")) return "Claude";
    if (n.includes("gemini")) return "Gemini";
    if (n.includes("cursor")) return "Cursor";
    if (n.includes("code") || n.includes("vscode")) return "VS Code";
    if (n.includes("cline")) return "Cline";
    if (n.includes("windsurf")) return "Windsurf";
    return name; // 未知则原样显示
  }

  function setIndicator(dotId, textId, state, text) {
    const dot = el(dotId);
    dot.classList.remove("on", "off", "idle");
    dot.classList.add(state);
    el(textId).textContent = text;
  }

  function render(status) {
    if (!status) return;
    running = status.running;
    setIndicator("serviceDot", "serviceText", running ? "on" : "off",
      running ? `Service running on port ${status.port}` : "Service stopped");
    el("toggleService").textContent = running ? "Stop service" : "Start service";

    setIndicator("pluginDot", "pluginText", status.pluginConnected ? "on" : "off",
      status.pluginConnected ? "Plugin online (auto-connected)" : "Plugin offline");
    el("installPlugin").classList.toggle("hidden", status.pluginConnected);

    setIndicator("agentDot", "agentText", status.agentConnected ? "on" : "off",
      status.agentConnected ? "Runtime agent online (test running)" : "Runtime agent off (starts with a test)");

    const clientLabel = status.mcpClient ? prettyClient(status.mcpClient) : "MCP client";
    setIndicator("claudeDot", "claudeText", status.claudeConnected ? "on" : "idle",
      status.claudeConnected ? `${clientLabel} connected` : `${clientLabel} not connected`);
  }

  function fmtTime(ms) {
    const d = new Date(ms);
    return d.toTimeString().slice(0, 8);
  }

  function renderActivity(act) {
    const box = el("activity");
    if (!box) return;
    const rows = [];
    for (const c of act.commands || []) {
      const cls = c.ok === false ? "bad" : c.ok === true ? "ok" : "info";
      const status = c.ok === false ? `✗ ${c.error || "error"}` : c.ok === true ? "✓" : "…";
      rows.push({ at: c.at, html: `<span class="t">${fmtTime(c.at)}</span><span class="m">${c.channel}: ${c.tool}</span><span class="${cls}">${status}</span>` });
    }
    for (const e of act.events || []) {
      const label = e.type === "runState" ? `runState → ${e.state}`
        : e.type === "output" ? `${e.messageType || "output"}`
        : `${e.type}`;
      rows.push({ at: e.at, html: `<span class="t">${fmtTime(e.at)}</span><span class="m info">${label}</span>` });
    }
    rows.sort((a, b) => b.at - a.at);
    box.innerHTML = rows.length
      ? rows.slice(0, 40).map((r) => `<div class="ev">${r.html}</div>`).join("")
      : '<div class="small">No activity yet.</div>';
  }

  async function refreshActivity() {
    if (!running) return;
    try { renderActivity(await api.getActivity(40)); } catch { /* ignore */ }
  }

  // 统一包一层 try/catch，任何错误都弹到界面上，避免"点了没反应"。
  const guard = (fn) => async () => {
    try { await fn(); } catch (e) { flash("Error: " + (e && e.message ? e.message : String(e))); console.error(e); }
  };

  async function refresh() {
    render(await api.getStatus());
    el("token").textContent = (await api.getToken()) || "— (start the service to generate a token)";
  }

  el("toggleService").addEventListener("click", guard(async () => {
    const status = running ? await api.stop() : await api.start();
    render(status);
    await refresh();
  }));

  el("installPlugin").addEventListener("click", guard(async () => {
    const r = await api.installPlugin();
    flash(r.saved ? `Plugin saved to ${r.path}` : "Install cancelled");
  }));

  el("writeConfig").addEventListener("click", guard(async () => {
    const client = el("clientSelect").value;
    const r = await api.writeConfig(client);
    if (r.cancelled) { flash("MCP install cancelled"); return; }
    flash(r.written ? `MCP config written to ${r.path}. Restart your client to pick it up.` : "Failed");
    await refresh();
  }));

  el("copyToken").addEventListener("click", guard(async () => {
    const token = await api.getToken();
    if (token) { await navigator.clipboard.writeText(token); flash("Token copied"); }
  }));

  el("rotateToken").addEventListener("click", guard(async () => {
    await api.rotateToken();
    flash("Token rotated. Re-pair the Studio plugin and re-install the MCP config.");
    await refresh();
  }));

  // ---- 更新：横幅按钮 + 更新日志弹窗（changelog 从 GitHub 抓取） ----
  let pendingUpdate = null;

  // 极简 Markdown → HTML：先转义，再套用标题 / 列表 / 粗体 / 行内代码 / 链接。
  function renderMarkdown(md) {
    if (!md || !md.trim()) return '<p class="small">No release notes.</p>';
    let s = md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" data-ext="1">$1</a>');
    const out = [];
    let inList = false;
    const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
    for (const line of s.split(/\r?\n/)) {
      const h = line.match(/^(#{1,3})\s+(.*)$/);
      const li = line.match(/^\s*[-*]\s+(.*)$/);
      if (h) { closeList(); out.push(`<h${h[1].length}>${h[2]}</h${h[1].length}>`); }
      else if (li) { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${li[1]}</li>`); }
      else if (line.trim() === "") { closeList(); }
      else { closeList(); out.push(`<p>${line}</p>`); }
    }
    closeList();
    return out.join("");
  }

  function showUpdateModal() {
    const u = pendingUpdate;
    if (!u) return;
    el("updateModalTitle").textContent = `Update available · v${u.version}`;
    el("updateModalSub").textContent = u.kind === "win"
      ? "Downloaded and ready to install."
      : "Download the new version, then drag it into Applications.";
    el("changelogBody").innerHTML = renderMarkdown(u.notes);
    el("changelogBody").querySelectorAll("a[data-ext]").forEach((a) => {
      a.addEventListener("click", (e) => { e.preventDefault(); api.openExternal(a.getAttribute("href")); });
    });
    el("installUpdateBtn").textContent = u.kind === "win" ? "Restart & install" : "Download & install";
    el("updateModal").classList.remove("hidden");
  }
  const hideUpdateModal = () => el("updateModal").classList.add("hidden");

  // 检测到更新（或界面打开时已有待装更新）：显示横幅 + 直接弹出更新日志界面。
  function onUpdate(u) {
    if (!u || !u.version) return;
    pendingUpdate = u;
    el("updateText").textContent = `Update v${u.version} is available.`;
    el("updateBanner").classList.remove("hidden");
    showUpdateModal();
  }

  el("viewUpdate").addEventListener("click", () => showUpdateModal());
  el("updateLater").addEventListener("click", hideUpdateModal);
  el("installUpdateBtn").addEventListener("click", guard(async () => {
    const u = pendingUpdate;
    if (!u) return;
    if (u.kind === "win") { await api.restartToUpdate(); return; }
    // mac：下载期间禁用按钮并显示 "Downloading…"，防重复点击；完成/失败后复原。
    const btn = el("installUpdateBtn");
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Downloading…";
    try {
      flash("Downloading update… this can take a minute.");
      const r = await api.downloadUpdate(u.url);
      hideUpdateModal();
      flash(`Saved to ${r.path} and opened it. Drag the app into Applications, then reopen.`);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }));

  // 显示版本号，便于区分新旧实例。
  api.getVersion().then((v) => {
    el("sub").textContent = `Bridge between AI and Roblox Studio · v${v}`;
  }).catch(() => {});

  api.onStatus((status) => render(status));
  api.onHandshake(() => { flash("Studio plugin connected."); refresh(); });
  api.onUpdateAvailable(onUpdate);
  // 界面一打开就检查是否已有待安装更新，有则弹出更新日志。
  api.getPendingUpdate().then(onUpdate).catch(() => {});

  setInterval(refresh, 2500);
  setInterval(refreshActivity, 2000);
  refresh();
  refreshActivity();

  // 自检：确认 .hidden 真的把元素隐藏了（防 CSS 优先级回归——横幅误显示）。
  if (getComputedStyle(el("updateBanner")).display !== "none") {
    console.error("[renderer] CSS bug: .hidden class is not hiding elements");
  }

  // 成功标志：renderer 完整初始化且确实拿到了 window.api（供自检确认）。
  console.log("[renderer] ui ready");
})();
