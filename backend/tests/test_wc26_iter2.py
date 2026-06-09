"""
Iteration 2 backend tests:
- ROI includes purchase price (ownership_session created BEFORE debit)
- Match settle adds to ROI
- P2P trades blocked outside transfer windows
- Admin balance adjust (PATCH /admin/users/{id})
- Ledger filter by user_id
- Football API endpoints (graceful 403)
- Admin-only enforcement on /admin/football/*

Run with:
  pytest /app/backend/tests/test_wc26_iter2.py -v \
    --junitxml=/app/test_reports/pytest/pytest_results_iter2.xml
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as fh:
        for line in fh:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

API = f"{BASE_URL}/api"

ADMIN = {"username": "admin", "password": "admin1234"}
ALI = {"username": "ali", "password": "player1234"}
REZA = {"username": "reza", "password": "player1234"}


def H(token):
    return {"Authorization": f"Bearer {token}"}


def login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["token"]


# Reset DB once so state is deterministic for this run
@pytest.fixture(scope="session", autouse=True)
def fresh_db():
    tok = login(ADMIN)
    r = requests.post(f"{API}/admin/reset?confirm=RESET-ALL", headers=H(tok), timeout=20)
    assert r.status_code == 200, r.text
    yield


@pytest.fixture(scope="session")
def admin_token():
    return login(ADMIN)


@pytest.fixture(scope="session")
def ali_token():
    return login(ALI)


@pytest.fixture(scope="session")
def reza_token():
    return login(REZA)


@pytest.fixture(scope="session")
def users(admin_token):
    return requests.get(f"{API}/users", headers=H(admin_token), timeout=10).json()


@pytest.fixture(scope="session")
def teams(admin_token):
    return requests.get(f"{API}/teams", headers=H(admin_token), timeout=10).json()


def _find_user(users, uname):
    return next(u for u in users if u["username"] == uname)


def _find_team(teams, name_en):
    return next(t for t in teams if t["name_en"].lower() == name_en.lower())


# -------------------- Test 1 & 2: ROI tracking --------------------
class TestRoiTracking:
    def test_auction_assign_iran_creates_negative_roi(self, admin_token, ali_token, users, teams):
        ali = _find_user(users, "ali")
        iran = _find_team(teams, "Iran")
        # Assign Iran to ali at 20
        r = requests.post(f"{API}/admin/auction/assign", headers=H(admin_token),
                          json={"team_id": iran["id"], "user_id": ali["id"], "price": 20}, timeout=10)
        assert r.status_code == 200, r.text

        # Portfolio ROI should be -20
        port = requests.get(f"{API}/portfolio/{ali['id']}", headers=H(ali_token), timeout=10).json()
        iran_p = next((t for t in port if t["id"] == iran["id"]), None)
        assert iran_p is not None, "Iran not in ali's portfolio"
        assert abs(iran_p["roi"] - (-20.0)) < 1e-6, f"Expected roi=-20, got {iran_p['roi']}"

        # Verify ledger entry has meta.ownership_session and meta.purchase=true
        ledger = requests.get(f"{API}/ledger?user_id={ali['id']}", headers=H(admin_token), timeout=10).json()
        purchase_entry = next((e for e in ledger if e.get("meta", {}).get("team_id") == iran["id"]
                              and e.get("meta", {}).get("purchase") is True), None)
        assert purchase_entry is not None, "no purchase ledger entry with meta.purchase"
        assert purchase_entry["meta"].get("ownership_session"), "missing ownership_session in meta"
        # Validate ownership session matches team's session
        team_after = requests.get(f"{API}/teams/{iran['id']}", headers=H(admin_token), timeout=10).json()
        # team object exposes ownership_session_id
        assert team_after["ownership_session_id"] == purchase_entry["meta"]["ownership_session"]

    def test_settle_match_adds_to_roi(self, admin_token, ali_token, teams):
        # Find a group match where Iran plays - assume Iran is tier 4 group F or similar
        iran = _find_team(requests.get(f"{API}/teams", headers=H(admin_token), timeout=10).json(), "Iran")
        matches = requests.get(f"{API}/matches?stage=group", headers=H(admin_token), timeout=10).json()
        # find a match Iran is in
        match = next((m for m in matches
                      if (m["home_team_id"] == iran["id"] or m["away_team_id"] == iran["id"])
                      and m["status"] == "scheduled"), None)
        assert match, "no Iran match"
        iran_is_home = match["home_team_id"] == iran["id"]
        # Iran wins 2-1
        if iran_is_home:
            payload = {"match_id": match["id"], "home_goals": 2, "away_goals": 1,
                       "home_yellow": 0, "home_second_yellow": 0, "home_red": 0,
                       "away_yellow": 0, "away_second_yellow": 0, "away_red": 0}
        else:
            payload = {"match_id": match["id"], "home_goals": 1, "away_goals": 2,
                       "home_yellow": 0, "home_second_yellow": 0, "home_red": 0,
                       "away_yellow": 0, "away_second_yellow": 0, "away_red": 0}
        r = requests.post(f"{API}/admin/matches/settle", headers=H(admin_token), json=payload, timeout=10)
        assert r.status_code == 200, r.text

        users = requests.get(f"{API}/users", headers=H(admin_token), timeout=10).json()
        ali = _find_user(users, "ali")
        port = requests.get(f"{API}/portfolio/{ali['id']}", headers=H(ali_token), timeout=10).json()
        iran_p = next((t for t in port if t["id"] == iran["id"]), None)
        # Iran tier 4 -> multiplier 1.5; group_win base=5 -> 5*1.5=7.5; +2 goals scored, -1 conceded => 8.5
        # ROI = -20 + 8.5 = -11.5
        assert abs(iran_p["roi"] - (-11.5)) < 1e-6, f"Expected -11.5, got {iran_p['roi']}"


# -------------------- Test 3: P2P trades blocked outside windows --------------------
class TestTradeWindow:
    def test_trade_blocked_then_allowed(self, admin_token, ali_token, reza_token, users, teams):
        ali = _find_user(users, "ali")
        reza = _find_user(users, "reza")
        brazil = _find_team(teams, "Brazil")
        # Ensure windows closed
        for w in ("window_1", "window_2"):
            requests.post(f"{API}/admin/transfer-window", headers=H(admin_token),
                          json={"window": w, "open": False}, timeout=10)
        # Assign Brazil to ali at 30
        r = requests.post(f"{API}/admin/auction/assign", headers=H(admin_token),
                          json={"team_id": brazil["id"], "user_id": ali["id"], "price": 30}, timeout=10)
        assert r.status_code == 200, r.text

        # Propose trade: ali -> reza, price 20 (reza has 100, 40% = 40 -> 20 ok)
        r = requests.post(f"{API}/trades/propose", headers=H(ali_token),
                          json={"team_id": brazil["id"], "to_user_id": reza["id"], "price": 20}, timeout=10)
        assert r.status_code == 200, r.text
        trade = r.json()

        # Reza tries to accept while windows closed - should 400 with Persian message
        acc = requests.post(f"{API}/trades/{trade['id']}/accept",
                            headers=H(reza_token), timeout=10)
        assert acc.status_code == 400
        assert "پنجره" in acc.text or "نقل و انتقال" in acc.text, f"expected window message, got {acc.text}"

        # Admin opens window_1
        r = requests.post(f"{API}/admin/transfer-window", headers=H(admin_token),
                          json={"window": "window_1", "open": True}, timeout=10)
        assert r.status_code == 200

        # Now accept should work
        acc = requests.post(f"{API}/trades/{trade['id']}/accept",
                            headers=H(reza_token), timeout=10)
        assert acc.status_code == 200, acc.text

        # Verify buyer ownership_session is updated and buyer purchase debit has matching session
        team_after = requests.get(f"{API}/teams/{brazil['id']}", headers=H(admin_token), timeout=10).json()
        assert team_after["current_owner_id"] == reza["id"]
        new_session = team_after["ownership_session_id"]
        assert new_session

        ledger = requests.get(f"{API}/ledger?user_id={reza['id']}", headers=H(admin_token), timeout=10).json()
        buyer_debit = next((e for e in ledger if e.get("meta", {}).get("team_id") == brazil["id"]
                            and e.get("meta", {}).get("purchase") is True
                            and e["amount"] < 0), None)
        assert buyer_debit is not None, "buyer purchase debit not found"
        assert buyer_debit["meta"]["ownership_session"] == new_session, \
            "buyer ownership_session mismatch"

        # Close window again for downstream tests
        requests.post(f"{API}/admin/transfer-window", headers=H(admin_token),
                      json={"window": "window_1", "open": False}, timeout=10)


# -------------------- Test 4: Admin balance adjust --------------------
class TestAdminBalanceAdjust:
    def test_credit_then_debit(self, admin_token, users):
        # Use 'hossein' to avoid interfering with other tests
        hossein = _find_user(users, "hossein")
        before = requests.get(f"{API}/users", headers=H(admin_token), timeout=10).json()
        h_before = next(u for u in before if u["username"] == "hossein")["balance"]

        # Credit +15
        r = requests.patch(f"{API}/admin/users/{hossein['id']}", headers=H(admin_token),
                           json={"balance_delta": 15}, timeout=10)
        assert r.status_code == 200, r.text
        after = requests.get(f"{API}/users", headers=H(admin_token), timeout=10).json()
        h_after = next(u for u in after if u["username"] == "hossein")["balance"]
        assert abs((h_after - h_before) - 15) < 1e-6

        # Confirm ledger has the adjustment reason
        ledger = requests.get(f"{API}/ledger?user_id={hossein['id']}",
                              headers=H(admin_token), timeout=10).json()
        assert any("تعدیل دستی" in e.get("reason_fa", "") and e["amount"] == 15 for e in ledger)

        # Debit -7
        r = requests.patch(f"{API}/admin/users/{hossein['id']}", headers=H(admin_token),
                           json={"balance_delta": -7}, timeout=10)
        assert r.status_code == 200, r.text
        after2 = requests.get(f"{API}/users", headers=H(admin_token), timeout=10).json()
        h_after2 = next(u for u in after2 if u["username"] == "hossein")["balance"]
        assert abs((h_after2 - h_after) + 7) < 1e-6


# -------------------- Test 5: Ledger filter by user --------------------
class TestLedgerFilter:
    def test_ledger_user_filter(self, admin_token, users):
        ali = _find_user(users, "ali")
        ledger = requests.get(f"{API}/ledger?user_id={ali['id']}",
                              headers=H(admin_token), timeout=10).json()
        assert len(ledger) > 0, "ali should have ledger entries"
        for e in ledger:
            assert e["user_id"] == ali["id"], f"foreign user entry leaked: {e}"


# -------------------- Test 6 & 7: Football API endpoints --------------------
class TestFootballApi:
    def test_competitions_graceful(self, admin_token):
        r = requests.get(f"{API}/admin/football/competitions", headers=H(admin_token), timeout=20)
        # Either 200 with list, or 403 with Persian message, or 429
        assert r.status_code in (200, 403, 429, 502), f"unexpected: {r.status_code} {r.text}"
        if r.status_code == 200:
            data = r.json()
            assert "competitions" in data
            assert isinstance(data["competitions"], list)
        elif r.status_code == 403:
            assert "API" in r.text or "پلن" in r.text

    def test_import_does_not_crash(self, admin_token):
        r = requests.post(f"{API}/admin/football/import?competition=WC",
                          headers=H(admin_token), timeout=30)
        assert r.status_code in (200, 403, 429, 502)
        if r.status_code == 200:
            data = r.json()
            assert "linked" in data
            assert "remote_count" in data


# -------------------- Test 8: Admin-only on football endpoints --------------------
class TestFootballAdminOnly:
    def test_competitions_non_admin(self, ali_token):
        r = requests.get(f"{API}/admin/football/competitions", headers=H(ali_token), timeout=10)
        assert r.status_code == 403

    def test_matches_non_admin(self, ali_token):
        r = requests.get(f"{API}/admin/football/matches", headers=H(ali_token), timeout=10)
        assert r.status_code == 403

    def test_import_non_admin(self, ali_token):
        r = requests.post(f"{API}/admin/football/import", headers=H(ali_token), timeout=10)
        assert r.status_code == 403
