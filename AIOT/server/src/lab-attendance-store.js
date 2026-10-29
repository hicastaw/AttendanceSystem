// Daily lab attendance is an isolated R50 laptop-demo policy. Production keeps
// the existing event/occurrence contract and history unchanged.
export const LAB_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const validDay = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export function localCheckinDate(timestamp) {
  if (typeof timestamp !== 'string') throw new TypeError('Invalid timestamp');
  // Older event rows may contain a timezone-naive wall time. Preserve their
  // stored business day as local time; new API payloads require an explicit zone.
  const wall = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.exec(timestamp);
  if (wall && validDay(wall[1])) return wall[1];
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) {
    throw new TypeError('Timestamp must be ISO-8601 with timezone');
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LAB_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const day = `${fields.year}-${fields.month}-${fields.day}`;
  if (!validDay(day)) throw new TypeError('Invalid timestamp');
  return day;
}

export function weekRange(date) {
  if (!validDay(date)) throw new TypeError('week must be a valid YYYY-MM-DD date');
  const start = new Date(`${date}T00:00:00.000Z`);
  const mondayOffset = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - mondayOffset);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function monthRange(month) {
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
    throw new TypeError('month must be YYYY-MM');
  }
  const start = `${month}-01`;
  if (!validDay(start)) throw new TypeError('month must be a valid calendar month');
  const next = new Date(`${start}T00:00:00.000Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { start, end: next.toISOString().slice(0, 10) };
}

export function initializeLabAttendance(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS lab_daily_checkins (
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    local_checkin_date TEXT NOT NULL CHECK (length(local_checkin_date)=10),
    event_id TEXT NOT NULL UNIQUE REFERENCES access_events(event_id) ON DELETE CASCADE,
    event_time TEXT NOT NULL,
    PRIMARY KEY (user_id, local_checkin_date)
  );
    CREATE INDEX IF NOT EXISTS idx_lab_daily_checkins_date_user
      ON lab_daily_checkins(local_checkin_date, user_id);`);

  // Preserve every original access_events row. The separate ledger selects one
  // canonical committed check-in per member/local day from prior demo history.
  const insert = db.prepare(`INSERT INTO lab_daily_checkins(user_id,local_checkin_date,event_id,event_time)
    VALUES (?,?,?,?) ON CONFLICT(user_id,local_checkin_date) DO NOTHING`);
  const legacy = db.prepare(`SELECT user_id,event_id,event_time FROM access_events
    WHERE event_type='check_in' ORDER BY julianday(event_time),rowid`).all();
  const backfill = db.transaction(() => {
    for (const row of legacy) {
      try { insert.run(row.user_id, localCheckinDate(row.event_time), row.event_id, row.event_time); }
      catch (error) { if (!(error instanceof TypeError)) throw error; }
    }
  });
  backfill();
}

export function attendanceSummary(db, { week, month }) {
  const weekBounds = weekRange(week);
  const monthBounds = monthRange(month);
  const rows = db.prepare(`SELECT u.user_id,u.user_code,u.full_name,u.status,
      COUNT(DISTINCT CASE WHEN c.local_checkin_date>=? AND c.local_checkin_date<?
        THEN c.local_checkin_date END) AS week_days,
      COUNT(DISTINCT CASE WHEN c.local_checkin_date>=? AND c.local_checkin_date<?
        THEN c.local_checkin_date END) AS month_days,
      (SELECT latest.event_time FROM lab_daily_checkins latest WHERE latest.user_id=u.user_id
        ORDER BY julianday(latest.event_time) DESC LIMIT 1) AS last_checkin,
      GROUP_CONCAT(CASE WHEN c.local_checkin_date>=? AND c.local_checkin_date<?
        THEN c.local_checkin_date END, ',') AS month_dates
    FROM users u LEFT JOIN lab_daily_checkins c ON c.user_id=u.user_id
    GROUP BY u.user_id ORDER BY u.user_code`).all(
      weekBounds.start, weekBounds.end, monthBounds.start, monthBounds.end,
      monthBounds.start, monthBounds.end,
    );
  return {
    timezone: LAB_TIME_ZONE,
    week: { start: weekBounds.start, end_exclusive: weekBounds.end },
    month: { start: monthBounds.start, end_exclusive: monthBounds.end },
    data: rows.map(row => ({
      user_id: row.user_id,
      user_code: row.user_code,
      full_name: row.full_name,
      status: row.status,
      week_days: row.week_days,
      month_days: row.month_days,
      last_checkin: row.last_checkin,
      month_dates: row.month_dates ? [...new Set(row.month_dates.split(','))].sort() : [],
    })),
  };
}
