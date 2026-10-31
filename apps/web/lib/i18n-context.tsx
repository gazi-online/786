'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { Locale, dictionaries, Translations } from './i18n';

interface I18nContextValue {
  locale: Locale;
  setLocale: (loc: Locale) => void;
  t: Translations;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    // 1. Check local storage preference
    const saved = localStorage.getItem('walletsync_locale') as Locale | null;
    if (saved && ['en', 'bn', 'hi'].includes(saved)) {
      setLocaleState(saved);
      return;
    }

    // 2. Fallback to navigator.language (Amd-5: default from navigator.language -> Bengali fallback)
    if (typeof navigator !== 'undefined' && navigator.language) {
      const lang = navigator.language.toLowerCase();
      if (lang.startsWith('bn')) {
        setLocaleState('bn');
      } else if (lang.startsWith('hi')) {
        setLocaleState('hi');
      } else {
        setLocaleState('en');
      }
    }
  }, []);

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
    if (typeof window !== 'undefined') {
      localStorage.setItem('walletsync_locale', newLocale);
    }
  };

  const t = dictionaries[locale] || dictionaries.en;

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return {
      locale: 'en' as Locale,
      setLocale: () => {},
      t: dictionaries.en,
    };
  }
  return ctx;
}

