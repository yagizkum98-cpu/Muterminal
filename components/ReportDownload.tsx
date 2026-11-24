import { useState } from 'react';
import { useLanguage, useTranslate } from './LanguagePicker';
import { coreReport, type CoreReportData, type Report } from '../lib/report-data';
import type { ReportFormat } from '../lib/report-file';
import type { Language } from '../lib/language';
import styles from './ReportDownload.module.css';

type Props = { core: CoreReportData['kind']; getReport?: never } | { core?: never; getReport: (language: Language) => Report };
const downloads = [
  { format: 'pdf', label: 'PDF indir' },
  { format: 'xlsx', label: 'Excel indir' },
  { format: 'json', label: 'JSON indir' },
] as const;

export default function ReportDownload({ core, getReport }: Props) {
  const panelLanguage = useLanguage();
  const t = useTranslate();
  const [selectedLanguage, setSelectedLanguage] = useState<Language>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const language = selectedLanguage ?? panelLanguage;

  async function download(format: ReportFormat, button: HTMLButtonElement) {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      let report: Report;
      if (getReport) {
        report = getReport(language);
      } else {
        const detail: { kind: typeof core; data: CoreReportData | null } = { kind: core, data: null };
        button.dispatchEvent(new CustomEvent('muterminal:report-data', { bubbles: true, detail }));
        if (!detail.data) throw new Error('Missing report data');
        report = coreReport(detail.data, language);
      }
      const { createReportFile } = await import('../lib/report-file');
      const blob = await createReportFile(report, format);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${report.fileName}.${format}`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return <div className={styles.download}>
    <fieldset className={styles.fields} id={core ? `report-export-${core}` : undefined} disabled={Boolean(core)}>
      <label>{t('Rapor dili')}
        <select value={language} onChange={event => setSelectedLanguage(event.target.value as Language)}>
          <option value="tr" lang="tr">Türkçe</option>
          <option value="en" lang="en">English</option>
        </select>
      </label>
      <div className={styles.actions}>
        {downloads.map(({ format, label }) => <button key={format} type="button" disabled={busy}
          onClick={event => void download(format, event.currentTarget)}>{t(label)}</button>)}
      </div>
    </fieldset>
    {busy && <p role="status">{t('Rapor hazırlanıyor…')}</p>}
    {error && <p className={styles.error} role="alert">{t('Rapor indirilemedi. Lütfen yeniden deneyin.')}</p>}
  </div>;
}
