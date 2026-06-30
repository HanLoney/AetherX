export interface TodoItem {
  id: string;
  text: string;
  startAt: number;
  endAt: number;
  completed: boolean;
  createdAt: number;
}

export type TodoFilter = "all" | "active" | "completed";

export type ThemeName =
  | "blossom"
  | "mint"
  | "sunset"
  | "lavender"
  | "midnight";

export interface Appearance {
  theme: ThemeName;
  dim: number;
  blur: number;
  headline: string;
  background: string;
}
