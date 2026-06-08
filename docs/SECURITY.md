# Security model

The bridge runs an HTTP server on your machine. **Any web page you open can send requests to
`127.0.0.1`**, so without protection a malicious site could drive the bridge and damage your
Studio project (a localhost CSRF / DNS-rebinding attack). The bridge defends against this with
several independent checks, applied to **every** request before any routing.

## Threat model

- Attacker: a web page running in your browser while the bridge is up.
- Goal of the attacker: send commands to `http://127.0.0.1:<port>` to read or modify your project.
- The attacker cannot read responses cross-origin and cannot set custom headers on a simple
  cross-site request without triggering a CORS preflight (which we never approve).

## Defenses

1. **Loopback only.** The server binds `127.0.0.1`, never `0.0.0.0`. It is unreachable from the
   network.
2. **Random Bearer token.** On start the server generates a 256-bit random token
   (`crypto.randomBytes(32)`), stored at `0600`. Every request must send
   `Authorization: Bearer <token>`; otherwise it gets `401`. The token is only ever shown in the
   native desktop app — a web page cannot obtain it. Comparison is constant-time
   (`crypto.timingSafeEqual`).
3. **Studio-side pairing.** The token is pasted **into the Studio plugin** by you and stored with
   `plugin:SetSetting`, so connecting is a deliberate action on the Studio side. After the first
   pairing the plugin auto-reconnects.
4. **Host validation.** The `Host` header must be exactly `127.0.0.1:<port>` or
   `localhost:<port>`; anything else is rejected (`403`). This blocks DNS-rebinding.
5. **Origin rejection.** Any request carrying a browser `Origin` header is rejected (`403`).
   Legitimate clients (Claude Code, the Roblox plugin) do not send `Origin`.
6. **Required custom header.** Every request must send `X-Roblox-MCP: 1`. A cross-site browser
   request cannot set this without a CORS preflight, which the server never approves (no
   permissive `Access-Control-Allow-Origin`).

## Token rotation

You can rotate the token from the desktop app at any time. After rotating you must re-pair the
Studio plugin and re-write the Claude Code MCP config (the app does the latter for you).

## "Think before acting" (三思而后行)

Separately from authentication, the tools are designed so Claude is cautious — destructive
operations return a dry-run preview and a one-time confirm token before they apply, every change
is wrapped in an undo waypoint (Ctrl+Z), and Core services (`CoreGui`, `CorePackages`, …) are
never mutable. This guidance targets Claude and never interrupts you with pop-ups.
