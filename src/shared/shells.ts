export interface ShellOption {
  readonly value: string;
  readonly label: string;
}
export interface ShellHost {
  listShells(destination?: string): Promise<readonly ShellOption[]>;
}
