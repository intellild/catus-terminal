export const tabKinds = ['shell', 'tmux', 'sftp'] as const;
export type TabKind = (typeof tabKinds)[number];
