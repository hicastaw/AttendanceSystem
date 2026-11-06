import Avatar from '@mui/material/Avatar';
import { initials } from '../utils/format.js';

// Màu nền avatar suy ra từ tên (mẫu "letter avatar" của MUI). Bảng màu chọn sao cho chữ
// trắng đạt tương phản ≥ 4.5:1.
const COLORS = ['#1565c0', '#00695c', '#6a1b9a', '#ad1457', '#4e342e', '#37474f', '#2e7d32', '#283593', '#bf360c', '#00838f'];

function colorFor(name) {
  let hash = 0;
  for (const ch of String(name || '')) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

export default function MemberAvatar({ name, size = 32 }) {
  return (
    <Avatar sx={{ width: size, height: size, fontSize: size * 0.42, bgcolor: colorFor(name), color: '#fff' }}>
      {initials(name)}
    </Avatar>
  );
}
