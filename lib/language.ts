import english from '../public/ui-en.json';

export type Language = 'tr' | 'en';
type Values = Record<string, string | number>;
const dictionary: Record<string, string> = english;

export function languageFromCookie(cookie?: string): Language {
  return /(?:^|;\s*)mu_language=en(?:;|$)/.test(cookie ?? '') ? 'en' : 'tr';
}

export function translate(language: Language, text: string, values?: Values) {
  if (language === 'en' && !Object.hasOwn(dictionary, text)) {
    let match = text.match(/^SKT’ye (\d+) gün$/);
    if (match) return translate(language, 'SKT’ye {days} gün', { days: match[1] });
    match = text.match(/^Sayım farkı ([+-]\d+)$/);
    if (match) return translate(language, 'Sayım farkı {delta}', { delta: match[1] });
    match = text.match(/^(Aynı lot|Onaylandı|Onay bekliyor) · (.+)$/);
    if (match) {
      const field = match[1] === 'Aynı lot' ? 'risk' : 'status';
      return translate(language, `${match[1]} · {${field}}`, { [field]: translate(language, match[2]) });
    }
    match = text.match(/^(.+?) (için geçerli bir değer girin\.|sıfır veya pozitif bir tam sayı olmalıdır\.)$/);
    if (match) return translate(language, `{field} ${match[2]}`, { field: translate(language, match[1]) });
    match = text.match(/^(.+?) (\d+–\d+) karakter olmalıdır\.$/);
    if (match) return translate(language, '{field} {range} karakter olmalıdır.', { field: translate(language, match[1]), range: match[2] });
  }
  const message = language === 'en' && Object.hasOwn(dictionary, text) ? dictionary[text] : text;
  return values ? message.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : placeholder) : message;
}
