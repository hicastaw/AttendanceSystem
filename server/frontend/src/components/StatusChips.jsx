import Chip from '@mui/material/Chip';

// Một cách thể hiện cho mỗi trạng thái, dùng giống nhau ở mọi màn hình.

const FACE = {
  ok: { label: 'Đã đăng ký', color: 'success' },
  outdated: { label: 'Cần đăng ký lại', color: 'warning' },
  none: { label: 'Chưa có khuôn mặt', color: 'default' },
};

const SESSION = {
  complete: { label: 'Hoàn chỉnh', color: 'default' },
  ongoing: { label: 'Đang ở lab', color: 'success' },
  missing_out: { label: 'Thiếu lượt ra', color: 'warning' },
  missing_in: { label: 'Thiếu lượt vào', color: 'warning' },
};

const USER = {
  // Chỉ trạng thái ngoại lệ mới có chip; "đang hoạt động" là mặc định nên không đánh dấu.
  inactive: { label: 'Đã khoá', color: 'default', variant: 'outlined' },
};

const EVENT = {
  check_in: { label: 'VÀO', color: 'primary' },
  check_out: { label: 'RA', color: 'default' },
};

function StatusChip({ map, value }) {
  const item = map[value];
  if (!item) return null;
  return <Chip size="small" label={item.label} color={item.color} variant={item.variant || 'filled'} />;
}

// Nhãn ngắn cho cột hẹp trên mobile.
const FACE_SHORT = {
  ok: { ...FACE.ok, label: 'Đã có' },
  outdated: { ...FACE.outdated, label: 'Đăng ký lại' },
  none: { ...FACE.none, label: 'Chưa có' },
};

export const FaceStatusChip = ({ status, short = false }) => <StatusChip map={short ? FACE_SHORT : FACE} value={status} />;
export const SessionStatusChip = ({ status }) => <StatusChip map={SESSION} value={status} />;
export const UserStatusChip = ({ status }) => <StatusChip map={USER} value={status} />;
export const EventTypeChip = ({ type }) => <StatusChip map={EVENT} value={type} />;

export const FACE_STATUS_LABEL = Object.fromEntries(Object.entries(FACE).map(([k, v]) => [k, v.label]));
export const SESSION_STATUS_LABEL = Object.fromEntries(Object.entries(SESSION).map(([k, v]) => [k, v.label]));
export const EVENT_TYPE_LABEL = Object.fromEntries(Object.entries(EVENT).map(([k, v]) => [k, v.label]));
