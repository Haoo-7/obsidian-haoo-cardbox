function snapshot(doc: unknown): string {
  const value = JSON.stringify(doc);
  if (value === undefined) {
    throw new TypeError("撤销历史只接受能够序列化为 JSON 的内容。");
  }
  return value;
}

/** 以 JSON 快照隔离可变内容，撤销历史不持有调用方的对象引用。 */
export class History {
  private current: string | undefined;
  private readonly undoStack: string[] = [];
  private readonly redoStack: string[] = [];

  /** 限制只作用于可撤销的旧快照，当前状态始终单独保留。 */
  constructor(private readonly limit = 100) {
    if (!Number.isInteger(limit) || limit < 0) {
      throw new RangeError("撤销历史的上限必须是非负整数。");
    }
  }

  /** 相同的快照不记历史，也不会打断已有的重做路径。 */
  commit(doc: unknown): void {
    const next = snapshot(doc);
    if (next === this.current) return;
    if (this.current !== undefined) {
      this.undoStack.push(this.current);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
      this.redoStack.length = 0;
    }
    this.current = next;
  }

  /** 返回独立的上一份内容，并让后续提交以撤销结果为基准。 */
  undo(): unknown | null {
    const previous = this.undoStack.pop();
    if (previous === undefined || this.current === undefined) return null;
    this.redoStack.push(this.current);
    this.current = previous;
    return JSON.parse(previous) as unknown;
  }

  /** 返回独立的下一份内容，并同步当前基准。 */
  redo(): unknown | null {
    const next = this.redoStack.pop();
    if (next === undefined || this.current === undefined) return null;
    this.undoStack.push(this.current);
    this.current = next;
    return JSON.parse(next) as unknown;
  }

  /** 切换画板或重新加载时，旧画板的撤销与重做路径不再适用。 */
  reset(doc: unknown): void {
    const next = snapshot(doc);
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.current = next;
  }

  /** 库里的笔记改名、删除时，所有快照里的路径一起改，撤销回去不会指向已经不在的笔记。 */
  rewrite(fn: (doc: unknown) => unknown): void {
    const map = (s: string) => snapshot(fn(JSON.parse(s) as unknown));
    this.undoStack.splice(0, this.undoStack.length, ...this.undoStack.map(map));
    this.redoStack.splice(0, this.redoStack.length, ...this.redoStack.map(map));
    if (this.current !== undefined) this.current = map(this.current);
  }

  /** 供适配层决定撤销操作是否可用。 */
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** 供适配层决定重做操作是否可用。 */
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
