import { useRef, useState } from 'react';
import { api } from '../../api.js';

export default function ExportImportCard({ recordCount, onReload, showToast }) {
  const fileRef = useRef();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      await api.export();
      showToast('Файл скачан ✓');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setExporting(false);
    }
  }

  async function handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const { count } = await api.import(text);
      showToast(`Импортировано ${count} записей ✓`);
      await onReload();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setImporting(false);
      fileRef.current.value = '';
    }
  }

  return (
    <div className="export-card">
      <h3>💾 Резервная копия</h3>
      <p>Скачайте зашифрованный файл с всеми данными. Расшифровка возможна только с мастер-паролем.</p>
      <button className="btn btn-primary btn-block" onClick={handleExport} disabled={exporting || recordCount === 0}>
        {exporting ? '…' : '⬇ Скачать .enc файл'}
      </button>
      <div style={{ height: 10 }} />
      <input ref={fileRef} type="file" accept=".enc" style={{ display: 'none' }} onChange={handleImport} />
      <button className="btn btn-ghost btn-block" onClick={() => fileRef.current.click()} disabled={importing}>
        {importing ? '…' : '⬆ Загрузить из файла'}
      </button>
    </div>
  );
}
