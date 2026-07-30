import { useCallback, useEffect, useState } from 'react';

/**
 * Tema chiaro/scuro con tre stati. `system` segue il sistema operativo e continua
 * a seguirlo se l'utente lo cambia mentre l'app è aperta; light e dark lo forzano.
 *
 * La classe `.dark` sull'`<html>` è ciò che accende la variante `dark:` di Tailwind
 * (vedi `@custom-variant` in index.css). Lo script anti-flash in index.html applica
 * la stessa regola prima del primo paint.
 */
export type ThemeChoice = 'light' | 'dark' | 'system';

const KEY = 'hf-theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export function readStoredTheme(): ThemeChoice {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

export function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  return choice === 'system' ? (media().matches ? 'dark' : 'light') : choice;
}

function apply(choice: ThemeChoice): void {
  document.documentElement.classList.toggle('dark', resolveTheme(choice) === 'dark');
}

export function useTheme(): {
  choice: ThemeChoice;
  resolved: 'light' | 'dark';
  setChoice: (c: ThemeChoice) => void;
} {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => readStoredTheme());
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolveTheme(readStoredTheme()));

  useEffect(() => {
    apply(choice);
    setResolved(resolveTheme(choice));
    if (choice !== 'system') return;
    // Solo in `system` l'app resta agganciata al sistema operativo.
    const m = media();
    const onChange = () => {
      apply('system');
      setResolved(resolveTheme('system'));
    };
    m.addEventListener('change', onChange);
    return () => m.removeEventListener('change', onChange);
  }, [choice]);

  const setChoice = useCallback((c: ThemeChoice) => {
    localStorage.setItem(KEY, c);
    setChoiceState(c);
  }, []);

  return { choice, resolved, setChoice };
}
