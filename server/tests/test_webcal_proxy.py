import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def auth_client(client):
    r = client.post("/api/register", json={"username": "webcaluser", "password": "password123"})
    token = r.json()["token"]
    client.headers = {"Authorization": f"Bearer {token}"}
    return client


def test_webcal_proxy_requires_auth(client):
    res = client.get("/api/webcal/proxy?url=https://example.com/cal.ics")
    assert res.status_code == 401


def test_webcal_proxy_blocks_private_and_loopback_ips(auth_client):
    # Loopback
    res = auth_client.get("/api/webcal/proxy?url=http://127.0.0.1/cal.ics")
    assert res.status_code == 400
    assert "forbidden" in res.json()["detail"]

    # Private IPv4
    res = auth_client.get("/api/webcal/proxy?url=http://192.168.1.1/cal.ics")
    assert res.status_code == 400

    # Localhost
    res = auth_client.get("/api/webcal/proxy?url=http://localhost:8080/cal.ics")
    assert res.status_code == 400

    # Non-http scheme
    res = auth_client.get("/api/webcal/proxy?url=ftp://example.com/cal.ics")
    assert res.status_code == 400
