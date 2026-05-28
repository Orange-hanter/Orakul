"""
Data models for QuickResto API entities.
Generated from recon data + OpenAPI spec inspection.

Usage:
    from models_qr import Dish, IncomingInvoice, Shift
    dish = Dish.model_validate(raw_json)
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

# Use stdlib dataclasses (no Pydantic dependency)
from dataclasses import dataclass, field
from typing import Optional, Union


# ── Base ───────────────────────────────────────────────────────

@dataclass
class QRBase:
    """Base class for all QR entities."""
    id: int
    version: int
    className: str
    _id: Optional[str] = None

    @classmethod
    def from_dict(cls, data: dict) -> "QRBase":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


# ── Nomenclature ───────────────────────────────────────────────

@dataclass
class MeasureUnit(QRBase):
    code: str = ""
    fullName: str = ""
    name: str = ""
    parentRatio: float = 1.0
    systemUnit: str = ""


@dataclass
class Store(QRBase):
    title: str = ""
    storeCode: str = ""
    liteBusiness: dict = field(default_factory=dict)


@dataclass
class ModifierLink(QRBase):
    """Связь блюда-модификатора (ингредиент в рецепте)."""
    modifierId: str = ""
    modifier: dict = field(default_factory=dict)
    minValue: int = 0
    maxValue: int = 0
    defaultValue: int = 0
    group: Optional[str] = None
    ownerId: Optional[str] = None


@dataclass
class DishSalePrice(QRBase):
    """Цена блюда на точке реализации."""
    price: float = 0.0
    salePlace: dict = field(default_factory=dict)
    cookingPlace: Optional[Any] = None


@dataclass
class StoreItemTag(QRBase):
    pass  # Пустой dict в данных


@dataclass
class SingleProduct(QRBase):
    """Ингредиент / товар."""
    name: str = ""
    itemTitle: str = ""
    article: str = ""
    basePriceInList: float = 0.0
    currentPrimeCost: float = 0.0
    measureUnit: dict = field(default_factory=dict)
    minimalPrice: float = 0.0
    pack: Union[int, float] = 1
    ratio: float = 1.0
    recipe: str = ""
    serverRegisterTime: str = ""
    storeItemTags: list = field(default_factory=list)
    storeQuantityKg: float = 0.0
    # Flags
    displayOnTerminal: bool = False
    doNotAccumulateBonuses: bool = False
    doNotWithdrawBonuses: bool = False
    excludeDeal: bool = False
    excludeDiscount: bool = False
    excludeMarkup: bool = False
    color: Optional[str] = None


@dataclass
class DishCategory(QRBase):
    """Категория блюд."""
    name: str = ""
    itemTitle: str = ""
    color: str = ""
    displayOnTerminal: bool = False
    measureUnit: dict = field(default_factory=dict)
    serverRegisterTime: str = ""
    storeItemTags: list = field(default_factory=list)
    sellingType: str = ""
    dishSales: list = field(default_factory=list)


@dataclass
class Dish(QRBase):
    """Блюдо (Dish — готовое к продаже)."""
    name: str = ""
    itemTitle: str = ""
    article: str = ""
    basePriceInList: float = 0.0
    currentPrimeCost: float = 0.0
    measureUnit: dict = field(default_factory=dict)
    minimalPrice: float = 0.0
    pack: Union[int, float] = 1
    ratio: float = 1.0
    recipe: str = ""
    serverRegisterTime: str = ""
    storeItemTags: list = field(default_factory=list)
    storeQuantityKg: float = 0.0
    # Flags
    displayOnTerminal: bool = False
    doNotAccumulateBonuses: bool = False
    doNotWithdrawBonuses: bool = False
    excludeDeal: bool = False
    excludeDiscount: bool = False
    excludeMarkup: bool = False
    sellingType: str = ""  # WHOLE | COMBO | BY_WEIGHT
    # Links
    modifierLinks: list[dict] = field(default_factory=list)  # ингредиенты-модификаторы
    dishSales: list[dict] = field(default_factory=list)  # цены на точках
    color: Optional[str] = None


@dataclass
class SemiProduct(QRBase):
    """Полуфабрикат"""
    name: str = ""
    itemTitle: str = ""
    article: str = ""
    basePriceInList: float = 0.0
    currentPrimeCost: float = 0.0
    measureUnit: dict = field(default_factory=dict)
    minimalPrice: float = 0.0
    pack: Union[int, float] = 1
    ratio: float = 1.0
    recipe: str = ""
    serverRegisterTime: str = ""
    storeItemTags: list = field(default_factory=list)
    storeQuantityKg: float = 0.0
    displayOnTerminal: bool = False
    doNotAccumulateBonuses: bool = False
    doNotWithdrawBonuses: bool = False
    excludeDeal: bool = False
    excludeDiscount: bool = False
    excludeMarkup: bool = False
    color: Optional[str] = None


# ── Providers ──────────────────────────────────────────────────

@dataclass
class ProviderOrg(QRBase):
    """Поставщик ( juridical / abstract )"""
    shortName: str = ""
    fullName: str = ""
    address: str = ""
    egaisActivityStatus: str = ""  # ACTIVE | INACTIVE
    egaisStatus: str = ""  # UNKNOWN | ...


# ── Documents ──────────────────────────────────────────────────

@dataclass
class DocumentRef(QRBase):
    """Ссылка на связанный объект."""
    pass


@dataclass
class IncomingInvoice(QRBase):
    """Приходная накладная."""
    documentNumber: str = ""
    invoiceDate: str = ""  # ISO datetime
    lastUpdateDate: str = ""
    processed: bool = False
    paid: bool = False
    provider: dict = field(default_factory=dict)
    store: dict = field(default_factory=dict)
    comment: str = ""
    totalAmount: float = 0.0  # фактическое кол-во
    totalNds: float = 0.0
    totalSum: float = 0.0  # с НДС
    totalSumWoNds: float = 0.0


@dataclass  
class DiscardInvoice(QRBase):
    """Списание со склада."""
    documentNumber: str = ""
    invoiceDate: str = ""
    lastUpdateDate: str = ""
    processed: bool = False
    customerType: str = ""  # SPECIAL | ...
    discardReason: dict = field(default_factory=dict)
    store: dict = field(default_factory=dict)
    comment: str = ""
    totalAmount: float = 0.0
    totalNds: float = 0.0
    totalSum: int = 0
    totalSumWoNds: float = 0.0


@dataclass
class InventoryDocument(QRBase):
    """Инвентаризация."""
    documentNumber: str = ""
    invoiceDate: str = ""
    lastUpdateDate: str = ""
    processed: bool = False
    comment: str = ""
    store: dict = field(default_factory=dict)
    shortfallSum: float = 0.0  # Недостача
    surplusSum: float = 0.0  # Излишек
    totalAmount: float = 0.0
    totalNds: float = 0.0
    totalSum: int = 0
    totalSumWoNds: float = 0.0


# ── Front ──────────────────────────────────────────────────────

@dataclass
class Cancellation(QRBase):
    """Отмена заказа/блюда."""
    comment: str = ""
    description: str = ""
    serverRegisterTime: str = ""
    localCreateTime: str = ""
    localTimeZoneOffsetMin: int = 0
    tableOrderDocId: str = ""
    cancellationReasonDocId: str = ""
    cancellationReason: dict = field(default_factory=dict)
    tableScheme: dict = field(default_factory=dict)
    tableSchemeDocId: str = ""
    createTerminalSalePlace: dict = field(default_factory=dict)
    createTerminalSalePlaceDocId: str = ""
    employee: dict = field(default_factory=dict)
    userDocId: str = ""
    withDismission: bool = False


@dataclass
class Shift(QRBase):
    """Кассовая смена (Z-Report)."""
    frontId: str = ""
    tableSchemeDocId: str = ""
    tableScheme: dict = field(default_factory=dict)
    openerId: str = ""
    openedEmployee: dict = field(default_factory=dict)
    closerId: str = ""
    closedEmployee: dict = field(default_factory=dict)
    salePlaceDocId: str = ""
    salePlace: dict = field(default_factory=dict)
    organizationDocId: str = ""
    organization: dict = field(default_factory=dict)
    deviceId: str = ""
    kkmTerminal: dict = field(default_factory=dict)
    # Timing
    opened: str = ""  # ISO datetime UTC
    localOpenedTime: str = ""  # ISO datetime local
    localOpenedTimeZoneOffsetMin: int = 0
    closed: str = ""
    localClosedTime: str = ""
    localClosedTimeZoneOffsetMin: int = 0
    # Status
    status: str = ""  # OPENED | CLOSED
    zReportDocumentNumber: int = 0
    incomplete: bool = False
    shiftNumber: int = 0
    # Revenue breakdown
    totalCash: float = 0.0
    totalReturnCash: float = 0.0
    totalCard: float = 0.0
    totalReturnCard: float = 0.0
    totalBonuses: float = 0.0
    totalReturnBonuses: float = 0.0
    totalCashInRegister: float = 0.0
    # Non-fiscal
    nonFiscalTotalCash: float = 0.0
    nonFiscalTotalReturnCash: float = 0.0
    nonFiscalTotalCard: float = 0.0
    nonFiscalTotalReturnCard: float = 0.0
    nonFiscalTotalBonuses: float = 0.0
    nonFiscalTotalReturnBonuses: float = 0.0
    # Writeoff
    writeOffTotalCash: float = 0.0
    writeOffTotalReturnCash: float = 0.0
    writeOffTotalCard: float = 0.0
    writeOffTotalReturnCard: float = 0.0
    writeOffTotalBonuses: float = 0.0
    writeOffTotalReturnBonuses: float = 0.0
    # Cash operations
    openCashInRegister: float = 0.0
    closeCashInRegister: float = 0.0
    totalCashIn: float = 0.0
    totalCashOut: float = 0.0
    cashInCheksCount: int = 0
    cashOutCheksCount: int = 0
    closingEncashment: float = 0.0
    # Orders
    ordersCount: int = 0
    returnOrdersCount: int = 0
    tableOrdersDocIds: list[str] = field(default_factory=list)


@dataclass
class Employee(QRBase):
    """Сотрудник."""
    firstName: str = ""
    lastName: str = ""
    middleName: str = ""
    fullName: str = ""
    shortName: str = ""
    blocked: bool = False
    systemEmployee: str = ""  # SuperUser | FrontOffice | ...
    user: dict = field(default_factory=dict)
    allowedTablesSchemes: list[dict] = field(default_factory=list)


# ── Company ────────────────────────────────────────────────────

@dataclass
class CompanyInfo(QRBase):
    discount: str = ""  # scale
    markup: str = ""  # scale


# ── Auto-parse helper ──────────────────────────────────────────

ENTITY_MAP = {
    "ru.edgex.quickresto.modules.core.company.CompanyInfo": CompanyInfo,
    "ru.edgex.quickresto.modules.core.dictionaries.measureunits.MeasureUnit": MeasureUnit,
    "ru.edgex.quickresto.modules.warehouse.store.Store": Store,
    "ru.edgex.quickresto.modules.warehouse.nomenclature.dish.Dish": Dish,
    "ru.edgex.quickresto.modules.warehouse.nomenclature.dish.DishCategory": DishCategory,
    "ru.edgex.quickresto.modules.warehouse.nomenclature.singleproduct.SingleProduct": SingleProduct,
    "ru.edgex.quickresto.modules.warehouse.nomenclature.semiproduct.SemiProduct": SemiProduct,
    "ru.edgex.quickresto.modules.warehouse.providers.Organization": ProviderOrg,
    "ru.edgex.quickresto.modules.warehouse.documents.incoming.IncomingInvoice": IncomingInvoice,
    "ru.edgex.quickresto.modules.warehouse.documents.discard.DiscardInvoice": DiscardInvoice,
    "ru.edgex.quickresto.modules.warehouse.inventory.document.v2.InventoryDocument": InventoryDocument,
    "ru.edgex.quickresto.modules.front.cancellations.Cancellation": Cancellation,
    "ru.edgex.quickresto.modules.front.zreport.Shift": Shift,
    "ru.edgex.quickresto.modules.personnel.employee.Employee": Employee,
}


def parse_entity(raw: dict) -> QRBase:
    """Auto-detect class from className and parse."""
    cls_name = raw.get("className", "")
    model = ENTITY_MAP.get(cls_name)
    if model:
        return model(**raw)
    return QRBase(**raw)


if __name__ == "__main__":
    print("Generated models:")
    for cls_name, cls in sorted(ENTITY_MAP.items(), key=lambda x: x[1].__name__):
        print(f"  {cls.__name__:20s} <- {cls_name}")
    print(f"\nTotal: {len(ENTITY_MAP)} entity types")
