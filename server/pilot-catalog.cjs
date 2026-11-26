const csvColumns = ['barcode', 'product_code', 'product_name', 'price_try', 'case_quantity', 'price_valid_from',
  'price_valid_to', 'order_status', 'sale_status', 'warehouse_code', 'stock_quantity', 'source_updated_at'];

class CatalogError extends Error {
  status = 400;
}

function optionalText(value, key, limit) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length > limit) throw new CatalogError(`Geçersiz alan: ${key}`);
  return value.trim();
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().startsWith(value);
}

function catalogDetails(input) {
  const details = {};
  for (const [field, limit] of [['productCode', 80], ['orderStatus', 150], ['saleStatus', 20],
    ['price', 20], ['caseQuantity', 10], ['priceValidFrom', 10], ['priceValidTo', 10]]) {
    const value = optionalText(input[field], field, limit);
    if (value !== undefined) details[field] = value;
  }
  if (details.price !== undefined) {
    const price = details.price.replace(',', '.');
    if (price && !/^\d{1,9}(\.\d{1,2})?$/.test(price)) throw new CatalogError('Fiyat geçersiz.');
    details.price = price === '' ? null : Number(Math.round(Number(price) * 100));
  }
  if (details.caseQuantity !== undefined) {
    const quantity = details.caseQuantity;
    if (quantity && !/^[1-9]\d{0,8}$/.test(quantity)) throw new CatalogError('Koli içi miktar geçersiz.');
    details.caseQuantity = quantity === '' ? null : Number(quantity);
  }
  for (const field of ['priceValidFrom', 'priceValidTo']) {
    if (details[field] && !validDate(details[field])) throw new CatalogError('Fiyat geçerlilik tarihi geçersiz.');
  }
  if (details.priceValidFrom && details.priceValidTo && details.priceValidFrom > details.priceValidTo) {
    throw new CatalogError('Fiyat bitiş tarihi başlangıçtan önce olamaz.');
  }
  if (details.saleStatus && !['sellable', 'blocked', 'unknown'].includes(details.saleStatus)) {
    throw new CatalogError('Kaynak satış durumu geçersiz.');
  }
  return details;
}

function parseCsv(csv) {
  const rows = [];
  const field = /(?:"((?:[^"]|"")*)"|([^",\r\n]*))(,|\r\n|\n|\r|$)/y;
  csv = csv.replace(/^\uFEFF/, '');
  let row = [];
  while (field.lastIndex < csv.length) {
    const match = field.exec(csv);
    if (!match) throw new CatalogError('CSV biçimi geçersiz.');
    row.push(match[1] === undefined ? match[2].trim() : match[1].replaceAll('""', '"').trim());
    if (match[3] === ',' && field.lastIndex === csv.length) row.push('');
    else if (match[3] === ',') continue;
    if (row.some(Boolean)) rows.push(row);
    row = [];
  }
  return rows;
}

function readCatalogCsv(csv, normalizeBarcode) {
  if (typeof csv !== 'string') throw new CatalogError('CSV dosyası gerekli.');
  const [header, ...rows] = parseCsv(csv);
  if (header?.length !== csvColumns.length || header.join(',') !== csvColumns.join(',') || !rows.length || rows.length > 500) {
    throw new CatalogError('CSV şablonunu kullanın ve 1–500 veri satırı ekleyin.');
  }
  const products = new Map();
  const snapshots = new Map();
  for (const [index, row] of rows.entries()) {
    try {
      if (row.length !== csvColumns.length) throw new CatalogError('Sütun sayısı geçersiz.');
      const [rawBarcode, productCode, name, price, caseQuantity, priceValidFrom, priceValidTo,
        orderStatus, saleStatus, warehouseCode, quantity, sourceUpdatedAt] = row;
      if (!rawBarcode || rawBarcode.length > 80 || !name || name.length > 150) {
        throw new CatalogError('Barkod veya ürün adı eksik ya da geçersiz.');
      }
      const barcode = normalizeBarcode(rawBarcode);
      const product = { barcode, name, ...catalogDetails({ productCode, price, caseQuantity,
        priceValidFrom, priceValidTo, orderStatus, saleStatus }) };
      if (products.has(barcode) && JSON.stringify(products.get(barcode)) !== JSON.stringify(product)) {
        throw new CatalogError('Aynı barkodun ürün bilgileri satırlar arasında farklı.');
      }
      products.set(barcode, product);
      if (!warehouseCode && !quantity && !sourceUpdatedAt) continue;
      if (!warehouseCode || warehouseCode.length > 50 || !/^-?\d{1,9}$/.test(quantity)
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(sourceUpdatedAt)
        || !validDate(sourceUpdatedAt.slice(0, 10)) || !Number.isFinite(Date.parse(sourceUpdatedAt))) {
        throw new CatalogError('Depo kodu, stok miktarı ve saat dilimli kaynak zamanı birlikte geçerli olmalıdır.');
      }
      const key = JSON.stringify([barcode, warehouseCode]);
      if (snapshots.has(key)) throw new CatalogError('Barkod ve depo aynı CSV içinde bir kez bulunabilir.');
      snapshots.set(key, { barcode, warehouseCode, quantity: Number(quantity), sourceUpdatedAt });
    } catch (error) {
      if (!(error instanceof CatalogError)) throw error;
      throw new CatalogError(`CSV satırı ${index + 2}: ${error.message}`);
    }
  }
  return { products: [...products.values()], snapshots: [...snapshots.values()] };
}

module.exports = { CatalogError, catalogDetails, readCatalogCsv };
