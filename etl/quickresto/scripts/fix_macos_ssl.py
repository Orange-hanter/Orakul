#!/usr/bin/env python3
"""
Фикс SSL-сертификатов macOS для Python 3.13 (Framework build).
Проверяет, установлены ли сертификаты, и предлагает решение.
"""

import os
import subprocess
import sys
from pathlib import Path


def find_certifi():
    """Ищет certifi в venv."""
    paths = [
        Path(sys.executable).parent / "certifi",
        Path(sys.executable).parents[1] / "lib" / f"python{sys.version_info.major}.{sys.version_info.minor}" / "site-packages" / "certifi",
    ]
    for p in paths:
        if p.exists():
            try:
                import certifi
                return certifi.where()
            except ImportError:
                continue
    return None


def get_openssl_cafile():
    """Путь к системному CA-bundle Python."""
    import ssl
    return ssl.get_default_verify_paths().openssl_cafile


def main():
    print("=" * 60)
    print("macOS SSL Certificate Fix for Python 3.13")
    print("=" * 60)

    cafile = get_openssl_cafile()
    print(f"\n1. Python expects CA bundle at:\n   {cafile}")

    if Path(cafile).exists():
        print("   ✓ Файл найден — SSL должен работать.")
    else:
        print("   ✗ Файл НЕ найден — вот проблема.")

    cert_path = find_certifi()
    print(f"\n2. certifi пакет:\n   {cert_path or 'не найден'}")

    print("\n" + "-" * 60)
    print("варианты решения:")
    print("-" * 60)

    print("\nA) БЫСТРЫЙ (правильный) — установить сертификаты macOS:")
    print("   /Applications/Python\ 3.13/Install\ Certificates.command")
    print("   или:")
    print("   open '/Applications/Python 3.13/Install Certificates.command'")

    print("\nB) ОБХОДНОЙ — использовать certifi вместо системного:")
    print("   export SSL_CERT_FILE=$(python3 -m certifi)")
    print("   # добавить в .env проекта:")
    print("   SSL_CERT_FILE=/path/to/certifi/cacert.pem")

    print("\nC) ПОЛУЧИТЬ certifi:")
    print("   pip install certifi")

    print("\n" + "=" * 60)

    # Автоматический фикс B через certifi
    if cert_path and not Path(cafile).exists():
        print("\n[авто-фикс] Используем certifi как SSL_CERT_FILE...")
        print(f"export SSL_CERT_FILE={cert_path}")
        return 0

    return 0 if Path(cafile).exists() else 1


if __name__ == "__main__":
    sys.exit(main())
