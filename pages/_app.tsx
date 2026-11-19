import type { AppProps } from 'next/app';
import { LanguageProvider } from '../components/LanguagePicker';
import type { Language } from '../lib/language';

export default function App({ Component, pageProps }: AppProps<{ language?: Language }>) {
  return <LanguageProvider initialLanguage={pageProps.language ?? 'tr'}>
    <Component {...pageProps} />
  </LanguageProvider>;
}
