import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { es as appEs, en as appEn } from './app';
import { es as playersEs, en as playersEn } from './players';
import { es as modalsEs, en as modalsEn } from './modals';

export type Lang = 'es' | 'en';

const STORAGE_KEY = 'rulo_lang';

const dictionaries: Record<Lang, Record<string, string>> = {
  es: { ...appEs, ...playersEs, ...modalsEs },
  en: { ...appEn, ...playersEn, ...modalsEn },
};

function detectInitialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'es' || saved === 'en') {
      return saved;
    }
  } catch {
    // ignore storage access issues
  }
  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language.toLowerCase().startsWith('en') ? 'en' : 'es';
  }
  return 'es';
}

export interface I18nContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Lang>(detectInitialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore
    }
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      let text = dictionaries[lang][key] ?? dictionaries.es[key] ?? key;
      if (vars) {
        for (const [varKey, value] of Object.entries(vars)) {
          text = text.replace(new RegExp(`\\{${varKey}\\}`, 'g'), String(value));
        }
      }
      return text;
    },
    [lang]
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within a LanguageProvider');
  }
  return ctx;
}

export const LanguageToggle: React.FC = () => {
  const { lang, setLang, t } = useI18n();

  return (
    <div className="lang-toggle" role="group" aria-label={t('lang.toggleLabel')}>
      <button
        type="button"
        className={`lang-toggle-btn ${lang === 'es' ? 'active' : ''}`}
        onClick={() => setLang('es')}
        aria-pressed={lang === 'es'}
        title={t('lang.esTitle')}
      >
        ES
      </button>
      <button
        type="button"
        className={`lang-toggle-btn ${lang === 'en' ? 'active' : ''}`}
        onClick={() => setLang('en')}
        aria-pressed={lang === 'en'}
        title={t('lang.enTitle')}
      >
        EN
      </button>
    </div>
  );
};
