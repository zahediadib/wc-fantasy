# WC 2026 Fantasy Trading – PRD

## Original problem statement
Build a Strategic FIFA World Cup 2026 Fantasy Trading Game. Private, invite-only
league for ~10 players. Acts as a live stock market where national teams are
assets, and Coins act as both purchasing currency and Victory Points.

Full original spec lives in the user's request: tier multipliers, scoring
matrix, special bonuses, historical-retention ownership, 40% transfer-limit,
auction (cap 65), blind bidding, admin God-Mode (settle, rollback, manual
override, transfer windows, bonus awarder, danger-zone reset, logs), Persian
RTL UI, no-emoji flags, 48 teams in 12 groups.

## Architecture
- FastAPI backend (single file `server.py`, helpers in `seed_data.py` & `auth.py`)
- MongoDB (motor async) – atomic `$inc` on balance + immutable ledger collection
- React 19 + craco + Tailwind + shadcn/ui frontend
- JWT auth via `Authorization: Bearer` header, token kept in `localStorage`
- football-data.org API key configured for real fetch (manual override always available)

## User personas
- **Admin** (`admin / admin1234`): runs the league, settles matches, awards bonuses, manages users
- **Players** (10 pre-seeded: ali, reza, hossein, amir, sara, neda, mohsen, kian, sina, arman, all password `player1234`): bid, trade, watch the ledger

## Core requirements (static)
1. 48 teams seeded into 12 groups with tier multipliers (T1-2 ×1, T3-4 ×1.5, T5-6 ×2)
2. Coin economy: start 100 coins, win/draw/goal/card matrix applied by stage
3. Special bonuses (Golden Team, Giant Killer, Clean Sheet, Punching Bag, Scapegoat)
4. P2P trade with 40 % balance limit; ownership session id so historical Coins stay with seller
5. Blind bidding during open windows + admin resolver
6. Persian RTL UI, no emoji flags (uses flagcdn)
7. Public ledger – every change visible to every player
8. Admin God-Mode panel with settle + rollback + manual override

## What's been implemented (2026-02-XX initial build)
- Login / JWT / role-gated routes (admin vs player)
- 48 teams + 72 group fixtures auto-seeded on startup
- Wallet, public ledger, balance-history chart, leaderboard
- Portfolio grid, group standings (12 tables), fixtures (today/upcoming/done)
- Knockout bracket page (reads admin-built bracket matches)
- Market: P2P trade with inbox/outbox + blind-bidding free-agent UI
- Admin: matches/auction/window/bonus/users/bracket builder/logs/danger-zone
- Match settlement engine with tier multipliers + auto-eliminate on knockout loss
- Rollback that reverses ledger entries & team stats cleanly
- Backend pytest suite at `/app/backend/tests/test_wc26_backend.py` – 20/20 pass

## Known limitations / Backlog
- P0 – none (MVP fully functional)
- P1 –
  - Notification badges on sidebar for new trade offers (poll-based today)
  - WebSocket for true real-time ledger pushes (today: client refresh on action)
  - Knockout bracket auto-population from group winners (today: admin builds it)
  - football-data.org real-fixture pull (today: scheduled placeholder fixtures)
- P2 –
  - Persian-number formatting in form inputs
  - Dark-mode print stylesheet for admin logs export
  - Per-team detail page with full transaction history

## Next tasks (highest impact first)
1. Add a small chart-empty-state min-height fix to silence Recharts warnings.
2. Implement WebSocket / SSE for live ledger feed (replaces polling).
3. Auto-populate knockout from final group standings after admin closes group stage.
4. Email/SMS-free in-app notifications for trade offers (toast on poll).
5. Persian-aware number input that accepts Persian digits.
