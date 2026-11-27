"""What lifetime access means in THIS app (Lifetime.py is the same in every app; this file is the app's own).

    APP_NAME   shown on the offer and on the Stripe receipt
    FREE       what everyone gets (shown on the offer, so people see what they keep)
    PAID       what $34 unlocks (shown on the offer); keep each line short
    CAPS       fair-use limits for lifetime buyers per month, e.g. {"scans": 20} (check with Lifetime.within_cap)
    FREE_CAPS  the same limits for free users, e.g. {"scans": 3}
Written by tools/lifetime_rollout.py from APP_MAKER/money/lifetime/plan.json; edit freely afterwards.
"""
APP_NAME = "Add a Robot"
FREE = [
    "The whole app: garage, builder, installer, simulator, guest passes",
    "Live drives of up to 15 minutes each",
]
PAID = [
    "Live drives of any length (fair use: 50 hours a month)",
]
# drive_hours = hours of live drives on the robots you own this calendar month (sessions.stats duration_s, guests
# included), checked in Drive.drive_offer. Free owners have no monthly cap, only FREE_SESSION_MINUTES per drive
# (BotApi.bot_poll ends longer drives through the robot's `ended` list).
CAPS = {"drive_hours": 50}
FREE_CAPS = {}
FREE_SESSION_MINUTES = 15
