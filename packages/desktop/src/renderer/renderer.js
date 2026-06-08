// Renderer logic (plain JS, talks to main via the preload `api`).
/* global window, document */
const api = window.api;

const el = (id) => document.getElementById(id);

function setIndicator(dotId, textId, state, text) {
  const dot = el(dotId);
  dot.classList.remove("on", "off", "idle");
  dot.classList.add(state);
  el(textId).textContent = text;
}

function flash(message) {
  el("msg").textContent = message;
  if (message) setTimeout(() => { el("msg").textContent = ""; }, 4000);
}

let running = false;

function render(status) {
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

async function refresh() {
  const status = await api.getStatus();
  render(status);
  el("token").textContent = (await api.getToken()) || "— (start the service to generate a token)";
}

el("toggleService").addEventListener("click", async () => {
  const status = running ? await api.stop() : await api.start();
  render(status);
  refresh();
});

el("installPlugin").addEventListener("click", async () => {
  const r = await api.installPlugin();
  flash(r.saved ? `Plugin saved to ${r.path}` : "Install cancelled");
});

el("writeConfig").addEventListener("click", async () => {
  const r = await api.writeConfig();
  flash(r.written ? `MCP config written to ${r.path}. Restart Claude Code to pick it up.` : "Failed");
  refresh();
});

el("copyToken").addEventListener("click", async () => {
  const token = await api.getToken();
  if (token) { await navigator.clipboard.writeText(token); flash("Token copied"); }
});

el("rotateToken").addEventListener("click", async () => {
  await api.rotateToken();
  flash("Token rotated. Re-pair the Studio plugin and re-install the MCP config.");
  refresh();
});

api.onStatus((status) => render(status));
api.onHandshake(() => { flash("Studio plugin connected."); refresh(); });

// Poll status periodically so plugin/Claude online state stays fresh.
setInterval(refresh, 2500);
refresh();
