import type { ReactNode } from 'react';
import type { ReportCell, ReportSection } from '../lib/report-data';
import { useLanguage, useTranslate } from './LanguagePicker';
import styles from './ReportTable.module.css';

interface Props {
  section: ReportSection;
  labelledBy: string;
  renderCell?: (value: ReportCell, column: string, row: number) => ReactNode;
}

export default function ReportTable({ section, labelledBy, renderCell }: Props) {
  const t = useTranslate();
  const locale = useLanguage() === 'tr' ? 'tr-TR' : 'en-GB';
  const number = new Intl.NumberFormat(locale);

  return <>
    <p className={styles.count}>{t('Kayıt sayısı: {count}', { count: number.format(section.rows.length) })}</p>
    <div className={styles.scroll} tabIndex={0} role="region" aria-labelledby={labelledBy}>
      <table aria-labelledby={labelledBy}>
        <thead><tr>{section.columns.map(column => <th key={column.key} scope="col">{column.title}</th>)}</tr></thead>
        <tbody>{section.rows.length ? section.rows.map((row, index) => <tr key={index}>
          {section.columns.map((column, cell) => {
            const value = row[cell];
            return <td key={column.key} data-numeric={typeof value === 'number'}>
              {renderCell?.(value, column.key, index) ?? (typeof value === 'number' ? number.format(value) : value)}
            </td>;
          })}
        </tr>) : <tr><td colSpan={section.columns.length}>{t('Raporlanacak kayıt bulunamadı.')}</td></tr>}</tbody>
      </table>
    </div>
    {section.note && <p className={styles.note}>{section.note}</p>}
  </>;
}
