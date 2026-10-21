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

/** One tmux session on the target machine, as listed by `tmux list-sessions`. */
export interface TmuxSessionSummary {
  readonly name: string;
  readonly windows: number;
  readonly attached: number;
  /** Seconds since the Unix epoch; the most recently active session wins. */
  readonly activity: number;
}

/** Machine-level tmux APIs, independent from the attached terminal session. */
export interface TmuxSessionHost {
  listTmuxSessions?(destination?: string): Promise<readonly TmuxSessionSummary[]>;
  killTmuxSession?(destination: string | undefined, session: string): Promise<void>;
}

/** Native terminal APIs used by the in-terminal tmux tab bar. */
export interface TmuxHost {
  getTmuxSessionInfo?(id: number): TmuxSessionInfo | undefined;
  selectTmuxWindow?(id: number, windowId: string): void;
  createTmuxWindow?(id: number): void;
  closeTmuxWindow?(id: number, windowId: string): void;
}
