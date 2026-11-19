import { Head, Html, Main, NextScript, type DocumentProps } from 'next/document';
import { languageFromCookie } from '../lib/language';

export default function Document({ __NEXT_DATA__ }: DocumentProps) {
  const language = __NEXT_DATA__.props.pageProps?.language ?? languageFromCookie();
  return <Html lang={language}>
    <Head>
      <link rel="manifest" href={language === 'en' ? '/mu-mobile-en.webmanifest' : '/mu-mobile.webmanifest'} />
      <link rel="apple-touch-icon" href="/mobil/icon-192.png" />
      <meta name="theme-color" content="#12372d" />
    </Head>
    <body><Main /><NextScript /></body>
  </Html>;
}
