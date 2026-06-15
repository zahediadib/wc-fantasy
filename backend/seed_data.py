"""
World Cup 2026 - Team, Group, and Tier seed data.
Persian names + country codes (ISO 3166-1) used for flagcdn lookups.
"""

TEAMS = [
    # name_en, name_fa, code (for flagcdn), group, tier
    ("Mexico", "مکزیک", "mx", "A", 3),
    ("South Korea", "کره جنوبی", "kr", "A", 4),
    ("South Africa", "آفریقای جنوبی", "za", "A", 6),
    ("Czech Republic", "جمهوری چک", "cz", "A", 5),

    ("Canada", "کانادا", "ca", "B", 4),
    ("Switzerland", "سوئیس", "ch", "B", 3),
    ("Qatar", "قطر", "qa", "B", 5),
    ("Bosnia and Herzegovina", "بوسنی و هرزگوین", "ba", "B", 6),

    ("Brazil", "برزیل", "br", "C", 1),
    ("Morocco", "مراکش", "ma", "C", 2),
    ("Scotland", "اسکاتلند", "gb-sct", "C", 5),
    ("Haiti", "هائیتی", "ht", "C", 6),

    ("United States", "ایالات متحده", "us", "D", 3),
    ("Australia", "استرالیا", "au", "D", 4),
    ("Paraguay", "پاراگوئه", "py", "D", 5),
    ("Turkey", "ترکیه", "tr", "D", 4),

    ("Germany", "آلمان", "de", "E", 2),
    ("Ecuador", "اکوادور", "ec", "E", 4),
    ("Ivory Coast", "ساحل عاج", "ci", "E", 5),
    ("Curaçao", "کوراسائو", "cw", "E", 6),

    ("Netherlands", "هلند", "nl", "F", 2),
    ("Japan", "ژاپن", "jp", "F", 3),
    ("Tunisia", "تونس", "tn", "F", 5),
    ("Sweden", "سوئد", "se", "F", 4),

    ("Belgium", "بلژیک", "be", "G", 2),
    ("Iran", "ایران", "ir", "G", 4),
    ("Egypt", "مصر", "eg", "G", 4),
    ("New Zealand", "نیوزیلند", "nz", "G", 6),

    ("Spain", "اسپانیا", "es", "H", 1),
    ("Uruguay", "اروگوئه", "uy", "H", 3),
    ("Saudi Arabia", "عربستان سعودی", "sa", "H", 6),
    ("Cape Verde", "کیپ ورد", "cv", "H", 6),

    ("France", "فرانسه", "fr", "I", 1),
    ("Senegal", "سنگال", "sn", "I", 3),
    ("Norway", "نروژ", "no", "I", 4),
    ("Iraq", "عراق", "iq", "I", 6),

    ("Argentina", "آرژانتین", "ar", "J", 1),
    ("Austria", "اتریش", "at", "J", 4),
    ("Algeria", "الجزایر", "dz", "J", 4),
    ("Jordan", "اردن", "jo", "J", 6),

    ("Portugal", "پرتغال", "pt", "K", 1),
    ("Colombia", "کلمبیا", "co", "K", 3),
    ("Uzbekistan", "ازبکستان", "uz", "K", 5),
    ("DR Congo", "جمهوری دموکراتیک کنگو", "cd", "K", 5),

    ("England", "انگلیس", "gb-eng", "L", 1),
    ("Croatia", "کرواسی", "hr", "L", 2),
    ("Panama", "پاناما", "pa", "L", 5),
    ("Ghana", "غنا", "gh", "L", 6),
]


def tier_multiplier(tier: int) -> float:
    if tier in (1, 2):
        return 1.0
    if tier in (3, 4):
        return 1.5
    return 2.0


# Match outcome base coins (subject to tier multiplier)
MATCH_BASE_COINS = {
    "group_win": 5,
    "group_draw": 2,
    "r32_win": 6,
    "r16_win": 7,
    "qf_win": 8,
    "sf_win": 9,
    "final_win": 10,
    "third_win": 5,
}

# Performance metrics (no multiplier) — simplified card rule
PERFORMANCE = {
    "goal_scored": 1,
    "goal_conceded": -1,
    "yellow_card": -0.5,
    "red_card": -1,
}

# Special bonuses (no multiplier)
BONUSES = {
    "golden_team": 10,        # win all 3 group matches
    "giant_killer": 15,       # T4/5/6 eliminates T1/2 in knockouts
    "clean_sheet": 10,        # zero conceded in group stage
    "punching_bag": 15,       # most conceded at group stage end
    "scapegoat": 10,          # most cards at tournament end
}

STAGES = ["group", "r32", "r16", "qf", "sf", "third", "final"]


def generate_group_fixtures():
    """Generate round-robin fixtures for all 12 groups (6 matches per group)."""
    from itertools import combinations
    fixtures = []
    groups = {}
    for t in TEAMS:
        groups.setdefault(t[3], []).append(t[0])
    base_day = 1
    for g_letter, team_names in groups.items():
        for i, (a, b) in enumerate(combinations(team_names, 2)):
            fixtures.append({
                "stage": "group",
                "group": g_letter,
                "home": a,
                "away": b,
                "matchday": base_day + i // 2,
            })
    return fixtures
