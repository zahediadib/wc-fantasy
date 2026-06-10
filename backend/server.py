"""
World Cup 2026 – Strategic Fantasy Trading Game
FastAPI backend (MongoDB).

All routes are prefixed with /api.
"""
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import re
import uuid
import logging
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any, Annotated

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict
import httpx

from auth import (
    hash_password,
    verify_password,
    create_access_token,
    decode_token,
    get_token_from_request,
)
from seed_data import (
    TEAMS,
    tier_multiplier,
    MATCH_BASE_COINS,
    PERFORMANCE,
    BONUSES,
    STAGES,
    generate_group_fixtures,
)

# ---------------------------------------------------------------------------
# DB / App
# ---------------------------------------------------------------------------
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="World Cup 2026 Fantasy Trading")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("wc26")

DEFAULT_START_BALANCE = 100
TRANSFER_PERCENT_LIMIT = 0.40  # 40%
AUCTION_MAX_BID = 65
STAGE_LABELS_FA = {
    "group": "مرحله گروهی",
    "r32": "یک‌شانزدهم نهایی",
    "r16": "یک‌هشتم نهایی",
    "qf": "یک‌چهارم نهایی",
    "sf": "نیمه‌نهایی",
    "third": "رده‌بندی",
    "final": "فینال",
}
TIER_LABELS_FA = {
    1: "سطح ۱",
    2: "سطح ۲",
    3: "سطح ۳",
    4: "سطح ۴",
    5: "سطح ۵",
    6: "سطح ۶",
}
KNOCKOUT_STAGE_LIMITS = {"r32": 16, "r16": 8, "qf": 4, "sf": 2, "third": 1, "final": 1}
UNASSIGNED_BRACKET_SLOT_SORT_KEY = 10_000

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def gen_id() -> str:
    return str(uuid.uuid4())


def clean(doc: Optional[dict]) -> Optional[dict]:
    if doc is None:
        return None
    doc.pop("_id", None)
    return doc


async def log_event(action: str, payload: dict, actor_id: Optional[str] = None):
    # Sanitize payload: drop ObjectId at any depth to avoid serialization issues later
    def _scrub(v):
        from bson import ObjectId
        if isinstance(v, ObjectId):
            return str(v)
        if isinstance(v, dict):
            return {k: _scrub(x) for k, x in v.items() if k != "_id"}
        if isinstance(v, list):
            return [_scrub(x) for x in v]
        return v
    safe_payload = _scrub(payload) if isinstance(payload, dict) else payload
    await db.system_logs.insert_one({
        "id": gen_id(),
        "ts": now_iso(),
        "actor_id": actor_id,
        "action": action,
        "payload": safe_payload,
    })


# ---------------------------------------------------------------------------
# Auth dependencies
# ---------------------------------------------------------------------------
async def get_current_user(request: Request) -> dict:
    token = get_token_from_request(request)
    if not token:
        raise HTTPException(status_code=401, detail="احراز هویت نشده")
    payload = decode_token(token)
    user = await db.users.find_one({"id": payload["sub"]})
    if not user:
        raise HTTPException(status_code=401, detail="کاربر یافت نشد")
    clean(user)
    user.pop("password_hash", None)
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="دسترسی فقط برای ادمین")
    return user


# ---------------------------------------------------------------------------
# Pydantic Models
# ---------------------------------------------------------------------------
class LoginIn(BaseModel):
    username: str
    password: str


class UserCreateIn(BaseModel):
    username: str
    password: str
    name: str  # Persian name
    role: str = "player"
    initial_balance: int = DEFAULT_START_BALANCE


class UserUpdateIn(BaseModel):
    name: Optional[str] = None
    password: Optional[str] = None
    balance_delta: Optional[float] = None


class TradeProposeIn(BaseModel):
    team_id: str
    to_user_id: str
    price: float


class BlindBidIn(BaseModel):
    team_id: str
    amount: float


class AuctionAssignIn(BaseModel):
    team_id: str
    user_id: str
    price: float


class MatchSettleConfirmIn(BaseModel):
    match_id: str
    home_goals: int
    away_goals: int
    home_yellow: int = 0
    home_red: int = 0
    away_yellow: int = 0
    away_red: int = 0


class MatchCreateIn(BaseModel):
    stage: str
    home_team_id: str
    away_team_id: str
    kickoff: Optional[str] = None
    group: Optional[str] = None
    external_id: Optional[str] = None


class TransferWindowIn(BaseModel):
    window: str  # 'window_1' or 'window_2'
    open: bool


class BonusAwardIn(BaseModel):
    bonus_type: str  # golden_team, giant_killer, clean_sheet, punching_bag, scapegoat
    team_id: str
    note: Optional[str] = None


# ---------------------------------------------------------------------------
# Ledger helpers
# ---------------------------------------------------------------------------
async def credit_user(user_id: str, amount: float, reason_fa: str, meta: dict):
    """Atomic-ish credit / debit + ledger entry. Wallet stays consistent because
    we update with $inc."""
    if amount == 0:
        return
    res = await db.users.update_one({"id": user_id}, {"$inc": {"balance": amount}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="کاربر یافت نشد")
    user = await db.users.find_one({"id": user_id})
    entry = {
        "id": gen_id(),
        "ts": now_iso(),
        "user_id": user_id,
        "username": user["username"],
        "user_name_fa": user["name"],
        "amount": amount,
        "reason_fa": reason_fa,
        "meta": meta,
        "balance_after": user["balance"],
    }
    await db.ledger.insert_one(entry)
    return entry


# ---------------------------------------------------------------------------
# Startup: seed data, indexes, admin & players, teams, fixtures
# ---------------------------------------------------------------------------
async def seed_admin_and_players():
    admin_username = os.environ.get("ADMIN_USERNAME", "admin")
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin1234")
    admin_name = os.environ.get("ADMIN_NAME", "مدیر سیستم")

    existing = await db.users.find_one({"username": admin_username})
    if not existing:
        await db.users.insert_one({
            "id": gen_id(),
            "username": admin_username,
            "password_hash": hash_password(admin_password),
            "name": admin_name,
            "role": "admin",
            "balance": 0,
            "created_at": now_iso(),
        })
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one(
            {"username": admin_username},
            {"$set": {"password_hash": hash_password(admin_password)}},
        )

    # Seed 10 default players if not already present
    default_players = [
        ("ali", "علی"),
        ("reza", "رضا"),
        ("hossein", "حسین"),
        ("amir", "امیر"),
        ("sara", "سارا"),
        ("neda", "ندا"),
        ("mohsen", "محسن"),
        ("kian", "کیان"),
        ("sina", "سینا"),
        ("arman", "آرمان"),
    ]
"""     for uname, fa_name in default_players:
        if not await db.users.find_one({"username": uname}):
            await db.users.insert_one({
                "id": gen_id(),
                "username": uname,
                "password_hash": hash_password("player1234"),
                "name": fa_name,
                "role": "player",
                "balance": DEFAULT_START_BALANCE,
                "created_at": now_iso(),
            }) """


async def seed_teams():
    count = await db.teams.count_documents({})
    if count > 0:
        return
    docs = []
    for name_en, name_fa, code, group, tier in TEAMS:
        docs.append({
            "id": gen_id(),
            "name_en": name_en,
            "name_fa": name_fa,
            "code": code,
            "group": group,
            "tier": tier,
            "multiplier": tier_multiplier(tier),
            "alive": True,
            "current_owner_id": None,  # None = Bank / Free Agent
            "stats": {
                "played": 0, "wins": 0, "draws": 0, "losses": 0,
                "gf": 0, "ga": 0, "yc": 0, "ry": 0, "rc": 0,
            },
        })
    await db.teams.insert_many(docs)


async def seed_fixtures():
    """No-op: matches are no longer auto-seeded. Admin pulls real fixtures via
    POST /api/admin/fetch (apifootball.com)."""
    return


async def seed_settings():
    settings = await db.settings.find_one({"id": "global"})
    if not settings:
        await db.settings.insert_one({
            "id": "global",
            "auction_open": False,
            "window_1_open": False,
            "window_2_open": False,
            "tournament_locked": False,
        })


@app.on_event("startup")
async def on_startup():
    await db.users.create_index("username", unique=True)
    await db.teams.create_index("name_en")
    await db.matches.create_index("kickoff")
    await db.matches.create_index("external_id")
    await db.ledger.create_index("ts")
    await seed_admin_and_players()
    await seed_teams()
    # One-time cleanup: drop any old mock matches with no external_id
    deleted = await db.matches.delete_many({"$or": [
        {"external_id": None}, {"external_id": {"$exists": False}},
    ]})
    if deleted.deleted_count:
        log.info("Removed %d auto-seeded mock fixtures (now using apifootball.com)", deleted.deleted_count)
    await seed_settings()
    log.info("Startup seeding complete.")


@app.on_event("shutdown")
async def on_shutdown():
    client.close()


# ---------------------------------------------------------------------------
# AUTH
# ---------------------------------------------------------------------------
@api.post("/auth/login")
async def auth_login(body: LoginIn, response: Response):
    user = await db.users.find_one({"username": body.username})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="نام کاربری یا رمز عبور اشتباه است")
    token = create_access_token(user["id"], user["username"], user["role"])
    # HttpOnly cookie – primary auth channel for the SPA
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=60 * 60 * 24 * 7,
        path="/",
    )
    clean(user)
    user.pop("password_hash", None)
    # Token is still returned for API clients (tests, curl); browser ignores it
    return {"token": token, "user": user}


@api.get("/auth/me")
async def auth_me(user: dict = Depends(get_current_user)):
    return user


@api.post("/auth/logout")
async def auth_logout(response: Response, user: dict = Depends(get_current_user)):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}


# ---------------------------------------------------------------------------
# USERS
# ---------------------------------------------------------------------------
@api.get("/users")
async def list_users(user: dict = Depends(get_current_user)):
    out = []
    async for u in db.users.find({}).sort("balance", -1):
        clean(u)
        u.pop("password_hash", None)
        out.append(u)
    return out


@api.post("/admin/users")
async def admin_create_user(body: UserCreateIn, admin: dict = Depends(require_admin)):
    if await db.users.find_one({"username": body.username}):
        raise HTTPException(status_code=400, detail="این نام کاربری قبلاً ثبت شده است")
    if body.role not in ("admin", "player"):
        raise HTTPException(status_code=400, detail="نقش نامعتبر")
    new = {
        "id": gen_id(),
        "username": body.username,
        "password_hash": hash_password(body.password),
        "name": body.name,
        "role": body.role,
        "balance": body.initial_balance,
        "created_at": now_iso(),
    }
    await db.users.insert_one(new)
    await log_event("user.create", {"user_id": new["id"], "username": body.username}, admin["id"])
    clean(new)
    new.pop("password_hash", None)
    return new


@api.patch("/admin/users/{user_id}")
async def admin_update_user(user_id: str, body: UserUpdateIn, admin: dict = Depends(require_admin)):
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="کاربر یافت نشد")
    updates: Dict[str, Any] = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.password:
        updates["password_hash"] = hash_password(body.password)
    if updates:
        await db.users.update_one({"id": user_id}, {"$set": updates})
    if body.balance_delta:
        await credit_user(
            user_id, body.balance_delta,
            "تعدیل دستی توسط ادمین",
            {"by": admin["username"]},
        )
    await log_event("user.update", {"user_id": user_id, "updates": list(updates.keys())}, admin["id"])
    return {"ok": True}


@api.delete("/admin/users/{user_id}")
async def admin_delete_user(user_id: str, admin: dict = Depends(require_admin)):
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="کاربر یافت نشد")
    if target["role"] == "admin":
        raise HTTPException(status_code=400, detail="ادمین حذف نمی‌شود")
    # release teams
    await db.teams.update_many({"current_owner_id": user_id}, {"$set": {"current_owner_id": None}})
    await db.users.delete_one({"id": user_id})
    await log_event("user.delete", {"user_id": user_id}, admin["id"])
    return {"ok": True}


# ---------------------------------------------------------------------------
# TEAMS
# ---------------------------------------------------------------------------
@api.get("/teams")
async def list_teams(user: dict = Depends(get_current_user)):
    teams = []
    async for t in db.teams.find({}):
        clean(t)
        teams.append(t)
    return teams


@api.get("/teams/{team_id}")
async def get_team(team_id: str, user: dict = Depends(get_current_user)):
    t = await db.teams.find_one({"id": team_id})
    if not t:
        raise HTTPException(status_code=404, detail="تیم یافت نشد")
    clean(t)
    # compute ROI for current owner restricted to the CURRENT ownership session
    if t["current_owner_id"] and t.get("ownership_session_id"):
        agg = await db.ledger.aggregate([
            {"$match": {
                "user_id": t["current_owner_id"],
                "meta.team_id": t["id"],
                "meta.ownership_session": t["ownership_session_id"],
            }},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
        ]).to_list(1)
        t["current_owner_roi"] = float(agg[0]["total"]) if agg else 0.0
    return t


@api.get("/portfolio/me")
async def my_portfolio(user: dict = Depends(get_current_user)):
    return await _portfolio_for(user["id"])


@api.get("/portfolio/{user_id}")
async def user_portfolio(user_id: str, _: dict = Depends(get_current_user)):
    return await _portfolio_for(user_id)


async def _portfolio_for(user_id: str):
    teams = []
    async for t in db.teams.find({"current_owner_id": user_id}):
        clean(t)
        # ROI for current ownership session
        ownership_session = t.get("ownership_session_id")
        if ownership_session:
            agg = await db.ledger.aggregate([
                {"$match": {"user_id": user_id, "meta.team_id": t["id"], "meta.ownership_session": ownership_session}},
                {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
            ]).to_list(1)
            t["roi"] = float(agg[0]["total"]) if agg else 0.0
        else:
            t["roi"] = 0.0
        teams.append(t)
    return teams


# ---------------------------------------------------------------------------
# MATCHES + FIXTURES
# ---------------------------------------------------------------------------
@api.get("/matches")
async def list_matches(
    stage: Optional[str] = None,
    status: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    q: Dict[str, Any] = {}
    if stage:
        q["stage"] = stage
    if status:
        q["status"] = status
    matches = []
    async for m in db.matches.find(q).sort("kickoff", 1):
        clean(m)
        matches.append(m)
    return matches


@api.post("/admin/matches")
async def admin_create_match(body: MatchCreateIn, admin: dict = Depends(require_admin)):
    if body.stage not in STAGES:
        raise HTTPException(status_code=400, detail="مرحله نامعتبر")
    home = await db.teams.find_one({"id": body.home_team_id})
    away = await db.teams.find_one({"id": body.away_team_id})
    if not home or not away:
        raise HTTPException(status_code=404, detail="تیم یافت نشد")
    doc = {
        "id": gen_id(),
        "stage": body.stage,
        "group": body.group,
        "home_team_id": body.home_team_id,
        "away_team_id": body.away_team_id,
        "kickoff": body.kickoff or now_iso(),
        "status": "scheduled",
        "result": None,
        "external_id": body.external_id,
    }
    await db.matches.insert_one(doc)
    await log_event("match.create", {"match_id": doc["id"]}, admin["id"])
    clean(doc)
    return doc


# ---------- match settlement engine ----------
def _stage_win_key(stage: str) -> Optional[str]:
    return {
        "group": "group_win",
        "r32": "r32_win",
        "r16": "r16_win",
        "qf": "qf_win",
        "sf": "sf_win",
        "final": "final_win",
        "third": "third_win",
    }.get(stage)


def _compute_settlement(match: dict, home: dict, away: dict, r: dict) -> dict:
    """Compute coin deltas for home and away owners (and any events) from result `r`.

    `r` keys: home_goals, away_goals, home_yellow, home_second_yellow, home_red,
    away_yellow, away_second_yellow, away_red.
    """
    stage = match["stage"]
    home_owner = home.get("current_owner_id")
    away_owner = away.get("current_owner_id")

    def base_outcome(side_goals: int, other_goals: int, tier: int, is_home: bool):
        # returns (amount, reason_label)
        m = tier_multiplier(tier)
        if stage == "group":
            if side_goals > other_goals:
                return MATCH_BASE_COINS["group_win"] * m, "برد گروهی"
            if side_goals == other_goals:
                return MATCH_BASE_COINS["group_draw"] * m, "تساوی گروهی"
            return 0, "باخت گروهی"
        # knockout: only wins pay
        if side_goals > other_goals:
            key = _stage_win_key(stage)
            return MATCH_BASE_COINS[key] * m, f"برد {stage}"
        return 0, "حذف"

    breakdown = {"home": [], "away": []}

    # Outcome
    h_amt, h_lbl = base_outcome(r["home_goals"], r["away_goals"], home["tier"], True)
    a_amt, a_lbl = base_outcome(r["away_goals"], r["home_goals"], away["tier"], False)
    breakdown["home"].append({"amount": h_amt, "label": h_lbl})
    breakdown["away"].append({"amount": a_amt, "label": a_lbl})

    # Goals
    if r["home_goals"]:
        breakdown["home"].append({"amount": PERFORMANCE["goal_scored"] * r["home_goals"], "label": f"{r['home_goals']} گل زده"})
    if r["away_goals"]:
        breakdown["home"].append({"amount": PERFORMANCE["goal_conceded"] * r["away_goals"], "label": f"{r['away_goals']} گل خورده"})
    if r["away_goals"]:
        breakdown["away"].append({"amount": PERFORMANCE["goal_scored"] * r["away_goals"], "label": f"{r['away_goals']} گل زده"})
    if r["home_goals"]:
        breakdown["away"].append({"amount": PERFORMANCE["goal_conceded"] * r["home_goals"], "label": f"{r['home_goals']} گل خورده"})

    # Cards (simplified: yellow=-1, red=-2, no second-yellow distinction)
    for side, prefix in (("home", "home_"), ("away", "away_")):
        yc = r.get(f"{prefix}yellow", 0)
        rc = r.get(f"{prefix}red", 0)
        if yc:
            breakdown[side].append({"amount": PERFORMANCE["yellow_card"] * yc, "label": f"{yc} کارت زرد"})
        if rc:
            breakdown[side].append({"amount": PERFORMANCE["red_card"] * rc, "label": f"{rc} کارت قرمز"})

    home_total = sum(b["amount"] for b in breakdown["home"])
    away_total = sum(b["amount"] for b in breakdown["away"])

    return {
        "home_owner": home_owner,
        "away_owner": away_owner,
        "home_total": home_total,
        "away_total": away_total,
        "breakdown": breakdown,
    }


@api.get("/admin/matches/{match_id}/preview")
async def preview_settle(match_id: str, admin: dict = Depends(require_admin)):
    """Compute pre-filled values from the stored apifootball event payload.
    Admin can still manually override before confirming the settlement."""
    m = await db.matches.find_one({"id": match_id})
    if not m:
        raise HTTPException(status_code=404, detail="بازی یافت نشد")
    if m["status"] == "settled":
        raise HTTPException(status_code=400, detail="این بازی قبلاً تسویه شده است")
    home = await db.teams.find_one({"id": m["home_team_id"]})
    away = await db.teams.find_one({"id": m["away_team_id"]})

    api_data = m.get("api_data") or {}
    if api_data:
        h_goals, a_goals = _goals_from_api(api_data)
        h_cards = _cards_from_api(api_data, "home")
        a_cards = _cards_from_api(api_data, "away")
        fetched = {
            "home_goals": h_goals, "away_goals": a_goals,
            "home_yellow": h_cards["yellow"], "home_red": h_cards["red"],
            "away_yellow": a_cards["yellow"], "away_red": a_cards["red"],
            "source": "apifootball.com",
            "api_status": m.get("api_status"),
        }
    else:
        fetched = {
            "home_goals": 0, "away_goals": 0,
            "home_yellow": 0, "home_red": 0,
            "away_yellow": 0, "away_red": 0,
            "source": "manual", "api_status": None,
        }

    sim = _compute_settlement(m, home, away, fetched)
    clean(m)
    clean(home)
    clean(away)
    return {
        "match": m,
        "home": home,
        "away": away,
        "fetched": fetched,
        "simulation": sim,
    }


def _poster_fantasy_stats(stage: str, team_tier: int, my_goals: int, other_goals: int, yellow: int, red: int) -> List[dict]:
    rows: List[dict] = []
    mult = tier_multiplier(team_tier)
    if my_goals > other_goals:
        key = "group_win" if stage == "group" else _stage_win_key(stage)
        if key:
            base = MATCH_BASE_COINS[key]
            rows.append({"title": "برد بازی", "baseValue": base, "multiplier": mult, "finalScore": base * mult})
    elif stage == "group" and my_goals == other_goals:
        base = MATCH_BASE_COINS["group_draw"]
        rows.append({"title": "تساوی بازی", "baseValue": base, "multiplier": mult, "finalScore": base * mult})

    if my_goals:
        rows.append({"title": "گل زده", "baseValue": my_goals, "multiplier": 1, "finalScore": my_goals})
    if other_goals:
        rows.append({"title": "گل خورده", "baseValue": other_goals, "multiplier": PERFORMANCE["goal_conceded"], "finalScore": PERFORMANCE["goal_conceded"] * other_goals})
    if yellow:
        rows.append({"title": "کارت زرد", "baseValue": yellow, "multiplier": PERFORMANCE["yellow_card"], "finalScore": PERFORMANCE["yellow_card"] * yellow})
    if red:
        rows.append({"title": "کارت قرمز", "baseValue": red, "multiplier": PERFORMANCE["red_card"], "finalScore": PERFORMANCE["red_card"] * red})
    return rows


async def _team_roi_until(team_id: str, settled_at: str, users_map: Dict[str, str]) -> List[dict]:
    rows = await db.ledger.aggregate([
        {"$match": {"meta.team_id": team_id, "ts": {"$lte": settled_at}}},
        {"$group": {"_id": "$user_id", "roi": {"$sum": "$amount"}}},
        {"$sort": {"roi": -1}},
    ]).to_list(100)
    out = []
    for row in rows:
        uid = row["_id"]
        out.append({
            "userId": uid,
            "userName": users_map.get(uid, "کاربر"),
            "roi": float(row["roi"]),
        })
    return out


@api.get("/admin/matches/{match_id}/poster")
async def settled_match_poster_data(match_id: str, admin: dict = Depends(require_admin)):
    m = await db.matches.find_one({"id": match_id})
    if not m:
        raise HTTPException(status_code=404, detail="بازی یافت نشد")
    if m.get("status") != "settled" or not m.get("result"):
        raise HTTPException(status_code=400, detail="این بازی هنوز تسویه نشده است")

    home = await db.teams.find_one({"id": m["home_team_id"]})
    away = await db.teams.find_one({"id": m["away_team_id"]})
    if not home or not away:
        raise HTTPException(status_code=422, detail="اطلاعات تیم برای پوستر کامل نیست")

    users_map = {u["id"]: u["name"] async for u in db.users.find({})}
    r = m["result"]
    settled_at = m.get("settled_at") or now_iso()

    home_stats = _poster_fantasy_stats(
        m["stage"], int(home["tier"]), int(r.get("home_goals", 0)), int(r.get("away_goals", 0)),
        int(r.get("home_yellow", 0)), int(r.get("home_red", 0)),
    )
    away_stats = _poster_fantasy_stats(
        m["stage"], int(away["tier"]), int(r.get("away_goals", 0)), int(r.get("home_goals", 0)),
        int(r.get("away_yellow", 0)), int(r.get("away_red", 0)),
    )

    home_total = float(sum(x["finalScore"] for x in home_stats))
    away_total = float(sum(x["finalScore"] for x in away_stats))

    return {
        "match": {
            "status": "تسویه شده",
            "date": (m.get("kickoff") or "")[:10],
            "tournamentStage": STAGE_LABELS_FA.get(m["stage"], m["stage"]),
            "finalScore": f"{r.get('home_goals', 0)} - {r.get('away_goals', 0)}",
        },
        "teams": [
            {
                "flagUrl": f"https://flagicons.lipis.dev/flags/4x3/{home['code']}.svg",
                "countryName": home["name_fa"],
                "tierName": TIER_LABELS_FA.get(int(home["tier"]), f"سطح {home['tier']}"),
                "matchResult": r.get("home_goals", 0),
                "fantasyStats": home_stats,
                "totalMatchScore": home_total,
                "usersROI": await _team_roi_until(home["id"], settled_at, users_map),
            },
            {
                "flagUrl": f"https://flagicons.lipis.dev/flags/4x3/{away['code']}.svg",
                "countryName": away["name_fa"],
                "tierName": TIER_LABELS_FA.get(int(away["tier"]), f"سطح {away['tier']}"),
                "matchResult": r.get("away_goals", 0),
                "fantasyStats": away_stats,
                "totalMatchScore": away_total,
                "usersROI": await _team_roi_until(away["id"], settled_at, users_map),
            },
        ],
    }


@api.post("/admin/matches/settle")
async def settle_match(body: MatchSettleConfirmIn, admin: dict = Depends(require_admin)):
    m = await db.matches.find_one({"id": body.match_id})
    if not m:
        raise HTTPException(status_code=404, detail="بازی یافت نشد")
    if m["status"] == "settled":
        raise HTTPException(status_code=400, detail="این بازی قبلاً تسویه شده است")
    home = await db.teams.find_one({"id": m["home_team_id"]})
    away = await db.teams.find_one({"id": m["away_team_id"]})

    r = body.model_dump(exclude={"match_id"})
    sim = _compute_settlement(m, home, away, r)

    settlement_id = gen_id()
    ledger_ids: List[str] = []

    # Apply ledger entries to home & away owners
    for side, owner_id, breakdown in (
        ("home", sim["home_owner"], sim["breakdown"]["home"]),
        ("away", sim["away_owner"], sim["breakdown"]["away"]),
    ):
        if not owner_id:
            continue
        for item in breakdown:
            if item["amount"] == 0:
                continue
            team_id = m["home_team_id"] if side == "home" else m["away_team_id"]
            team = home if side == "home" else away
            session_id = team.get("ownership_session_id")
            entry = await credit_user(
                owner_id, item["amount"], f"{team['name_fa']} – {item['label']}",
                {
                    "team_id": team_id, "match_id": m["id"], "settlement_id": settlement_id,
                    "ownership_session": session_id,
                },
            )
            if entry:
                ledger_ids.append(entry["id"])

    # Update team stats and alive flag
    def update_team_stats(team, side, r, won_or_draw):
        side_goals = r["home_goals"] if side == "home" else r["away_goals"]
        other_goals = r["away_goals"] if side == "home" else r["home_goals"]
        upd = {
            "$inc": {
                "stats.played": 1,
                "stats.gf": side_goals,
                "stats.ga": other_goals,
                "stats.yc": r.get(f"{'home' if side == 'home' else 'away'}_yellow", 0),
                "stats.rc": r.get(f"{'home' if side == 'home' else 'away'}_red", 0),
            }
        }
        if side_goals > other_goals:
            upd["$inc"]["stats.wins"] = 1
        elif side_goals == other_goals:
            upd["$inc"]["stats.draws"] = 1
        else:
            upd["$inc"]["stats.losses"] = 1
        return upd

    await db.teams.update_one({"id": home["id"]}, update_team_stats(home, "home", r, None))
    await db.teams.update_one({"id": away["id"]}, update_team_stats(away, "away", r, None))

    # Knockout eliminations
    if m["stage"] != "group" and r["home_goals"] != r["away_goals"]:
        loser_id = home["id"] if r["home_goals"] < r["away_goals"] else away["id"]
        await db.teams.update_one({"id": loser_id}, {"$set": {"alive": False}})

    # Update match
    await db.matches.update_one({"id": m["id"]}, {"$set": {
        "status": "settled",
        "needs_settlement": False,
        "result": r,
        "settled_at": now_iso(),
        "settlement_id": settlement_id,
        "ledger_ids": ledger_ids,
    }})

    await log_event("match.settle", {"match_id": m["id"], "settlement_id": settlement_id}, admin["id"])

    return {"ok": True, "settlement_id": settlement_id, "simulation": sim}


@api.post("/admin/matches/{match_id}/rollback")
async def rollback_match(match_id: str, admin: dict = Depends(require_admin)):
    m = await db.matches.find_one({"id": match_id})
    if not m or m["status"] != "settled":
        raise HTTPException(status_code=400, detail="بازی تسویه‌شده‌ای یافت نشد")
    ledger_ids: List[str] = m.get("ledger_ids", [])
    # Reverse each ledger entry
    async for entry in db.ledger.find({"id": {"$in": ledger_ids}}):
        await credit_user(entry["user_id"], -entry["amount"], f"بازگردانی: {entry['reason_fa']}", {
            "rollback_of": entry["id"], "match_id": match_id,
        })
    # Reverse team stats
    r = m["result"]
    home = await db.teams.find_one({"id": m["home_team_id"]})
    away = await db.teams.find_one({"id": m["away_team_id"]})

    def reverse_stats(side, r):
        side_goals = r["home_goals"] if side == "home" else r["away_goals"]
        other_goals = r["away_goals"] if side == "home" else r["home_goals"]
        upd: Dict[str, Any] = {"$inc": {
            "stats.played": -1,
            "stats.gf": -side_goals,
            "stats.ga": -other_goals,
            "stats.yc": -r.get(f"{'home' if side == 'home' else 'away'}_yellow", 0),
            "stats.rc": -r.get(f"{'home' if side == 'home' else 'away'}_red", 0),
        }}
        if side_goals > other_goals:
            upd["$inc"]["stats.wins"] = -1
        elif side_goals == other_goals:
            upd["$inc"]["stats.draws"] = -1
        else:
            upd["$inc"]["stats.losses"] = -1
        return upd

    await db.teams.update_one({"id": home["id"]}, reverse_stats("home", r))
    await db.teams.update_one({"id": away["id"]}, reverse_stats("away", r))
    # Re-enable alive on both (since elimination was due to this match)
    if m["stage"] != "group" and r["home_goals"] != r["away_goals"]:
        await db.teams.update_many({"id": {"$in": [home["id"], away["id"]]}}, {"$set": {"alive": True}})

    await db.matches.update_one({"id": match_id}, {"$set": {
        "status": "scheduled", "result": None, "ledger_ids": [], "settlement_id": None,
        "needs_settlement": False,
    }})
    await log_event("match.rollback", {"match_id": match_id}, admin["id"])
    return {"ok": True}


# ---------------------------------------------------------------------------
# LEDGER  +  BALANCE HISTORY  +  PUBLIC FEED
# ---------------------------------------------------------------------------
@api.get("/ledger")
async def get_ledger(limit: int = 100, user_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {"user_id": user_id} if user_id else {}
    out = []
    async for e in db.ledger.find(q).sort("ts", -1).limit(limit):
        clean(e)
        out.append(e)
    return out


@api.get("/ledger/history")
async def balance_history(user: dict = Depends(get_current_user)):
    """Return time series of balances per user (cumulative)."""
    users = {}
    async for u in db.users.find({"role": "player"}):
        users[u["id"]] = {"username": u["username"], "name": u["name"], "events": []}
    # initial state
    async for e in db.ledger.find({}).sort("ts", 1):
        if e["user_id"] in users:
            users[e["user_id"]]["events"].append({"ts": e["ts"], "balance": e["balance_after"]})
    return list(users.values())


# ---------------------------------------------------------------------------
# TRADES (P2P)
# ---------------------------------------------------------------------------
@api.post("/trades/propose")
async def propose_trade(body: TradeProposeIn, user: dict = Depends(get_current_user)):
    team = await db.teams.find_one({"id": body.team_id})
    if not team:
        raise HTTPException(status_code=404, detail="تیم یافت نشد")
    if team.get("current_owner_id") != user["id"]:
        raise HTTPException(status_code=400, detail="شما مالک این تیم نیستید")
    to_user = await db.users.find_one({"id": body.to_user_id})
    if not to_user or to_user["id"] == user["id"]:
        raise HTTPException(status_code=400, detail="کاربر مقصد نامعتبر")
    if body.price <= 0:
        raise HTTPException(status_code=400, detail="قیمت باید مثبت باشد")
    doc = {
        "id": gen_id(),
        "team_id": body.team_id,
        "from_user_id": user["id"],
        "to_user_id": body.to_user_id,
        "price": body.price,
        "status": "pending",
        "created_at": now_iso(),
    }
    await db.trades.insert_one(doc)
    await log_event("trade.propose", doc, user["id"])
    clean(doc)
    return doc


@api.get("/trades/inbox")
async def trades_inbox(user: dict = Depends(get_current_user)):
    out = []
    async for t in db.trades.find({"to_user_id": user["id"], "status": "pending"}).sort("created_at", -1):
        clean(t)
        out.append(t)
    return out


@api.get("/trades/outbox")
async def trades_outbox(user: dict = Depends(get_current_user)):
    out = []
    async for t in db.trades.find({"from_user_id": user["id"]}).sort("created_at", -1):
        clean(t)
        out.append(t)
    return out


@api.post("/trades/{trade_id}/accept")
async def accept_trade(trade_id: str, user: dict = Depends(get_current_user)):
    trade = await db.trades.find_one({"id": trade_id})
    if not trade or trade["to_user_id"] != user["id"] or trade["status"] != "pending":
        raise HTTPException(status_code=400, detail="معامله نامعتبر")
    # Transfer windows must be open for P2P trades
    s = await db.settings.find_one({"id": "global"})
    if not (s.get("window_1_open") or s.get("window_2_open")):
        raise HTTPException(status_code=400, detail="معاملات فقط هنگام بازبودن پنجره نقل و انتقالات مجاز است")
    team = await db.teams.find_one({"id": trade["team_id"]})
    if not team or team["current_owner_id"] != trade["from_user_id"]:
        raise HTTPException(status_code=400, detail="تیم دیگر در دسترس نیست")
    buyer = await db.users.find_one({"id": user["id"]})
    seller = await db.users.find_one({"id": trade["from_user_id"]})
    price = float(trade["price"])
    if buyer["balance"] < price:
        raise HTTPException(status_code=400, detail="موجودی کافی نیست")
    limit = buyer["balance"] * TRANSFER_PERCENT_LIMIT
    if price > limit + 1e-9:
        raise HTTPException(status_code=400, detail=f"حداکثر مجاز خرید: {limit:.1f} سکه (۴۰٪ موجودی)")
    # Create new ownership session FIRST so the purchase debit is included in ROI
    new_session = gen_id()
    await db.teams.update_one({"id": team["id"]}, {"$set": {
        "current_owner_id": buyer["id"],
        "ownership_session_id": new_session,
        "owned_since": now_iso(),
    }})
    # Debit buyer (counted toward new ownership session ROI) / Credit seller
    await credit_user(buyer["id"], -price, f"خرید {team['name_fa']} از {seller['name']}",
                      {"team_id": team["id"], "trade_id": trade_id, "ownership_session": new_session, "purchase": True})
    await credit_user(seller["id"], price, f"فروش {team['name_fa']} به {buyer['name']}",
                      {"team_id": team["id"], "trade_id": trade_id})
    await db.trades.update_one({"id": trade_id}, {"$set": {"status": "accepted", "resolved_at": now_iso()}})
    await log_event("trade.accept", {"trade_id": trade_id, "team_id": team["id"]}, user["id"])
    return {"ok": True}


@api.post("/trades/{trade_id}/reject")
async def reject_trade(trade_id: str, user: dict = Depends(get_current_user)):
    trade = await db.trades.find_one({"id": trade_id})
    if not trade or trade["to_user_id"] != user["id"] or trade["status"] != "pending":
        raise HTTPException(status_code=400, detail="معامله نامعتبر")
    await db.trades.update_one({"id": trade_id}, {"$set": {"status": "rejected", "resolved_at": now_iso()}})
    return {"ok": True}


# ---------------------------------------------------------------------------
# BLIND BIDS  +  TRANSFER WINDOWS
# ---------------------------------------------------------------------------
@api.get("/settings")
async def get_settings(user: dict = Depends(get_current_user)):
    s = await db.settings.find_one({"id": "global"})
    clean(s)
    return s


@api.post("/admin/transfer-window")
async def admin_toggle_window(body: TransferWindowIn, admin: dict = Depends(require_admin)):
    if body.window not in ("window_1", "window_2"):
        raise HTTPException(status_code=400, detail="پنجره نامعتبر")
    field = f"{body.window}_open"
    await db.settings.update_one({"id": "global"}, {"$set": {field: body.open}})
    await log_event("window.toggle", {"window": body.window, "open": body.open}, admin["id"])
    return {"ok": True}


@api.post("/bids")
async def submit_bid(body: BlindBidIn, user: dict = Depends(get_current_user)):
    s = await db.settings.find_one({"id": "global"})
    if not (s["window_1_open"] or s["window_2_open"] or s["auction_open"]):
        raise HTTPException(status_code=400, detail="پنجره مزایده باز نیست")
    team = await db.teams.find_one({"id": body.team_id})
    if not team or team["current_owner_id"]:
        raise HTTPException(status_code=400, detail="این تیم آزاد نیست")
    buyer = await db.users.find_one({"id": user["id"]})
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="مبلغ نامعتبر")
    if body.amount > buyer["balance"] * TRANSFER_PERCENT_LIMIT + 1e-9:
        raise HTTPException(status_code=400, detail=f"حداکثر مجاز: ۴۰٪ موجودی = {buyer['balance']*TRANSFER_PERCENT_LIMIT:.1f}")
    # Replace existing bid by this user for this team
    await db.bids.delete_many({"team_id": body.team_id, "user_id": user["id"], "resolved": False})
    doc = {
        "id": gen_id(),
        "team_id": body.team_id,
        "user_id": user["id"],
        "amount": body.amount,
        "created_at": now_iso(),
        "resolved": False,
    }
    await db.bids.insert_one(doc)
    clean(doc)
    return doc


@api.get("/bids/mine")
async def my_bids(user: dict = Depends(get_current_user)):
    out = []
    async for b in db.bids.find({"user_id": user["id"], "resolved": False}):
        clean(b)
        out.append(b)
    return out


@api.get("/admin/bids")
async def admin_list_bids(admin: dict = Depends(require_admin)):
    out = []
    async for b in db.bids.find({"resolved": False}).sort("amount", -1):
        clean(b)
        out.append(b)
    return out


@api.post("/admin/bids/resolve")
async def admin_resolve_bids(admin: dict = Depends(require_admin)):
    """Assign each free-agent team to its highest bidder, deduct funds."""
    transferred = 0
    # Group bids by team, pick highest
    teams = {}
    async for b in db.bids.find({"resolved": False}).sort("amount", -1):
        teams.setdefault(b["team_id"], []).append(b)
    for team_id, bids in teams.items():
        team = await db.teams.find_one({"id": team_id})
        if not team or team["current_owner_id"]:
            # mark all resolved (lost)
            await db.bids.update_many({"team_id": team_id, "resolved": False}, {"$set": {"resolved": True, "won": False}})
            continue
        # Sort by amount desc
        bids.sort(key=lambda x: -x["amount"])
        winner_bid = bids[0]
        buyer = await db.users.find_one({"id": winner_bid["user_id"]})
        if buyer["balance"] < winner_bid["amount"]:
            # skip if insufficient
            await db.bids.update_one({"id": winner_bid["id"]}, {"$set": {"resolved": True, "won": False}})
            continue
        # Create new ownership session first so the bid debit is part of ROI
        new_session = gen_id()
        await db.teams.update_one({"id": team_id}, {"$set": {
            "current_owner_id": buyer["id"],
            "ownership_session_id": new_session,
            "owned_since": now_iso(),
        }})
        await credit_user(buyer["id"], -winner_bid["amount"], f"برنده مزایده کور: {team['name_fa']}",
                          {"team_id": team_id, "bid_id": winner_bid["id"], "ownership_session": new_session, "purchase": True})
        await db.bids.update_one({"id": winner_bid["id"]}, {"$set": {"resolved": True, "won": True}})
        # mark losers
        await db.bids.update_many({"team_id": team_id, "resolved": False}, {"$set": {"resolved": True, "won": False}})
        transferred += 1
    # Close windows
    await db.settings.update_one({"id": "global"}, {"$set": {"window_1_open": False, "window_2_open": False}})
    await log_event("bids.resolve", {"teams_transferred": transferred}, admin["id"])
    return {"ok": True, "transferred": transferred}


# ---------------------------------------------------------------------------
# AUCTION  (initial team draft)
# ---------------------------------------------------------------------------
@api.post("/admin/auction/open")
async def auction_open(admin: dict = Depends(require_admin)):
    await db.settings.update_one({"id": "global"}, {"$set": {"auction_open": True}})
    return {"ok": True}


@api.post("/admin/auction/close")
async def auction_close(admin: dict = Depends(require_admin)):
    await db.settings.update_one({"id": "global"}, {"$set": {"auction_open": False, "tournament_locked": True}})
    return {"ok": True}


@api.post("/admin/auction/assign")
async def auction_assign(body: AuctionAssignIn, admin: dict = Depends(require_admin)):
    team = await db.teams.find_one({"id": body.team_id})
    user = await db.users.find_one({"id": body.user_id})
    if not team or not user:
        raise HTTPException(status_code=404, detail="کاربر یا تیم یافت نشد")
    if team.get("current_owner_id"):
        raise HTTPException(status_code=400, detail="این تیم قبلاً به کسی واگذار شده است")
    if body.price < 0 or body.price > AUCTION_MAX_BID:
        raise HTTPException(status_code=400, detail=f"قیمت مزایده باید بین ۰ تا {AUCTION_MAX_BID} باشد")
    if user["balance"] < body.price:
        raise HTTPException(status_code=400, detail="موجودی کافی نیست")
    # Create new ownership session FIRST so the auction debit counts toward ROI
    new_session = gen_id()
    await db.teams.update_one({"id": team["id"]}, {"$set": {
        "current_owner_id": user["id"],
        "ownership_session_id": new_session,
        "owned_since": now_iso(),
    }})
    await credit_user(user["id"], -body.price, f"خرید {team['name_fa']} از مزایده اولیه",
                      {"team_id": team["id"], "auction": True, "ownership_session": new_session, "purchase": True})
    await log_event("auction.assign", {"team_id": team["id"], "user_id": user["id"], "price": body.price}, admin["id"])
    return {"ok": True}


# ---------------------------------------------------------------------------
# APIFOOTBALL.COM INTEGRATION (admin only)
# ---------------------------------------------------------------------------
# We map remote team names to our internal teams via name_en + aliases.
APIFOOTBALL_ALIASES = {
    "south korea": ["korea republic", "south korea", "korea south", "republic of korea"],
    "united states": ["usa", "united states", "united states of america"],
    "czech republic": ["czech republic", "czechia"],
    "ivory coast": ["ivory coast", "cote d'ivoire", "côte d'ivoire"],
    "dr congo": ["dr congo", "d.r. congo", "d r congo", "congo dr", "democratic republic of congo", "congo democratic republic"],
    "bosnia and herzegovina": ["bosnia and herzegovina", "bosnia & herzegovina", "bosnia"],
    "cape verde": ["cape verde", "cabo verde"],
    "curaçao": ["curaçao", "curacao"],
}


def _norm(s: Optional[str]) -> str:
    return (s or "").strip().lower().replace("-", " ").replace("  ", " ")


async def _resolve_team(name: str, teams_cache: List[dict]) -> Optional[dict]:
    n = _norm(name)
    if not n:
        return None
    for t in teams_cache:
        en = _norm(t["name_en"])
        if en == n:
            return t
        aliases = APIFOOTBALL_ALIASES.get(en, [])
        if n in [_norm(a) for a in aliases]:
            return t
    # Loose contains pass
    for t in teams_cache:
        en = _norm(t["name_en"])
        if en in n or n in en:
            return t
    return None


def _stage_from(league_name: str, stage_name: str, match_round: str) -> str:
    s = " ".join(filter(None, [_norm(league_name), _norm(stage_name), _norm(match_round)]))
    if "quarter" in s:
        return "qf"
    if "semi" in s:
        return "sf"
    if "third" in s or "3rd place" in s or "playoff" in s:
        return "third"
    if "round of 32" in s or "1/16" in s:
        return "r32"
    if "round of 16" in s or "1/8" in s:
        return "r16"
    if "group" in s:
        return "group"
    if "final" in s:
        return "final"
    return "group"


def _is_knockout_hint(*parts: Optional[str]) -> bool:
    text = " ".join(_norm(p) for p in parts if p)
    return bool(re.search(r"(round of|1/|quarter|semi|final|playoff|knockout|elimination)", text))


def _extract_round_slot(*parts: Optional[str]) -> Optional[int]:
    text = " ".join(_norm(p) for p in parts if p)
    if not text:
        return None
    patterns = [
        r"match\s*#?\s*(\d+)",
        r"game\s*#?\s*(\d+)",
        r"(\d+)\s*(?:st|nd|rd|th)\s*match",
        r"round\s*(\d+)",
        r"-\s*(\d+)$",
    ]
    for p in patterns:
        m = re.search(p, text)
        if m:
            try:
                return int(m.group(1))
            except (TypeError, ValueError):
                return None
    return None


def _is_knockout_stage(stage: str) -> bool:
    return stage in KNOCKOUT_STAGE_LIMITS


def _normalized_slot(slot: Any) -> int:
    return slot if isinstance(slot, int) and slot > 0 else UNASSIGNED_BRACKET_SLOT_SORT_KEY


async def _sync_knockout_bracket_slots() -> Dict[str, int]:
    """Validate and auto-assign bracket slots for all knockout stages."""
    out: Dict[str, int] = {}
    for stage, max_count in KNOCKOUT_STAGE_LIMITS.items():
        matches = [m async for m in db.matches.find({"stage": stage})]
        if len(matches) > max_count:
            raise HTTPException(
                status_code=422,
                detail=f"تعداد مسابقات مرحله {STAGE_LABELS_FA[stage]} ({len(matches)}) بیش از حد مجاز ({max_count}) است",
            )

        seen_team_ids = set()
        for m in matches:
            home_id = m.get("home_team_id")
            away_id = m.get("away_team_id")
            if not home_id or not away_id or home_id == away_id:
                raise HTTPException(
                    status_code=422,
                    detail=f"چیدمان براکت نامعتبر در مرحله {STAGE_LABELS_FA[stage]} برای بازی {m.get('id')} (home={home_id}, away={away_id})",
                )
            for tid in (home_id, away_id):
                if tid in seen_team_ids:
                    raise HTTPException(
                        status_code=422,
                        detail=f"تیم تکراری ({tid}) در مرحله {STAGE_LABELS_FA[stage]} شناسایی شد",
                    )
                seen_team_ids.add(tid)

        ordered = sorted(
            matches,
            key=lambda m: (
                _normalized_slot(m.get("bracket_slot")),
                m.get("kickoff") or "",
                m.get("external_id") or "",
                m.get("id") or "",
            ),
        )
        for idx, m in enumerate(ordered, start=1):
            if m.get("bracket_slot") != idx:
                await db.matches.update_one({"id": m["id"]}, {"$set": {"bracket_slot": idx}})
        out[stage] = len(matches)
    return out


def _cards_from_api(api_match: dict, side: str) -> dict:
    """Extract yellow/red card counts for `side` ∈ {'home','away'} from the stats array,
    falling back to scanning the `cards` array."""
    yellow = 0
    red = 0
    for st in api_match.get("statistics") or []:
        t = (st.get("type") or "").lower()
        try:
            v = int(st.get(side, "0") or 0)
        except (TypeError, ValueError):
            v = 0
        if t == "yellow cards":
            yellow = max(yellow, v)
        elif t == "red cards":
            red = max(red, v)
    if yellow == 0 and red == 0:
        # Fallback to event list
        for card in api_match.get("cards") or []:
            faulter = card.get(f"{'home' if side == 'home' else 'away'}_fault") or ""
            card_kind = (card.get("card") or "").lower()
            if not faulter:
                continue
            if "red" in card_kind:
                red += 1
            elif "yellow" in card_kind:
                yellow += 1
    return {"yellow": yellow, "red": red}


def _goals_from_api(api_match: dict):
    def _to_int(v):
        try: return int(v) if v not in (None, "") else 0
        except (TypeError, ValueError): return 0
    return _to_int(api_match.get("match_hometeam_score")), _to_int(api_match.get("match_awayteam_score"))


async def _apifootball_get_events() -> List[dict]:
    """Call the single endpoint we use, with hardcoded league + date window from env."""
    key = os.environ["APIFOOTBALL_KEY"]
    league_id = os.environ.get("APIFOOTBALL_LEAGUE_ID", "28")
    date_from = os.environ.get("APIFOOTBALL_FROM", "2026-06-10")
    date_to = os.environ.get("APIFOOTBALL_TO", "2026-07-20")
    url = "https://apiv3.apifootball.com/"
    params = {
        "action": "get_events", "from": date_from, "to": date_to,
        "league_id": league_id, "APIkey": key,
    }
    async with httpx.AsyncClient(timeout=20.0) as c:
        resp = await c.get(url, params=params)
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"apifootball خطا: {resp.status_code}")
        data = resp.json()
        # The API returns a JSON array on success, or an object with `error` on failure
        if isinstance(data, dict) and data.get("error"):
            raise HTTPException(status_code=502, detail=f"apifootball: {data.get('message', 'error')}")
        if not isinstance(data, list):
            raise HTTPException(status_code=502, detail="پاسخ apifootball در قالب آرایه نیست")
        return data


@api.post("/admin/fetch")
async def admin_fetch_matches(admin: dict = Depends(require_admin)):
    """Pull all matches from apifootball.com for the WC league + date window.

    - Creates matches that don't exist locally (by external match_id).
    - Updates kickoff, stage and api_data on existing scheduled matches.
    - Marks Finished-but-not-settled matches with `needs_settlement=True`.
    - Skips matches that are already settled (status='settled') — they are immutable.
    """
    events = await _apifootball_get_events()
    teams_cache = [t async for t in db.teams.find({})]
    created = updated = finished_pending = unresolved = 0
    unresolved_names: List[str] = []

    for ev in events:
        ext_id = str(ev.get("match_id") or "").strip()
        if not ext_id:
            continue
        h_name = ev.get("match_hometeam_name") or ""
        a_name = ev.get("match_awayteam_name") or ""
        ht = await _resolve_team(h_name, teams_cache)
        at = await _resolve_team(a_name, teams_cache)
        if not ht or not at:
            unresolved += 1
            unresolved_names.append(f"{h_name} vs {a_name}")
            continue
        stage = _stage_from(ev.get("league_name", ""), ev.get("stage_name", ""), ev.get("match_round", ""))
        if stage == "group" and _is_knockout_hint(ev.get("league_name", ""), ev.get("stage_name", ""), ev.get("match_round", "")):
            match_identity = f"id={ev.get('match_id')}, {ev.get('match_hometeam_name')} vs {ev.get('match_awayteam_name')}"
            raise HTTPException(
                status_code=422,
                detail=f"مرحله حذفی ناشناخته از API دریافت شد ({match_identity}): {ev.get('stage_name') or ev.get('match_round') or 'unknown'}؛ نگاشت مرحله را بررسی کنید یا نام مرحله API را اصلاح کنید",
            )
        round_slot = _extract_round_slot(ev.get("stage_name", ""), ev.get("match_round", ""))
        kickoff_str = f"{ev.get('match_date', '')}T{ev.get('match_time') or '00:00'}:00+00:00"
        api_status = (ev.get("match_status") or "").strip()
        is_finished = api_status.lower() == "finished"

        existing = await db.matches.find_one({"external_id": ext_id})
        if existing:
            if existing.get("status") == "settled":
                continue
            new_status = "finished_pending" if is_finished else "scheduled"
            update_fields = {
                "kickoff": kickoff_str,
                "stage": stage,
                "api_data": ev,
                "api_status": api_status,
                "status": new_status,
                "needs_settlement": is_finished,
                "match_round": ev.get("match_round"),
                "match_stadium": ev.get("match_stadium"),
                "match_referee": ev.get("match_referee"),
            }
            if _is_knockout_stage(stage):
                update_fields["bracket_slot"] = round_slot
            else:
                update_fields["bracket_slot"] = None
            await db.matches.update_one({"id": existing["id"]}, {"$set": update_fields})
            updated += 1
            if is_finished:
                finished_pending += 1
        else:
            doc = {
                "id": gen_id(),
                "external_id": ext_id,
                "stage": stage,
                "group": ht["group"] if stage == "group" and ht["group"] == at["group"] else None,
                "home_team_id": ht["id"],
                "away_team_id": at["id"],
                "kickoff": kickoff_str,
                "status": "finished_pending" if is_finished else "scheduled",
                "needs_settlement": is_finished,
                "result": None,
                "api_data": ev,
                "api_status": api_status,
                "match_round": ev.get("match_round"),
                "match_stadium": ev.get("match_stadium"),
                "match_referee": ev.get("match_referee"),
                "bracket_slot": round_slot if _is_knockout_stage(stage) else None,
            }
            await db.matches.insert_one(doc)
            created += 1
            if is_finished:
                finished_pending += 1

    bracket = await _sync_knockout_bracket_slots()
    await log_event("fetch.api",
                    {"created": created, "updated": updated,
                     "finished_pending": finished_pending, "unresolved": unresolved, "bracket": bracket},
                    admin["id"])
    return {
        "ok": True,
        "events_count": len(events),
        "created": created,
        "updated": updated,
        "finished_pending": finished_pending,
        "unresolved": unresolved,
        "unresolved_names": unresolved_names[:20],
        "bracket": bracket,
    }





# ---------------------------------------------------------------------------
# BONUSES
# ---------------------------------------------------------------------------
@api.post("/admin/bonus/award")
async def admin_award_bonus(body: BonusAwardIn, admin: dict = Depends(require_admin)):
    if body.bonus_type not in BONUSES:
        raise HTTPException(status_code=400, detail="نوع بونوس نامعتبر")
    team = await db.teams.find_one({"id": body.team_id})
    if not team:
        raise HTTPException(status_code=404, detail="تیم یافت نشد")
    owner_id = team.get("current_owner_id")
    if not owner_id:
        raise HTTPException(status_code=400, detail="این تیم صاحب ندارد")
    amount = BONUSES[body.bonus_type]
    labels = {
        "golden_team": "تیم طلایی",
        "giant_killer": "غول‌کش",
        "clean_sheet": "بدون گل خورده",
        "punching_bag": "کیسه بوکس",
        "scapegoat": "سپر بلا",
    }
    label = labels[body.bonus_type]
    await credit_user(owner_id, amount, f"بونوس {label}: {team['name_fa']}", {"team_id": team["id"], "bonus": body.bonus_type})
    # Scapegoat also forgives card penalties
    if body.bonus_type == "scapegoat":
        agg = await db.ledger.aggregate([
            {"$match": {"user_id": owner_id, "meta.team_id": team["id"], "amount": {"$lt": 0}}},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
        ]).to_list(1)
        forgive = -float(agg[0]["total"]) if agg else 0
        if forgive > 0:
            await credit_user(owner_id, forgive, f"بخشش جرائم کارت سپر بلا: {team['name_fa']}", {"team_id": team["id"], "bonus": "scapegoat_forgive"})
    await log_event("bonus.award", {"team_id": team["id"], "type": body.bonus_type}, admin["id"])
    return {"ok": True}


# ---------------------------------------------------------------------------
# SYSTEM LOGS  +  DANGER  +  GROUP STANDINGS  +  BRACKET
# ---------------------------------------------------------------------------
@api.get("/admin/logs")
async def admin_logs(limit: int = 200, admin: dict = Depends(require_admin)):
    from bson import ObjectId
    def _scrub(v):
        if isinstance(v, ObjectId):
            return str(v)
        if isinstance(v, dict):
            return {k: _scrub(x) for k, x in v.items() if k != "_id"}
        if isinstance(v, list):
            return [_scrub(x) for x in v]
        return v
    out = []
    async for e in db.system_logs.find({}).sort("ts", -1).limit(limit):
        out.append(_scrub(e))
    return out


@api.post("/admin/reset")
async def admin_reset(confirm: str = "", admin: dict = Depends(require_admin)):
    if confirm != "RESET-ALL":
        raise HTTPException(status_code=400, detail="برای تأیید مقدار `RESET-ALL` ارسال شود")
    await db.matches.delete_many({})
    await db.teams.delete_many({})
    await db.ledger.delete_many({})
    await db.trades.delete_many({})
    await db.bids.delete_many({})
    await db.system_logs.delete_many({})
    # Reset balances
    await db.users.update_many({"role": "player"}, {"$set": {"balance": DEFAULT_START_BALANCE}})
    # Reseed
    await seed_teams()
    await seed_fixtures()
    await db.settings.update_one({"id": "global"}, {"$set": {
        "auction_open": False, "window_1_open": False, "window_2_open": False, "tournament_locked": False,
    }})
    return {"ok": True}


@api.get("/standings")
async def standings(user: dict = Depends(get_current_user)):
    """Return group standings with owner info."""
    users = {u["id"]: {"name": u["name"], "username": u["username"]} async for u in db.users.find({})}
    groups: Dict[str, List[dict]] = {}
    async for t in db.teams.find({}):
        clean(t)
        s = t["stats"]
        pts = s["wins"] * 3 + s["draws"]
        gd = s["gf"] - s["ga"]
        row = {
            **t,
            "points": pts,
            "gd": gd,
            "owner": users.get(t.get("current_owner_id")) if t.get("current_owner_id") else None,
        }
        groups.setdefault(t["group"], []).append(row)
    for g in groups.values():
        g.sort(key=lambda x: (-x["points"], -x["gd"], -x["stats"]["gf"]))
    return groups


@api.get("/bracket")
async def bracket(user: dict = Depends(get_current_user)):
    """Return knockout matches in deterministic, validated bracket slot order."""
    await _sync_knockout_bracket_slots()
    out = {}
    for stage in ["r32", "r16", "qf", "sf", "third", "final"]:
        out[stage] = []
        async for m in db.matches.find({"stage": stage}).sort([("bracket_slot", 1), ("kickoff", 1), ("external_id", 1)]):
            clean(m)
            out[stage].append(m)
    return out


# ---------------------------------------------------------------------------
# MISC
# ---------------------------------------------------------------------------
@api.get("/")
async def root():
    return {"ok": True, "service": "wc26-fantasy"}


# ---------------------------------------------------------------------------
# Wire up
# ---------------------------------------------------------------------------
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
