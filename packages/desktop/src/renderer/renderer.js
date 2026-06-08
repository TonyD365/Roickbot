// Renderer logic (plain JS, talks to main via the preload `api`).
/* global window, document */
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
} else {
  setupHandlers(api);
}

function setIndicator(dotId, textId, state, text) {
  const dot = el(dotId);
  dot.classList.remove("on", "off", "idle");
  dot.classList.add(state);
  el(textId).textContent = text;
}

let running = false;

function render(status) {
  if (!status) return;
  running = status.running;
  setIndicator("serviceDot", "serviceText", running ? "on" : "off",
    running ? `Service running on port ${status.port}` : "Service stopped");
  el("toggleService").textContent = running ? "Stop service" : "Start service";

  setIndicator("pluginDot", "pluginText", status.pluginConnected ? "on" : "off",
    status.pluginConnected ? "Plugin online (auto-connected)" : "Plugin offline");
  el("installPlugin").classList.toggle("hidden", status.pluginConnected);

  setIndicator("claudeDot", "claudeText", status.claudeConnected ? "on" : "idle",
    status.claudeConnected ? "Claude Code connected" : "Claude Code not connected");
}

function setupHandlers(api) {
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
    const r = await api.writeConfig();
    flash(r.written ? `MCP config written to ${r.path}. Restart Claude Code to pick it up.` : "Failed");
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

  api.onStatus((status) => render(status));
  api.onHandshake(() => { flash("Studio plugin connected."); refresh(); });
  api.onUpdateReady((version) => {
    el("updateText").textContent = `Update ${version} downloaded.`;
    el("updateBanner").classList.remove("hidden");
  });

  setInterval(refresh, 2500);
  refresh();
}
