import { afterEach, describe, expect, it, vi } from 'vitest';
import { jumpToMessage, renderedTree, requestHistory } from '../src/tree/deepseek';

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });
describe('tree navigation and fallback', () => {
  it('never invents edges between a partial virtual-list window', () => {
    document.body.innerHTML = '<div data-virtual-list-item-key="88"><div class="ds-collapsible-text">question</div></div><div data-virtual-list-item-key="92"><div class="ds-markdown">answer</div></div>';
    const tree = renderedTree();
    expect(tree.complete).toBe(false); expect(tree.roots).toEqual(['88', '92']);
    expect([...tree.nodes.values()].every(n => n.parentId === null)).toBe(true);
  });
  it('mounts an offscreen message using known path order rather than numeric IDs', async () => {
    const list = document.createElement('div'); list.className = 'ds-virtual-list'; document.body.append(list);
    Object.defineProperties(list, { scrollHeight: { value: 1000 }, clientHeight: { value: 100 } });
    const ids = ['99', '7', '31', '2', '81', '15', '44', '3', '96', '22'];
    let jumped = '';
    const render = () => {
      const index = Math.min(ids.length - 1, Math.floor(list.scrollTop / 100));
      const id = ids[index] ?? '';
      const item = document.createElement('div'); item.setAttribute('data-virtual-list-item-key', id);
      item.scrollIntoView = () => { jumped = id; }; list.replaceChildren(item);
    };
    render(); list.addEventListener('scroll', render);
    expect(await jumpToMessage('96', ids, new AbortController().signal)).toBe(true);
    expect(jumped).toBe('96');
  });
  it('does not scroll for an inactive branch or an unknown target', async () => {
    expect(await jumpToMessage('missing', ['known'], new AbortController().signal)).toBe(false);
  });
  it('rejects a mismatched bridge response and supports cancellation', async () => {
    let request: Record<string, string> = {};
    vi.spyOn(window, 'postMessage').mockImplementation((data) => { request = data; });
    const controller = new AbortController(); const promise = requestHistory('chat-id', controller.signal);
    window.dispatchEvent(new MessageEvent('message', { source: window, origin: location.origin, data: { type: 'dse:history-response', requestId: request.requestId, conversationId: 'another-chat', data: {} } }));
    controller.abort(); await expect(promise).rejects.toThrow('Cancelled');
  });
});
