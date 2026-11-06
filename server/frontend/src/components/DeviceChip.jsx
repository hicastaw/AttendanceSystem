import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import SensorsIcon from '@mui/icons-material/Sensors';
import SensorsOffIcon from '@mui/icons-material/SensorsOff';
import { apiGet } from '../api/client.js';
import useApi from '../hooks/useApi.js';
import { formatRelativeDay } from '../utils/format.js';

// Trạng thái thiết bị biên, gọn trên AppBar: online/offline + số sự kiện chờ đồng bộ.
export default function DeviceChip({ compact = false }) {
  const { data, error } = useApi(() => apiGet('/devices'), [], { intervalMs: 30000 });
  const devices = data?.data || [];

  if (error || !devices.length) {
    return (
      <Tooltip title={error || 'Chưa có thiết bị biên nào kết nối tới server.'}>
        <Chip size="small" icon={<SensorsOffIcon />} label={compact ? undefined : 'Chưa có thiết bị'} aria-label="Chưa có thiết bị" sx={compact ? compactSx : chipSx} />
      </Tooltip>
    );
  }

  return devices.map((d) => {
    const pending = d.pending_events ? ` · ${d.pending_events} chờ đồng bộ` : '';
    const label = d.online ? `${d.device_id} · online${pending}` : `${d.device_id} · offline`;
    const tip = d.online
      ? `Liên lạc lần cuối ${formatRelativeDay(d.last_seen_at)}.${d.face_data_up_to_date ? '' : ' Đang chờ tải dữ liệu khuôn mặt mới.'}`
      : `Mất liên lạc từ ${formatRelativeDay(d.last_seen_at)}. Thiết bị vẫn ghi nhận ra/vào và sẽ đồng bộ khi có mạng lại.`;
    return (
      <Tooltip key={d.device_id} title={tip}>
        <Chip
          size="small"
          icon={d.online ? <SensorsIcon /> : <SensorsOffIcon />}
          label={compact ? undefined : label}
          aria-label={label}
          color={d.online && !d.pending_events ? 'success' : 'warning'}
          sx={compact ? compactSx : chipSx}
        />
      </Tooltip>
    );
  });
}

const chipSx = { fontWeight: 500 };
// Chỉ icon: bỏ khoảng trống dành cho nhãn.
const compactSx = { '& .MuiChip-icon': { mx: 0.75 }, '& .MuiChip-label': { display: 'none' } };
