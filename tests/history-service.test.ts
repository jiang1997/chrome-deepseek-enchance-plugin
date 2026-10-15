import { describe, expect, it, vi } from "vitest";
import { ConversationHistory } from "../src/tree/history-service";
import { createDeferred } from "./helpers/dom";
const raw = (ids = [1]) => ({
  data: {
    biz_data: { chat_messages: ids.map((id) => ({ message_id: id, parent_id: 0, role: "USER", content: "text" })) },
  },
});
const signal = () => new AbortController().signal;

describe("shared conversation history", () => {
  it("shares one request and cache between independent consumers", async () => {
    const deferred = createDeferred<unknown>();
    const load = vi.fn(() => deferred.promise);
    const service = new ConversationHistory(load);
    const quote = service.get("chat", signal(), { messageId: "1" });
    const panel = service.get("chat", signal(), { force: true });
    expect(load).toHaveBeenCalledTimes(1);
    deferred.resolve(raw());
    const [a, b] = await Promise.all([quote, panel]);
    expect(a).toBe(b);
    expect(await service.get("chat", signal())).toBe(a);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("refreshes cached history once when the selected message is missing", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(raw())
      .mockResolvedValueOnce(raw([1, 2]));
    const service = new ConversationHistory(load);
    await service.get("chat", signal());
    const tree = await service.get("chat", signal(), { messageId: "2" });
    expect(tree.nodes.has("2")).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
    await service.get("chat", signal(), { messageId: "2" });
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("cancelling the quote does not cancel a panel sharing its request", async () => {
    const deferred = createDeferred<unknown>();
    let underlying: AbortSignal;
    const service = new ConversationHistory((_id, s) => {
      underlying = s;
      return deferred.promise;
    });
    const controller = new AbortController();
    const quote = service.get("chat", controller.signal);
    const panel = service.get("chat", signal());
    controller.abort();
    await expect(quote).rejects.toThrow("Cancelled");
    expect(underlying!.aborted).toBe(false);
    deferred.resolve(raw());
    expect((await panel).nodes.size).toBe(1);
  });
  it("aborts the request after its last consumer cancels", async () => {
    const deferred = createDeferred<unknown>();
    let underlying: AbortSignal;
    const service = new ConversationHistory((_id, s) => {
      underlying = s;
      return deferred.promise;
    });
    const controller = new AbortController();
    const request = service.get("chat", controller.signal);
    controller.abort();
    await expect(request).rejects.toThrow("Cancelled");
    expect(underlying!.aborted).toBe(true);
    deferred.resolve(raw());
  });
  it("does not cache an old conversation response after navigation", async () => {
    const old = createDeferred<unknown>();
    const load = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue(raw([2]));
    const service = new ConversationHistory(load);
    const request = service.get("old", signal());
    const current = await service.get("new", signal());
    old.resolve(raw());
    await expect(request).rejects.toThrow("Cancelled");
    expect(await service.get("new", signal())).toBe(current);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("expires history and retries after failures", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(raw());
    const service = new ConversationHistory(load);
    await expect(service.get("chat", signal())).rejects.toThrow("offline");
    await service.get("chat", signal());
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 16000);
    try {
      await service.get("chat", signal());
      expect(load).toHaveBeenCalledTimes(3);
    } finally {
      clock.mockRestore();
    }
  });
});
