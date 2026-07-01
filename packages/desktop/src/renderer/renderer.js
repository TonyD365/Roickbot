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

  el("restartUpdate").addEventListener("click", guard(() => api.restartToUpdate()));

  // macOS（未签名）：下载 dmg 到桌面并打开，用户手动拖入 Applications。
  let manualUrl = null;
  el("downloadUpdate").addEventListener("click", guard(async () => {
    if (!manualUrl) return;
    flash("Downloading update… this can take a minute.");
    const r = await api.downloadUpdate(manualUrl);
    flash(`Saved to ${r.path} and opened it. Drag the app into Applications, then reopen.`);
  }));

  // 显示版本号，便于区分新旧实例。
  api.getVersion().then((v) => {
    el("sub").textContent = `Bridge between Claude Code and Roblox Studio · v${v}`;
  }).catch(() => {});

  api.onStatus((status) => render(status));
  api.onHandshake(() => { flash("Studio plugin connected."); refresh(); });
  // 两个更新横幅互斥：任何时候最多显示一个。
  api.onUpdateReady((version) => {
    el("manualUpdateBanner").classList.add("hidden");
    el("updateText").textContent = `Update ${version} downloaded.`;
    el("updateBanner").classList.remove("hidden");
  });
  api.onUpdateManual(({ version, url }) => {
    manualUrl = url;
    el("updateBanner").classList.add("hidden");
    el("manualUpdateText").textContent = `Update ${version} available — download & drag into Applications.`;
    el("manualUpdateBanner").classList.remove("hidden");
  });

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
