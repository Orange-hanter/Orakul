"""
Async HTTP-клиент для QuickResto Back Office API v2.92.

- Авторизация через /api/authByUserPasswordLogin
- Пагинация (limit + offset)
- Retry с exponential backoff (tenacity)
- Rate limiting (asyncio.semaphore)
- Повторная авторизация при истечении токена
"""

import asyncio
import json
import logging
from typing import Any, Optional
from urllib.parse import urlencode

import aiohttp
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from config import config

logger = logging.getLogger(__name__)


class QRAuthenticationError(Exception):
    pass


class QRApiError(Exception):
    def __init__(self, message: str, status: int = 0, response_body: Optional[str] = None):
        super().__init__(message)
        self.status = status
        self.response_body = response_body


class QuickRestoClient:
    """Async клиент для QuickResto API."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
        timeout: Optional[int] = None,
        max_retries: Optional[int] = None,
        rpm: Optional[int] = None,
    ):
        self.base_url = (base_url or config.qr_api_url).rstrip('/')
        self.username = username or config.QR_USERNAME
        self.password = password or config.QR_PASSWORD
        self.timeout = aiohttp.ClientTimeout(total=(timeout or config.HTTP_TIMEOUT))
        self.max_retries = max_retries or config.MAX_RETRIES

        # Rate limiting
        self._semaphore = asyncio.Semaphore(
            max(1, (rpm or config.RATE_LIMIT_RPM) // 60)  # requests per second
        )
        self._last_request_time: float = 0.0
        self._min_interval: float = 60.0 / max(1, (rpm or config.RATE_LIMIT_RPM))

        # Token state
        self._token: Optional[str] = None
        self._auth_payload: Optional[str] = None
        self._session: Optional[aiohttp.ClientSession] = None

    # ── Session lifecycle ──────────────────────────────────────────

    async def __aenter__(self) -> 'QuickRestoClient':
        self._session = aiohttp.ClientSession(timeout=self.timeout)
        await self._ensure_auth()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._session:
            await self._session.close()
            self._session = None

    # ── Authentication ─────────────────────────────────────────────

    def _build_auth_payload(self) -> str:
        """Конструирует hex-encoded username:password для X-Authorization."""
        creds = f"{self.username}:{self.password}"
        return creds.encode('utf-8').hex()

    async def _authenticate(self) -> str:
        """Получает токен через /api/authByUserPasswordLogin."""
        auth_url = f"{self.base_url}/api/authByUserPasswordLogin"
        payload = self._build_auth_payload()
        headers = {
            "Content-Type": "application/json",
            "X-Authorization": payload,
        }

        logger.info("QR auth: requesting token for %s", self.username)
        async with self._semaphore:
            async with self._session.post(auth_url, headers=headers) as resp:
                body = await resp.text()
                if resp.status != 200:
                    logger.error("QR auth failed: HTTP %s — %s", resp.status, body[:500])
                    raise QRAuthenticationError(
                        f"Auth failed: HTTP {resp.status} — {body[:200]}"
                    )
                data = json.loads(body)
                token = data.get("token")
                if not token:
                    raise QRAuthenticationError(f"No token in auth response: {body[:200]}")
                logger.info("QR auth: token acquired (len=%s)", len(token))
                return token

    async def _ensure_auth(self):
        """Проверяет наличие токена; если нет — получает."""
        if not self._token:
            self._token = await self._authenticate()

    # ── Request helpers ────────────────────────────────────────────

    async def _maybe_wait(self):
        """Rate limiter: не отправляет запросы чаще чем раз в N секунд."""
        now = asyncio.get_event_loop().time()
        elapsed = now - self._last_request_time
        if elapsed < self._min_interval:
            wait_for = self._min_interval - elapsed
            if config.DEBUG:
                logger.debug("Rate limit: waiting %.2fs", wait_for)
            await asyncio.sleep(wait_for)
        self._last_request_time = asyncio.get_event_loop().time()

    @retry(
        retry=retry_if_exception_type((aiohttp.ClientError, asyncio.TimeoutError)),
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        reraise=True,
    )
    async def _request(self, method: str, endpoint: str, **kwargs) -> Any:
        """Base HTTP-запрос с retry + auth + rate limiting."""
        await self._ensure_auth()
        await self._maybe_wait()

        url = f"{self.base_url}{endpoint}"
        headers = kwargs.pop('headers', {})
        headers.setdefault("X-Authorization", self._token)
        headers.setdefault("Content-Type", "application/json")

        async with self._semaphore:
            async with self._session.request(method, url, headers=headers, **kwargs) as resp:
                body = await resp.text()
                if resp.status == 401:
                    # Токен мог истечь — сбрасываем и retry
                    logger.warning("QR: token expired (401), re-authenticating…")
                    self._token = None
                    raise aiohttp.ClientResponseError(
                        resp.request_info, resp.history,
                        status=401, message="Token expired",
                    )
                if resp.status >= 400:
                    logger.error("QR API error: HTTP %s — %s", resp.status, body[:500])
                    raise QRApiError(
                        f"HTTP {resp.status} on {endpoint}",
                        status=resp.status,
                        response_body=body,
                    )
                if not body.strip():
                    return {}
                return json.loads(body)

    async def get(self, endpoint: str, **kwargs) -> Any:
        return await self._request("GET", endpoint, **kwargs)

    async def post(self, endpoint: str, **kwargs) -> Any:
        return await self._request("POST", endpoint, **kwargs)

    # ── High-level API methods ─────────────────────────────────────

    async def list_entities(
        self,
        module_name: str,
        limit: int = None,
        offset: int = 0,
        filters: Optional[list] = None,
        **extra_params
    ) -> list:
        """
        GET /api/list?moduleName={module_name}
        С автоматической пагинацией.

        Возвращает список словарей (entities).
        """
        page_size = limit or config.PAGE_SIZE
        all_items: list = []
        current_offset = offset
        total_cycles = 0

        while True:
            params = {
                "moduleName": module_name,
                "limit": page_size,
                "offset": current_offset,
            }
            if filters:
                # QR API принимает фильтры как JSON-массив строкой (?)
                # Пока кодируем простым перебором; при необходимости — сериализация
                for idx, filt in enumerate(filters):
                    params[f"filter[{idx}]"] = json.dumps(filt)
            params.update(extra_params)

            query = urlencode(params, doseq=True)
            endpoint = f"/api/list?{query}"

            if config.DEBUG:
                logger.debug("QR list: %s (offset=%s, limit=%s)", module_name, current_offset, page_size)

            data = await self.get(endpoint)

            # Ответ может быть dict с полем 'result' или list напрямую
            items = data if isinstance(data, list) else (data.get("result") or data.get("rows", []))
            if not items:
                break

            all_items.extend(items)
            current_offset += len(items)
            total_cycles += 1

            # Защита от бесконечного цикла
            if len(items) < page_size:
                break
            if total_cycles > 1000:
                logger.warning("QR list: breaking after 1000 pages for %s", module_name)
                break

        logger.info("QR list: %s — fetched %s items", module_name, len(all_items))
        return all_items

    async def get_entity(self, module_name: str, entity_id: str) -> dict:
        """
        GET /api/find?moduleName={module_name}
        Получение одной сущности по ID.
        """
        params = {"moduleName": module_name}
        query = urlencode(params)
        endpoint = f"/api/find?{query}"
        payload = json.dumps({"id": entity_id})

        data = await self.post(endpoint, data=payload)
        return data if isinstance(data, dict) else (data.get("result") or {})
