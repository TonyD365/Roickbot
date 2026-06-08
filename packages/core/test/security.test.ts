import { describe, it, expect } from "vitest";
import type { IncomingMessage } from "node:http";
import { authorizeRequest, safeEqual, generateToken, REQUIRED_HEADER } from "../src/security/auth";
import { ConfirmStore, hashArgs } from "../src/safety/confirm";

const PORT = 7331;
const TOKEN = generateToken();

function fakeReq(headers: Record<string, string | undefined>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

function goodHeaders(): Record<string, string> {
  return {
    host: `127.0.0.1:${PORT}`,
    authorization: `Bearer ${TOKEN}`,
    [REQUIRED_HEADER]: "1",
  };
}

describe("safeEqual", () => {
  it("matches equal strings and rejects different ones", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("authorizeRequest", () => {
  const cfg = { token: TOKEN, port: PORT };

  it("accepts a valid request", () => {
    expect(authorizeRequest(fakeReq(goodHeaders()), cfg).ok).toBe(true);
  });

  it("rejects browser Origin (CSRF / DNS-rebinding defense)", () => {
    const r = authorizeRequest(fakeReq({ ...goodHeaders(), origin: "https://evil.example" }), cfg);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });

  it("rejects a mismatched Host", () => {
    const r = authorizeRequest(fakeReq({ ...goodHeaders(), host: "evil.example" }), cfg);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });

  it("rejects a missing required header", () => {
    const h = goodHeaders();
    delete h[REQUIRED_HEADER];
    expect(authorizeRequest(fakeReq(h), cfg).ok).toBe(false);
  });

  it("rejects a bad token with 401", () => {
    const r = authorizeRequest(fakeReq({ ...goodHeaders(), authorization: "Bearer wrong" }), cfg);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });

  it("rejects a missing token", () => {
    const h = goodHeaders();
    delete h.authorization;
    expect(authorizeRequest(fakeReq(h), cfg).ok).toBe(false);
  });
});

describe("ConfirmStore", () => {
  it("issues a token that confirms matching args once", () => {
    const store = new ConfirmStore();
    const args = { path: "Workspace/Thing", confirm: undefined };
    const token = store.issue(args);
    expect(store.consume(token, args)).toBe(true);
    // single use
    expect(store.consume(token, args)).toBe(false);
  });

  it("rejects a token when args were tampered with", () => {
    const store = new ConfirmStore();
    const token = store.issue({ path: "Workspace/A" });
    expect(store.consume(token, { path: "Workspace/B" })).toBe(false);
  });

  it("ignores the confirm field itself when hashing", () => {
    expect(hashArgs({ path: "x", confirm: "abc" })).toBe(hashArgs({ path: "x" }));
  });
});
