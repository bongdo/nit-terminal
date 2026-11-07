import type { ITheme } from "@xterm/xterm";

export type Mode = "light" | "dark";
export type PaletteId = "pero" | "solarized";

export type Prefs = {
  mode: Mode;
  palette: PaletteId;
  fontSize: number;
};

export const paletteLabels: Record<PaletteId, string> = {
  pero: "pero",
  solarized: "solarized",
};

const peroLight: ITheme = {
  background: "#faf9f7",
  foreground: "#26241f",
  cursor: "#c65d3b",
  cursorAccent: "#faf9f7",
  selectionBackground: "#f0d9cd",
  black: "#26241f",
  red: "#b3362f",
  green: "#4f7a3a",
  yellow: "#9a6b1f",
  blue: "#3d6b96",
  magenta: "#8a4f7d",
  cyan: "#2f7d7a",
  white: "#d9d4ca",
  brightBlack: "#726d64",
  brightRed: "#c94c42",
  brightGreen: "#5f8f45",
  brightYellow: "#b08028",
  brightBlue: "#4b7fae",
  brightMagenta: "#a46394",
  brightCyan: "#379491",
  brightWhite: "#fffdf9",
};

const peroDark: ITheme = {
  background: "#141413",
  foreground: "#f1efe9",
  cursor: "#e07a4f",
  cursorAccent: "#141413",
  selectionBackground: "#3b2b23",
  black: "#26241f",
  red: "#e07a6a",
  green: "#9ec27a",
  yellow: "#e3c07a",
  blue: "#8ab4d8",
  magenta: "#d79ac8",
  cyan: "#7fd1cd",
  white: "#d9d4ca",
  brightBlack: "#726d64",
  brightRed: "#f09585",
  brightGreen: "#b5d694",
  brightYellow: "#f0d192",
  brightBlue: "#a4c8e8",
  brightMagenta: "#e8b3da",
  brightCyan: "#9ce4e0",
  brightWhite: "#fffdf9",
};

const solarizedLight: ITheme = {
  background: "#fdf6e3",
  foreground: "#586e75",
  cursor: "#b58900",
  cursorAccent: "#fdf6e3",
  selectionBackground: "#eee8d5",
  black: "#073642",
  red: "#dc322f",
  green: "#859900",
  yellow: "#b58900",
  blue: "#268bd2",
  magenta: "#d33682",
  cyan: "#2aa198",
  white: "#eee8d5",
  brightBlack: "#002b36",
  brightRed: "#cb4b16",
  brightGreen: "#586e75",
  brightYellow: "#657b83",
  brightBlue: "#839496",
  brightMagenta: "#6c71c4",
  brightCyan: "#93a1a1",
  brightWhite: "#fdf6e3",
};

const solarizedDark: ITheme = {
  background: "#002b36",
  foreground: "#93a1a1",
  cursor: "#b58900",
  cursorAccent: "#002b36",
  selectionBackground: "#073642",
  black: "#073642",
  red: "#dc322f",
  green: "#859900",
  yellow: "#b58900",
  blue: "#268bd2",
  magenta: "#d33682",
  cyan: "#2aa198",
  white: "#eee8d5",
  brightBlack: "#586e75",
  brightRed: "#cb4b16",
  brightGreen: "#586e75",
  brightYellow: "#657b83",
  brightBlue: "#839496",
  brightMagenta: "#6c71c4",
  brightCyan: "#93a1a1",
  brightWhite: "#fdf6e3",
};

const themes: Record<PaletteId, Record<Mode, ITheme>> = {
  pero: { light: peroLight, dark: peroDark },
  solarized: { light: solarizedLight, dark: solarizedDark },
};

export function themeFor(prefs: Prefs): ITheme {
  return themes[prefs.palette][prefs.mode];
}

export function loadPrefs(): Prefs {
  const mode = localStorage.getItem("term-theme");
  const palette = localStorage.getItem("term-palette");
  const fontSize = Number.parseInt(localStorage.getItem("term-font") ?? "", 10);
  return {
    mode: mode === "light" || mode === "dark" ? mode : prefersDark() ? "dark" : "light",
    palette: palette === "solarized" || palette === "pero" ? palette : "pero",
    fontSize: Number.isFinite(fontSize) && fontSize >= 9 && fontSize <= 28 ? fontSize : 14,
  };
}

export function savePrefs(prefs: Prefs): void {
  localStorage.setItem("term-theme", prefs.mode);
  localStorage.setItem("term-palette", prefs.palette);
  localStorage.setItem("term-font", String(prefs.fontSize));
}

function prefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}
