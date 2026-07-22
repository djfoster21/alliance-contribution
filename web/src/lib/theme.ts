import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "theme";
const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

// Stored choice, or the OS preference on first load (used once — no ongoing OS follow).
export function getTheme(): Theme {
  const t = localStorage.getItem(KEY);
  if (t === "light" || t === "dark") return t;
  return prefersDark() ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getTheme);

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem(KEY, next);
    setThemeState(next);
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return { theme, setTheme };
}
