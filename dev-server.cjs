const { readFile } = require('node:fs/promises');
const { createServer } = require('node:http');
const { join } = require('node:path');
const { MongoClient, ObjectId } = require('mongodb');
const { operations, saleApproval } = require('./operations.cjs');

const host = '127.0.0.1';
const port = Number(process.env.PORT ?? 4173);
const client = new MongoClient(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017', {
  serverSelectionTimeoutMS: 3000,
});
const records = client.db(process.env.MONGODB_DATABASE ?? 'muterminal').collection('products');
const legacyChoices = new Set([saleApproval, 'Blokaj devam', 'Depoya iade', 'İncelemeye sevk']);
const localTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'short',
});
const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.html', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
]);

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }).end(JSON.stringify(data));
}

async function readJson(request) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new RequestError(415, 'Kayıt verisi JSON biçiminde olmalıdır.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 16_384) {
      request.resume();
      throw new RequestError(413, 'Gönderilen veri çok büyük.');
    }
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch {
    // Invalid JSON and non-object payloads use the same response.
  }
  throw new RequestError(400, 'Geçersiz kayıt verisi.');
}

function requiredText(body, field, label, maxLength) {
  const value = typeof body[field] === 'string' ? body[field].trim() : '';
  if (!value || value.length > maxLength) {
    throw new RequestError(400, `${label} 1–${maxLength} karakter olmalıdır.`);
  }
  return value;
}

function dateField(value, field) {
  const withTime = field.type === 'datetime-local';
  const pattern = withTime ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/;
  if (typeof value === 'string' && pattern.test(value) && !value.startsWith('0000')) {
    const date = new Date(withTime ? `${value}Z` : value);
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, value.length) === value) return value;
  }
  throw new RequestError(400, `${field.label} için geçerli bir değer girin.`);
}

function currentMinute() {
  return localTime.format(new Date()).replace(' ', 'T');
}

function temporaryBlockEnded(product, now) {
  return Boolean(product.details?.blockEndsAt && product.details.blockEndsAt <= now);
}

function operationDetails(operation, values) {
  const details = {};
  for (const field of operation.fields) {
    const value = values[field.name];
    if (field.type === 'text') {
      details[field.name] = requiredText(values, field.name, field.label, field.max);
    } else if (field.type === 'number') {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new RequestError(400, `${field.label} sıfır veya pozitif bir tam sayı olmalıdır.`);
      }
      details[field.name] = value;
    } else {
      details[field.name] = dateField(value, field);
    }
  }
  return details;
}

function newProduct(body) {
  const name = requiredText(body, 'name', 'Ürün adı', 150);
  const code = requiredText(body, 'code', 'Barkod', 80);
  const lot = requiredText(body, 'lot', 'Lot', 80);
  const { type, expired } = body;
  if (!Object.hasOwn(operations, type)) throw new RequestError(400, 'Geçerli bir operasyon seçin.');
  const operation = operations[type];
  const details = operationDetails(operation, body.details ?? {});
  const difference = type === 'Depo Fark' ? details.physicalStock - details.systemStock : null;
  const qty = difference === null ? body.qty : Math.abs(difference);
  if (difference === null && (!Number.isSafeInteger(qty) || qty < 1)) {
    throw new RequestError(400, 'Adet pozitif bir tam sayı olmalıdır.');
  }
  if (typeof expired !== 'boolean') throw new RequestError(400, 'SKT durumu geçersiz.');
  return {
    name, code, lot, type, qty, expired, details,
    locked: Boolean(operation.blockLabel),
    status: difference === 0 ? 'Fark yok' : operation.initial,
    createdAt: new Date(),
    decisions: [],
  };
}

function productRisk(product, now) {
  const today = now.slice(0, 10);
  const expiry = product.details?.expiryDate;
  if (product.expired || (expiry && expiry < today)) return { label: 'SKT geçmiş', level: 'danger', blocks: true };
  if (product.locked || product.type === 'RKS Blokaj') {
    const label = temporaryBlockEnded(product, now)
      ? 'Süre doldu · kaldırma bekliyor'
      : operations[product.type].blockLabel ?? 'Blokajlı';
    return { label, level: 'warn', blocks: true };
  }
  if (product.type === 'SKT') {
    if (!expiry) return { label: 'SKT bilgisi eksik', level: 'warn', blocks: true };
    const days = (Date.parse(expiry) - Date.parse(today)) / 86_400_000;
    if (days <= 7) return { label: days ? `SKT’ye ${days} gün` : 'SKT bugün', level: 'warn' };
  }
  if (product.type === 'Depo Fark') {
    if (!product.details) return { label: 'Sayım bilgisi eksik', level: 'warn' };
    const difference = product.details.physicalStock - product.details.systemStock;
    if (difference) return { label: `Sayım farkı ${difference > 0 ? '+' : ''}${difference}`, level: 'warn', blocks: true };
  }
  return null;
}

function availableActions(product, risk, now) {
  if (!product.details) return [];
  return operations[product.type].actions.filter(action => (
    (!action.from || action.from.includes(product.status)) &&
    (!action.guarded || !risk?.blocks) &&
    (!action.releaseTemporary || (product.locked && temporaryBlockEnded(product, now)))
  ));
}

async function state() {
  const products = [];
  const logs = [];
  const now = currentMinute();
  const entries = await records.find().sort({ _id: -1 }).toArray();
  const lotRisks = new Map();
  const risks = entries.map(record => {
    const risk = productRisk(record, now);
    const key = JSON.stringify([record.code, record.lot]);
    if (risk?.blocks && (risk.level === 'danger' || !lotRisks.has(key))) lotRisks.set(key, risk);
    return risk;
  });
  for (const [index, record] of entries.entries()) {
    const { _id, decisions, ...product } = record;
    const id = _id.toHexString();
    const ownRisk = risks[index];
    const lotRisk = lotRisks.get(JSON.stringify([product.code, product.lot]));
    const risk = chooseRisk(ownRisk, lotRisk);
    const actions = availableActions(product, risk, now);
    products.push({ id, ...product, risk, actions });
    const { name, code, lot, type } = product;
    for (const decision of decisions) {
      logs.push({ id, name, code, lot, type, result: decision.choice, ...decision });
    }
  }
  logs.sort((first, second) => second.time - first.time);
  return { products, logs };
}

function chooseRisk(ownRisk, lotRisk) {
  return ((lotRisk?.level === 'danger' && ownRisk?.level !== 'danger') || (!ownRisk?.blocks && lotRisk))
    ? { ...lotRisk, label: `Aynı lot · ${lotRisk.label}` }
    : ownRisk;
}

async function saveDecision(id, body) {
  const staff = requiredText(body, 'staff', 'Personel', 100);
  const reason = requiredText(body, 'reason', 'Gerekçe', 1000);
  const { choice } = body;
  const filter = { _id: new ObjectId(id) };
  const product = await records.findOne(filter);
  if (!product) throw new RequestError(404, 'Ürün kaydı bulunamadı.');
  const option = product.details && operations[product.type].actions.find(action => action.choice === choice);
  const action = option || (!product.details && legacyChoices.has(choice) ? { choice, guarded: choice === saleApproval } : null);
  if (!action) throw new RequestError(400, 'Bu operasyon için geçerli bir karar seçin.');
  const now = currentMinute();
  if (action.guarded) {
    const related = records.find({ code: product.code, lot: product.lot });
    for await (const entry of related) {
      if (productRisk(entry, now)?.blocks) {
        throw new RequestError(409, 'Bu ürün ve lot için açık risk veya eksik kontrol bilgisi var.');
      }
    }
  }
  if (action.from) {
    if (!action.from.includes(product.status)) {
      throw new RequestError(409, 'Kayıt bu işlem için gereken durumda değil.');
    }
    filter.status = product.status;
  }
  const status = action.result ?? choice;
  filter.details = product.details ? { $exists: true } : { $exists: false };
  const update = { status };
  const decision = { time: new Date(), choice, result: status, staff, reason };
  if (action.releaseTemporary) {
    if (!product.locked || !temporaryBlockEnded(product, now)) {
      throw new RequestError(409, 'Geçici blokaj ancak bitiş zamanı dolduğunda kaldırılabilir.');
    }
    filter.locked = true;
    update.locked = false;
  }
  if (action.destination) {
    decision.destination = requiredText(body, 'destination', 'Varış noktası', 150);
    update['details.destination'] = decision.destination;
  }
  const result = await records.updateOne(filter, {
    $set: update,
    $push: { decisions: decision },
  });
  if (!result.matchedCount) {
    throw new RequestError(409, 'Kayıt durumu değişti. Güncel kaydı kontrol edin.');
  }
}

async function completeDetails(id, body) {
  const filter = { _id: new ObjectId(id), details: { $exists: false } };
  const product = await records.findOne(filter);
  if (!product) throw new RequestError(409, 'Kayıt bulunamadı veya operasyon bilgileri tamamlanmış.');
  const operation = operations[product.type];
  const details = operationDetails(operation, body.details ?? {});
  const update = { details, status: operation.initial };
  if (product.type === 'Depo Fark') {
    update.qty = Math.abs(details.physicalStock - details.systemStock);
    if (update.qty === 0) update.status = 'Fark yok';
  }
  const result = await records.updateOne({ ...filter, status: product.status }, { $set: update });
  if (!result.matchedCount) throw new RequestError(409, 'Kayıt durumu değişti. Güncel kaydı kontrol edin.');
}

async function handleApi(request, response, path) {
  if (request.method === 'GET' && path === '/api/operations') {
    json(response, 200, operations);
    return;
  }
  if (request.method === 'GET' && path === '/api/state') {
    json(response, 200, await state());
    return;
  }
  if (request.method === 'POST' && path === '/api/products') {
    const product = newProduct(await readJson(request));
    const result = await records.insertOne(product);
    json(response, 201, { id: result.insertedId.toHexString() });
    return;
  }
  const decision = path.match(/^\/api\/products\/([0-9a-f]{24})\/decisions$/);
  if (request.method === 'POST' && decision) {
    await saveDecision(decision[1], await readJson(request));
    response.writeHead(204).end();
    return;
  }
  const details = path.match(/^\/api\/products\/([0-9a-f]{24})\/details$/);
  if (request.method === 'POST' && details) {
    await completeDetails(details[1], await readJson(request));
    response.writeHead(204).end();
    return;
  }
  throw new RequestError(404, 'İstek adresi bulunamadı.');
}

const server = createServer(async (request, response) => {
  const path = request.url.split('?')[0];
  try {
    if (path.startsWith('/api/')) {
      await handleApi(request, response, path);
      return;
    }
    const asset = assets.get(path);
    if (!asset) {
      response.writeHead(404).end();
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const [filename, contentType] = asset;
    const content = await readFile(join(__dirname, 'muterminal', filename));
    response.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8` }).end(content);
  } catch (error) {
    if (error instanceof RequestError) {
      json(response, error.status, { error: error.message });
      return;
    }
    console.error(error.message);
    json(response, 500, { error: 'İşlem tamamlanamadı. MongoDB bağlantısını kontrol edin.' });
  }
});

server.listen(port, host, () => {
  console.log(`MuTerminal http://${host}:${server.address().port}`);
});
