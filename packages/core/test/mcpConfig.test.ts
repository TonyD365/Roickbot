import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCodexEntry, writeCodexConfig } from "../src/config/mcpConfig";

describe("Codex MCP config", () => {
  it("creates the Streamable HTTP server table with both required headers", () => {
    const entry = buildCodexEntry(7331, "test-token");
    expect(entry).toContain("[mcp_servers.roickbot]");
    expect(entry).toContain('url = "http://127.0.0.1:7331/mcp"');
    expect(entry).toContain('Authorization = "Bearer test-token"');
    expect(entry).toContain('"X-Roblox-MCP" = "1"');
  });

  it("preserves other TOML settings and replaces an existing roickbot table", async () => {
    const dir = await mkdtemp(join(tmpdir(), "roickbot-codex-"));
    const path = join(dir, "config.toml");
    await writeFile(path, [
      'model = "gpt-5"',
      "",
      "[mcp_servers.roickbot]",
      'url = "http://old.example/mcp"',
      "",
      "[features]",
      "fast_mode = true",
      "",
    ].join("\n"));

    await writeCodexConfig(path, 7331, "new-token");
    const config = await readFile(path, "utf8");
    expect(config).toContain('model = "gpt-5"');
    expect(config).toContain("[features]");
    expect(config).toContain('url = "http://127.0.0.1:7331/mcp"');
    expect(config).toContain('Authorization = "Bearer new-token"');
    expect(config).not.toContain("old.example");
    expect(config.match(/\[mcp_servers\.roickbot\]/g)).toHaveLength(1);
  });
});
