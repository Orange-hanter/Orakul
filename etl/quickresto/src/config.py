"""
Orakul QuickResto ETL Connector — конфигурация.

Читает переменные окружения из .env (или переданные напрямую).
Поддерживает SQLite (default/MVP) и PostgreSQL backends.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Путь к корню проекта Orakul
PROJECT_ROOT = Path(__file__).resolve().parents[2]  # etl/quickresto/src → etl/quickresto → Orakul

# Смотрим .env — более специфичные приоритетнее
def _load_env():
    # Поиск: сначала ETL-корень (наиболее специфичный), потом общий
    paths = [
        Path(__file__).parent.parent / '.env',   # etl/quickresto/.env
        PROJECT_ROOT / '.env',
        PROJECT_ROOT / 'app' / '.env',
    ]
    for p in paths:
        if p.exists():
            load_dotenv(p, override=True)  # последний загруженный выигрывает
            break  # берем первый найденный из приоритизированного списка


def _print_env_debug():
    """Выводит найденные переменные для диагностики."""
    for key in ('QR_USERNAME', 'QR_PASSWORD', 'QR_BASE_URL', 'QR_SSL_VERIFY'):
        print(f"  {key}={os.getenv(key, '')}")

_load_env()


class Config:
    """Runtime-конфигурация ETL."""

    # ── QuickResto API ─────────────────────────────────────────────
    QR_BASE_URL: str = os.getenv('QR_BASE_URL', '')
    QR_USERNAME: str = os.getenv('QR_USERNAME', '')
    QR_PASSWORD: str = os.getenv('QR_PASSWORD', '')
    QR_LAYER:    str = os.getenv('QR_LAYER', 'web')
    # ⚠️ ОТКЛЮЧАЕТ SSL VERIFY. Только для VPN/корп.сетей. Не на проде.
    QR_SSL_VERIFY: bool = os.getenv('QR_SSL_VERIFY', 'true').lower() not in ('false', '0', 'no', 'off')

    # Собираем полный URL если baseUrl задан частично
    @property
    def qr_api_url(self) -> str:
        if self.QR_BASE_URL.startswith('http'):
            return self.QR_BASE_URL.rstrip('/')
        # Схема по умолчанию
        return f"https://{self.QR_LAYER}.quickresto.ru/platform/online/api"

    # ── ETL runtime ────────────────────────────────────────────────
    # Режим работы БД: sqlite | postgres
    DB_BACKEND: str = os.getenv('ETL_DB_BACKEND', 'sqlite').lower()

    # SQLite (MVP)
    SQLITE_PATH: str = os.getenv(
        'ETL_SQLITE_PATH',
        str(PROJECT_ROOT / 'etl' / 'quickresto' / 'data' / 'etl.db')
    )

    # PostgreSQL
    POSTGRES_DSN: str = os.getenv('ETL_POSTGRES_DSN', '')
    # fallback на разобранные компоненты
    POSTGRES_HOST: str = os.getenv('POSTGRES_HOST', 'localhost')
    POSTGRES_PORT: int = int(os.getenv('POSTGRES_PORT', '5432'))
    POSTGRES_DB:   str = os.getenv('POSTGRES_DB', 'orakul')
    POSTGRES_USER: str = os.getenv('POSTGRES_USER', 'orakul')
    POSTGRES_PASS: str = os.getenv('POSTGRES_PASS', '')

    @property
    def postgres_dsn(self) -> str:
        if self.POSTGRES_DSN:
            return self.POSTGRES_DSN
        return (
            f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASS}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    # ── Поведение синхронизации ────────────────────────────────────
    # Лимит на запросы в минуту (≤60 рекомендует документация)
    RATE_LIMIT_RPM: int = int(os.getenv('ETL_RATE_LIMIT_RPM', '60'))
    # Задержка между запросами к API (сек)
    REQUEST_DELAY: float = float(os.getenv('ETL_REQUEST_DELAY', '1.0'))
    # Page size для пагинации
    PAGE_SIZE: int = int(os.getenv('ETL_PAGE_SIZE', '100'))
    # Максимум попыток для retry
    MAX_RETRIES: int = int(os.getenv('ETL_MAX_RETRIES', '5'))
    # Базовая задержка backoff (сек)
    BACKOFF_BASE: float = float(os.getenv('ETL_BACKOFF_BASE', '2.0'))
    # Таймаут HTTP (сек)
    HTTP_TIMEOUT: int = int(os.getenv('ETL_HTTP_TIMEOUT', '30'))
    # Debug-логирование
    DEBUG: bool = os.getenv('ETL_DEBUG', '').lower() in ('1', 'true', 'yes')

    # ── Venue / location ───────────────────────────────────────────
    # Default venueId — если не указан в настройках интеграции
    DEFAULT_VENUE_ID: str = os.getenv('ETL_DEFAULT_VENUE_ID', '')

    # ── Recon state file ───────────────────────────────────────────
    STATE_PATH: str = os.getenv(
        'ETL_STATE_PATH',
        str(PROJECT_ROOT / 'etl' / 'quickresto' / 'data' / 'state.json')
    )


# Singleton
config = Config()
