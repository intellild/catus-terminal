export interface TmuxWindowInfo {
  /** Stable tmux window ID such as `@2`. */
  readonly id: string;
  /** Zero-based tmux window index shown in the title bar. */
  readonly index: number;
  readonly name: string;
  readonly active: boolean;
}

export interface TmuxSessionInfo {
  readonly windows: readonly TmuxWindowInfo[];
  readonly activeWindowId?: string;
}

/** Native terminal APIs used by the in-terminal tmux tab bar. */
export interface TmuxHost {
  getTmuxSessionInfo?(id: number): TmuxSessionInfo | undefined;
  selectTmuxWindow?(id: number, windowId: string): void;
  createTmuxWindow?(id: number): void;
  closeTmuxWindow?(id: number, windowId: string): void;
}
