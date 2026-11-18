const $ = id => document.getElementById(id);
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const timeZone = 'Europe/Istanbul';
const dateFormat = new Intl.DateTimeFormat('tr-TR', { timeZone, dateStyle: 'short', timeStyle: 'medium' });
const dayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone, dateStyle: 'short' });
const historyModule = 'history';

let operations = {};
let activeModule;
let lotFilter;
let editingId;
let entryRevision = 0;
let products = [];
let logs = [];
let currentId = null;
let refreshId = 0;
let lastState;

function showStatus(id, message, error = false) {
  $(id).textContent = message;
  $(id).classList.toggle('error', error);
}

function signed(number) {
  return number > 0 ? `+${number}` : String(number);
}

function renderDetails(product) {
  if (!product.details) return '<small>Operasyon bilgileri eksik</small>';
  const values = operations[product.type].fields.map(field => {
    const value = product.details[field.name];
    return [field.label, field.type === 'datetime-local' ? value.replace('T', ' ') : value];
  });
  if (product.details.destination) values.push(['Varış noktası', product.details.destination]);
  return values.map(([label, value]) => `<small>${escapeHtml(label)}</small><br>${escapeHtml(value)}<br>`).join('');
}

function rowActions(product) {
  const id = escapeHtml(product.id);
  const actions = [`<button type="button" class="secondary" data-action="trace" data-id="${id}">Lot geçmişi</button>`];
  if (!product.details) {
    actions.unshift(`<button type="button" data-action="edit" data-id="${id}">Bilgileri tamamla</button>`);
  } else if (product.type === 'Geçici Blokaj' && product.locked) {
    const available = product.actions.some(action => action.releaseTemporary);
    const disabled = available ? '' : ' disabled title="Blokaj bitiş zamanı henüz dolmadı"';
    actions.unshift(`<button type="button" data-action="release" data-id="${id}"${disabled}>Blokajı kaldır</button>`);
  } else if (product.actions.length) {
    actions.unshift(`<button type="button" data-action="decide" data-id="${id}">Karar ver</button>`);
  }
  return actions.join('');
}

function renderRows() {
  const query = $('search').value.trim().toLocaleLowerCase('tr');
  const matching = products.filter(product => (
    product.type === activeModule &&
    [product.name, product.code, product.lot].join(' ').toLocaleLowerCase('tr').includes(query)
  ));
  $('rows').innerHTML = matching.map(product => `
    <tr>
      <td>${escapeHtml(product.name)}</td>
      <td>${escapeHtml(product.code)}<br><small>${escapeHtml(product.lot)}</small></td>
      <td>${escapeHtml(product.type === 'Depo Fark' ? (product.details ? signed(product.details.physicalStock - product.details.systemStock) : '—') : product.qty)}</td>
      <td class="details">${renderDetails(product)}</td>
      <td>
        <span class="tag">${escapeHtml(product.status)}</span>
        ${product.risk ? `<small class="risk tag ${escapeHtml(product.risk.level)}">${escapeHtml(product.risk.label)}</small>` : ''}
      </td>
      <td><div class="actions">${rowActions(product)}</div></td>
    </tr>`).join('') || '<tr><td colspan="6">Kayıt bulunamadı</td></tr>';
}

function renderHistory() {
  const query = $('history-search').value.trim().toLocaleLowerCase('tr');
  const date = $('history-date').value;
  const operation = $('history-operation').value;
  const matching = logs.filter(log => (
    (!lotFilter || (log.code === lotFilter.code && log.lot === lotFilter.lot)) &&
    (!operation || log.type === operation) &&
    (!date || dayFormat.format(new Date(log.time)) === date) &&
    [log.name, log.code, log.lot, log.staff, log.choice, log.reason, log.result, log.destination]
      .join(' ').toLocaleLowerCase('tr').includes(query)
  ));
  $('history').innerHTML = matching.map(log => `
    <tr>
      <td>${escapeHtml(dateFormat.format(new Date(log.time)))}</td>
      <td>${escapeHtml(log.name)}<br><small>${escapeHtml(log.code)} · ${escapeHtml(log.lot)}</small></td>
      <td>${escapeHtml(operations[log.type].title)}</td>
      <td>${escapeHtml(log.staff)}</td>
      <td>${escapeHtml(log.choice)}<br><small>${escapeHtml(log.reason)}</small></td>
      <td>${escapeHtml(log.result)}${log.destination ? `<br><small>${escapeHtml(log.destination)}</small>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6">Karar kaydı bulunamadı</td></tr>';
}

function renderEntry(product) {
  const operation = operations[activeModule];
  const stockCount = activeModule === 'Depo Fark';
  const checksDate = activeModule === 'SKT';
  const quantityLabel = operation.quantityLabel || 'Adet';
  editingId = product?.id;
  entryRevision++;
  $('product-form').reset();
  for (const id of ['name', 'code', 'lot', 'qty']) {
    $(id).value = product?.[id] ?? '';
    $(id).readOnly = Boolean(product);
  }
  $('entry-title').textContent = product ? 'Operasyon bilgilerini tamamla' : 'Manuel ürün kaydı';
  $('save-product').textContent = product ? 'Bilgileri kaydet' : 'Ürünü kaydet';
  $('cancel-edit').hidden = !product;
  $('quantity-label').textContent = quantityLabel;
  $('quantity-column').textContent = stockCount ? 'Sayım farkı' : quantityLabel;
  $('quantity-field').hidden = stockCount;
  $('qty').required = !stockCount && !product;
  $('qty').disabled = stockCount || Boolean(product);
  $('expired-field').hidden = checksDate || Boolean(product);
  $('expired').disabled = checksDate || Boolean(product);
  $('operation-fields').innerHTML = operation.fields.map(field => {
    const attributes = field.type === 'number' ? ' min="0" step="1"' : field.max ? ` maxlength="${field.max}"` : '';
    return `<div><label for="${field.name}">${escapeHtml(field.label)}</label><input id="${field.name}" name="${field.name}" type="${field.type}"${attributes} required></div>`;
  }).join('');
  $('stock-preview').hidden = true;
  showStatus('product-status', '');
}

function selectModule(type, product) {
  const isHistory = type === historyModule;
  activeModule = type;
  lotFilter = product;
  currentId = null;
  for (const button of $('modules').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.module === type));
  }
  const module = isHistory ? {
    title: 'Karar Geçmişi', feature: 'MuTrace',
    description: 'Kullanıcı, tarih, ürün, lot, gerekçe ve sonuç bazında kararları inceleyin.',
  } : operations[type];
  $('module-title').textContent = module.title;
  $('module-feature').textContent = module.feature;
  $('module-description').textContent = module.description;
  $('entry-panel').hidden = isHistory;
  $('records-panel').hidden = isHistory;
  $('decision').hidden = true;
  $('history-panel').hidden = !isHistory;
  $('clear-lot').hidden = !product;
  $('lot-filter').hidden = !product;
  if (product) {
    $('lot-filter').textContent = `${product.name} · Barkod ${product.code} · Lot ${product.lot}`;
    for (const id of ['history-search', 'history-date', 'history-operation']) $(id).value = '';
  }
  if (isHistory) {
    renderHistory();
  } else {
    $('search').value = '';
    renderEntry();
    renderRows();
  }
}

function render() {
  const stats = [
    ['Toplam ürün kaydı', products.length],
    ['RKS blokajlı', products.filter(product => product.type === 'RKS Blokaj' && product.locked).length],
    ['Delist blokajlı', products.filter(product => product.type === 'Delist Blokaj' && product.locked).length],
    ['Geçici blokajlı', products.filter(product => product.type === 'Geçici Blokaj' && product.locked).length],
    ['SKT kontrolü', products.filter(product => product.type === 'SKT').length],
    ['Karar kaydı', logs.length],
  ];
  $('stats').innerHTML = stats.map(([label, value]) => `<div class="card"><small>${label}</small><b>${value}</b></div>`).join('');
  if (activeModule === historyModule) renderHistory();
  else renderRows();
  if (currentId) renderDecisionChoices(products.find(product => product.id === currentId));
}

async function refresh() {
  const id = ++refreshId;
  try {
    const response = await fetch('/api/state');
    if (!response.ok) throw new Error();
    const snapshot = await response.text();
    if (id !== refreshId) return;
    if (lastState !== snapshot) {
      ({ products, logs } = JSON.parse(snapshot));
      render();
      lastState = snapshot;
    }
    showStatus('sync-status', '');
    $('export').disabled = false;
  } catch {
    if (id !== refreshId) return;
    showStatus('sync-status', 'Kayıtlar güncellenemedi. MuTerminal sunucusunu ve MongoDB bağlantısını kontrol edin.', true);
    $('export').disabled = true;
  }
}

async function post(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.ok) return;
  const result = await response.json().catch(() => ({}));
  throw new Error(result.error || 'Kayıt işlemi tamamlanamadı.');
}

$('product-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  if (button.disabled) return;
  const module = activeModule;
  const revision = entryRevision;
  const id = editingId;
  const data = new FormData(form);
  const { name, code, lot, qty } = Object.fromEntries(data);
  const details = Object.fromEntries(operations[module].fields.map(field => [
    field.name, field.type === 'number' ? Number(data.get(field.name)) : data.get(field.name),
  ]));
  button.disabled = true;
  showStatus('product-status', 'Kaydediliyor…');
  try {
    if (id) await post(`/api/products/${id}/details`, { details });
    else await post('/api/products', { name, code, lot, type: module, qty: Number(qty), expired: data.has('expired'), details });
    if (module === activeModule && revision === entryRevision) {
      renderEntry();
      $('search').value = '';
      renderRows();
      showStatus('product-status', id ? 'Operasyon bilgileri kaydedildi.' : 'Ürün kaydedildi.');
    }
    await refresh();
  } catch (error) {
    if (module === activeModule && revision === entryRevision) showStatus('product-status', error.message, true);
  } finally {
    button.disabled = false;
  }
});

function updateDestination() {
  const product = products.find(item => item.id === currentId);
  const action = product?.actions.find(item => item.choice === $('choice').value);
  const required = Boolean(action?.destination);
  $('destination-field').hidden = !required;
  $('destination').disabled = !required;
  $('destination').required = required;
}

function renderDecisionChoices(product) {
  const previous = $('choice').value;
  const actions = product?.actions ?? [];
  $('choice').innerHTML = '<option value="">Karar seçin</option>' + actions.map(action => (
    `<option>${escapeHtml(action.choice)}</option>`
  )).join('');
  if (actions.some(action => action.choice === previous)) $('choice').value = previous;
  updateDestination();
}

$('rows').addEventListener('click', event => {
  const button = event.target.closest('button[data-id]');
  if (!button) return;
  const product = products.find(item => item.id === button.dataset.id);
  if (!product) return;
  if (button.dataset.action === 'trace') {
    selectModule(historyModule, product);
    $('module-title').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  if (button.dataset.action === 'edit') {
    renderEntry(product);
    $('operation-fields').querySelector('input').focus();
    return;
  }
  if ($('decision-form').querySelector('button').disabled) return;
  currentId = product.id;
  $('selected').textContent = `${product.name} · ${operations[product.type].title} · ${product.lot}`;
  $('choice').value = '';
  $('reason').value = '';
  $('destination').value = '';
  renderDecisionChoices(product);
  if (button.dataset.action === 'release') {
    $('choice').value = product.actions.find(action => action.releaseTemporary).choice;
  }
  showStatus('decision-status', '');
  $('decision').hidden = false;
  $('decision').scrollIntoView({ behavior: 'smooth' });
  $('staff').focus({ preventScroll: true });
});

$('decision-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  if (!currentId || button.disabled) return;
  const id = currentId;
  button.disabled = true;
  showStatus('decision-status', 'Kaydediliyor…');
  try {
    await post(`/api/products/${id}/decisions`, Object.fromEntries(new FormData(form)));
    if (currentId === id) {
      $('decision').hidden = true;
      currentId = null;
    }
    await refresh();
  } catch (error) {
    if (currentId === id) showStatus('decision-status', error.message, true);
  } finally {
    button.disabled = false;
  }
});

$('search').addEventListener('input', renderRows);
$('choice').addEventListener('change', updateDestination);
$('cancel-edit').addEventListener('click', () => renderEntry());
$('clear-lot').addEventListener('click', () => selectModule(historyModule));
$('modules').addEventListener('click', event => {
  const button = event.target.closest('button[data-module]');
  if (button && (button.dataset.module !== activeModule || lotFilter)) selectModule(button.dataset.module);
});
for (const id of ['history-search', 'history-date', 'history-operation']) $(id).addEventListener('input', renderHistory);
$('operation-fields').addEventListener('input', () => {
  if (activeModule !== 'Depo Fark') return;
  const system = $('systemStock');
  const physical = $('physicalStock');
  const valid = system.value !== '' && physical.value !== '' && system.validity.valid && physical.validity.valid;
  $('stock-preview').hidden = !valid;
  if (valid) $('stock-preview').textContent = `Sayım farkı ${signed(physical.valueAsNumber - system.valueAsNumber)} adet`;
});
$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ products, logs }, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'muterminal-kayitlar.json';
  link.click();
  URL.revokeObjectURL(link.href);
});

async function poll() {
  await refresh();
  setTimeout(poll, 2000);
}

async function start() {
  try {
    const response = await fetch('/api/operations');
    if (!response.ok) throw new Error();
    operations = await response.json();
    const options = Object.entries(operations);
    $('modules').innerHTML = options.map(([id, operation]) => (
      `<button type="button" data-module="${escapeHtml(id)}">${escapeHtml(operation.title)}</button>`
    )).join('') + '<button type="button" data-module="history">Karar Geçmişi</button>';
    $('history-operation').innerHTML = '<option value="">Tüm operasyonlar</option>' + options.map(([id, operation]) => (
      `<option value="${escapeHtml(id)}">${escapeHtml(operation.title)}</option>`
    )).join('');
    selectModule(options[0][0]);
    poll();
  } catch {
    showStatus('sync-status', 'Operasyon modülleri yüklenemedi. MuTerminal sunucusunu kontrol edin.', true);
    setTimeout(start, 2000);
  }
}

start();
