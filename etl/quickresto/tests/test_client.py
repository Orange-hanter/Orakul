"""
Tests for QuickRestoClient.

Мокаем aiohttp.ClientSession для unit-тестов без реальных запросов.
"""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / 'src'))

from client import QuickRestoClient


@pytest.fixture
def mock_session():
    """Мок сессия aiohttp."""
    session = MagicMock()
    session.post = AsyncMock()
    session.request = AsyncMock()
    session.close = AsyncMock()
    return session


@pytest.mark.asyncio
async def test_authenticate_success(mock_session):
    """Успешная аутентификация через /api/authByUserPasswordLogin."""
    client = QuickRestoClient(base_url="http://test", username="u", password="p")
    client._session = mock_session

    # Мокаем ответ auth
    mock_resp = AsyncMock()
    mock_resp.status = 200
    mock_resp.text = AsyncMock(return_value=json.dumps({"token": "abc123"}))
    mock_session.post.return_value.__aenter__ = AsyncMock(return_value=mock_resp)
    mock_session.post.return_value.__aexit__ = AsyncMock(return_value=False)

    token = await client._authenticate()
    assert token == "abc123"


@pytest.mark.asyncio
async def test_list_entities_pagination(mock_session):
    """Пагинация: если страница полная → следующая."""
    client = QuickRestoClient(base_url="http://test", username="u", password="p")
    client._session = mock_session
    client._token = "tok"

    page1 = [{"id": "1", "name": "A"}] * 100  # полная страница → offset+100
    page2 = [{"id": "2", "name": "B"}]

    responses = [page1, page2]
    call_index = [0]

    async def _make_resp():
        data = responses[call_index[0]]
        call_index[0] += 1
        mock_resp = AsyncMock()
        mock_resp.status = 200
        mock_resp.text = AsyncMock(return_value=json.dumps(data))
        return mock_resp

    def _post(*args, **kwargs):
        mock_post = AsyncMock()
        mock_post.__aenter__ = _make_resp
        mock_post.__aexit__ = AsyncMock(return_value=False)
        return mock_post

    # Переопределяем request (GET)
    async def _req(*args, **kwargs):
        resp = await _make_resp()
        return resp

    client._request = _req

    items = await client.list_entities('test.module', page_size=100)
    assert len(items) == 101


@pytest.mark.asyncio
async def test_map_single_product():
    """Трансформация SingleProduct."""
    from transform import map_single_product
    qr = {
        "id": "abc",
        "name": "Мука",
        "code": "F-001",
        "measureUnit": {"name": "кг"},
        "category": "Сыпучие",
    }
    m = map_single_product(qr, venue_id="V1")
    assert m['source_id'] == "abc"
    assert m['name'] == "Мука"
    assert m['unit'] == "кг"
    assert m['venue_id'] == "V1"


@pytest.mark.asyncio
async def test_map_recipes_from_cooking_invoice():
    """Извлечение рецептур из CookingInvoice."""
    from transform import map_recipes_from_cooking_invoice
    qr = {
        "id": "cook001",
        "dishId": "dish001",
        "invoiceComponents": [
            {"dishId": "dish001", "productId": "prod001", "amount": 0.5, "measureUnit": "кг"},
            {"dishId": "dish001", "productId": "prod002", "amount": 0.3, "measureUnit": "л"},
        ]
    }
    recipes = map_recipes_from_cooking_invoice(qr, venue_id="V1")
    assert len(recipes) == 2
    assert recipes[0]['dish_source_id'] == "dish001"
    assert recipes[0]['ingredient_source_id'] == "prod001"
    assert recipes[0]['quantity'] == 0.5


@pytest.mark.asyncio
async def test_map_recipes_empty_components():
    """CookingInvoice без ингредиентов → пустой список."""
    from transform import map_recipes_from_cooking_invoice
    qr = {"id": "cook002", "dishId": "dishX", "invoiceComponents": []}
    recipes = map_recipes_from_cooking_invoice(qr, "V1")
    assert recipes == []
