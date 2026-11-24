import { createContext, useContext, useState, type ReactNode } from 'react';
import { translate, type Language } from '../lib/language';
import styles from './LanguagePicker.module.css';

const LanguageContext = createContext<{ language: Language; setLanguage: (language: Language) => void }>({
  language: 'tr', setLanguage: () => {},
});

export function LanguageProvider({ initialLanguage, children }: { initialLanguage: Language; children: ReactNode }) {
  const [language, setLanguage] = useState(initialLanguage);
  return <LanguageContext.Provider value={{ language, setLanguage }}>{children}</LanguageContext.Provider>;
}

export const useLanguage = () => useContext(LanguageContext).language;

export function useTranslate() {
  const language = useLanguage();
  return (text: string, values?: Record<string, string | number>) => translate(language, text, values);
}

export default function LanguagePicker() {
  const { language, setLanguage } = useContext(LanguageContext);
  const t = useTranslate();
  function choose(next: Language) {
    if (next === language) return;
    document.cookie = `mu_language=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    if (document.getElementById('panel-role')) {
      location.reload();
      return;
    }
    document.documentElement.lang = next;
    setLanguage(next);
  }
  return <div className={styles.picker} role="group" aria-label={t('Dil')}>
    <button type="button" aria-label="Türkçe" aria-pressed={language === 'tr'} onClick={() => choose('tr')}>TR</button>
    <button type="button" aria-label="English" aria-pressed={language === 'en'} onClick={() => choose('en')}>EN</button>
  </div>;
}
