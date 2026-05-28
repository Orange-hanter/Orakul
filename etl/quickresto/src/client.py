"""
Async HTTP-клиент для QuickResto Back Office API v2.92.

- Basic Auth на каждом запросе (Authorization: Basic base64(user:pass))
- Базовый URL из config.qr_api_url
- Retry с exponential backoff (tenacity)
- Rate limiting (asyncio.semaphore)
- SSL verify: QR_SSL_VERIFY=false для VPN
"""

import asyncio
import base64
import json
import logging
from typing import Any, Optional
from urllib.parse import urlencode, parse_qs

import aiohttp
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from config import config

logger = logging.getLogger(__name__)


class QRApiError(Exception):
    def __init__(self, message: str, status: int = 0, response_body: Optional[str] = None):
        super().__init__(message)
        self.status = status
        self.response_body = response_body


class QuickRestoClient:
    """Async клиент для QuickResto API.

    Конфигурация берётся из config (src/config.py):
      - QR_BASE_URL       https://vt786.quickresto.ru/platform/online
      - QR_USERNAME       vt786
      - QR_PASSWORD       ***
      - QR_SSL_VERIFY     false при VPN

    Все запросы идут с заголовком Authorization: Basic base64(user:pass)
    """

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

        # Двухуровневая защита: sem ограничивает одновременные запросы,
        # _maybe_wait делает rate limiting по RPS
        self._semaphore = asyncio.Semaphore(
            max(1, (rpm or config.RATE_LIMIT_RPM) // 60)  # requests per second
        )
        self._last_request_time: float = 0.0
        self._min_interval: float = 60.0 / max(1, (rpm or config.RATE_LIMIT_RPM))

        # SSL verify flag (может быть False при VPN/корп.инспекции)
        self._ssl = config.QR_SSL_VERIFY
        if not self._ssl:
            logger.warning("⚠️  QR_SSL_VERIFY=false — SSL certificate verification DISABLED!")

        self._session: Optional[aiohttp.ClientSession] = None

    # ── Session lifecycle ──────────────────────────────────────────

    async def __aenter__(self) -> 'QuickRestoClient':
        ssl_ctx = False if not self._ssl else None
        conn = aiohttp.TCPConnector(ssl=ssl_ctx)
        self._session = aiohttp.ClientSession(
            timeout=self.timeout,
            connector=conn,
        )
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._session:
            await self._session.close()
            self._session = None

    # ── Auth helpers ───────────────────────────────────────────────

    def _basic_auth_header(self) -> str:
        """Authorization: Basic base64(username:password)"""
        creds = f"{self.username}:{self.password}"
        return f"Basic {base64.b64encode(creds.encode('utf-8')).decode('utf-8')}"

    # ── Rate limiting ─────────────────────────────────────────────

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

    # ── Base request ──────────────────────────────────────────────

    @retry(
        retry=retry_if_exception_type((aiohttp.ClientError, asyncio.TimeoutError)),
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        reraise=True,
    )
    async def _request(self, method: str, endpoint: str, **kwargs) -> Any:
        """Base HTTP-запрос с retry + Basic Auth + rate limiting."""
        if not self._session:
            raise RuntimeError("Client not entered — use 'async with QuickRestoClient() as client:'")

        await self._maybe_wait()

        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        headers = kwargs.pop('headers', {})
        headers.setdefault("Authorization", self._basic_auth_header())
        headers.setdefault("Content-Type", "application/json")

        if config.DEBUG:
            logger.debug("REQUEST %s %s", method, url)

        async with self._semaphore:
            async with self._session.request(method, url, headers=headers, **kwargs) as resp:
                body = await resp.text()
                if config.DEBUG:
                    logger.debug("RESPONSE %s — %d bytes", resp.status, len(body))

                if resp.status == 401:
                    logger.error("QR: Authentication failed (401). Check QR_USERNAME and QR_PASSWORD.")
                    raise QRApiError(
                        f"Authentication failed (401) on {endpoint}.",
                        status=resp.status,
                        response_body=body[:500],
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

    # ── Entity helpers — используют именно endpoints из OpenAPI ─────

    async def list_entities(
        self,
        module_name: str,
        class_name: str,
        limit: int = None,
        offset: int = 0,
        filters: Optional[list] = None,
        **extra_params
    ) -> list:
        """
        Получает список объектов через /api/list.

        Пример module/class:
          warehouse.nomenclature.dish / ru.edgex.quickresto.modules.warehouse.nomenclature.dish.Dish
          front.orders / ru.edgex.quickresto.modules.front.orders.OrderInfo
        """
        params = {
            "moduleName": module_name,
            "className": class_name,
            "offset": str(offset),
        }
        if limit is not None:
            params["limit"] = str(limit)
        if filters:
            params["filter"] = json.dumps(filters)
        params.update(extra_params)

        endpoint = f"/api/list?{urlencode(params)}"
        return await self.get(endpoint)

    async def read_entity(self, module_name: str, class_name: str, entity_id: int) -> dict:
        """Получает один объект через /api/read с параметрами id и className"""
        params = {
            "moduleName": module_name,
            "className": class_name,
            "id": str(entity_id),
        }
        endpoint = f"/api/read?{urlencode(params)}"
        return await self.get(endpoint)

    # ── High-level: именно нужные сущности ─────────────────────────

    async def list_dishes(self, limit: int = None, offset: int = 0) -> list:
        """Блюда (Dish)"""
        return await self.list_entities(
            "warehouse.nomenclature.dish",
            "ru.edgex.quickresto.modules.warehouse.nomenclature.dish.Dish",
            limit=limit, offset=offset,
        )

    async def list_ingredients(self, limit: int = None, offset: int = 0) -> list:
        """Ингредиенты (SingleProduct)"""
        return await self.list_entities(
            "warehouse.nomenclature.singleproduct",
            "ru.edgex.quickresto.modules.warehouse.nomenclature.singleproduct.SingleProduct",
            limit=limit, offset=offset,
        )

    async def list_semiproducts(self, limit: int = None, offset: int = 0) -> list:
        """Полуфабрикаты (SemiProduct)"""
        return await self.list_entities(
            "warehouse.nomenclature.semiproduct",
            "ru.edgex.quickresto.modules.warehouse.nomenclature.semiproduct.SemiProduct",
            limit=limit, offset=offset,
        )

    async def list_stores(self, limit: int = None, offset: int = 0) -> list:
        """Склады (Store)"""
        return await self.list_entities(
            "warehouse.store",
            "ru.edgex.quickresto.modules.warehouse.store.Store",
            limit=limit, offset=offset,
        )

    async def list_providers(self, limit: int = None, offset: int = 0) -> list:
        """Поставщики (Organization)"""
        return await self.list_entities(
            "warehouse.providers",
            "ru.edgex.quickresto.modules.warehouse.providers.Organization",
            limit=limit, offset=offset,
        )

    async def list_concrete_providers(self, limit: int = None, offset: int = 0) -> list:
        """Конкретные поставщики (ConcreteProvider)"""
        return await self.list_entities(
            "warehouse.providers.concrete",
            "ru.edgex.quickresto.modules.warehouse.providers.concrete.ConcreteProvider",
            limit=limit, offset=offset,
        )

    async def list_incoming_invoices(self, limit: int = None, offset: int = 0) -> list:
        """Приходные накладные (IncomingInvoice)"""
        return await self.list_entities(
            "warehouse.documents.incoming",
            "ru.edgex.quickresto.modules.warehouse.documents.incoming.IncomingInvoice",
            limit=limit, offset=offset,
        )

    async def list_discard_invoices(self, limit: int = None, offset: int = 0) -> list:
        """Акты списания (DiscardInvoice)"""
        return await self.list_entities(
            "warehouse.documents.discard",
            "ru.edgex.quickresto.modules.warehouse.documents.discard.DiscardInvoice",
            limit=limit, offset=offset,
        )

    async def list_cooking_invoices(self, limit: int = None, offset: int = 0) -> list:
        """Акты приготовления (CookingInvoice)"""
        return await self.list_entities(
            "warehouse.documents.cooking",
            "ru.edgex.quickresto.modules.warehouse.documents.cooking.CookingInvoice",
            limit=limit, offset=offset,
        )

    async def list_inventory(self, limit: int = None, offset: int = 0) -> list:
        """Инвентаризация (InventoryDocument2)"""
        return await self.list_entities(
            "warehouse.inventory.document.v2",
            "ru.edgex.quickresto.modules.warehouse.inventory.document.InventoryDocument2",
            limit=limit, offset=offset,
        )

    async def list_orders(self, limit: int = None, offset: int = 0) -> list:
        """Чеки (OrderInfo)"""
        return await self.list_entities(
            "front.orders",
            "ru.edgex.quickresto.modules.front.orders.OrderInfo",
            limit=limit, offset=offset,
        )

    async def list_cancellations(self, limit: int = None, offset: int = 0) -> list:
        """Отмены (Cancellation)"""
        return await self.list_entities(
            "front.cancellations",
            "ru.edgex.quickresto.modules.front.cancellations.Cancellation",
            limit=limit, offset=offset,
        )

    async def list_employees(self, limit: int = None, offset: int = 0) -> list:
        """Сотрудники (Employee)"""
        return await self.list_entities(
            "personnel.employee",
            "ru.edgex.quickresto.modules.personnel.employee.Employee",
            limit=limit, offset=offset,
        )

    async def list_company_info(self) -> list:
        """Организации (CompanyInfo)"""
        return await self.list_entities(
            "core.company",
            "ru.edgex.quickresto.modules.core.company.CompanyInfo",
            limit=1, offset=0,
        )

    async def list_businesses(self, limit: int = None, offset: int = 0) -> list:
        """Бизнесы (Business)"""
        return await self.list_entities(
            "core.company.businesses",
            "ru.edgex.quickresto.modules.core.company.businesses.Business",
            limit=limit, offset=offset,
        )

    async def list_measure_units(self, limit: int = None, offset: int = 0) -> list:
        """Единицы измерения (MeasureUnit)"""
        return await self.list_entities(
            "core.dictionaries.measureunits",
            "ru.edgex.quickresto.modules.core.dictionaries.measureunits.MeasureUnit",
            limit=limit, offset=offset,
        )

    async def list_dish_categories(self, limit: int = None, offset: int = 0) -> list:
        """Категории блюд (DishCategory)"""
        return await self.list_entities(
            "warehouse.nomenclature.dish",
            "ru.edgex.quickresto.modules.warehouse.nomenclature.dish.DishCategory",
            limit=limit, offset=offset,
        )

    async def list_outgoing_invoices(self, limit: int = None, offset: int = 0) -> list:
        """Расходные накладные (OutgoingInvoice)"""
        return await self.list_entities(
            "warehouse.documents.outgoing",
            "ru.edgex.quickresto.modules.warehouse.documents.outgoing.OutgoingInvoice",
            limit=limit, offset=offset,
        )

    async def list_decomposition_invoices(self, limit: int = None, offset: int = 0) -> list:
        """Акты разбора (DecompositionInvoice)"""
        return await self.list_entities(
            "warehouse.documents.decomposition",
            "ru.edgex.quickresto.modules.warehouse.documents.decomposition.DecompositionInvoice",
            limit=limit, offset=offset,
        )

    async def list_processing_invoices(self, limit: int = None, offset: int = 0) -> list:
        """Акты переработки (ProcessingInvoice)"""
        return await self.list_entities(
            "warehouse.documents.processing",
            "ru.edgex.quickresto.modules.warehouse.documents.processing.ProcessingInvoice",
            limit=limit, offset=offset,
        )
