import { requestHistory } from './deepseek';
import { parseHistory, type ChatTree } from './model';

const CACHE_MS = 15000;
type Flight = { controller: AbortController; users: Set<symbol>; promise: Promise<ChatTree> };

/** One in-memory history cache and request shared by quoting and the tree panel. */
export class ConversationHistory {
  private id: string | null = null;
  private cached: { tree: ChatTree; time: number } | null = null;
  private flight: Flight | null = null;
  private generation = 0;

  constructor(private load = requestHistory) {}

  clear(): void {
    this.generation++;
    this.flight?.controller.abort();
    this.flight = null;
    this.cached = null;
    this.id = null;
  }

  syncConversation(id: string | null): void {
    if (this.id !== id) { this.clear(); this.id = id; }
  }

  get(id: string, signal: AbortSignal, options: { force?: boolean; messageId?: string } = {}): Promise<ChatTree> {
    if (signal.aborted) return Promise.reject(new Error('Cancelled'));
    this.syncConversation(id);
    const cache = this.cached;
    if (!options.force && cache && Date.now() - cache.time < CACHE_MS &&
        (!options.messageId || cache.tree.nodes.has(options.messageId))) {
      return Promise.resolve().then(() => {
        if (signal.aborted) throw new Error('Cancelled');
        return cache.tree;
      });
    }
    if (!this.flight) {
      const controller = new AbortController();
      const generation = this.generation;
      const promise = this.load(id, controller.signal).then(raw => {
        if (controller.signal.aborted || generation !== this.generation) throw new Error('Cancelled');
        const tree = parseHistory(raw);
        this.cached = { tree, time: Date.now() };
        return tree;
      }).finally(() => { if (this.flight === flight) this.flight = null; });
      const flight: Flight = { controller, users: new Set(), promise };
      this.flight = flight;
    }
    const flight = this.flight;
    const user = Symbol(); flight.users.add(user);
    return new Promise((resolve, reject) => {
      const release = () => {
        signal.removeEventListener('abort', abort);
        flight.users.delete(user);
      };
      const abort = () => {
        release();
        if (!flight.users.size) {
          flight.controller.abort();
          if (this.flight === flight) this.flight = null;
        }
        reject(new Error('Cancelled'));
      };
      signal.addEventListener('abort', abort, { once: true });
      flight.promise.then(tree => {
        release();
        if (signal.aborted) reject(new Error('Cancelled')); else resolve(tree);
      }, error => { release(); reject(error); });
    });
  }
}

export const conversationHistory = new ConversationHistory();
