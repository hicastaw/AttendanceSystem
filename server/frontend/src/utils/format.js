import dayjs from 'dayjs';

// Định dạng hiển thị dùng chung — một cách viết cho mỗi loại giá trị trên toàn trang.

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round((seconds || 0) / 60));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes} phút`;
  return `${hours} giờ ${String(minutes).padStart(2, '0')} phút`;
}

export function formatHours(seconds) {
  return `${((seconds || 0) / 3600).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} giờ`;
}

export const formatTime = (iso) => (iso ? dayjs(iso).format('HH:mm') : '—');
export const formatDateTime = (iso) => (iso ? dayjs(iso).format('DD/MM/YYYY HH:mm:ss') : '—');
export const formatDate = (iso) => (iso ? dayjs(iso).format('DD/MM/YYYY') : '—');
export const formatDay = (day) => dayjs(day).format('dd DD/MM');

export function formatPercent(value) {
  if (value === null || value === undefined) return '—';
  return `${Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;
}

// "Hôm nay 14:41", "Hôm qua 17:30", "05/11 08:12"
export function formatRelativeDay(iso) {
  if (!iso) return 'Chưa có';
  const d = dayjs(iso);
  if (d.isSame(dayjs(), 'day')) return `Hôm nay ${d.format('HH:mm')}`;
  if (d.isSame(dayjs().subtract(1, 'day'), 'day')) return `Hôm qua ${d.format('HH:mm')}`;
  return d.format('DD/MM/YYYY HH:mm');
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return ((parts.at(-2)?.[0] || '') + (parts.at(-1)?.[0] || '')).toUpperCase() || '?';
}

// Xuất CSV (phân cách bằng dấu phẩy) kèm BOM UTF-8 để Excel hiển thị đúng tiếng Việt.
export function downloadCsv(filename, columns, rows) {
  const escape = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [
    columns.map((c) => escape(c.header)).join(','),
    ...rows.map((row) => columns.map((c) => escape(c.value(row))).join(',')),
  ];
  const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
