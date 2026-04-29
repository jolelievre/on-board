import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { authClient, updateProfile } from "../lib/auth-client";

export type Theme = "parchment" | "candlelit";

const THEMES: readonly Theme[] = ["parchment", "candlelit"] as const;
const STORAGE_KEY = "ob.theme";
const DEFAULT_THEME: Theme = "parchment";

function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isTheme(stored) ? stored : DEFAULT_THEME;
}

function applyThemeAttribute(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

type ThemeContextValue = {
  theme: Theme;
  setTheme: (next: Theme) => void;
  themes: readonly Theme[];
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());
  const { data: session } = authClient.useSession();

  // Sync attribute on mount + when theme changes (also covers dev HMR).
  useEffect(() => {
    applyThemeAttribute(theme);
  }, [theme]);

  // When a session loads, treat the server value as source of truth on first sync.
  useEffect(() => {
    const sessionUser = session?.user as { theme?: string } | undefined;
    const serverTheme = sessionUser?.theme;
    if (isTheme(serverTheme) && serverTheme !== theme) {
      setThemeState(serverTheme);
      window.localStorage.setItem(STORAGE_KEY, serverTheme);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    applyThemeAttribute(next);
    // Best-effort server sync; don't block the UI on it.
    void updateProfile({ theme: next }).catch(() => {
      /* offline / unauthenticated — local change still applies */
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, themes: THEMES }),
    [theme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return ctx;
}
