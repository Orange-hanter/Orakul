# Phase A — Recon: сбор недостающих дампов

## Цель
Получить raw JSON для 7 сущностей QR API, у которых есть методы в `client.py`, но нет recon дампов.

## Сущности для recon

| # | Сущность | Client метод | Module / ClassName | Приоритет |
|---|----------|------------|-------------------|-----------|
| A1 | CookingInvoice | `list_cooking_invoices()` | `warehouse.documents.cooking` / `CookingInvoice` | 🔴 |
| A2 | OutgoingInvoice | `list_outgoing_invoices()` | `warehouse.documents.outgoing` / `OutgoingInvoice` | 🟡 |
| A3 | DecompositionInvoice | `list_decomposition_invoices()` | `warehouse.documents.decomposition` / `DecompositionInvoice` | 🟢 |
| A4 | ProcessingInvoice | `list_processing_invoices()` | `warehouse.documents.processing` / `ProcessingInvoice` | 🟢 |
| A5 | ConcreteProvider | `list_concrete_providers()` | `warehouse.providers.concrete` / `ConcreteProvider` | 🟡 |
| A6 | OrderInfo | `list_orders()` | `front.orders` / `OrderInfo` | 🟢 |
| A7 | Shift | `list_shifts()` | `front.zreport` / `Shift` | 🔴 |

## Команда запуска

```bash
cd ~/Git/_my/Mozarella/Orakul/etl/quickresto
PYTHONPATH=src python -m src.recon_probe --entities cooking_invoice,outgoing_invoice,decomposition_invoice,processing_invoice,concrete_provider,order_info,shift
```

## DoD
- [ ] В `data/recon/` появились JSON файлы для всех 7 сущностей
- [ ] Каждый дамп содержит ≥1 запись
- [ ] Структура записей задокументирована (keys top-level)

## Примечание
Если `--entities` не поддерживается в текущем `recon_probe.py`, добавить аргумент `cli_args` в `main()`.
