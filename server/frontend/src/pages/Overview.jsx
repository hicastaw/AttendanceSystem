import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { BarChart } from '@mui/x-charts/BarChart';
import { apiGet } from '../api/client.js';
import useApi from '../hooks/useApi.js';
import { EmptyState, ErrorAlert, SectionCard, StatCard, useChartColors } from '../components/common.jsx';
import { EventTypeChip } from '../components/StatusChips.jsx';
import MemberAvatar from '../components/MemberAvatar.jsx';
import { formatDuration, formatPercent, formatRelativeDay, formatTime } from '../utils/format.js';

const REFRESH_MS = 30000;

// Đồng hồ cập nhật mỗi 30 giây để cột "Đã ở" tự tăng.
function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function HourlyChart({ hourly, loading }) {
  const colors = useChartColors();
  // Hiện 6:00–22:00; mở rộng nếu có người ngoài khung đó.
  const active = hourly.filter((h) => h.people > 0).map((h) => h.hour);
  const first = Math.min(6, ...active);
  const last = Math.max(new Date().getHours(), ...active);
  const rows = hourly.slice(first, last + 1).map((h) => ({ ...h, label: `${h.hour}h` }));
  const peak = hourly.reduce((best, h) => (h.people > best.people ? h : best), { people: 0 });

  if (loading) return <Skeleton variant="rounded" height={280} sx={{ mx: 2, mb: 2 }} />;
  return (
    <>
      <BarChart
        dataset={rows}
        xAxis={[{ scaleType: 'band', dataKey: 'label' }]}
        yAxis={[{ tickMinStep: 1, width: 36 }]}
        series={[{ dataKey: 'people', label: 'Số người có mặt', color: colors.primary, valueFormatter: (v) => `${v} người` }]}
        height={280}
        hideLegend
        margin={{ left: 8, right: 16 }}
      />
      <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 2 }}>
        {peak.people
          ? `Đông nhất lúc ${peak.hour}:00–${peak.hour + 1}:00 với ${peak.people} người.`
          : 'Hôm nay chưa có ai vào lab.'}
      </Typography>
    </>
  );
}

function PresentTable({ present, loading, now }) {
  const navigate = useNavigate();
  if (loading) {
    return <Box sx={{ px: 2, pb: 2 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={44} />)}</Box>;
  }
  if (!present.length) {
    return (
      <EmptyState
        title="Hiện không có ai trong lab"
        description="Khi thành viên quét khuôn mặt ở cửa, họ sẽ xuất hiện ở đây kèm giờ vào."
      />
    );
  }
  return (
    <Table size="small" aria-label="Người đang có mặt" sx={{ '& th, & td:not(:first-of-type)': { whiteSpace: 'nowrap' } }}>
      <TableHead>
        <TableRow>
          <TableCell>Thành viên</TableCell>
          <TableCell align="right">Vào lúc</TableCell>
          <TableCell align="right">Đã ở</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {present.map((p) => (
          <TableRow
            key={p.user_code}
            hover
            onClick={() => navigate(`/members/${p.user_code}`)}
            sx={{ cursor: 'pointer', '&:last-child td': { border: 0 } }}
          >
            <TableCell>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <MemberAvatar name={p.full_name} />
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>{p.full_name}</Typography>
                  <Typography variant="caption" color="text.secondary">{p.user_code}</Typography>
                </Box>
              </Stack>
            </TableCell>
            <TableCell align="right">{formatTime(p.check_in)}</TableCell>
            <TableCell align="right">{formatDuration((now - Date.parse(p.check_in)) / 1000)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function Overview() {
  const now = useNow();
  const presence = useApi(() => apiGet('/presence'), [], { intervalMs: REFRESH_MS });
  const users = useApi(() => apiGet('/users'));
  const recent = useApi(() => apiGet('/access-events', { limit: 8 }), [], { intervalMs: REFRESH_MS });

  const p = presence.data?.data;
  const memberList = users.data?.data || [];
  const counts = useMemo(() => ({
    total: memberList.length,
    active: memberList.filter((u) => u.status === 'active').length,
    outdated: memberList.filter((u) => u.face_status === 'outdated').length,
    noFace: memberList.filter((u) => u.face_status === 'none').length,
  }), [memberList]);
  const needFace = counts.outdated + counts.noFace;

  return (
    <Stack spacing={3}>
      <ErrorAlert message={presence.error} onRetry={presence.reload} />
      {p?.missing_out_yesterday > 0 && (
        <Alert
          severity="warning"
          action={<Button color="inherit" size="small" component={RouterLink} to="/stats">Xem thống kê</Button>}
        >
          Hôm qua có {p.missing_out_yesterday} lượt vào không có lượt ra; các lượt này không được cộng giờ.
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid size={{ xs: 6, lg: 3 }}>
          <StatCard
            label="Đang ở lab"
            value={p?.present.length ?? 0}
            caption={`trên ${counts.active} thành viên đang hoạt động`}
            loading={presence.loading || users.loading}
            color="success.main"
          />
        </Grid>
        <Grid size={{ xs: 6, lg: 3 }}>
          <StatCard label="Lượt vào hôm nay" value={p?.check_ins_today ?? 0} caption="tính cả người đã về" loading={presence.loading} />
        </Grid>
        <Grid size={{ xs: 6, lg: 3 }}>
          <StatCard
            label="Thành viên"
            value={counts.total}
            caption={counts.total ? `${counts.total - needFace} đã đăng ký khuôn mặt` : 'Chưa có thành viên'}
            loading={users.loading}
          />
        </Grid>
        <Grid size={{ xs: 6, lg: 3 }}>
          <StatCard
            label="Cần đăng ký khuôn mặt"
            value={needFace}
            caption={needFace ? `${counts.outdated} cần đăng ký lại · ${counts.noFace} chưa có` : 'Tất cả đã sẵn sàng'}
            loading={users.loading}
            color={needFace ? 'warning.main' : undefined}
          />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <SectionCard title="Số người có mặt theo giờ hôm nay">
            <HourlyChart hourly={p?.hourly || []} loading={presence.loading} />
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <SectionCard title={`Đang có mặt${p ? ` (${p.present.length})` : ''}`}>
            <PresentTable present={p?.present || []} loading={presence.loading} now={now} />
          </SectionCard>
        </Grid>
      </Grid>

      <SectionCard
        title="Lượt ra/vào gần nhất"
        action={<Button size="small" component={RouterLink} to="/history">Xem lịch sử</Button>}
      >
        <ErrorAlert message={recent.error} onRetry={recent.reload} />
        {recent.loading && <Box sx={{ px: 2, pb: 2 }}>{[0, 1, 2].map((i) => <Skeleton key={i} height={40} />)}</Box>}
        {!recent.loading && !(recent.data?.data || []).length && (
          <EmptyState title="Chưa có lượt ra/vào nào" description="Sự kiện từ thiết bị ở cửa sẽ hiện ở đây." />
        )}
        <List dense disablePadding>
          {(recent.data?.data || []).map((e) => (
            <ListItem key={e.event_id} divider secondaryAction={<EventTypeChip type={e.event_type} />}>
              <ListItemText
                primary={`${e.full_name} · ${e.user_code}`}
                secondary={`${formatRelativeDay(e.event_time)} · độ tin cậy ${formatPercent(e.confidence)}`}
              />
            </ListItem>
          ))}
        </List>
      </SectionCard>
    </Stack>
  );
}
