---
Документ: Telegram Notification Spec
Версия: 1.0
Дата: 2026-05-09
Статус: Утверждён
Владелец: Tech Lead + Продакт
Связанные документы: [MVP Architecture](00-mvp-architecture.md), [Data Model & Pipeline](02-data-model-and-pipeline.md), [PRD §9](../03-product/01-product-requirements-document.md), [User Stories US-01, US-08](../03-product/02-user-stories.md)
---

# Telegram Notification Spec

## 0. Принципы

1. **Меньше — лучше.** Пользователь, получающий 20 сообщений в день, перестаёт читать все. Приоритет — качество каждого алёрта, а не полнота охвата.
2. **Каждое сообщение = один чёткий вопрос или действие.** «Молоко закончится завтра — нужно заказать» — ОК. «Есть несколько ситуаций, на которые стоит обратить внимание» — не ОК.
3. **Обоснование всегда.** В соответствии с принципом [PRD §3](../03-product/01-product-requirements-document.md) — «Always explain». Цифры, не магия.
4. **Тихие часы — жёсткие.** Кроме `CRITICAL` (depletes < 1 дня) ничего не уходит в 22:00–07:00.
5. **Пользователь контролирует шум.** Команда `/mute` и отложенные алёрты — часть MVP, а не бонус.

---

## 1. Типы сообщений

| Тип | Триггер | Когда отправляется | Кому |
|-----|---------|-------------------|------|
| `CRITICAL` | days_to_depletion < 1 | Немедленно, игнорирует тихие часы | Управляющий точкой |
| `WARNING` | days_to_depletion 1–2 | Немедленно в рабочее время, иначе в 07:00 | Управляющий точкой |
| `DIGEST_MORNING` | Ежедневно 07:00 | 07:00 | Управляющий точкой |
| `ANOMALY` | deviation_pct > threshold | Утренний дайджест | Управляющий + опционально опердир |
| `INFRA` | ETL failed / data staleness > 2h | Немедленно | Оператор (технический) |
| `WEEKLY_REPORT` | Еженедельно в пн 08:00 | 08:00 пн | Опердир, собственник |

---

## 2. Шаблоны сообщений

Используем Markdown (mode=`MarkdownV2` в Telegram).

### 2.1 CRITICAL — скоро закончится (<1 дня)

```
🔴 *Критично* — «Молоко 3,2%»

Текущий остаток: *8,4 кг*
Прогноз расхода сегодня: *11,2 кг*
⏰ Закончится примерно через *18 ч*

📊 _Basis: среднее за 7 дней (9,8 кг/день) × коэффициент пятницы (1,14)_

Рекомендация: заказать минимум *25 кг* (партия поставщика)

👉 /status — все текущие алёрты
👉 /mute 4h — отложить на 4 часа
```

### 2.2 WARNING — заканчивается (1–2 дня)

```
🟠 *Предупреждение* — «Куриное филе»

Текущий остаток: *3,2 кг*
Осталось примерно: *~36 ч*

📊 _Прогноз: 2,1 кг/день; модель: baseline MA7 (MAPE 8%)_

💡 Проверить заказ или ускорить поставку
```

### 2.3 DIGEST_MORNING — утренний дайджест (07:00)

```
☀️ *Доброе утро! Ресторан «Название»* — 09 мая

─────────────────────────────
🔴 *Срочно (сегодня):*
• Сливки 33% — 6 ч до окончания
• Говяжий фарш — 14 ч до окончания

🟠 *Скоро (завтра):*
• Пармезан — 1,8 дня
• Базилик свежий — 1,6 дня

🟡 *На этой неделе:*
• Оливковое масло — 4,2 дня
• Тигровые креветки — 5,1 дня
─────────────────────────────
⚠️ *Аномалии расхода вчера:*
• Лосось — +34% к норме (107 г vs 80 г/порция)

✅ Всё остальное в норме

👉 /stock лосось — детали по позиции
👉 /forecast — полный прогноз
```

> Правило: утренний дайджест отправляется **всегда**, даже если всё в норме (последняя строка `✅ Всё остальное в норме`). Нет дайджеста → пользователь думает, что бот сломан.

### 2.4 ANOMALY — аномалия расхода

```
📉 *Аномалия расхода* — «Лосось атлантический»

Вчера (08.05): использовано *21,4 кг*
Норма по рецептурам: *15,8 кг*
Отклонение: *+35%* (🔴 выше порога 20%)

📊 _Смена 14:00–22:00, управляющий Анна С._
_Продано 94 порции «лосось гриль» × 80 г = 7,5 кг_
_Продано 68 порций «сёмга слабосол.» × 120 г = 8,2 кг_
_Итого теор.: 15,8 кг | Факт. расход: 21,4 кг_

💬 Если причина известна — прокомментируйте:
👉 /comment лосось Вчера новая партия, другая жирность
```

### 2.5 INFRA — технический алёрт (только оператору)

```
🛑 *[INFRA]* ETL ошибка — products.sales

Ошибка: Connection timeout (Kiepper API)
Попыток: 3/3 | Последний успешный run: 2ч 14 мин назад
Свежесть данных: ⚠️ просрочена (норма ≤15 мин)

📋 Логи: ops.etl_runs ID #4471
Действие: проверить доступность Kiepper API
```

### 2.6 WEEKLY_REPORT — еженедельный отчёт (опердир/собственник)

```
📊 *Еженедельный отчёт* — 5–11 мая, «Сеть "Название"»

*Топ потерь (теор. vs факт, %):*
1. Лосось        +18% ↑  (было +9% на прошлой нед)
2. Говяжий фарш  +14% ↑
3. Сливки        +11% →

*Стоп-листов из-за нехватки:* 2 (лосось пн, говядина пт)

*Adoption AI-рекомендаций:* 76% (+8% vs пред.нед)

📈 _MAPE прогноза: 9,4% (цель ≤15% ✅)_
📉 _Аномалий выявлено: 12 | Прокомментировано: 8_

👉 /anomalies — детали всех аномалий
```

---

## 3. Команды бота

| Команда | Описание | Ответ |
|---------|----------|-------|
| `/start <token>` | Привязка чата к точке и роли | Приветствие + подтверждение |
| `/status` | Текущие алёрты по точке | Список активных алёртов |
| `/stock <ингредиент>` | Остаток + прогноз по ингредиенту | Карточка ингредиента |
| `/forecast` | Утренний дайджест по требованию | Полный дайджест |
| `/anomalies [N дней]` | Список аномалий за N дней (по умолч. 7) | Таблица аномалий |
| `/comment <ингредиент> <текст>` | Добавить комментарий к аномалии | Подтверждение сохранения |
| `/mute [N]h` | Тишина на N часов (по умолч. 4) | «Уведомления отложены до HH:MM» |
| `/unmute` | Снять тишину | Подтверждение |
| `/help` | Список команд | Краткая справка |

---

## 4. Правила тихих часов

```python
from datetime import time
import pytz

QUIET_START = time(22, 0)  # 22:00
QUIET_END   = time(7, 0)   # 07:00

def get_scheduled_at(alert_type: str, location_tz: str) -> datetime:
    """Определяет время отправки с учётом тихих часов."""
    tz = pytz.timezone(location_tz)
    now_local = datetime.now(tz)

    if alert_type == 'CRITICAL':
        return now_local  # Всегда немедленно

    current_time = now_local.time()
    in_quiet_hours = (
        current_time >= QUIET_START or current_time < QUIET_END
    )

    if in_quiet_hours:
        # Переносим на 07:00 следующего рабочего дня
        next_morning = now_local.replace(
            hour=7, minute=0, second=0, microsecond=0
        )
        if current_time >= QUIET_START:
            next_morning += timedelta(days=1)
        return next_morning

    return now_local
```

---

## 5. Дедупликация алёртов

Ключ дедупликации в `marts.alerts_queue.dedup_key`:

```python
def build_dedup_key(
    location_id: int,
    ingredient_id: int,
    alert_type: str,
    date: str  # YYYY-MM-DD
) -> str:
    return f"{location_id}:{ingredient_id}:{alert_type}:{date}"
```

**Правило:** алёрт с тем же `dedup_key` не добавляется в очередь, если предыдущий был отправлен менее 4 часов назад.

```sql
INSERT INTO marts.alerts_queue (..., dedup_key)
VALUES (..., :dedup_key)
ON CONFLICT (dedup_key) DO UPDATE
    SET message_text = EXCLUDED.message_text  -- обновляем данные
WHERE marts.alerts_queue.sent_at < NOW() - INTERVAL '4 hours'
   OR marts.alerts_queue.sent_at IS NULL;
```

---

## 6. Подписка — onboarding пользователя

```
Пользователь → /start abc123token

Бот: Привет! Вы подключаетесь к точке «Ресторан Центральный» 
как Управляющий.

Вы будете получать:
• Утренний дайджест (07:00)
• Критические алёрты (в любое время)
• Предупреждения (в рабочее время)
• Аномалии расхода

Часовой пояс: UTC+3 (МСК). Тихие часы: 22:00–07:00.

Для подтверждения напишите: ДА
```

После подтверждения запись в `ops.bot_subscriptions`:

```sql
CREATE TABLE ops.bot_subscriptions (
    id              SERIAL PRIMARY KEY,
    chat_id         BIGINT       NOT NULL UNIQUE,
    location_id     INT          NOT NULL REFERENCES core.locations(id),
    role            VARCHAR(32)  NOT NULL,   -- 'manager' | 'buyer' | 'chef' | 'operator'
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    quiet_start     TIME         NOT NULL DEFAULT '22:00',
    quiet_end       TIME         NOT NULL DEFAULT '07:00',
    subscribed_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    token_used      VARCHAR(64)
);
```

---

## 7. Отправитель (Sender Loop)

```python
import asyncio
from telegram import Bot
from sqlalchemy import text

SEND_INTERVAL_SECONDS = 60  # каждую минуту

async def sender_loop(bot: Bot, db_session):
    while True:
        pending = db_session.execute(text("""
            SELECT aq.id, bs.chat_id, aq.message_text
            FROM marts.alerts_queue aq
            JOIN ops.bot_subscriptions bs ON bs.location_id = aq.location_id
                AND bs.is_active = TRUE
                AND bs.role = ANY(aq.target_roles)
            WHERE NOT aq.is_sent
              AND aq.scheduled_at <= NOW()
            ORDER BY aq.severity DESC, aq.scheduled_at
            LIMIT 20
        """)).fetchall()

        for row in pending:
            try:
                await bot.send_message(
                    chat_id=row.chat_id,
                    text=row.message_text,
                    parse_mode='MarkdownV2'
                )
                db_session.execute(text("""
                    UPDATE marts.alerts_queue
                    SET is_sent = TRUE, sent_at = NOW()
                    WHERE id = :id
                """), {'id': row.id})
                db_session.commit()
            except Exception as e:
                # Логируем ошибку, не падаем — следующая итерация попробует снова
                log.error(f"Failed to send alert {row.id}: {e}")

        await asyncio.sleep(SEND_INTERVAL_SECONDS)
```

---

## 8. Обработка ошибок Telegram

| Ошибка | Действие |
|--------|---------|
| `Unauthorized` (бот заблокирован) | Деактивировать подписку в `ops.bot_subscriptions` |
| `ChatNotFound` | Деактивировать подписку |
| `TooManyRequests` (rate limit) | Exponential backoff, повторить через 30–60 сек |
| `NetworkError` | Логировать, оставить в очереди (`is_sent = FALSE`) |
| Telegram API недоступен >30 мин | INFRA алёрт оператору через email/альтернативный канал |

---

## 9. Тест-план

| Тест | Что проверяем |
|------|--------------|
| Unit: quiet hours | В 23:00 scheduled_at переносится на 07:00 следующего дня |
| Unit: quiet hours CRITICAL | В 23:00 CRITICAL НЕ переносится, scheduled_at = now |
| Unit: dedup_key | Второй алёрт по той же паре не добавляется в очередь |
| Unit: days_in_message | Корректное форматирование 1.8 → «~1 день», 3.4 → «~3 дня» |
| Integration: send loop | Запись из alerts_queue помечается is_sent=TRUE после успешной отправки |
| Manual: digest format | Визуальная проверка в тестовом Telegram-чате |
| Manual: /stock команда | Возвращает актуальный остаток и прогноз |

---

## 10. Changelog

| Версия | Дата | Автор | Изменения |
|--------|------|-------|-----------|
| 1.0 | 2026-05-09 | Tech Lead + Продакт | Первая утверждённая редакция |
