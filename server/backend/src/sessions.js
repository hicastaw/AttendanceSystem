import db from './db.js';

// Ghép sự kiện ra/vào thành "lượt có mặt", cùng quy tắc với edge (reset theo ngày):
// trong mỗi ngày của mỗi người, check_in mở lượt, check_out đóng lượt.
//   complete    — có VÀO và RA, cộng giờ.
//   ongoing     — VÀO hôm nay chưa RA: đang ở lab, cộng giờ tới hiện tại.
//   missing_out — VÀO ngày trước (hoặc VÀO liền 2 lần) không có RA: KHÔNG cộng giờ.
//   missing_in  — RA không có VÀO trước đó trong ngày: KHÔNG cộng giờ.
// Ngày lấy theo 10 ký tự đầu của event_time (giờ địa phương edge ghi kèm offset).

const TIME_ZONE = process.env.TZ || 'Asia/Ho_Chi_Minh';

export function todayKey(now = new Date()) {
  return now.toLocaleDateString('sv-SE', { timeZone: TIME_ZONE });
}

export function dayRange(from, to) {
  const days = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end && days.length < 400) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

// Sự kiện trong khoảng ngày [from, to] (YYYY-MM-DD, tính cả 2 đầu), kèm thông tin người.
export function loadEvents({ from, to, userCode } = {}) {
  const clauses = [];
  const params = [];
  if (from) { clauses.push('substr(e.event_time, 1, 10) >= ?'); params.push(from); }
  if (to) { clauses.push('substr(e.event_time, 1, 10) <= ?'); params.push(to); }
  if (userCode) { clauses.push('u.user_code = ?'); params.push(String(userCode).trim().toUpperCase()); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`
    SELECT e.event_id, e.event_type, e.event_time, e.confidence, e.device_id,
           u.user_id, u.user_code, u.full_name
    FROM access_events e
    JOIN users u ON u.user_id = e.user_id
    ${where}
    ORDER BY u.user_id, e.event_time, e.rowid
  `).all(...params);
}

export function buildSessions(events, now = new Date()) {
  const today = todayKey(now);
  const sessions = [];
  let open = null;
  let openKey = null;

  const push = (checkIn, checkOut, status) => {
    const base = checkIn || checkOut;
    const seconds = status === 'complete'
      ? Math.max(0, (Date.parse(checkOut.event_time) - Date.parse(checkIn.event_time)) / 1000)
      : status === 'ongoing'
        ? Math.max(0, (now.getTime() - Date.parse(checkIn.event_time)) / 1000)
        : 0;
    sessions.push({
      user_code: base.user_code,
      full_name: base.full_name,
      day: base.event_time.slice(0, 10),
      check_in: checkIn ? checkIn.event_time : null,
      check_out: checkOut ? checkOut.event_time : null,
      duration_seconds: Math.round(seconds),
      status,
    });
  };

  const closeOpen = () => {
    if (open) push(open, null, open.event_time.slice(0, 10) === today ? 'ongoing' : 'missing_out');
    open = null;
  };

  for (const event of events) {
    const key = `${event.user_id}|${event.event_time.slice(0, 10)}`;
    if (key !== openKey) {
      closeOpen();
      openKey = key;
    }
    if (event.event_type === 'check_in') {
      if (open) push(open, null, 'missing_out');
      open = event;
    } else if (open) {
      push(open, event, 'complete');
      open = null;
    } else {
      push(null, event, 'missing_in');
    }
  }
  closeOpen();
  return sessions;
}
