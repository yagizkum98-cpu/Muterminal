import { Head, Html, Main, NextScript, type DocumentProps } from 'next/document';
import { languageFromCookie } from '../lib/language';

export default function Document({ __NEXT_DATA__ }: DocumentProps) {
  const language = __NEXT_DATA__.props.pageProps?.language ?? languageFromCookie();
  return <Html lang={language}>
    <Head>
      <meta name="theme-color" content="#12372d" />
      <link rel="manifest" href="/muterminal.webmanifest" />
      <link rel="apple-touch-icon" href="/muterminal-app-icon.png" />
    </Head>
    <body><Main /><NextScript /></body>
  </Html>;
}
