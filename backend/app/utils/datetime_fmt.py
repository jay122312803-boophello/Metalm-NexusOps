from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

try:
    _TZ = ZoneInfo("Asia/Shanghai")
except Exception:
    _TZ = timezone(timedelta(hours=8))


def to_app_tz(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(_TZ)


def iso_app(dt: datetime | None) -> str | None:
    x = to_app_tz(dt)
    if x is None:
        return None
    return x.isoformat(timespec="seconds")


def iso_now_app() -> str:
    return datetime.now(tz=_TZ).isoformat(timespec="seconds")
