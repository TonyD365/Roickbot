import { describe, expect, it } from "vitest";
import { CommandQueue } from "../src/bridge/commandQueue";

describe("CommandQueue", () => {
  it("does not deliver a second command until the active command responds", async () => {
    const queue = new CommandQueue(1_000);
    queue.setConnectedSession("studio");

    const first = queue.dispatch("first", {});
    const firstEnvelope = await queue.poll("studio");
    expect(firstEnvelope?.tool).toBe("first");

    const second = queue.dispatch("second", {});
    const secondPoll = queue.poll("studio");
    let secondDelivered = false;
    void secondPoll.then(() => { secondDelivered = true; });
    await Promise.resolve();
    expect(secondDelivered).toBe(false);

    queue.resolveResponse({ id: firstEnvelope!.id, ok: true, result: "first result" });
    const secondEnvelope = await secondPoll;
    expect(secondEnvelope?.tool).toBe("second");
    queue.resolveResponse({ id: secondEnvelope!.id, ok: true, result: "second result" });

    await expect(first).resolves.toBe("first result");
    await expect(second).resolves.toBe("second result");
  });
});
