import type { ITheme } from "@xterm/xterm";

export type ThemeId =
  | "pero"
  | "pero-light"
  | "solarized"
  | "solarized-light"
  | "nord"
  | "gruvbox"
  | "dracula"
  | "tokyo-night"
  | "catppuccin"
  | "latte"
  | "one-dark"
  | "paper"
  | "ember";

export type Prefs = {
  theme: ThemeId;
  fontSize: number;
};

type Ansi = [
  black: string,
  red: string,
  green: string,
  yellow: string,
  blue: string,
  magenta: string,
  cyan: string,
  white: string,
  brightBlack: string,
  brightRed: string,
  brightGreen: string,
  brightYellow: string,
  brightBlue: string,
  brightMagenta: string,
  brightCyan: string,
  brightWhite: string,
];

export type Theme = {
  id: ThemeId;
  label: string;
  dark: boolean;
  terminal: ITheme;
};

function terminal(background: string, foreground: string, cursor: string, selectionBackground: string, ansi: Ansi): ITheme {
  const [black, red, green, yellow, blue, magenta, cyan, white] = ansi;
  const [brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite] = ansi.slice(8);
  return {
    background,
    foreground,
    cursor,
    cursorAccent: background,
    selectionBackground,
    black,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white,
    brightBlack,
    brightRed,
    brightGreen,
    brightYellow,
    brightBlue,
    brightMagenta,
    brightCyan,
    brightWhite,
  };
}

export const themes: Theme[] = [
  {
    id: "pero",
    label: "Pero",
    dark: true,
    terminal: terminal("#141413", "#f1efe9", "#e07a4f", "#3b2b23", [
      "#26241f", "#e07a6a", "#9ec27a", "#e3c07a", "#8ab4d8", "#d79ac8", "#7fd1cd", "#d9d4ca",
      "#726d64", "#f09585", "#b5d694", "#f0d192", "#a4c8e8", "#e8b3da", "#9ce4e0", "#fffdf9",
    ]),
  },
  {
    id: "pero-light",
    label: "Pero Light",
    dark: false,
    terminal: terminal("#faf9f7", "#26241f", "#c65d3b", "#f0d9cd", [
      "#26241f", "#b3362f", "#4f7a3a", "#9a6b1f", "#3d6b96", "#8a4f7d", "#2f7d7a", "#d9d4ca",
      "#726d64", "#c94c42", "#5f8f45", "#b08028", "#4b7fae", "#a46394", "#379491", "#fffdf9",
    ]),
  },
  {
    id: "solarized",
    label: "Solarized Dark",
    dark: true,
    terminal: terminal("#002b36", "#93a1a1", "#b58900", "#073642", [
      "#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5",
      "#586e75", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3",
    ]),
  },
  {
    id: "solarized-light",
    label: "Solarized Light",
    dark: false,
    terminal: terminal("#fdf6e3", "#586e75", "#b58900", "#eee8d5", [
      "#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5",
      "#002b36", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3",
    ]),
  },
  {
    id: "nord",
    label: "Nord",
    dark: true,
    terminal: terminal("#2e3440", "#d8dee9", "#d8dee9", "#434c5e", [
      "#3b4252", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#88c0d0", "#e5e9f0",
      "#4c566a", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#8fbcbb", "#eceff4",
    ]),
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    dark: true,
    terminal: terminal("#282828", "#ebdbb2", "#ebdbb2", "#504945", [
      "#282828", "#cc241d", "#98971a", "#d79921", "#458588", "#b16286", "#689d6a", "#a89984",
      "#928374", "#fb4934", "#b8bb26", "#fabd2f", "#83a598", "#d3869b", "#8ec07c", "#ebdbb2",
    ]),
  },
  {
    id: "dracula",
    label: "Dracula",
    dark: true,
    terminal: terminal("#282a36", "#f8f8f2", "#f8f8f2", "#44475a", [
      "#21222c", "#ff5555", "#50fa7b", "#f1fa8c", "#bd93f9", "#ff79c6", "#8be9fd", "#f8f8f2",
      "#6272a4", "#ff6e6e", "#69ff94", "#ffffa5", "#d6acff", "#ff92df", "#a4ffff", "#ffffff",
    ]),
  },
  {
    id: "tokyo-night",
    label: "Tokyo Night",
    dark: true,
    terminal: terminal("#1a1b26", "#c0caf5", "#c0caf5", "#33467c", [
      "#15161e", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#a9b1d6",
      "#414868", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#c0caf5",
    ]),
  },
  {
    id: "catppuccin",
    label: "Catppuccin Mocha",
    dark: true,
    terminal: terminal("#1e1e2e", "#cdd6f4", "#f5e0dc", "#585b70", [
      "#45475a", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7", "#94e2d5", "#bac2de",
      "#585b70", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7", "#94e2d5", "#a6adc8",
    ]),
  },
  {
    id: "latte",
    label: "Catppuccin Latte",
    dark: false,
    terminal: terminal("#eff1f5", "#4c4f69", "#dc8a78", "#ccd0da", [
      "#5c5f77", "#d20f39", "#40a02b", "#df8e1d", "#1e66f5", "#ea76cb", "#179299", "#acb0be",
      "#6c6f85", "#d20f39", "#40a02b", "#df8e1d", "#1e66f5", "#ea76cb", "#179299", "#bcc0cc",
    ]),
  },
  {
    id: "one-dark",
    label: "One Dark",
    dark: true,
    terminal: terminal("#282c34", "#abb2bf", "#528bff", "#3e4451", [
      "#282c34", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#abb2bf",
      "#5c6370", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#ffffff",
    ]),
  },
  {
    id: "paper",
    label: "Paper",
    dark: false,
    terminal: terminal("#f7f3ea", "#2f2a24", "#7a5c3e", "#e6dccb", [
      "#2f2a24", "#b4472f", "#4f7a4a", "#b98515", "#3f739c", "#8a4f7d", "#2f7d7a", "#d9d4ca",
      "#766c60", "#c2703a", "#5f8f45", "#9a7412", "#6d9cc0", "#a46394", "#379491", "#fffdf8",
    ]),
  },
  {
    id: "ember",
    label: "Ember",
    dark: true,
    terminal: terminal("#1c1714", "#f0e3d6", "#e8794a", "#352921", [
      "#2a221d", "#e05545", "#7fbf7a", "#e8c06a", "#7aa2c8", "#d79ac8", "#7fd1cd", "#f0e3d6",
      "#b09a8a", "#ff7860", "#9bdb94", "#ffd982", "#9bc0e4", "#e8b3da", "#9ce4e0", "#fff6ee",
    ]),
  },
];

const byId = new Map(themes.map((theme) => [theme.id, theme]));

export function themeById(id: ThemeId): Theme {
  return byId.get(id) ?? themes[0];
}

export function themeFor(prefs: Prefs): ITheme {
  return themeById(prefs.theme).terminal;
}

export function themeIsDark(prefs: Prefs): boolean {
  return themeById(prefs.theme).dark;
}

export function loadPrefs(): Prefs {
  const stored = localStorage.getItem("term-theme");
  const legacyPalette = localStorage.getItem("term-palette");
  const fontSize = Number.parseInt(localStorage.getItem("term-font") ?? "", 10);
  return {
    theme: isThemeId(stored) ? stored : migrate(stored, legacyPalette),
    fontSize: Number.isFinite(fontSize) && fontSize >= 9 && fontSize <= 28 ? fontSize : 14,
  };
}

export function savePrefs(prefs: Prefs): void {
  localStorage.setItem("term-theme", prefs.theme);
  localStorage.setItem("term-font", String(prefs.fontSize));
  localStorage.removeItem("term-palette");
}

function isThemeId(value: string | null): value is ThemeId {
  return value !== null && byId.has(value as ThemeId);
}

function migrate(value: string | null, legacyPalette: string | null): ThemeId {
  const solarized = legacyPalette === "solarized";
  if (value === "light") return solarized ? "solarized-light" : "pero-light";
  if (value === "dark") return solarized ? "solarized" : "pero";
  return prefersDark() ? "pero" : "pero-light";
}

function prefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}
