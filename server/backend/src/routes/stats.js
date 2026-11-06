import express from 'express';
import db from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { buildSessions, dayRange, loadEvents, todayKey } from '../sessions.js';

const router = express.Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseRange(req, res) {
  const today = todayKey();
  const from = req.query.from || today;
  const to = req.query.to || today;
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
    res.status(400).json({ status: 'error', message: 'Khoảng ngày không hợp lệ (định dạng YYYY-MM-DD, from ≤ to).' });
    return null;
  }
  return { from, to };
}

// GET /api/stats?from&to[&user_code] — tổng hợp có mặt: theo từng thành viên và theo ngày.
router.get('/stats', requireAdmin, (req, res) => {
  const range = parseRange(req, res);
  if (!range) return;
  const userCode = req.query.user_code;
  const events = loadEvents({ ...range, userCode });
  const sessions = buildSessions(events);

  const users = db.prepare(`
    SELECT user_code, full_name, status FROM users
    ${userCode ? 'WHERE user_code = ?' : ''} ORDER BY user_code
  `).all(...(userCode ? [String(userCode).trim().toUpperCase()] : []));

  const perUser = new Map(users.map((u) => [u.user_code, {
    user_code: u.user_code, full_name: u.full_name, status: u.status,
    days_present: 0, total_seconds: 0, sessions: 0, missing_out: 0, last_seen: null,
  }]));
  const daysByUser = new Map();
  for (const s of sessions) {
    const row = perUser.get(s.user_code);
    if (!row) continue;
    row.total_seconds += s.duration_seconds;
    if (s.status === 'missing_out') row.missing_out += 1;
    if (s.status !== 'missing_in') row.sessions += 1;
    const seen = s.check_out || s.check_in;
    if (seen && (!row.last_seen || seen > row.last_seen)) row.last_seen = seen;
    if (s.check_in) {
      if (!daysByUser.has(s.user_code)) daysByUser.set(s.user_code, new Set());
      daysByUser.get(s.user_code).add(s.day);
    }
  }
  for (const [code, days] of daysByUser) {
    if (perUser.has(code)) perUser.get(code).days_present = days.size;
  }
  const members = [...perUser.values()].map((row) => ({
    ...row,
    avg_seconds_per_day: row.days_present ? Math.round(row.total_seconds / row.days_present) : 0,
  }));

  const daily = new Map(dayRange(range.from, range.to).map((day) => [day, {
    day, check_in: 0, check_out: 0, people: new Set(), total_seconds: 0,
  }]));
  for (const e of events) {
    const row = daily.get(e.event_time.slice(0, 10));
    if (!row) continue;
    row[e.event_type] += 1;
    row.people.add(e.user_code);
  }
  for (const s of sessions) {
    const row = daily.get(s.day);
    if (row) row.total_seconds += s.duration_seconds;
  }

  res.json({
    status: 'success',
    data: {
      from: range.from,
      to: range.to,
      summary: {
        people_present: members.filter((m) => m.days_present > 0).length,
        total_seconds: members.reduce((sum, m) => sum + m.total_seconds, 0),
        check_ins: events.filter((e) => e.event_type === 'check_in').length,
        missing_out: members.reduce((sum, m) => sum + m.missing_out, 0),
      },
      members,
      daily: [...daily.values()].map(({ people, ...row }) => ({ ...row, people: people.size })),
    },
  });
});

// GET /api/sessions?from&to[&user_code] — danh sách lượt có mặt (VÀO → RA).
router.get('/sessions', requireAdmin, (req, res) => {
  const range = parseRange(req, res);
  if (!range) return;
  const sessions = buildSessions(loadEvents({ ...range, userCode: req.query.user_code }));
  sessions.sort((a, b) => (b.check_in || b.check_out).localeCompare(a.check_in || a.check_out));
  res.json({ status: 'success', data: sessions });
});

// GET /api/presence — ai đang ở lab + số người có mặt theo từng giờ hôm nay.
router.get('/presence', requireAdmin, (req, res) => {
  const now = new Date();
  const today = todayKey(now);
  const sessions = buildSessions(loadEvents({ from: today, to: today }), now);
  const present = sessions
    .filter((s) => s.status === 'ongoing')
    .sort((a, b) => a.check_in.localeCompare(b.check_in));

  // Số người khác nhau có mặt trong mỗi giờ (lượt giao với khung giờ đó).
  const dayStart = Date.parse(`${today}T00:00:00+07:00`);
  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const start = dayStart + hour * 3600e3;
    const end = start + 3600e3;
    const people = new Set();
    for (const s of sessions) {
      if (!s.check_in) continue;
      const inAt = Date.parse(s.check_in);
      const outAt = s.status === 'complete' ? Date.parse(s.check_out) : s.status === 'ongoing' ? now.getTime() : null;
      if (outAt !== null && inAt < end && outAt > start) people.add(s.user_code);
    }
    return { hour, people: people.size };
  });

  res.json({
    status: 'success',
    data: {
      date: today,
      present,
      hourly,
      check_ins_today: sessions.filter((s) => s.check_in).length,
      missing_out_yesterday: buildSessions(loadEvents({
        from: todayKey(new Date(now.getTime() - 86400e3)), to: todayKey(new Date(now.getTime() - 86400e3)),
      }), now).filter((s) => s.status === 'missing_out').length,
    },
  });
});

export default router;
