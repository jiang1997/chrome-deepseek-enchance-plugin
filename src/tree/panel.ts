import styles from './tree.css?inline';
import { activePath, layoutTree, type ChatTree } from './model';
import { conversationId, jumpToMessage, messageItems, renderedTree } from './deepseek';
import { conversationHistory } from './history-service';
import { MESSAGE_ITEM_ATTR } from '../core/message-context';

const NS = 'http://www.w3.org/2000/svg';
const ICON = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 6v4m-7 5v-5h14v5" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="4" r="2" stroke="currentColor" stroke-width="1.5"/><circle cx="5" cy="18" r="2" stroke="currentColor" stroke-width="1.5"/><circle cx="19" cy="18" r="2" stroke="currentColor" stroke-width="1.5"/></svg>';
export class TreePanel {
  private host = document.createElement('div');
  private shadow = this.host.attachShadow({ mode: 'open' });
  private open = false;
  private tree: ChatTree = { nodes: new Map(), roots: [], currentId: null, complete: false };
  private path = location.pathname;
  private controller: AbortController | null = null;
  private jumpController: AbortController | null = null;
  private timer: number;
  private observer: MutationObserver;
  private scrollFrame: number | null = null;
  private selected: string | null = null;
  private viewing: string | null = null;
  private destroyed = false;
  private themeQuery = window.matchMedia('(prefers-color-scheme: dark)');

  constructor() {
    this.host.setAttribute('data-dse-tree', '');
    this.host.style.cssText = 'position:fixed;z-index:2147482999;top:0;right:0;width:0;height:0;';
    const style = document.createElement('style'); style.textContent = styles;
    this.shadow.append(style);
    const root = document.createElement('div');
    root.setAttribute('data-dse-tree', '');
    root.innerHTML = `<button class="toggle" type="button" aria-expanded="false" aria-controls="tree-panel">${ICON}Conversation tree</button>
      <section class="panel" id="tree-panel" aria-label="Conversation tree" hidden>
        <header><div class="title-row"><h2>Conversation tree</h2><div class="tools"><button class="icon-button refresh" type="button" aria-label="Refresh conversation tree" title="Refresh">↻</button><button class="icon-button close" type="button" aria-label="Close conversation tree">×</button></div></div>
          <input type="search" placeholder="Search messages…" aria-label="Search conversation messages"><div class="legend"><span>You</span><span>DeepSeek</span><span>Other branches</span></div></header>
        <p class="status" role="status" aria-live="polite"></p><div class="viewport"><div class="drawing"></div></div>
        <div class="preview" hidden><div class="preview-label"></div><p class="preview-text"></p></div>
        <footer><span class="count"></span><span>Hover to preview · Click to jump</span></footer>
      </section>`;
    this.shadow.append(root); document.body.append(this.host);
    this.el<HTMLButtonElement>('.toggle').onclick = () => this.setOpen(true);
    this.el<HTMLButtonElement>('.close').onclick = () => this.setOpen(false);
    this.el<HTMLButtonElement>('.refresh').onclick = () => void this.refresh(false, true);
    this.el<HTMLInputElement>('input').oninput = () => this.render();
    this.shadow.addEventListener('keydown', this.onKey);
    window.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    this.themeQuery.addEventListener('change', this.syncTheme);
    this.observer = new MutationObserver(() => {
      this.syncTheme();
      this.checkNavigation();
      if (this.open) this.onScroll();
    });
    this.observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'data-theme'] });
    this.timer = window.setInterval(() => {
      this.checkNavigation();
      if (this.open && !document.hidden && !this.controller) void this.refresh(true);
    }, 15000);
    window.addEventListener('popstate', this.checkNavigation);
    this.syncTheme();
  }

  private el<T extends Element = HTMLElement>(selector: string): T { return this.shadow.querySelector<T>(selector)!; }
  private status(text: string): void { this.el('.status').textContent = text; }
  private syncTheme = (): void => {
    const explicit = [document.documentElement, document.body].map(el => el.getAttribute('data-theme') || (el.classList.contains('dark') ? 'dark' : el.classList.contains('light') ? 'light' : '')).find(Boolean);
    const theme = explicit || (this.themeQuery.matches ? 'dark' : 'light');
    if (this.host.dataset.theme !== theme) this.host.dataset.theme = theme;
  };
  private onKey = (e: Event): void => {
    if ((e as KeyboardEvent).key === 'Escape' && this.open) { e.stopPropagation(); this.setOpen(false); }
  };
  private checkNavigation = (): void => {
    if (this.path === location.pathname) return;
    this.path = location.pathname; this.controller?.abort(); this.controller = null;
    conversationHistory.syncConversation(conversationId());
    this.jumpController?.abort(); this.selected = this.viewing = null;
    this.tree = { nodes: new Map(), roots: [], currentId: null, complete: false };
    this.el<HTMLInputElement>('input').value = ''; this.el('.preview').hidden = true;
    if (this.open) { this.render(); void this.refresh(); }
  };
  private setOpen(open: boolean): void {
    this.open = open;
    this.el('.panel').hidden = !open; this.el('.toggle').hidden = open;
    this.el('.toggle').setAttribute('aria-expanded', String(open));
    if (open) { this.el<HTMLInputElement>('input').focus(); void this.refresh(); }
    else { this.controller?.abort(); this.controller = null; this.jumpController?.abort(); this.el<HTMLButtonElement>('.toggle').focus(); }
  }
  private async refresh(quiet = false, force = false): Promise<void> {
    if (this.controller || !this.open) return;
    const controller = new AbortController(); this.controller = controller;
    const path = location.pathname;
    if (!quiet) this.status('Loading conversation…');
    try {
      const id = conversationId();
      if (!id) {
        this.tree = renderedTree();
        this.status(this.tree.nodes.size ? 'Rendered messages only; branch relationships are unknown.' : 'Open a DeepSeek conversation to view its message tree.');
      } else {
        const tree = await conversationHistory.get(id, controller.signal, { force: quiet || force });
        if (controller.signal.aborted || location.pathname !== path) return;
        this.tree = tree;
        this.status('Full conversation tree · Gray nodes preview other branches');
      }
      this.render(); this.trackReading();
    } catch (error) {
      if (controller.signal.aborted || location.pathname !== path) return;
      if (!this.tree.complete) this.tree = renderedTree();
      this.status(this.tree.complete ? 'Refresh failed. Showing the previously loaded tree.' : error instanceof Error ? error.message : 'Could not load history. Showing rendered messages.');
      this.render();
    } finally { if (this.controller === controller) this.controller = null; }
  }
  private render(): void {
    const drawing = this.el('.drawing'); drawing.replaceChildren();
    const query = this.el<HTMLInputElement>('input').value.trim().toLocaleLowerCase();
    let hits = 0;
    const layout = layoutTree(this.tree); const active = new Set(activePath(this.tree));
    const svg = document.createElementNS(NS, 'svg'); svg.classList.add('tree');
    svg.setAttribute('width', String(layout.width)); svg.setAttribute('height', String(layout.height));
    svg.setAttribute('role', 'group'); svg.setAttribute('aria-label', 'Conversation branch tree');
    for (const node of this.tree.nodes.values()) {
      const point = layout.points.get(node.id); if (!point) continue;
      const parent = node.parentId ? layout.points.get(node.parentId) : null;
      if (parent) {
        const line = document.createElementNS(NS, 'path'); const middle = (point.y + parent.y) / 2;
        line.setAttribute('d', `M${parent.x},${parent.y} C${parent.x},${middle} ${point.x},${middle} ${point.x},${point.y}`);
        line.setAttribute('class', `edge ${active.has(node.id) && active.has(node.parentId!) ? 'active' : ''}`); svg.append(line);
      }
    }
    for (const node of this.tree.nodes.values()) {
      const point = layout.points.get(node.id); if (!point) continue;
      const match = !!query && node.content.toLocaleLowerCase().includes(query); if (match) hits++;
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('transform', `translate(${point.x},${point.y})`);
      g.setAttribute('class', `node ${node.role} ${active.has(node.id) || !this.tree.complete ? 'active' : ''} ${match ? 'match' : ''} ${this.viewing === node.id ? 'viewing' : ''}`);
      g.dataset.id = node.id; g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button');
      g.setAttribute('aria-label', `${node.role === 'user' ? 'You' : 'DeepSeek'}: ${node.content.slice(0, 100)}`);
      for (const [radius, cls] of [[20, 'hit'], [10, 'ring'], [5, 'dot']] as const) {
        const circle = document.createElementNS(NS, 'circle'); circle.setAttribute('r', String(radius)); circle.setAttribute('class', cls); g.append(circle);
      }
      const text = document.createElementNS(NS, 'text'); text.setAttribute('x', '12'); text.setAttribute('y', '4'); text.textContent = node.role === 'user' ? 'You' : 'AI'; g.append(text);
      g.addEventListener('mouseenter', () => this.preview(node.id)); g.addEventListener('focus', () => this.preview(node.id));
      g.addEventListener('click', () => { this.preview(node.id); void this.jump(node.id); });
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.preview(node.id); void this.jump(node.id); } });
      svg.append(g);
    }
    if (this.tree.nodes.size) drawing.append(svg);
    else { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'Messages and conversation branches will appear here.'; drawing.append(empty); }
    this.el('.count').textContent = query ? `${hits} matches / ${this.tree.nodes.size} messages` : `${this.tree.nodes.size} messages`;
    if (this.selected && this.tree.nodes.has(this.selected)) this.preview(this.selected);
    else this.el('.preview').hidden = true;
  }
  private preview(id: string): void {
    const node = this.tree.nodes.get(id); if (!node) return;
    this.selected = id; this.el('.preview').hidden = false;
    const accessible = activePath(this.tree).includes(id) || messageItems().some(e => e.getAttribute(MESSAGE_ITEM_ATTR) === id);
    this.el('.preview-label').textContent = `${node.role === 'user' ? 'Your message' : 'DeepSeek response'}${accessible ? '' : ' · Other branches'}`;
    this.el('.preview-text').textContent = node.content || 'Message is being generated…';
  }
  private async jump(id: string): Promise<void> {
    if (!this.tree.nodes.has(id)) return;
    if (!activePath(this.tree).includes(id) && !messageItems().some(e => e.getAttribute(MESSAGE_ITEM_ATTR) === id)) return;
    this.jumpController?.abort(); const controller = new AbortController(); this.jumpController = controller;
    this.status('Locating message…');
    const ok = await jumpToMessage(id, activePath(this.tree), controller.signal);
    if (!controller.signal.aborted && !this.destroyed) this.status(ok ? 'Message located' : 'Could not locate this message. Scroll the page and try again.');
  }
  private onScroll = (): void => {
    if (!this.open || this.scrollFrame !== null) return;
    this.scrollFrame = requestAnimationFrame(() => { this.scrollFrame = null; this.trackReading(); });
  };
  private trackReading(): void {
    const items = messageItems(); const center = innerHeight * .4;
    const visible = items.filter(el => { const rect = el.getBoundingClientRect(); return rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight; });
    const item = visible.sort((a, b) => Math.abs(a.getBoundingClientRect().top - center) - Math.abs(b.getBoundingClientRect().top - center))[0];
    this.viewing = item?.getAttribute(MESSAGE_ITEM_ATTR) ?? null;
    for (const g of this.shadow.querySelectorAll<SVGGElement>('.node')) g.classList.toggle('viewing', g.dataset.id === this.viewing);
  }
  destroy(): void {
    this.destroyed = true; this.controller?.abort(); this.jumpController?.abort();
    clearInterval(this.timer); this.observer.disconnect();
    if (this.scrollFrame !== null) cancelAnimationFrame(this.scrollFrame);
    window.removeEventListener('scroll', this.onScroll, { capture: true });
    window.removeEventListener('popstate', this.checkNavigation);
    this.themeQuery.removeEventListener('change', this.syncTheme); this.host.remove();
  }
}
let panel: TreePanel | null = null;
export function initTree(): void { if (!panel && !document.querySelector('[data-dse-tree]')) panel = new TreePanel(); }
export function destroyTree(): void { panel?.destroy(); panel = null; }
