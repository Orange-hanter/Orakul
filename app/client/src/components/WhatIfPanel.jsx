import { useState, useMemo } from 'react';
import { simulatePriceChange, priceForTargetFC } from '../utils/whatIf.js';

/*
 * AI06 — inline-панель «Что если?» внутри модалки редактирования блюда (MenuTab).
 *
 * Принцип PRD §3 «Recommend, don't act»: симулятор ничего не сохраняет.
 * Менеджер видит «если поставить 24 BYN — маржа +3, недельная прибыль +210»
 * и сам решает, применять ли.
 */

function fmtMoney(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return Number(n).toFixed(2);
}
function fmtPct(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}
function fmtSigned(n, decimals = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const s = n.toFixed(decimals);
  return n > 0 ? `+${s}` : s;
}

export default function WhatIfPanel({ dish, supplierItems, suppliers, sales }) {
  const [newPrice, setNewPrice] = useState(() =>
    Number.isFinite(Number(dish.sellPrice)) && Number(dish.sellPrice) > 0
      ? String(dish.sellPrice)
      : ''
  );

  const numeric = Number(newPrice);
  const sim = useMemo(
    () => simulatePriceChange(dish, numeric, supplierItems, suppliers, sales),
    [dish, numeric, supplierItems, suppliers, sales]
  );
  const targetPrice30 = useMemo(
    () => sim && sim.cost ? priceForTargetFC(sim.cost, 30) : null,
    [sim]
  );

  if (!sim) return null;

  return (
    <div style={{
      marginTop: 12, padding: 12,
      background: '#f8fafc', borderRadius: 8, border: '1px solid var(--border)',
    }}>
      <div style={{ fontWeight: 700, marginBottom: 8, color: 'var(--primary)' }}>
        🎯 Что если изменить цену?
      </div>

      <div className="form-group" style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 11 }}>Новая цена продажи (BYN)</label>
        <input
          type="number"
          step="0.10"
          min="0"
          inputMode="decimal"
          value={newPrice}
          onChange={e => setNewPrice(e.target.value)}
          placeholder={dish.sellPrice ? String(dish.sellPrice) : '20.00'}
        />
        {targetPrice30 !== null && (
          <div style={{ fontSize: 11, color: 'var(--neutral)', marginTop: 4 }}>
            Подсказка: при FC 30% цена ≈ <strong>{fmtMoney(targetPrice30)} BYN</strong>{' '}
            <button
              type="button"
              className="btn btn-ghost"
              style={{ height: 24, fontSize: 11, padding: '0 8px', marginLeft: 4 }}
              onClick={() => setNewPrice(targetPrice30.toFixed(2))}
            >
              применить
            </button>
          </div>
        )}
      </div>

      {!sim.feasible ? (
        <div style={{ fontSize: 12, color: 'var(--warning)' }}>
          {sim.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      ) : (
        <>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--neutral)', fontWeight: 600 }}>
                <th style={{ textAlign: 'left', padding: '4px 0' }}></th>
                <th style={{ textAlign: 'right', padding: '4px 0' }}>Сейчас</th>
                <th style={{ textAlign: 'right', padding: '4px 0' }}>Новое</th>
                <th style={{ textAlign: 'right', padding: '4px 0' }}>Δ</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Цена</td>
                <td style={{ textAlign: 'right' }}>{fmtMoney(sim.currentSellPrice)}</td>
                <td style={{ textAlign: 'right' }}><strong>{fmtMoney(sim.newSellPrice)}</strong></td>
                <td style={{ textAlign: 'right', color: 'var(--neutral)' }}>
                  {sim.currentSellPrice !== null ? fmtSigned(sim.newSellPrice - sim.currentSellPrice) : '—'}
                </td>
              </tr>
              <tr>
                <td>Маржа/порц.</td>
                <td style={{ textAlign: 'right' }}>{fmtMoney(sim.currentMargin)}</td>
                <td style={{ textAlign: 'right' }}><strong>{fmtMoney(sim.newMargin)}</strong></td>
                <td style={{ textAlign: 'right', color: sim.marginDelta > 0 ? 'var(--success)' : sim.marginDelta < 0 ? 'var(--danger)' : 'var(--neutral)' }}>
                  <strong>{fmtSigned(sim.marginDelta)}</strong>
                </td>
              </tr>
              <tr>
                <td>Food Cost</td>
                <td style={{ textAlign: 'right' }}>{fmtPct(sim.currentFC)}</td>
                <td style={{ textAlign: 'right' }}><strong>{fmtPct(sim.newFC)}</strong></td>
                <td style={{ textAlign: 'right', color: sim.fcDelta !== null && sim.fcDelta < 0 ? 'var(--success)' : sim.fcDelta > 0 ? 'var(--danger)' : 'var(--neutral)' }}>
                  {sim.fcDelta !== null ? fmtSigned(sim.fcDelta, 1) + ' п.п.' : '—'}
                </td>
              </tr>
            </tbody>
          </table>

          <div style={{
            marginTop: 8, padding: 8,
            background: '#fff', border: '1px solid var(--border)', borderRadius: 6,
            fontSize: 13,
          }}>
            <div style={{ color: 'var(--neutral)', fontSize: 11 }}>
              За последние {sim.volumeDays} дн. продано {sim.volumeRecent} порц.
            </div>
            <div style={{ marginTop: 4 }}>
              Недельная маржа изменится на{' '}
              <strong style={{ color: sim.weeklyMarginDelta > 0 ? 'var(--success)' : sim.weeklyMarginDelta < 0 ? 'var(--danger)' : 'inherit' }}>
                {fmtSigned(sim.weeklyMarginDelta, 0)} BYN
              </strong>
              {sim.volumeRecent === 0 && (
                <span style={{ color: 'var(--neutral)' }}> · нет продаж — внесите их в «Продажи дня»</span>
              )}
            </div>
          </div>

          {sim.warnings.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--warning)' }}>
              {sim.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
