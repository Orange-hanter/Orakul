import { useState, useRef } from 'react';
import Modal from './Modal.jsx';

const CURRENCY = 'BYN';

// Маппинг колонок по ключевым словам в заголовке
const HEURISTICS = {
  itemName:     /назв|наименован|товар|продукт|товары|product|item/i,
  price:        /цен|price|стоим|сумм/i,
  unit:         /ед\.?\b|единиц|unit|меры/i,
  minQty:       /мин|min|партия|пакет/i,
  deliveryDays: /доставк|срок|days|дней|дни\b/i,
  sku:          /артик|код|sku/i,
};

const MAPPABLE = [
  { id: '',             label: '— Пропустить —' },
  { id: 'itemName',     label: 'Название (обязательно)' },
  { id: 'price',        label: 'Цена (обязательно)' },
  { id: 'unit',         label: 'Единица' },
  { id: 'minQty',       label: 'Мин. партия' },
  { id: 'deliveryDays', label: 'Срок доставки (дней)' },
  { id: 'sku',          label: 'Артикул поставщика' },
];

// Очистка цены: "1,20 BYN" → 1.20
function parsePrice(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return raw;
  const cleaned = String(raw).replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseInteger(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Math.round(raw);
  const cleaned = String(raw).replace(/[^\d]/g, '');
  if (!cleaned) return null;
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
}

function parseNumeric(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return raw;
  const cleaned = String(raw).replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function autoDetectMapping(headers) {
  const mapping = {};
  const taken = new Set();
  for (const [field, regex] of Object.entries(HEURISTICS)) {
    const idx = headers.findIndex((h, i) => !taken.has(i) && regex.test(String(h || '')));
    if (idx >= 0) {
      mapping[idx] = field;
      taken.add(idx);
    }
  }
  return mapping;
}

export default function ImportPriceListModal({ supplier, products, onClose, onCreate, showToast, onComplete }) {
  const [stage,    setStage]    = useState('pick');   // 'pick' | 'preview' | 'importing' | 'done'
  const [error,    setError]    = useState(null);
  const [rows,     setRows]     = useState([]);       // raw rows including header
  const [mapping,  setMapping]  = useState({});       // { columnIdx: fieldId }
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });
  const [parsing,  setParsing]  = useState(false);
  const fileInputRef = useRef(null);

  async function handleFileSelect(file) {
    if (!file) return;
    setParsing(true);
    setError(null);
    try {
      const XLSX = await import('xlsx');
      const buf  = await file.arrayBuffer();
      const wb   = XLSX.read(buf, { type: 'array', cellDates: false });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) throw new Error('Файл пустой или не содержит листов');
      const sheet = wb.Sheets[sheetName];
      const data  = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });
      if (data.length < 2) throw new Error('В файле нет данных (минимум: заголовок + 1 строка)');
      setRows(data);
      setMapping(autoDetectMapping(data[0]));
      setStage('preview');
    } catch (e) {
      setError(`Не удалось разобрать файл: ${e.message}`);
    } finally {
      setParsing(false);
    }
  }

  function dataRows() {
    return rows.slice(1);
  }

  function columnIdxFor(field) {
    return Object.entries(mapping).find(([, f]) => f === field)?.[0];
  }

  function previewItems() {
    const nameIdx  = columnIdxFor('itemName');
    const priceIdx = columnIdxFor('price');
    return dataRows().map((row, i) => {
      const out = { __row: i + 2 };
      for (const [idx, field] of Object.entries(mapping)) {
        if (!field) continue;
        out[field] = row[idx];
      }
      out.__valid = !!(out.itemName && parsePrice(out.price) !== null);
      return out;
    });
  }

  function findProductId(itemName) {
    const norm = String(itemName).toLowerCase().trim();
    // Точное совпадение нормализованных имён (для MVP). Fuzzy — в R3.
    return products.find(p => p.name.toLowerCase().trim() === norm)?.id || null;
  }

  async function runImport() {
    const items = previewItems().filter(it => it.__valid);
    if (items.length === 0) {
      setError('Нет валидных строк (название + цена обязательны)');
      return;
    }
    setStage('importing');
    setProgress({ done: 0, total: items.length, failed: 0 });

    let done = 0;
    let failed = 0;
    for (const it of items) {
      try {
        const price = parsePrice(it.price);
        const data = {
          type:       'supplier_item',
          supplierId: supplier.id,
          productId:  findProductId(it.itemName),
          itemName:   String(it.itemName).trim(),
          unit:       it.unit ? String(it.unit).trim() : 'шт',
          price,
          currency:   CURRENCY,
          minQty:       it.minQty       != null ? parseNumeric(it.minQty)       : null,
          deliveryDays: it.deliveryDays != null ? parseInteger(it.deliveryDays) : null,
        };
        if (it.sku) data.supplierSku = String(it.sku).trim();
        await onCreate(data);
        done++;
      } catch {
        failed++;
      }
      setProgress({ done, total: items.length, failed });
    }
    setStage('done');
  }

  function close() {
    if (stage === 'importing') return; // не закрывать во время импорта
    if (stage === 'done' && progress.done > 0) onComplete?.();
    onClose();
  }

  // ── Render по стадиям ──────────────────────────────────────────────────

  if (stage === 'pick') {
    return (
      <Modal title="Импорт прайс-листа" onClose={close}>
        <div style={{ fontSize: 14, color: 'var(--neutral)', marginBottom: 20 }}>
          Поставщик: <strong style={{ color: 'var(--primary)' }}>{supplier.name}</strong>
        </div>

        <div style={{ border: '2px dashed var(--border)', borderRadius: 12, padding: 32, textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
          <div style={{ fontSize: 14, marginBottom: 16, color: 'var(--neutral)' }}>
            Загрузите файл .xlsx, .xls или .csv с прайс-листом
          </div>
          <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()} disabled={parsing}>
            {parsing ? 'Читаю файл...' : 'Выбрать файл'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            style={{ display: 'none' }}
            onChange={e => handleFileSelect(e.target.files?.[0])}
          />
        </div>

        {error && (
          <div style={{ padding: 12, background: '#fef2f2', color: '#b91c1c', borderRadius: 8, fontSize: 13 }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: 16, padding: 12, background: '#fef9c3', borderRadius: 8, fontSize: 12, color: '#854d0e' }}>
          💡 Первая строка файла должна содержать заголовки. Система автоматически распознает колонки «Название», «Цена», «Единица», «Мин. партия» и «Срок доставки».
        </div>
      </Modal>
    );
  }

  if (stage === 'preview') {
    const preview = previewItems().slice(0, 8);
    const valid   = previewItems().filter(it => it.__valid).length;
    const total   = previewItems().length;
    const hasName  = !!columnIdxFor('itemName');
    const hasPrice = !!columnIdxFor('price');
    const canImport = hasName && hasPrice && valid > 0;

    return (
      <Modal
        title="Превью импорта"
        onClose={close}
        onSave={canImport ? runImport : undefined}
        saveLabel={`Импортировать (${valid})`}
      >
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 14, marginBottom: 8 }}>Найдено колонок: {rows[0].length}, строк: {total}</div>
          <div style={{ fontSize: 13, color: valid === total ? 'var(--success)' : 'var(--neutral)' }}>
            Валидных строк: {valid} из {total}
            {valid < total && ' (остальные пропустим — отсутствует название или цена)'}
          </div>
        </div>

        <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--neutral)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 16 }}>
          Маппинг колонок
        </h3>
        <div style={{ marginBottom: 16 }}>
          {rows[0].map((header, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--neutral)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {String(header || `Колонка ${idx + 1}`)}
              </div>
              <select
                value={mapping[idx] || ''}
                onChange={e => setMapping({ ...mapping, [idx]: e.target.value })}
                style={{ flex: 1, height: 36, fontSize: 13 }}
              >
                {MAPPABLE.map(m => {
                  const usedElsewhere = Object.entries(mapping).some(
                    ([i, f]) => Number(i) !== idx && f === m.id && m.id !== ''
                  );
                  return (
                    <option key={m.id} value={m.id} disabled={usedElsewhere}>
                      {m.label}{usedElsewhere ? ' (занято)' : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          ))}
        </div>

        {(!hasName || !hasPrice) && (
          <div style={{ padding: 12, background: '#fef2f2', color: '#b91c1c', borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
            ⚠ Обязательны колонки «Название» и «Цена»
          </div>
        )}

        <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--neutral)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          Превью (первые {preview.length})
        </h3>
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
          {preview.map((it, i) => (
            <div key={i} style={{
              display: 'flex',
              padding: '8px 12px',
              borderBottom: i < preview.length - 1 ? '1px solid #f1f5f9' : 'none',
              background: it.__valid ? '#fff' : '#fef2f2',
              fontSize: 13,
              gap: 8,
            }}>
              <div style={{ flex: 2, minWidth: 0, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {it.itemName || '—'}
              </div>
              <div style={{ flex: 1, textAlign: 'right', color: 'var(--neutral)' }}>
                {parsePrice(it.price) !== null ? `${parsePrice(it.price).toFixed(2)} ${CURRENCY}` : '—'}
              </div>
              <div style={{ width: 32, textAlign: 'right', color: 'var(--neutral)' }}>
                {it.unit || '—'}
              </div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 12, color: 'var(--neutral)' }}>
          💡 Позиции автоматически свяжутся с товаром склада, если имена точно совпадут.
        </div>
      </Modal>
    );
  }

  if (stage === 'importing') {
    const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <Modal title="Импорт..." onClose={() => {}}>
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 36, marginBottom: 16 }}>⏳</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
            Создано {progress.done} из {progress.total}
          </div>
          <div style={{ width: '100%', height: 8, background: '#e2e8f0', borderRadius: 4, marginBottom: 12, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.2s' }} />
          </div>
          {progress.failed > 0 && (
            <div style={{ fontSize: 13, color: 'var(--danger)' }}>Ошибок: {progress.failed}</div>
          )}
        </div>
      </Modal>
    );
  }

  // stage === 'done'
  return (
    <Modal title="Импорт завершён" onClose={close}>
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>{progress.failed > 0 ? '⚠' : '✅'}</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
          Импортировано {progress.done} позиций
        </div>
        {progress.failed > 0 && (
          <div style={{ fontSize: 14, color: 'var(--danger)' }}>
            Ошибок: {progress.failed}
          </div>
        )}
      </div>
      <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} onClick={close}>
        Готово
      </button>
    </Modal>
  );
}
