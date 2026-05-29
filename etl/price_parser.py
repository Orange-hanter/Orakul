#!/usr/bin/env python3
"""Universal parser for supplier price lists.

The parser reads Excel 2007+ `.xlsx` files with no third-party dependencies,
detects header rows, maps common Russian price-list columns to a normalized
schema, and exports product rows as CSV, JSON, or JSONL.

Legacy `.xls` files are supported when the optional `xlrd` package is installed;
otherwise the parser reports a clear warning and continues with `.xlsx` files.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


XLSX_NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}

CANONICAL_FIELDS = [
    "source_file",
    "supplier",
    "sheet",
    "category",
    "row_number",
    "code",
    "barcode",
    "name",
    "brand",
    "unit",
    "pack",
    "quantity",
    "country",
    "note",
    "vat_rate",
    "price_without_vat",
    "price_with_vat",
    "raw_price",
]

FIELD_ALIASES = {
    "code": [
        "код",
        "код товара",
        "артикул",
        "№",
        "№ п/п",
        "номер",
    ],
    "barcode": [
        "штрих-код товара",
        "штрих код товара",
        "штрихкод",
        "шк",
    ],
    "name": [
        "наименование",
        "наименование товара",
        "товары (работы, услуги)",
        "товар",
        "товары",
    ],
    "brand": ["бренд", "торговая марка", "тм"],
    "unit": ["ед. изм.", "ед изм", "единица", "единица измерения"],
    "pack": ["упак.", "упак", "упаковка", "кол-во в уп.", "кол во в уп", "кол-во в коробке"],
    "quantity": ["количество", "кол-во", "кол во"],
    "country": ["страна", "страна производства", "производство"],
    "note": ["примечание", "заказ", "комментарий"],
    "vat_rate": ["ндс", "ндс,%", "ндс, %", "ставка ндс"],
    "price_without_vat": [
        "цена без ндс",
        "цена за ед. без ндс",
        "цена за ед без ндс",
        "цена за 1 кг чистого веса, без ндс",
    ],
    "price_with_vat": ["цена с ндс", "цена за ед. с ндс", "цена за ед с ндс"],
    "raw_price": ["цена", "прайс"],
}

PRICE_FIELDS = {"price_without_vat", "price_with_vat", "raw_price"}
HEADER_HINTS = {
    "наименование",
    "товар",
    "товары",
    "цена",
    "ндс",
    "ед",
    "изм",
    "код",
    "штрих",
    "упак",
    "страна",
    "бренд",
    "кол",
}


@dataclass
class SheetRows:
    name: str
    rows: list[list[Any]]


def normalize_text(value: Any) -> str:
    text = str(value or "").replace("\u00a0", " ").replace("ё", "е").lower()
    text = re.sub(r"\s+", " ", text)
    return text.strip(" .:;")


def clean_string(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\u00a0", " ")).strip()


def parse_number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = clean_string(value)
    if not text:
        return None
    match = re.search(r"-?\d+(?:[\s\u00a0]\d{3})*(?:[,.]\d+)?|-?\d+(?:[,.]\d+)?", text)
    if not match:
        return None
    number = match.group(0).replace(" ", "").replace("\u00a0", "").replace(",", ".")
    try:
        return float(number)
    except ValueError:
        return None


def parse_percent(value: Any) -> float | None:
    number = parse_number(value)
    if number is None:
        return None
    if 0 < number < 1:
        return number * 100
    return number


def cell_col_index(ref: str) -> int:
    letters = "".join(ch for ch in ref if ch.isalpha())
    result = 0
    for ch in letters:
        result = result * 26 + ord(ch.upper()) - 64
    return max(result - 1, 0)


def read_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return ["".join(t.text or "" for t in si.findall(".//main:t", XLSX_NS)) for si in root.findall("main:si", XLSX_NS)]


def xlsx_cell_value(cell: ET.Element, shared_strings: list[str]) -> Any:
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        return clean_string("".join(t.text or "" for t in cell.findall(".//main:t", XLSX_NS)))
    value = cell.find("main:v", XLSX_NS)
    if value is None or value.text is None:
        return ""
    raw = value.text
    if cell_type == "s":
        index = int(raw)
        return clean_string(shared_strings[index]) if 0 <= index < len(shared_strings) else raw
    if cell_type == "b":
        return raw == "1"
    try:
        number = float(raw)
    except ValueError:
        return clean_string(raw)
    return int(number) if number.is_integer() else number


def read_xlsx(path: Path) -> list[SheetRows]:
    with zipfile.ZipFile(path) as zf:
        shared_strings = read_shared_strings(zf)
        workbook = ET.fromstring(zf.read("xl/workbook.xml"))
        rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        rel_map = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels}
        sheets = []
        for sheet in workbook.findall("main:sheets/main:sheet", XLSX_NS):
            relation_id = sheet.attrib[f"{{{XLSX_NS['rel']}}}id"]
            target = rel_map[relation_id].lstrip("/")
            sheet_path = "xl/" + target
            root = ET.fromstring(zf.read(sheet_path))
            rows = []
            for row in root.findall(".//main:sheetData/main:row", XLSX_NS):
                values: list[Any] = []
                for cell in row.findall("main:c", XLSX_NS):
                    idx = cell_col_index(cell.attrib.get("r", "A1"))
                    while len(values) <= idx:
                        values.append("")
                    values[idx] = xlsx_cell_value(cell, shared_strings)
                while values and values[-1] == "":
                    values.pop()
                rows.append(values)
            sheets.append(SheetRows(sheet.attrib["name"], rows))
        return sheets


def read_xls(path: Path) -> list[SheetRows]:
    try:
        import xlrd  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError(
            f"{path.name}: legacy .xls requires optional dependency xlrd. "
            "Install xlrd or convert the file to .xlsx."
        ) from exc

    workbook = xlrd.open_workbook(str(path))
    sheets = []
    for sheet in workbook.sheets():
        rows = []
        for row_index in range(sheet.nrows):
            values = []
            for col_index in range(sheet.ncols):
                cell = sheet.cell(row_index, col_index)
                value = cell.value
                if cell.ctype == xlrd.XL_CELL_EMPTY:
                    value = ""
                elif cell.ctype == xlrd.XL_CELL_NUMBER and float(value).is_integer():
                    value = int(value)
                values.append(value)
            while values and values[-1] == "":
                values.pop()
            rows.append(values)
        sheets.append(SheetRows(sheet.name, rows))
    return sheets


def read_workbook(path: Path) -> list[SheetRows]:
    if path.suffix.lower() == ".xlsx":
        return read_xlsx(path)
    if path.suffix.lower() == ".xls":
        return read_xls(path)
    raise RuntimeError(f"{path.name}: unsupported file type")


def header_score(row: list[Any]) -> int:
    text = " ".join(normalize_text(value) for value in row if value != "")
    return sum(1 for hint in HEADER_HINTS if hint in text)


def find_header_row(rows: list[list[Any]]) -> int | None:
    best_index = None
    best_score = 0
    for idx, row in enumerate(rows[:80]):
        score = header_score(row)
        if score > best_score:
            best_score = score
            best_index = idx
    return best_index if best_score >= 2 else None


def build_column_map(header: list[Any]) -> dict[int, str]:
    used: set[str] = set()
    columns: dict[int, str] = {}
    normalized_aliases = {
        field: [normalize_text(alias) for alias in aliases]
        for field, aliases in FIELD_ALIASES.items()
    }
    for idx, value in enumerate(header):
        label = normalize_text(value)
        if not label:
            continue
        exact_matches = [
            field
            for field, aliases in normalized_aliases.items()
            if field not in used and label in aliases
        ]
        if exact_matches:
            field = exact_matches[0]
            columns[idx] = field
            used.add(field)
            continue

        partial_matches: list[tuple[int, str]] = []
        for field, aliases in normalized_aliases.items():
            if field in used:
                continue
            matching_aliases = [alias for alias in aliases if alias and alias in label]
            if matching_aliases:
                partial_matches.append((max(len(alias) for alias in matching_aliases), field))
        if partial_matches:
            _score, field = max(partial_matches)
            columns[idx] = field
            used.add(field)
    return columns


def infer_missing_columns(rows: list[list[Any]], start: int, column_map: dict[int, str]) -> None:
    if "name" not in column_map.values():
        candidates: dict[int, int] = {}
        for row in rows[start : start + 50]:
            for idx, value in enumerate(row):
                if isinstance(value, str) and len(clean_string(value)) > 15:
                    candidates[idx] = candidates.get(idx, 0) + 1
        if candidates:
            column_map[max(candidates, key=candidates.get)] = "name"

    if not PRICE_FIELDS.intersection(column_map.values()):
        candidates: dict[int, int] = {}
        for row in rows[start : start + 50]:
            for idx, value in enumerate(row):
                number = parse_number(value)
                if number is not None and 0 < number < 100000:
                    candidates[idx] = candidates.get(idx, 0) + 1
        for idx, _count in sorted(candidates.items(), key=lambda item: item[1], reverse=True)[:2]:
            if idx not in column_map:
                column_map[idx] = "raw_price"
                break


def row_value(row: list[Any], column_map: dict[int, str], field: str) -> Any:
    for idx, mapped_field in column_map.items():
        if mapped_field == field and idx < len(row):
            return row[idx]
    return ""


def is_category_row(row: list[Any], column_map: dict[int, str]) -> bool:
    values = [clean_string(value) for value in row if clean_string(value)]
    if len(values) != 1:
        return False
    text = values[0]
    if len(text) < 3:
        return False
    if parse_number(text) is not None:
        return False
    if "акция" in normalize_text(text):
        return False
    return text.upper() == text or len(text) > 20


def is_product_row(row: list[Any], column_map: dict[int, str]) -> bool:
    name = clean_string(row_value(row, column_map, "name"))
    if len(name) < 3:
        return False
    if header_score(row) >= 3:
        return False
    if len([value for value in row if clean_string(value)]) < 2:
        return False
    has_price = any(parse_number(row_value(row, column_map, field)) is not None for field in PRICE_FIELDS)
    has_id_or_unit = any(clean_string(row_value(row, column_map, field)) for field in ("code", "barcode", "unit", "brand"))
    return has_price or has_id_or_unit


def detect_supplier(path: Path, rows: list[list[Any]]) -> str:
    stem = path.stem
    if "алдиал" in normalize_text(stem):
        return "АлДиАл Групп"
    if "белпп" in normalize_text(stem):
        return "Белппгруп"
    first_text = " ".join(clean_string(value) for row in rows[:3] for value in row if clean_string(value))
    match = re.search(r'"([^"]{3,80})"', first_text)
    return match.group(1) if match else stem


def normalize_record(
    path: Path,
    supplier: str,
    sheet_name: str,
    category: str,
    row_number: int,
    row: list[Any],
    column_map: dict[int, str],
) -> dict[str, Any]:
    record = {field: "" for field in CANONICAL_FIELDS}
    record.update(
        {
            "source_file": path.name,
            "supplier": supplier,
            "sheet": sheet_name,
            "category": category,
            "row_number": row_number,
        }
    )
    for idx, field in column_map.items():
        if idx >= len(row) or field not in record:
            continue
        value = row[idx]
        if field in PRICE_FIELDS:
            record[field] = parse_number(value)
            if record[field] is None:
                record[field] = clean_string(value)
        elif field == "vat_rate":
            record[field] = parse_percent(value)
        else:
            record[field] = clean_string(value)
    return record


def parse_workbook(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for sheet in read_workbook(path):
        header_index = find_header_row(sheet.rows)
        if header_index is None:
            continue
        column_map = build_column_map(sheet.rows[header_index])
        infer_missing_columns(sheet.rows, header_index + 1, column_map)
        if "name" not in column_map.values():
            continue
        supplier = detect_supplier(path, sheet.rows)
        category = sheet.name if not sheet.name.startswith("_") else ""
        for row_index, row in enumerate(sheet.rows[header_index + 1 :], start=header_index + 2):
            if not any(clean_string(value) for value in row):
                continue
            if is_category_row(row, column_map):
                category = clean_string([value for value in row if clean_string(value)][0])
                continue
            if is_product_row(row, column_map):
                records.append(normalize_record(path, supplier, sheet.name, category, row_index, row, column_map))
    return records


def iter_input_files(inputs: Iterable[str]) -> Iterable[Path]:
    for item in inputs:
        path = Path(item).expanduser()
        if path.is_dir():
            yield from sorted(path.glob("*.xlsx"))
            yield from sorted(path.glob("*.xls"))
        else:
            yield path


def write_csv(records: list[dict[str, Any]], output: Path) -> None:
    with output.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=CANONICAL_FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(records)


def write_json(records: list[dict[str, Any]], output: Path) -> None:
    output.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")


def write_jsonl(records: list[dict[str, Any]], output: Path) -> None:
    with output.open("w", encoding="utf-8") as fh:
        for record in records:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Parse supplier price lists and export normalized product data.")
    parser.add_argument("inputs", nargs="+", help="Input .xlsx/.xls files or directories")
    parser.add_argument("-o", "--output", required=True, help="Output file path")
    parser.add_argument(
        "-f",
        "--format",
        choices=["csv", "json", "jsonl"],
        help="Output format. Defaults to extension-based detection.",
    )
    parser.add_argument("--strict", action="store_true", help="Fail on unsupported or broken files")
    args = parser.parse_args(argv)

    records: list[dict[str, Any]] = []
    errors: list[str] = []
    for path in iter_input_files(args.inputs):
        try:
            records.extend(parse_workbook(path))
        except Exception as exc:  # noqa: BLE001 - CLI should report per-file import issues.
            message = str(exc)
            if args.strict:
                raise
            errors.append(message)

    output = Path(args.output).expanduser()
    output.parent.mkdir(parents=True, exist_ok=True)
    export_format = args.format or output.suffix.lower().lstrip(".") or "csv"
    if export_format == "csv":
        write_csv(records, output)
    elif export_format == "json":
        write_json(records, output)
    elif export_format == "jsonl":
        write_jsonl(records, output)
    else:
        raise SystemExit(f"Unsupported output format: {export_format}")

    print(f"exported_records={len(records)}")
    print(f"output={output}")
    for error in errors:
        print(f"warning={error}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
