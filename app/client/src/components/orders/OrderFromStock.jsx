/*
 * OrderFromStock — корзина → превью отправки → одна draft/submitted-order
 * на каждого поставщика.
 *
 * Точка входа: вкладка «Склад» → чекбоксы → sticky-bar → этот модал.
 * См. docs/08-technical/12-order-from-stock-spec.md.
 *
 * Шаг 1 (Корзина): per-line количество + выбор поставщика + автогруппировка.
 * Шаг 2 (Отправка): табы по поставщикам, редактируемый текст, диплинки
 *   email / Telegram / Viber. Каждый «Отправить через X» создаёт один order
 *   со status='submitted' и одновременно открывает диплинк. «Сохранить как
 *   черновик» создаёт draft без отправки.
 *
 * Деталь UX: диплинк открывается СИНХРОННО из click-обработчика (через
 * программный anchor click), а POST стартует параллельно. Иначе браузер
 * блокирует window.open после async await — теряется user-gesture.
 */
import { useState, useMemo } from 'react';
import Modal from '../Modal.jsx';
import { nplural } from '../../utils/plural.js';
import { CURRENCY, fmtPrice } from '../../utils/format.js';
import { todayIso, DAY_MS } from '../../utils/time.js';
import {
  buildOrderMessage, availableChannels, channelLabel, channelIcon,
  openOrderChannel, ORDER_CHANNELS,
} from '../../utils/orderMessage.js';

function defaultDesiredDate() {
  return new Date(Date.now() + 2 * DAY_MS).toISOString().slice(0, 10);
}

export default function OrderFromStock({ products, records, statusByProduct, venueName, onClose, onCreate, showToast }) {
  const [step, setStep] = useState(1);

  // ── Step 1 state: lines ─────────────────────────────────────────────────
  const optionsByProduct = useMemo(() => {
    const activeSuppliers = new Map();
    for (const r of records) {
      if (r.type === 'supplier' && r.status !== 'paused') activeSuppliers.set(r.id, r);
    }
    const map = new Map();
    for (const p of products) {
      const opts = records
        .filter(r => r.type === 'supplier_item' && r.productId === p.id)
        .filter(i => activeSuppliers.has(i.supplierId) && Number.isFinite(Number(i.price)))
        .map(i => ({ item: i, supplier: activeSuppliers.get(i.supplierId) }))
        .sort((a, b) => Number(a.item.price) - Number(b.item.price));
      map.set(p.id, opts);
    }
    return map;
  }, [records, products]);

  const [lines, setLines] = useState(() => products.map(p => {
    const opts = optionsByProduct.get(p.id) || [];
    const cheapest = opts[0] || null;
    const status = statusByProduct.get(p.id);
    return {
      productId:      p.id,
      productName:    p.name,
      unit:           p.unit,
      currentStock:   status?.stock ?? 0,
      quantity:       String(status?.suggestedQty ?? 1),
      supplierItemId: cheapest?.item.id ?? null,
    };
  }));

  function updateLine(productId, patch) {
    setLines(prev => prev.map(l => l.productId === productId ? { ...l, ...patch } : l));
  }
  function removeLine(productId) {
    setLines(prev => {
      const next = prev.filter(l => l.productId !== productId);
      if (next.length === 0) onClose();
      return next;
    });
  }

  const computedLines = useMemo(() => lines.map(l => {
    const opts = optionsByProduct.get(l.productId) || [];
    const chosen = opts.find(o => o.item.id === l.supplierItemId) || null;
    const qty = Number(l.quantity) || 0;
    const unitPrice = chosen ? Number(chosen.item.price) : 0;
    const minQty    = chosen?.item.minQty ? Number(chosen.item.minQty) : 0;
    return {
      ...l,
      options:   opts,
      chosen,
      qty,
      unitPrice,
      total:     qty * unitPrice,
      minQty,
      belowMin:  minQty > 0 && qty > 0 && qty < minQty,
      itemName:  chosen?.item.itemName || l.productName,
    };
  }), [lines, optionsByProduct]);

  // Группировка по supplierId — каждая группа = одна будущая заявка.
  const groups = useMemo(() => {
    const map = new Map();
    for (const l of computedLines) {
      if (!l.chosen || l.qty <= 0) continue;
      const sid = l.chosen.supplier.id;
      if (!map.has(sid)) map.set(sid, { supplier: l.chosen.supplier, lines: [], total: 0 });
      const g = map.get(sid);
      g.lines.push(l);
      g.total += l.total;
    }
    return [...map.values()];
  }, [computedLines]);

  const orphanLines = computedLines.filter(l => l.options.length === 0);

  // ── Step 2 state: lazy-init when entering step 2 ────────────────────────
  const [step2, setStep2] = useState({
    activeTab:        null,
    desiredDate:      new Map(),  // supplierId → 'YYYY-MM-DD'
    message:          new Map(),  // supplierId → string
    sent:             new Map(),  // supplierId → { number, channel }
  });
  // Поставщики, у которых юзер редактировал текст руками — для них
  // не перегенерируем сообщение при смене даты.
  const [manuallyEdited, setManuallyEdited] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  function goToStep2() {
    if (groups.length === 0) return;
    // Инициализация: дата + текст для каждого поставщика.
    const desired = new Map();
    const message = new Map();
    const defaultDate = defaultDesiredDate();
    for (const g of groups) {
      desired.set(g.supplier.id, defaultDate);
      const items = g.lines.map(l => ({
        itemName: l.itemName, quantity: l.qty, unit: l.unit,
      }));
      message.set(g.supplier.id, buildOrderMessage({
        venueName,
        items,
        desiredDate: defaultDate,
        total: g.total,
        currency: CURRENCY,
      }));
    }
    setStep2({
      activeTab: groups[0].supplier.id,
      desiredDate: desired,
      message,
      sent: new Map(),
    });
    setStep(2);
  }

  function updateStep2(patch) {
    setStep2(prev => ({ ...prev, ...patch }));
  }
  function setActiveTab(supplierId) {
    updateStep2({ activeTab: supplierId });
  }
  function setDesiredDate(supplierId, date) {
    const next = new Map(step2.desiredDate);
    next.set(supplierId, date);
    // Перегенерируем сообщение с новой датой только если юзер не редактировал
    // его руками — иначе затирали бы правки.
    const g = groups.find(x => x.supplier.id === supplierId);
    if (g && !manuallyEdited.has(supplierId)) {
      const items = g.lines.map(l => ({ itemName: l.itemName, quantity: l.qty, unit: l.unit }));
      const newMsg = buildOrderMessage({
        venueName, items, desiredDate: date, total: g.total, currency: CURRENCY,
      });
      const msgs = new Map(step2.message);
      msgs.set(supplierId, newMsg);
      updateStep2({ desiredDate: next, message: msgs });
    } else {
      updateStep2({ desiredDate: next });
    }
  }
  function setMessage(supplierId, text) {
    const next = new Map(step2.message);
    next.set(supplierId, text);
    updateStep2({ message: next });
    setManuallyEdited(prev => {
      if (prev.has(supplierId)) return prev;
      const n = new Set(prev); n.add(supplierId); return n;
    });
  }

  function buildOrderPayload(group, { status, sentVia = null, messageText = null }) {
    return {
      type:         'order',
      status,
      supplierId:   group.supplier.id,
      supplierName: group.supplier.name,
      items: group.lines.map(l => ({
        itemId:    l.chosen.item.id,
        itemName:  l.itemName,
        unit:      l.unit,
        quantity:  l.qty,
        unitPrice: l.unitPrice,
        currency:  l.chosen.item.currency || CURRENCY,
        total:     l.total,
      })),
      totalAmount: group.total,
      currency:    CURRENCY,
      desiredDate: step2.desiredDate.get(group.supplier.id) || null,
      sentVia,
      sentAt:      sentVia ? Date.now() : null,
      messageText: sentVia ? messageText : null,
      note:        '',
    };
  }

  function advanceToNextUnsent(currentSupplierId, newSentMap) {
    const idx = groups.findIndex(g => g.supplier.id === currentSupplierId);
    if (idx === -1) return;
    const rest = groups.slice(idx + 1).concat(groups.slice(0, idx));
    const next = rest.find(g => !newSentMap.has(g.supplier.id));
    if (next) updateStep2({ activeTab: next.supplier.id });
  }

  async function handleSendChannel(supplierId, channel) {
    const group = groups.find(g => g.supplier.id === supplierId);
    if (!group) return;
    const text = step2.message.get(supplierId) || '';

    // Открываем диплинк СИНХРОННО (user gesture preserved).
    const { ok, viberClipboard } = openOrderChannel(channel, group.supplier, text);
    if (!ok) {
      showToast(`Нет контакта для канала «${channelLabel(channel)}»`, 'error');
      return;
    }

    // Сохраняем заявку параллельно — на UX это не влияет, диплинк уже открыт.
    setBusy(true);
    try {
      const order = await onCreate(buildOrderPayload(group, {
        status: 'submitted', sentVia: channel, messageText: text,
      }));
      const newSent = new Map(step2.sent);
      newSent.set(supplierId, { number: order.number, channel });
      updateStep2({ sent: newSent });
      showToast(
        `${order.number} → ${channelLabel(channel)}${viberClipboard ? ' (текст в буфере)' : ''}`
      );
      advanceToNextUnsent(supplierId, newSent);
    } catch (e) {
      showToast(`Ошибка сохранения: ${e.message || e}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveDraft(supplierId) {
    const group = groups.find(g => g.supplier.id === supplierId);
    if (!group) return;
    setBusy(true);
    try {
      const order = await onCreate(buildOrderPayload(group, { status: 'draft' }));
      const newSent = new Map(step2.sent);
      newSent.set(supplierId, { number: order.number, channel: 'draft' });
      updateStep2({ sent: newSent });
      showToast(`Сохранён черновик: ${order.number}`);
      advanceToNextUnsent(supplierId, newSent);
    } catch (e) {
      showToast(`Ошибка сохранения: ${e.message || e}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const titleStep = step === 1 ? 'корзина' : 'отправка';
  const sentCount = step2.sent.size;
  const totalGroups = groups.length;

  return (
    <Modal
      title={`Заказ со склада · ${titleStep}`}
      onClose={onClose}
      onSave={step === 1 ? goToStep2 : onClose}
      saving={busy}
      saveLabel={step === 1
        ? (groups.length > 0
            ? `Далее → (${groups.length} ${nplural(groups.length, ['заявка','заявки','заявок'])})`
            : 'Далее →')
        : (sentCount === totalGroups && totalGroups > 0
            ? 'Готово'
            : 'Закрыть')}
      disabled={step === 1 ? groups.length === 0 : false}
    >
      {step === 1 && (
        <Step1Cart
          computedLines={computedLines}
          orphanLines={orphanLines}
          groups={groups}
          updateLine={updateLine}
          removeLine={removeLine}
        />
      )}
      {step === 2 && (
        <Step2Send
          groups={groups}
          step2={step2}
          busy={busy}
          setActiveTab={setActiveTab}
          setDesiredDate={setDesiredDate}
          setMessage={setMessage}
          onSendChannel={handleSendChannel}
          onSaveDraft={handleSaveDraft}
          onBackToCart={() => setStep(1)}
        />
      )}
    </Modal>
  );
}

// ── Step 1 ──────────────────────────────────────────────────────────────────

function Step1Cart({ computedLines, orphanLines, groups, updateLine, removeLine }) {
  return (
    <div className="ofs-list">
      {computedLines.map(l => l.options.length === 0 ? null : (
        <div key={l.productId} className="ofs-line">
          <div className="ofs-line-head">
            <div>
              <div className="ofs-line-name">{l.productName}</div>
              <div className="ofs-line-stock">Остаток: {l.currentStock} {l.unit}</div>
            </div>
            <button
              className="ofs-line-remove"
              title="Убрать из заказа"
              onClick={() => removeLine(l.productId)}
            >
              ✕
            </button>
          </div>

          <div className="ofs-qty-row">
            <label className="ofs-qty-label">Количество</label>
            <input
              type="number" step="0.1" min="0" inputMode="decimal"
              value={l.quantity}
              onChange={e => updateLine(l.productId, { quantity: e.target.value })}
              className={`ofs-qty-input ${l.belowMin ? 'input-error' : ''}`}
            />
            <span className="ofs-qty-unit">{l.unit}</span>
          </div>
          {l.belowMin && (
            <div className="field-hint warn">
              ⚠ Минимальная партия у поставщика: {l.minQty} {l.unit}
            </div>
          )}

          <div className="ofs-suppliers">
            {l.options.map((opt, idx) => (
              <label
                key={opt.item.id}
                className={`ofs-supplier ${l.supplierItemId === opt.item.id ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name={`sup-${l.productId}`}
                  checked={l.supplierItemId === opt.item.id}
                  onChange={() => updateLine(l.productId, { supplierItemId: opt.item.id })}
                />
                <div className="ofs-supplier-info">
                  <div className="ofs-supplier-name">
                    {opt.supplier.name}
                    {idx === 0 && l.options.length > 1 && (
                      <span className="ofs-cheapest">🟢 дешевле всех</span>
                    )}
                  </div>
                  <div className="ofs-supplier-meta">
                    {fmtPrice(opt.item.price)} / {opt.item.unit}
                    {opt.item.deliveryDays ? ` · доставка ${opt.item.deliveryDays} дн.` : ''}
                    {opt.item.minQty ? ` · мин. ${opt.item.minQty} ${opt.item.unit}` : ''}
                  </div>
                </div>
                <div className="ofs-supplier-total">
                  {fmtPrice((Number(l.quantity) || 0) * Number(opt.item.price))}
                </div>
              </label>
            ))}
          </div>
        </div>
      ))}

      {orphanLines.length > 0 && (
        <div className="ofs-orphans">
          <div className="ofs-orphans-title">
            ⚠ Без поставщика ({orphanLines.length})
          </div>
          <div className="ofs-orphans-body">
            У этих товаров нет ни одного активного поставщика в каталоге —
            добавьте позицию во вкладке «Поставщики», чтобы заказать.
          </div>
          <ul className="ofs-orphans-list">
            {orphanLines.map(l => (
              <li key={l.productId}>
                <span>{l.productName}</span>
                <button
                  className="ofs-line-remove"
                  title="Убрать"
                  onClick={() => removeLine(l.productId)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {groups.length > 0 && (
        <div className="ofs-summary">
          <div className="ofs-summary-title">
            Будет создано {groups.length} {nplural(groups.length, ['заявка','заявки','заявок'])}:
          </div>
          <ul className="ofs-summary-list">
            {groups.map(g => (
              <li key={g.supplier.id}>
                <span>{g.supplier.name}</span>
                <span className="ofs-summary-meta">
                  {g.lines.length} {nplural(g.lines.length, ['поз.','поз.','поз.'])} ·{' '}
                  <strong>{fmtPrice(g.total)}</strong>
                </span>
              </li>
            ))}
          </ul>
          <div className="ofs-summary-total">
            Итого: <strong>{fmtPrice(groups.reduce((s, g) => s + g.total, 0))}</strong>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step 2 ──────────────────────────────────────────────────────────────────

function Step2Send({ groups, step2, busy, setActiveTab, setDesiredDate, setMessage, onSendChannel, onSaveDraft, onBackToCart }) {
  const activeGroup = groups.find(g => g.supplier.id === step2.activeTab);
  return (
    <div className="ofs-send">
      <button className="ofs-back-link" onClick={onBackToCart}>← К корзине</button>

      <div className="ofs-tabs">
        {groups.map(g => {
          const sent = step2.sent.get(g.supplier.id);
          const isActive = g.supplier.id === step2.activeTab;
          return (
            <button
              key={g.supplier.id}
              className={`ofs-tab ${isActive ? 'active' : ''} ${sent ? 'sent' : ''}`}
              onClick={() => setActiveTab(g.supplier.id)}
            >
              <span className="ofs-tab-name">{g.supplier.name}</span>
              <span className="ofs-tab-meta">
                {sent ? `✓ ${sent.channel === 'draft' ? 'черновик' : channelLabel(sent.channel)}`
                      : fmtPrice(g.total)}
              </span>
            </button>
          );
        })}
      </div>

      {activeGroup && (
        <Step2GroupForm
          group={activeGroup}
          desiredDate={step2.desiredDate.get(activeGroup.supplier.id) || ''}
          message={step2.message.get(activeGroup.supplier.id) || ''}
          sent={step2.sent.get(activeGroup.supplier.id) || null}
          busy={busy}
          onDateChange={d => setDesiredDate(activeGroup.supplier.id, d)}
          onMessageChange={t => setMessage(activeGroup.supplier.id, t)}
          onSendChannel={ch => onSendChannel(activeGroup.supplier.id, ch)}
          onSaveDraft={() => onSaveDraft(activeGroup.supplier.id)}
        />
      )}
    </div>
  );
}

function Step2GroupForm({ group, desiredDate, message, sent, busy, onDateChange, onMessageChange, onSendChannel, onSaveDraft }) {
  const channels = availableChannels(group.supplier);

  if (sent) {
    return (
      <div className="ofs-sent-card">
        <div className="ofs-sent-icon">✓</div>
        <div>
          <div className="ofs-sent-title">
            {sent.channel === 'draft'
              ? `Сохранён черновик ${sent.number}`
              : `Заявка ${sent.number} отправлена через ${channelLabel(sent.channel)}`}
          </div>
          <div className="ofs-sent-hint">
            {sent.channel === 'draft'
              ? 'Можно открыть на вкладке «Заявки» и отправить позже.'
              : 'Перейдите в открывшийся клиент и подтвердите отправку сообщения.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ofs-send-form">
      <div className="form-group">
        <label>Желаемая дата поставки</label>
        <input
          type="date"
          value={desiredDate}
          onChange={e => onDateChange(e.target.value)}
          min={todayIsoForInput()}
        />
      </div>

      <div className="form-group">
        <label>Текст сообщения <span className="label-hint">(можно править)</span></label>
        <textarea
          rows={10}
          value={message}
          onChange={e => onMessageChange(e.target.value)}
          className="ofs-message"
        />
      </div>

      <div className="ofs-channels">
        {ORDER_CHANNELS.map(ch => {
          const available = channels.includes(ch);
          return (
            <button
              key={ch}
              className={`ofs-channel ${available ? '' : 'disabled'}`}
              onClick={() => available && onSendChannel(ch)}
              disabled={!available || busy}
              title={available ? '' : `У поставщика не заполнен контакт «${channelLabel(ch)}»`}
            >
              <span className="ofs-channel-icon">{channelIcon(ch)}</span>
              <span>{channelLabel(ch)}</span>
            </button>
          );
        })}
      </div>
      {channels.length === 0 && (
        <div className="field-hint warn">
          ⚠ У поставщика не заполнены контакты для отправки. Добавьте email, Telegram
          или Viber в карточке поставщика — либо сохраните как черновик.
        </div>
      )}

      <button
        className="btn btn-ghost btn-block ofs-draft-btn"
        onClick={onSaveDraft}
        disabled={busy}
      >
        Сохранить как черновик (без отправки)
      </button>
    </div>
  );
}

function todayIsoForInput() {
  return todayIso();
}
