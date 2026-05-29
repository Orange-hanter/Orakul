# Price parser

Универсальный CLI-парсер прайс-листов поставщиков из папки `Price`.

## Что умеет

- читает `.xlsx` без сторонних зависимостей;
- читает `.xls`, если установлен optional-пакет `xlrd`;
- сам находит строку заголовков;
- нормализует русские заголовки в единый набор полей;
- сохраняет результат в `csv`, `json` или `jsonl`;
- не падает на неподдержанном файле по умолчанию, а пишет warning и продолжает экспорт.

## Пример

```bash
python3 etl/price_parser.py Price -o exports/prices.csv
python3 etl/price_parser.py Price -o exports/prices.jsonl -f jsonl
python3 etl/price_parser.py Price/*.xlsx -o exports/prices.json -f json
```

Для строгого режима, где любая ошибка чтения файла останавливает импорт:

```bash
python3 etl/price_parser.py Price -o exports/prices.csv --strict
```

## Поля экспорта

`source_file`, `supplier`, `sheet`, `category`, `row_number`, `code`, `barcode`, `name`,
`brand`, `unit`, `pack`, `quantity`, `country`, `note`, `vat_rate`,
`price_without_vat`, `price_with_vat`, `raw_price`.

## Замечания по текущим файлам

Папка содержит несколько разных структур прайсов:

- стандартные таблицы с заголовком во 2-й строке;
- прайсы с 13 служебными строками и товарной таблицей с 14-й строки;
- многостраничные книги, где листы используются как категории;
- файл старого формата `.xls`, для которого нужен `xlrd` или предварительная конвертация в `.xlsx`.
