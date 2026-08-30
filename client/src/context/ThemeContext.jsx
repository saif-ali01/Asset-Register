import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const ThemeContext = createContext(null);
const MODES = ['light', 'dark', 'system'];

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(() => {
    const saved = localStorage.getItem('theme');
    return MODES.includes(saved) ? saved : 'system';
  });

  const apply = useCallback((next) => {
    const dark = next === 'dark' || (next === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  }, []);

  useEffect(() => {
    localStorage.setItem('theme', mode);
    apply(mode);
    if (mode !== 'system') return undefined;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const handler = () => apply('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode, apply]);

  const value = useMemo(() => ({
    mode,
    setMode,
    isDark: document.documentElement.classList.contains('dark'),
    cycle: () => setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length]),
  }), [mode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
