export type TreeNode = { id: string; parentId: string | null; children: string[]; role: 'user' | 'assistant'; content: string };
export type HistoryLink = { parentId: string | null | undefined; role: 'user' | 'assistant' | 'system' | 'unknown' };
export type ChatTree = { nodes: Map<string, TreeNode>; roots: string[]; currentId: string | null; complete: boolean; ancestry?: Map<string, HistoryLink> };

/** Normalize the history response; malformed parents must never cause recursive loops. */
export function parseHistory(raw: unknown): ChatTree {
  const data = (raw as { data?: { biz_data?: { chat_messages?: Array<Record<string, unknown>>; chat_session?: { current_message_id?: unknown } } } })?.data?.biz_data;
  if (!Array.isArray(data?.chat_messages)) throw new Error('Could not read conversation history.');
  const nodes = new Map<string, TreeNode>();
  const parents = new Map<string, string | null>();
  const ancestry = new Map<string, HistoryLink>();
  for (const msg of data.chat_messages) {
    if (msg.message_id == null) continue;
    const id = String(msg.message_id);
    const parentId = msg.parent_id == null || String(msg.parent_id) === '0' ? null : String(msg.parent_id);
    parents.set(id, parentId);
    ancestry.set(id, {
      parentId: Object.prototype.hasOwnProperty.call(msg, 'parent_id') ? parentId : undefined,
      role: msg.role === 'USER' ? 'user' : msg.role === 'ASSISTANT' ? 'assistant' : msg.role === 'SYSTEM' ? 'system' : 'unknown',
    });
    const role = msg.role === 'USER' ? 'user' : msg.role === 'ASSISTANT' ? 'assistant' : null;
    if (!role) continue;
    const fragments = Array.isArray(msg.fragments) ? msg.fragments as Array<Record<string, unknown>> : [];
    const content = typeof msg.content === 'string' ? msg.content : fragments.filter(f => f.type === 'RESPONSE' || f.type === 'REQUEST').map(f => typeof f.content === 'string' ? f.content : '').join('\n');
    nodes.set(id, { id, parentId, children: [], role, content });
  }
  const ancestor = (id: string | null, seen = new Set<string>()): string | null => {
    while (id && !seen.has(id)) {
      seen.add(id);
      if (nodes.has(id)) return id;
      id = parents.get(id) ?? null;
    }
    return null;
  };
  for (const n of nodes.values()) n.parentId = ancestor(n.parentId, new Set([n.id]));
  const checked = new Set<string>();
  for (const node of nodes.values()) {
    const chain = new Set<string>();
    let id: string | null = node.id;
    while (id && !checked.has(id)) {
      if (chain.has(id)) { const cyclic = nodes.get(id); if (cyclic) cyclic.parentId = null; break; }
      chain.add(id); id = nodes.get(id)?.parentId ?? null;
    }
    for (const visited of chain) checked.add(visited);
  }
  const roots: string[] = [];
  for (const n of nodes.values()) {
    if (n.parentId) nodes.get(n.parentId)?.children.push(n.id);
    else roots.push(n.id);
  }
  const currentId = ancestor(data.chat_session?.current_message_id == null ? null : String(data.chat_session.current_message_id));
  return { nodes, roots, currentId, complete: true, ancestry };
}

/** Count the target's own branch using original parents, never repaired layout roots. */
export function messageOrdinal(tree: ChatTree, messageId: string): { role: 'user' | 'assistant'; index: number; position: number } | null {
  const links = tree.ancestry;
  const target = links?.get(messageId);
  if (!tree.complete || !links || !target || (target.role !== 'user' && target.role !== 'assistant')) return null;
  let index = 0;
  let position = 0;
  let id: string | null = messageId;
  const seen = new Set<string>();
  while (id !== null) {
    if (seen.has(id)) return null;
    seen.add(id);
    const link = links.get(id);
    if (!link || link.parentId === undefined || link.role === 'unknown') return null;
    if (link.role === target.role) index++;
    if (link.role === 'user' || link.role === 'assistant') position++;
    id = link.parentId;
  }
  return { role: target.role, index, position };
}

export function activePath(tree: ChatTree): string[] {
  const path: string[] = []; const seen = new Set<string>();
  let id = tree.currentId;
  while (id && !seen.has(id)) {
    const node = tree.nodes.get(id);
    if (!node) break;
    seen.add(id); path.push(id); id = node.parentId;
  }
  return path.reverse();
}

/** Iterative leaf-spacing layout: independent of third-party implementation. */
export function layoutTree(tree: ChatTree): { points: Map<string, { x: number; y: number }>; width: number; height: number } {
  const points = new Map<string, { x: number; y: number }>();
  const stack = tree.roots.slice().reverse().map(id => ({ id, depth: 0, visited: false }));
  let leaf = 0; let maxDepth = 0;
  while (stack.length) {
    const entry = stack.pop(); if (!entry) break;
    const node = tree.nodes.get(entry.id);
    if (!node) continue;
    if (!entry.visited && node.children.length) {
      stack.push({ ...entry, visited: true });
      for (const id of [...node.children].reverse()) stack.push({ id, depth: entry.depth + 1, visited: false });
      continue;
    }
    // A child without a placed point means layout is inconsistent; ignore it instead of throwing.
    const xs = node.children.map(id => points.get(id)?.x).filter((x): x is number => x !== undefined);
    const first = xs[0];
    const last = xs[xs.length - 1];
    const x = first !== undefined && last !== undefined ? (first + last) / 2 : 64 + leaf++ * 76;
    points.set(node.id, { x, y: 36 + entry.depth * 48 }); maxDepth = Math.max(maxDepth, entry.depth);
  }
  return { points, width: Math.max(320, leaf * 76 + 64), height: 80 + maxDepth * 48 };
}
