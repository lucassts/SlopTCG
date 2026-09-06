/**
 * Idioma da interface. As chaves são o texto em pt-BR (idioma-fonte do código);
 * `t()` devolve a tradução quando o idioma é en-US e o texto original caso contrário.
 * Textos gerados pela engine (prompts de escolha, rótulos de habilidade) ainda chegam em pt-BR.
 */
import { useSyncExternalStore } from 'react';
import { EN_APP } from './i18n/en-app';
import { EN_GAMEBOARD } from './i18n/en-gameboard';
import { EN_HOME } from './i18n/en-home';
import { EN_LOBBY } from './i18n/en-lobby';
import { EN_LOGTEXT } from './i18n/en-logtext';
import { EN_SIDEBOARD } from './i18n/en-sideboard';

export type Lang = 'pt-BR' | 'en-US';
const STORAGE_KEY = 'sloptcg-lang';
const EN: Record<string, string> = { ...EN_APP, ...EN_GAMEBOARD, ...EN_HOME, ...EN_LOBBY, ...EN_LOGTEXT, ...EN_SIDEBOARD };

function loadLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'en-US' || v === 'pt-BR') return v;
    return navigator.language?.toLowerCase().startsWith('pt') ? 'pt-BR' : 'pt-BR';
  } catch { return 'pt-BR'; }
}
let current: Lang = loadLang();
const listeners = new Set<() => void>();

export function getLang(): Lang { return current; }
export function setLang(l: Lang): void {
  current = l;
  try { localStorage.setItem(STORAGE_KEY, l); } catch { /* sem storage */ }
  for (const f of listeners) f();
}
/** Hook: re-renderiza o componente quando o idioma muda. */
export function useLang(): [Lang, (l: Lang) => void] {
  const lang = useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => current);
  return [lang, setLang];
}
/** Traduz um texto pt-BR; `{nome}` é substituído pelas variáveis. */
export function t(pt: string, vars?: Record<string, string | number>): string {
  const base = current === 'en-US' ? (EN[pt] ?? pt) : pt;
  return vars ? base.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : base;
}
