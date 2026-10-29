'use client';

import React from 'react';
import { I18nProvider } from '@/lib/i18n-context';

export function Providers({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}
