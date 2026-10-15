import { describe, expect, it } from "vitest";
import { activePath, layoutTree, parseHistory } from "../src/tree/model";
const history = (messages: Record<string, unknown>[], current: unknown) => ({
  data: { biz_data: { chat_messages: messages, chat_session: { current_message_id: current } } },
});
const msg = (id: number, parent: number, role = "ASSISTANT", content = `message ${id}`) => ({
  message_id: id,
  parent_id: parent,
  role,
  content,
});

describe("conversation tree", () => {
  it("restores sibling branches and the selected path regardless of message ID order", () => {
    const tree = parseHistory(history([msg(90, 0, "USER"), msg(12, 90), msg(4, 90), msg(8, 4, "USER")], 8));
    expect(tree.roots).toEqual(["90"]);
    expect(tree.nodes.get("90")!.children).toEqual(["12", "4"]);
    expect(activePath(tree)).toEqual(["90", "4", "8"]);
    const layout = layoutTree(tree);
    expect(layout.points.get("12")!.y).toBe(layout.points.get("4")!.y);
    expect(layout.points.get("12")!.x).not.toBe(layout.points.get("4")!.x);
  });
  it("reconnects visible messages through omitted system nodes", () => {
    const tree = parseHistory(history([msg(1, 0, "USER"), msg(2, 1, "SYSTEM"), msg(3, 2)], 3));
    expect(tree.nodes.get("3")!.parentId).toBe("1");
    expect(activePath(tree)).toEqual(["1", "3"]);
  });
  it("breaks cycles and dangling parents so malformed history can still render", () => {
    const tree = parseHistory(history([msg(1, 2), msg(2, 1), msg(3, 3), msg(4, 999)], 2));
    expect(layoutTree(tree).points.size).toBe(4);
    expect(tree.roots).toContain("3");
    expect(tree.roots).toContain("4");
  });
  it("uses answer fragments and excludes thinking fragments", () => {
    const tree = parseHistory(
      history(
        [
          {
            message_id: 1,
            role: "ASSISTANT",
            fragments: [
              { type: "THINK", content: "thoughts" },
              { type: "RESPONSE", content: "<script>literal text</script>" },
            ],
          },
        ],
        1,
      ),
    );
    expect(tree.nodes.get("1")!.content).toBe("<script>literal text</script>");
  });
  it("does not invent an active branch when the current node is unknown", () => {
    const tree = parseHistory(history([msg(1, 0), msg(2, 0)], 999));
    expect(activePath(tree)).toEqual([]);
  });
  it("rejects incompatible payloads but permits an empty chat", () => {
    expect(() => parseHistory({ data: {} })).toThrow();
    expect(layoutTree(parseHistory(history([], null))).points.size).toBe(0);
  });
  it("lays out a long linear chat without exhausting the call stack", () => {
    // Construct directly to stress layout rather than the parent normalization.
    const nodes = new Map(
      Array.from({ length: 15000 }, (_, i) => [
        String(i),
        {
          id: String(i),
          parentId: i ? String(i - 1) : null,
          children: i < 14999 ? [String(i + 1)] : [],
          role: "user" as const,
          content: "",
        },
      ]),
    );
    expect(layoutTree({ nodes, roots: ["0"], currentId: "14999", complete: true }).points.size).toBe(15000);
  });
});
