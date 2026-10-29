"""Small weekly/date-specific event schedule; local civil time is fixed UTC+7."""
from datetime import date, datetime, timedelta, timezone
import re

VN_TZ = timezone(timedelta(hours=7))
OUTSIDE_KEY = "__outside__"
DEFAULT_EVENTS = [
    dict(schedule_id="default-morning", name="Buổi sáng", start_time="07:00", end_time="12:00",
         weekdays=[1, 2, 3, 4, 5, 6], date=None, active=True),
    dict(schedule_id="default-afternoon", name="Buổi chiều", start_time="13:00", end_time="18:00",
         weekdays=[1, 2, 3, 4, 5, 6], date=None, active=True),
]


def local_time(timestamp):
    stamp = datetime.fromisoformat(timestamp) if isinstance(timestamp, str) else timestamp
    if not isinstance(stamp, datetime) or stamp.utcoffset() is None:
        raise ValueError("Attendance timestamp requires timezone")
    return stamp.astimezone(VN_TZ)


def validate_events(events):
    if not isinstance(events, list):
        raise ValueError("Schedules must be a list")
    ids = set()
    result = []
    for event in events:
        if not isinstance(event, dict):
            raise ValueError("Invalid schedule")
        item = {k: event.get(k) for k in ("schedule_id", "name", "start_time", "end_time", "weekdays", "date", "active")}
        if (not isinstance(item["schedule_id"], str) or not item["schedule_id"] or ":" in item["schedule_id"] or
                item["schedule_id"] == OUTSIDE_KEY or item["schedule_id"] in ids or
                not isinstance(item["name"], str) or not item["name"].strip() or not isinstance(item["active"], bool)):
            raise ValueError("Invalid schedule identity")
        for field in ("start_time", "end_time"):
            if not isinstance(item[field], str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", item[field]):
                raise ValueError("Invalid schedule time")
        if item["start_time"] >= item["end_time"]:
            raise ValueError("Overnight/empty schedules are not supported")
        if item["date"] is not None:
            if not isinstance(item["date"], str) or date.fromisoformat(item["date"]).isoformat() != item["date"]:
                raise ValueError("Invalid schedule date")
        days = item["weekdays"]
        if not isinstance(days, list) or any(type(day) is not int or not 1 <= day <= 7 for day in days):
            raise ValueError("Invalid weekdays")
        if item["date"] is None and not days:
            raise ValueError("Weekly schedule needs weekdays")
        item["weekdays"] = sorted(set(days))
        ids.add(item["schedule_id"])
        result.append(item)
    for i, left in enumerate(result):
        for right in result[i + 1:]:
            if schedules_overlap(left, right):
                raise ValueError("Active schedules overlap")
    return result


def schedules_overlap(left, right):
    if not left["active"] or not right["active"] or left["start_time"] >= right["end_time"] or right["start_time"] >= left["end_time"]:
        return False
    if left["date"] and right["date"]:
        return left["date"] == right["date"]
    if left["date"] or right["date"]:
        specific, weekly = (left, right) if left["date"] else (right, left)
        return date.fromisoformat(specific["date"]).isoweekday() in weekly["weekdays"]
    return bool(set(left["weekdays"]) & set(right["weekdays"]))


def resolve_context(timestamp, events):
    stamp = local_time(timestamp)
    day = stamp.date().isoformat()
    minute = stamp.strftime("%H:%M")
    matches = [event for event in events if event["active"] and
               (event["date"] == day if event["date"] else stamp.isoweekday() in event["weekdays"]) and
               event["start_time"] <= minute < event["end_time"]]
    if len(matches) > 1:
        raise ValueError("Ambiguous schedule")
    if not matches:
        return dict(scheduled_event_id=None, occurrence_key=None, event_name=None)
    event = matches[0]
    return dict(scheduled_event_id=event["schedule_id"], occurrence_key=f"{event['schedule_id']}:{day}", event_name=event["name"])
