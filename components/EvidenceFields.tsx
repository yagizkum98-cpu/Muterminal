import { useTranslate } from './LanguagePicker';
import { evidenceCategories } from '../public/mu-evidence.mjs';

export default function EvidenceFields({ prefix }: { prefix: string }) {
  const t = useTranslate();
  return <fieldset className="evidence-fields" id={`${prefix}-evidence`}>
    <legend>MuEvidence · {t('Fotoğraflı kanıt')}</legend>
    <div className="fields">
      <div>
        <label htmlFor={`${prefix}-evidence-category`}>{t('Kanıt türü')}</label>
        <select id={`${prefix}-evidence-category`} defaultValue="">
          <option value="">{t('Tür seçin')}</option>
          {evidenceCategories.map(category => <option key={category} value={category}>{t(category)}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={`${prefix}-evidence-photo`}>{t('Kanıt fotoğrafı')}</label>
        <input id={`${prefix}-evidence-photo`} type="file" accept="image/jpeg,image/png,image/webp" />
      </div>
    </div>
  </fieldset>;
}
