/**
 * Undo/redo for editor snapshots. Rapid edits sharing a `key` (typing in the
 * same block) coalesce into one step so undo doesn't go letter by letter.
 */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private lastKey: string | null = null;
  private lastAt = 0;

  constructor(
    private readonly limit = 100,
    private readonly coalesceMs = 800,
  ) {}

  /** Record `before`, the state that is about to be replaced. */
  record(before: T, key: string | null = null, now = Date.now()) {
    const continuing =
      key !== null && key === this.lastKey && now - this.lastAt < this.coalesceMs;
    this.lastKey = key;
    this.lastAt = now;
    this.future = [];
    if (continuing) return;
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  undo(current: T): T | undefined {
    const previous = this.past.pop();
    if (previous === undefined) return undefined;
    this.future.unshift(current);
    this.lastKey = null;
    return previous;
  }

  redo(current: T): T | undefined {
    const next = this.future.shift();
    if (next === undefined) return undefined;
    this.past.push(current);
    this.lastKey = null;
    return next;
  }

  reset() {
    this.past = [];
    this.future = [];
    this.lastKey = null;
  }
}
