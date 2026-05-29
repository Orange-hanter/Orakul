"""
QuickResto API Recon Probe — read-only сбор данных.

Задачи:
  1. Проверить аутентификацию (Basic Auth)
  2. Получить sample записей каждой сущности
  3. Сохранить raw JSON дампы в data/recon/
  4. Собрать мета-информацию (поля, структура)

Использование:
  cd etl/quickresto && PYTHONPATH=src python -m src.recon_probe
"""

import sys
from pathlib import Path
# Добавляем src/ в PYTHONPATH
_src_dir = Path(__file__).resolve().parent
if str(_src_dir) not in sys.path:
    sys.path.insert(0, str(_src_dir))

import asyncio
import json
import logging
from datetime import datetime

from client import QuickRestoClient
from config import config

logger = logging.getLogger(__name__)

# Сущности для разведки: name -> (moduleName, className)
RECON_ENTITIES: dict[str, tuple[str, str]] = {
    "company":           ("core.company", "ru.edgex.quickresto.modules.core.company.CompanyInfo"),
    "businesses":        ("core.company.businesses", "ru.edgex.quickresto.modules.core.company.businesses.Business"),
    "measure_units":     ("core.dictionaries.measureunits", "ru.edgex.quickresto.modules.core.dictionaries.measureunits.MeasureUnit"),
    "dish_categories":   ("warehouse.nomenclature.dish", "ru.edgex.quickresto.modules.warehouse.nomenclature.dish.DishCategory"),
    "dish":              ("warehouse.nomenclature.dish", "ru.edgex.quickresto.modules.warehouse.nomenclature.dish.Dish"),
    "ingredient":        ("warehouse.nomenclature.singleproduct", "ru.edgex.quickresto.modules.warehouse.nomenclature.singleproduct.SingleProduct"),
    "semiproduct":       ("warehouse.nomenclature.semiproduct", "ru.edgex.quickresto.modules.warehouse.nomenclature.semiproduct.SemiProduct"),
    "store":             ("warehouse.store", "ru.edgex.quickresto.modules.warehouse.store.Store"),
    "provider_org":      ("warehouse.providers", "ru.edgex.quickresto.modules.warehouse.providers.Organization"),
    "incoming_invoice":  ("warehouse.documents.incoming", "ru.edgex.quickresto.modules.warehouse.documents.incoming.IncomingInvoice"),
    "discard_invoice":   ("warehouse.documents.discard", "ru.edgex.quickresto.modules.warehouse.documents.discard.DiscardInvoice"),
    "cooking_invoice":   ("warehouse.documents.cooking", "ru.edgex.quickresto.modules.warehouse.documents.cooking.CookingInvoice"),
    "inventory":         ("warehouse.inventory.document.v2", "ru.edgex.quickresto.modules.warehouse.inventory.document.InventoryDocument2"),
    "order_info":        ("front.orders", "ru.edgex.quickresto.modules.front.orders.OrderInfo"),
    "cancellations":     ("front.cancellations", "ru.edgex.quickresto.modules.front.cancellations.Cancellation"),
    "employees":         ("personnel.employee", "ru.edgex.quickresto.modules.personnel.employee.Employee"),
    "concrete_provider": ("warehouse.providers.concrete", "ru.edgex.quickresto.modules.warehouse.providers.concrete.ConcreteProvider"),
    "outgoing_invoice":  ("warehouse.documents.outgoing", "ru.edgex.quickresto.modules.warehouse.documents.outgoing.OutgoingInvoice"),
    "decomposition_invoice": ("warehouse.documents.decomposition", "ru.edgex.quickresto.modules.warehouse.documents.decomposition.DecompositionInvoice"),
    "processing_invoice": ("warehouse.documents.processing", "ru.edgex.quickresto.modules.warehouse.documents.processing.ProcessingInvoice"),
    "shift":             ("front.zreport", "ru.edgex.quickresto.modules.front.zreport.Shift"),
}

# Сколько записей выбираем
SAMPLE_SIZE = 5
# Для больших таблиц — минимум
TX_SAMPLE_SIZE = 5


def _get_sample_size(name: str) -> int:
    return TX_SAMPLE_SIZE if name in {
        "incoming_invoice", "discard_invoice", "cooking_invoice",
        "inventory", "order_info", "cancellations"
    } else SAMPLE_SIZE


async def _probe_entity(
    client: QuickRestoClient,
    name: str,
    module: str,
    class_name: str,
    sample: int,
    dump_dir: Path,
) -> dict:
    """Запрашивает sample записей, сохраняет дамп."""
    logger.info("[probe] %s → %s::%s (sample=%s)", name, module, class_name, sample)

    meta = {
        "name": name,
        "module": module,
        "class_name": class_name,
        "sample_size": sample,
        "fetched": 0,
        "fields": [],
        "sample_fields": [],
        "errors": [],
        "json_file": None,
    }

    try:
        items = await client.list_entities(module_name=module, class_name=class_name, limit=sample)
        meta["fetched"] = len(items)

        if items:
            all_fields: set[str] = set()
            for it in items:
                if isinstance(it, dict):
                    all_fields.update(it.keys())
            meta["fields"] = sorted(all_fields)
            meta["sample_fields"] = sorted(items[0].keys()) if isinstance(items[0], dict) else []

            # Сохраняем JSON дамп
            ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            fname = f"recon_{name}_{ts}.json"
            fpath = dump_dir / fname
            with open(fpath, 'w', encoding='utf-8') as f:
                json.dump(items, f, ensure_ascii=False, indent=2, default=str)
            meta["json_file"] = str(fpath)
            logger.info("[probe] %s → %s items, saved to %s", name, len(items), fname)
        else:
            logger.warning("[probe] %s → пустой ответ", name)
            meta["errors"].append("empty response")

    except Exception as e:
        logger.exception("[probe] %s failed", name)
        meta["errors"].append(str(e))

    return meta


async def run_recon() -> int:
    """Основной flow разведки."""
    setup_logging()

    if not config.QR_USERNAME or not config.QR_PASSWORD:
        logger.error("QR_USERNAME / QR_PASSWORD не заданы. Заполните .env")
        return 1

    dump_dir = Path(__file__).resolve().parents[3] / 'etl' / 'quickresto' / 'data' / 'recon'
    dump_dir.mkdir(parents=True, exist_ok=True)

    logger.info("╔═══════════════════════════════════════╗")
    logger.info("║   QuickResto Recon Probe (read-only) ║")
    logger.info("╠═══════════════════════════════════════╣")
    logger.info("║ API:   %-29s ║", config.qr_api_url)
    logger.info("║ User:  %-29s ║", config.QR_USERNAME)
    logger.info("║ Dump:  %-29s ║", str(dump_dir))
    logger.info("╚═══════════════════════════════════════╝")

    results = []

    async with QuickRestoClient() as client:
        logger.info("✅ Авторизация успешна (Basic Auth — каждый запрос)")

        for name, (module, class_name) in RECON_ENTITIES.items():
            sample = _get_sample_size(name)
            meta = await _probe_entity(client, name, module, class_name, sample, dump_dir)
            results.append(meta)

    # Report
    report = {
        "recon_at": datetime.utcnow().isoformat(),
        "qr_base_url": config.qr_api_url,
        "qr_username": config.QR_USERNAME,
        "dump_dir": str(dump_dir),
        "entities": results,
    }

    report_path = dump_dir / f"recon_report_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    # Console summary
    logger.info("╔═══════════════════════════════════════╗")
    logger.info("║  Разведка завершена                   ║")
    logger.info("╠═══════════════════════════════════════╣")
    total_fetched = sum(r["fetched"] for r in results)
    total_errs = sum(len(r.get("errors", [])) for r in results)
    total_files = sum(1 for r in results if r.get("json_file"))
    logger.info("║  Сущностей проверено: %-15s ║", len(results))
    logger.info("║  JSON-файлов сохранено: %-13s ║", total_files)
    logger.info("║  Записей собрано:     %-15s ║", total_fetched)
    logger.info("║  Ошибок:              %-15s ║", total_errs)
    logger.info("║  Отчёт:  %-28s ║", report_path.name)
    logger.info("╚═══════════════════════════════════════╝")

    # Поля
    print("\n--- Поля по сущностям ---")
    for r in results:
        if r.get("fields"):
            print(f"\n{r['name']} ({r['module']}):")
            print(f"  fetched: {r['fetched']}")
            print(f"  fields ({len(r['fields'])}): {', '.join(r['fields'][:20])}")
            if len(r['fields']) > 20:
                print(f"  ... и ещё {len(r['fields']) - 20}")
        elif r.get("errors"):
            print(f"\n{r['name']} → ОШИБКА: {r['errors'][0]}")

    return 0 if total_errs == 0 else 1


def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )
    # Меньше шума от aiohttp
    logging.getLogger("aiohttp").setLevel(logging.WARNING)


if __name__ == "__main__":
    sys.exit(asyncio.run(run_recon()))
