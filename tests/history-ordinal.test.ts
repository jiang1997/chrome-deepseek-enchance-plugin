import { describe, expect, it } from "vitest";
import { messageOrdinal, parseHistory } from "../src/tree/model";
const msg = (id: number, parent: number | null, role = "ASSISTANT") => ({
  message_id: id,
  parent_id: parent,
  role,
  content: `text ${id}`,
});
const tree = (messages: Record<string, unknown>[], current = 999) =>
  parseHistory({ data: { biz_data: { chat_messages: messages, chat_session: { current_message_id: current } } } });

describe("history-based quote ordinals", () => {
  it("counts each branch independently, ignoring ID order and currentId", () => {
    const data = tree([
      msg(91, 0, "USER"),
      msg(12, 91),
      msg(40, 91),
      msg(7, 12, "USER"),
      msg(22, 7),
      msg(3, 40, "USER"),
      msg(8, 3),
    ]);
    expect(messageOrdinal(data, "22")).toEqual({ role: "assistant", index: 2, position: 4 });
    expect(messageOrdinal(data, "8")).toEqual({ role: "assistant", index: 2, position: 4 });
    expect(messageOrdinal(data, "3")).toEqual({ role: "user", index: 2, position: 3 });
  });
  it("does not assume user and assistant strictly alternate", () => {
    expect(messageOrdinal(tree([msg(1, 0, "USER"), msg(2, 1, "USER"), msg(3, 2)]), "3")).toEqual({
      role: "assistant",
      index: 1,
      position: 3,
    });
  });
  it("skips explicit system messages without losing ancestry", () => {
    expect(
      messageOrdinal(tree([msg(1, null, "SYSTEM"), msg(2, 1, "USER"), msg(3, 2, "SYSTEM"), msg(4, 3)]), "4"),
    ).toEqual({ role: "assistant", index: 1, position: 2 });
  });
  it("refuses to count dangling ancestry even when layout repairs it to a root", () => {
    const data = tree([msg(1, 999, "USER"), msg(2, 1)]);
    expect(data.nodes.get("1")!.parentId).toBeNull();
    expect(messageOrdinal(data, "2")).toBeNull();
  });
  it("rejects a cycle in original ancestry despite layout cycle repair", () => {
    const data = tree([msg(1, 2, "USER"), msg(2, 1), msg(3, 2)]);
    expect(messageOrdinal(data, "3")).toBeNull();
  });
  it("requires an explicit root and known roles throughout the path", () => {
    expect(messageOrdinal(tree([{ message_id: 1, role: "USER" }, msg(2, 1)]), "2")).toBeNull();
    expect(messageOrdinal(tree([msg(1, 0, "UNKNOWN"), msg(2, 1)]), "2")).toBeNull();
    expect(messageOrdinal(tree([msg(1, 0)]), "missing")).toBeNull();
  });
});
