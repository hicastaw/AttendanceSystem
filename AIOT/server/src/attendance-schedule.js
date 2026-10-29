// The small calendar policy is mirrored in edge/attendance_schedule.py and parity tested.
export const defaults = [
  {schedule_id:'default-morning',name:'Buổi sáng',start_time:'07:00',end_time:'12:00',weekdays:[1,2,3,4,5,6],date:null,active:true},
  {schedule_id:'default-afternoon',name:'Buổi chiều',start_time:'13:00',end_time:'18:00',weekdays:[1,2,3,4,5,6],date:null,active:true},
];
export function validDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day.startsWith('0000-')) return false;
  const parsed = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === day;
}
export function validateSchedule(value) {
  const item = Object.fromEntries(['schedule_id','name','start_time','end_time','weekdays','date','active'].map(k=>[k,value?.[k]]));
  if (typeof item.schedule_id !== 'string' || !item.schedule_id || item.schedule_id.includes(':') || item.schedule_id === '__outside__' ||
      typeof item.name !== 'string' || !item.name.trim() || typeof item.active !== 'boolean') throw new Error('Thông tin sự kiện không hợp lệ.');
  for (const field of ['start_time','end_time']) if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item[field])) throw new Error('Giờ phải theo HH:MM.');
  if (item.start_time >= item.end_time) throw new Error('Giờ kết thúc phải sau giờ bắt đầu; chưa hỗ trợ qua nửa đêm.');
  if (item.date !== null && !validDay(item.date)) throw new Error('Ngày không hợp lệ.');
  if (!Array.isArray(item.weekdays) || item.weekdays.some(d=>!Number.isInteger(d)||d<1||d>7) || (!item.date && !item.weekdays.length)) throw new Error('Chọn ngày trong tuần.');
  item.weekdays = [...new Set(item.weekdays)].sort();
  return item;
}
const weekday = day => new Date(`${day}T00:00:00Z`).getUTCDay() || 7;
export function overlap(a,b) {
  if (!a.active || !b.active || a.start_time >= b.end_time || b.start_time >= a.end_time) return false;
  if (a.date && b.date) return a.date === b.date;
  if (a.date || b.date) { const [one,weekly] = a.date ? [a,b] : [b,a]; return weekly.weekdays.includes(weekday(one.date)); }
  return a.weekdays.some(d=>b.weekdays.includes(d));
}
export function resolveContext(timestamp, events) {
  if (typeof timestamp !== 'string' || !validDay(timestamp.slice(0,10)) ||
      !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) throw new Error('Timestamp cần ISO-8601 có timezone.');
  const local = new Date(Date.parse(timestamp)+7*3600*1000).toISOString();
  const day = local.slice(0,10), minute = local.slice(11,16);
  const matches = events.filter(e=>e.active && (e.date ? e.date===day : e.weekdays.includes(weekday(day))) && e.start_time<=minute && minute<e.end_time);
  if (matches.length>1) throw new Error('Các sự kiện đang chồng nhau.');
  return matches.length ? {scheduled_event_id:matches[0].schedule_id,occurrence_key:`${matches[0].schedule_id}:${day}`,event_name:matches[0].name}
    : {scheduled_event_id:null,occurrence_key:null,event_name:null};
}
