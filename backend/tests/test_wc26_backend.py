"""
World Cup 2026 Fantasy Trading - Backend E2E tests.

Covers: auth, users, teams, matches, settle, rollback, trades (40% limit),
blind bids + windows, auction, bonuses, ledger, bracket, standings, admin perms.

Run:
  pytest /app/backend/tests/test_wc26_backend.py -v \
    --junitxml=/app/test_reports/pytest/pytest_results.xml
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback to frontend env file
    try:
        with open("/app/frontend/.env") as fh:
            for line in fh:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    break
    except FileNotFoundError:
        pass

API = f"{BASE_URL}/api"

ADMIN_CREDS = {"username": "admin", "password": "admin1234"}
ALI_CREDS = {"username": "ali", "password": "player1234"}
REZA_CREDS = {"username": "reza", "password": "player1234"}


# ------------------------------ fixtures ------------------------------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json=ADMIN_CREDS, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def ali_token():
    r = requests.post(f"{API}/auth/login", json=ALI_CREDS, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def reza_token():
    r = requests.post(f"{API}/auth/login", json=REZA_CREDS, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def H(token):
    return {"Authorization": f"Bearer {token}"}


# ------------------------------ auth ----------------------------------
class TestAuth:
    def test_login_admin(self):
        r = requests.post(f"{API}/auth/login", json=ADMIN_CREDS, timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert "token" in d and isinstance(d["token"], str)
        assert d["user"]["username"] == "admin"
        assert d["user"]["role"] == "admin"

    def test_login_bad_pwd(self):
        r = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "wrong"}, timeout=10)
        assert r.status_code == 401

    def test_me_with_token(self, admin_token):
        r = requests.get(f"{API}/auth/me", headers=H(admin_token), timeout=10)
        assert r.status_code == 200
        assert r.json()["username"] == "admin"

    def test_me_no_token(self):
        r = requests.get(f"{API}/auth/me", timeout=10)
        assert r.status_code == 401


# ------------------------------ users / teams / matches --------------
class TestSeedData:
    def test_users_list(self, admin_token):
        r = requests.get(f"{API}/users", headers=H(admin_token), timeout=10)
        assert r.status_code == 200
        users = r.json()
        usernames = {u["username"] for u in users}
        assert "admin" in usernames
        for u in ["ali", "reza", "hossein", "amir", "sara", "neda", "mohsen", "kian", "sina", "arman"]:
            assert u in usernames, f"missing seeded player {u}"
        assert len(users) >= 11
        # no _id in response
        for u in users:
            assert "_id" not in u
            assert "password_hash" not in u

    def test_teams(self, admin_token):
        r = requests.get(f"{API}/teams", headers=H(admin_token), timeout=10)
        assert r.status_code == 200
        teams = r.json()
        assert len(teams) == 48, f"expected 48 teams, got {len(teams)}"
        groups = {t["group"] for t in teams}
        assert groups == set("ABCDEFGHIJKL"), f"groups mismatch: {groups}"
        # each group has exactly 4
        from collections import Counter
        c = Counter(t["group"] for t in teams)
        assert all(v == 4 for v in c.values())

    def test_matches(self, admin_token):
        r = requests.get(f"{API}/matches", headers=H(admin_token), timeout=10)
        assert r.status_code == 200
        matches = r.json()
        group_matches = [m for m in matches if m["stage"] == "group"]
        assert len(group_matches) == 72, f"expected 72 group matches, got {len(group_matches)}"

    def test_standings(self, admin_token):
        r = requests.get(f"{API}/standings", headers=H(admin_token), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert set(d.keys()) == set("ABCDEFGHIJKL")
        for grp, rows in d.items():
            assert len(rows) == 4
            assert "points" in rows[0] and "gd" in rows[0]

    def test_bracket_shape(self, admin_token):
        r = requests.get(f"{API}/bracket", headers=H(admin_token), timeout=10)
        assert r.status_code == 200
        d = r.json()
        for k in ["r32", "r16", "qf", "sf", "third", "final"]:
            assert k in d
            assert isinstance(d[k], list)


# ------------------------------ admin perms ---------------------------
class TestAdminAuth:
    def test_player_cannot_admin_logs(self, ali_token):
        r = requests.get(f"{API}/admin/logs", headers=H(ali_token), timeout=10)
        assert r.status_code == 403

    def test_player_cannot_auction_assign(self, ali_token, admin_token):
        teams = requests.get(f"{API}/teams", headers=H(admin_token), timeout=10).json()
        users = requests.get(f"{API}/users", headers=H(admin_token), timeout=10).json()
        any_team = next(t for t in teams if not t.get("current_owner_id"))
        any_player = next(u for u in users if u["username"] == "ali")
        r = requests.post(
            f"{API}/admin/auction/assign",
            headers=H(ali_token),
            json={"team_id": any_team["id"], "user_id": any_player["id"], "price": 10},
            timeout=10,
        )
        assert r.status_code == 403

    def test_admin_logs_ok(self, admin_token):
        r = requests.get(f"{API}/admin/logs", headers=H(admin_token), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ----------------------- auction + settle + rollback -----------------
class TestSettleFlow:
    """Assign Iran (T4) to Ali and an away team to Reza, then settle a group match
       between them and verify ledger / tier multiplier."""

    @pytest.fixture(scope="class")
    def context(self, admin_token):
        teams = requests.get(f"{API}/teams", headers=H(admin_token), timeout=10).json()
        users = requests.get(f"{API}/users", headers=H(admin_token), timeout=10).json()
        ali = next(u for u in users if u["username"] == "ali")
        reza = next(u for u in users if u["username"] == "reza")
        ali_before = ali["balance"]
        reza_before = reza["balance"]

        # pick a group match where neither team is owned
        matches = requests.get(f"{API}/matches?stage=group&status=scheduled",
                               headers=H(admin_token), timeout=10).json()
        t_by_id = {t["id"]: t for t in teams}
        chosen = None
        for m in matches:
            ht = t_by_id[m["home_team_id"]]
            at = t_by_id[m["away_team_id"]]
            if not ht.get("current_owner_id") and not at.get("current_owner_id"):
                chosen = (m, ht, at)
                break
        assert chosen, "no eligible group match found"
        m, ht, at = chosen

        # Assign home team to Ali at 20, away to Reza at 15
        r1 = requests.post(f"{API}/admin/auction/assign",
                           headers=H(admin_token),
                           json={"team_id": ht["id"], "user_id": ali["id"], "price": 20},
                           timeout=10)
        assert r1.status_code == 200, r1.text
        r2 = requests.post(f"{API}/admin/auction/assign",
                           headers=H(admin_token),
                           json={"team_id": at["id"], "user_id": reza["id"], "price": 15},
                           timeout=10)
        assert r2.status_code == 200, r2.text
        return {"match": m, "home_team": ht, "away_team": at, "ali": ali, "reza": reza,
                "ali_before": ali_before, "reza_before": reza_before}

    def test_balance_deducted(self, admin_token, context):
        users = requests.get(f"{API}/users", headers=H(admin_token), timeout=10).json()
        ali = next(u for u in users if u["username"] == "ali")
        reza = next(u for u in users if u["username"] == "reza")
        # Verify deltas relative to fixture start: Ali -20, Reza -15
        assert abs((context["ali_before"] - ali["balance"]) - 20) < 1e-6, f"ali delta wrong: was {context['ali_before']}, now {ali['balance']}"
        assert abs((context["reza_before"] - reza["balance"]) - 15) < 1e-6, f"reza delta wrong: was {context['reza_before']}, now {reza['balance']}"

    def test_settle_and_rollback(self, admin_token, context):
        m = context["match"]
        ht = context["home_team"]
        at = context["away_team"]
        # home win 2-1
        payload = {
            "match_id": m["id"],
            "home_goals": 2, "away_goals": 1,
            "home_yellow": 1, "home_second_yellow": 0, "home_red": 0,
            "away_yellow": 0, "away_second_yellow": 0, "away_red": 0,
        }
        r = requests.post(f"{API}/admin/matches/settle",
                          headers=H(admin_token), json=payload, timeout=10)
        assert r.status_code == 200, r.text
        sim = r.json()["simulation"]
        # Validate tier maths: home_total = base_win*mult + 2*1 (goals) + 1*-2 (yellow) + 1*-1 (conceded)
        from_seed = _expected_home_total(ht["tier"], 2, 1, yc=1)
        assert abs(sim["home_total"] - from_seed) < 1e-6, f"home_total {sim['home_total']} vs expected {from_seed}"

        # Verify ledger updated
        ledger = requests.get(f"{API}/ledger?limit=50",
                              headers=H(admin_token), timeout=10).json()
        assert any(e.get("meta", {}).get("match_id") == m["id"] for e in ledger)

        # Rollback
        rr = requests.post(f"{API}/admin/matches/{m['id']}/rollback",
                           headers=H(admin_token), timeout=10)
        assert rr.status_code == 200, rr.text
        # confirm match scheduled again
        ms = requests.get(f"{API}/matches", headers=H(admin_token), timeout=10).json()
        m_after = next(x for x in ms if x["id"] == m["id"])
        assert m_after["status"] == "scheduled"


def _expected_home_total(tier: int, hg: int, ag: int, yc=0, sy=0, rc=0):
    # mirrors backend constants
    mult = {1: 1.0, 2: 1.0, 3: 1.5, 4: 1.5, 5: 2.0, 6: 2.0}[tier]
    base = 0
    if hg > ag:
        base = 5 * mult  # group_win
    elif hg == ag:
        base = 2 * mult
    goals = hg * 1  # goal_scored
    conceded = ag * -1
    cards = yc * -1 + sy * -2 + rc * -4
    return base + goals + conceded + cards


# ----------------------------- trades ---------------------------------
class TestTrades:
    def test_propose_then_reject_overpriced(self, admin_token, ali_token, reza_token):
        # Ali should own at least one team (from previous test)
        port = requests.get(f"{API}/portfolio/me", headers=H(ali_token), timeout=10).json()
        if not port:
            pytest.skip("Ali has no team to trade")
        team = port[0]
        users = requests.get(f"{API}/users", headers=H(admin_token), timeout=10).json()
        reza = next(u for u in users if u["username"] == "reza")
        # Reza balance ~85 → 40% = 34. Propose price 80 (over the limit).
        r = requests.post(f"{API}/trades/propose",
                          headers=H(ali_token),
                          json={"team_id": team["id"], "to_user_id": reza["id"], "price": 80},
                          timeout=10)
        assert r.status_code == 200, r.text
        trade = r.json()
        # Reza accepts -> should fail due to 40% limit
        acc = requests.post(f"{API}/trades/{trade['id']}/accept",
                            headers=H(reza_token), timeout=10)
        assert acc.status_code == 400
        assert "40" in acc.text or "۴۰" in acc.text or "موجودی" in acc.text

    def test_propose_within_limit(self, admin_token, ali_token, reza_token):
        port = requests.get(f"{API}/portfolio/me", headers=H(ali_token), timeout=10).json()
        if not port:
            pytest.skip("Ali has no team")
        team = port[0]
        users = requests.get(f"{API}/users", headers=H(admin_token), timeout=10).json()
        reza = next(u for u in users if u["username"] == "reza")
        # use 30% of reza's balance to stay safely under 40% limit
        price = max(1, round(reza["balance"] * 0.3, 1))
        r = requests.post(f"{API}/trades/propose",
                          headers=H(ali_token),
                          json={"team_id": team["id"], "to_user_id": reza["id"], "price": price},
                          timeout=10)
        assert r.status_code == 200
        trade = r.json()
        acc = requests.post(f"{API}/trades/{trade['id']}/accept",
                            headers=H(reza_token), timeout=10)
        assert acc.status_code == 200, acc.text
        # confirm ownership transferred
        t = requests.get(f"{API}/teams/{team['id']}", headers=H(admin_token), timeout=10).json()
        assert t["current_owner_id"] == reza["id"]


# -------------------------- bids + windows ---------------------------
class TestBidsWindow:
    def test_bid_window_open_resolve(self, admin_token, ali_token):
        # open window 1
        r = requests.post(f"{API}/admin/transfer-window", headers=H(admin_token),
                          json={"window": "window_1", "open": True}, timeout=10)
        assert r.status_code == 200
        # find a free agent team
        teams = requests.get(f"{API}/teams", headers=H(admin_token), timeout=10).json()
        free = next(t for t in teams if not t.get("current_owner_id"))
        # ali bids
        ali_user = next(u for u in requests.get(f"{API}/users",
                        headers=H(admin_token), timeout=10).json() if u["username"] == "ali")
        # ensure under 40% limit
        amt = min(10, max(1, int(ali_user["balance"] * 0.4) - 1))
        rb = requests.post(f"{API}/bids", headers=H(ali_token),
                           json={"team_id": free["id"], "amount": amt}, timeout=10)
        assert rb.status_code == 200, rb.text
        # resolve
        rr = requests.post(f"{API}/admin/bids/resolve", headers=H(admin_token), timeout=10)
        assert rr.status_code == 200
        assert rr.json()["transferred"] >= 1
        # team now owned by ali
        t = requests.get(f"{API}/teams/{free['id']}", headers=H(admin_token), timeout=10).json()
        assert t["current_owner_id"] == ali_user["id"]


# ------------------------------ bonus --------------------------------
class TestBonus:
    def test_award_golden_team(self, admin_token):
        teams = requests.get(f"{API}/teams", headers=H(admin_token), timeout=10).json()
        owned = next((t for t in teams if t.get("current_owner_id")), None)
        if not owned:
            pytest.skip("no owned team")
        r = requests.post(f"{API}/admin/bonus/award", headers=H(admin_token),
                          json={"bonus_type": "golden_team", "team_id": owned["id"]},
                          timeout=10)
        assert r.status_code == 200


# ----------------------------- ledger --------------------------------
class TestLedger:
    def test_ledger_reverse_chrono(self, admin_token):
        r = requests.get(f"{API}/ledger?limit=20", headers=H(admin_token), timeout=10)
        assert r.status_code == 200
        entries = r.json()
        if len(entries) >= 2:
            ts = [e["ts"] for e in entries]
            assert ts == sorted(ts, reverse=True)


# ----------------------------- admin reset (run last) ----------------
class TestAdminReset:
    """We deliberately do NOT execute the full reset — only verify guard."""
    def test_reset_guard(self, admin_token):
        r = requests.post(f"{API}/admin/reset?confirm=NO", headers=H(admin_token), timeout=10)
        assert r.status_code == 400
