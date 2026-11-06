import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import FaceRetouchingNaturalOutlinedIcon from '@mui/icons-material/FaceRetouchingNaturalOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { DataGrid } from '@mui/x-data-grid';
import { apiGet } from '../api/client.js';
import useApi from '../hooks/useApi.js';
import useMemberActions from '../components/useMemberActions.jsx';
import RangePicker, { presetRange, toQuery } from '../components/RangePicker.jsx';
import { EmptyState, ErrorAlert, StatCard } from '../components/common.jsx';
import { FaceStatusChip, SessionStatusChip, UserStatusChip } from '../components/StatusChips.jsx';
import MemberAvatar from '../components/MemberAvatar.jsx';
import { formatDate, formatDateTime, formatDay, formatDuration, formatHours, formatRelativeDay, formatTime } from '../utils/format.js';

// Ngưỡng độ nét tối thiểu AI service chấp nhận khi đăng ký (server/ai/main.py).
const FACE_SHARPNESS_MIN = 100;

const sessionColumns = [
  { field: 'day', headerName: 'Ngày', width: 130, valueFormatter: (v) => formatDay(v) },
  { field: 'check_in', headerName: 'Vào', width: 100, valueFormatter: (v) => formatTime(v) },
  { field: 'check_out', headerName: 'Ra', width: 100, valueFormatter: (v) => formatTime(v) },
  {
    field: 'duration_seconds', headerName: 'Thời lượng', type: 'number', width: 150,
    valueFormatter: (v, row) => (row.status === 'complete' || row.status === 'ongoing' ? formatDuration(v) : '—'),
  },
  { field: 'status', headerName: 'Trạng thái', flex: 1, minWidth: 150, renderCell: (p) => <SessionStatusChip status={p.value} /> },
];

function InfoRow({ label, children }) {
  return (
    <Stack direction="row" spacing={2} sx={{ py: 1 }}>
      <Typography variant="body2" color="text.secondary" sx={{ width: 160, flexShrink: 0 }}>{label}</Typography>
      <Box sx={{ minWidth: 0 }}>{typeof children === 'string' ? <Typography variant="body2">{children}</Typography> : children}</Box>
    </Stack>
  );
}

export default function MemberDetail() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [range, setRange] = useState(() => presetRange('month'));
  const query = toQuery(range);

  const user = useApi(() => apiGet(`/users/${code}`), [code]);
  const stats = useApi(() => apiGet('/stats', { ...query, user_code: code }), [code, query.from, query.to]);
  const sessions = useApi(() => apiGet('/sessions', { ...query, user_code: code }), [code, query.from, query.to]);
  const { actions, elements } = useMemberActions((_, action) => {
    if (action === 'delete') navigate('/members', { replace: true });
    else { user.reload(true); stats.reload(true); }
  });

  const member = user.data?.data;
  const summary = stats.data?.data.members[0];

  if (user.error) {
    return (
      <Stack spacing={2}>
        <ErrorAlert message={user.error} onRetry={user.reload} />
        <Button component={RouterLink} to="/members" sx={{ alignSelf: 'flex-start' }}>Về danh sách thành viên</Button>
      </Stack>
    );
  }

  return (
    <Stack spacing={3}>
      <Breadcrumbs aria-label="Đường dẫn">
        <Link component={RouterLink} to="/members" underline="hover" color="inherit">Thành viên</Link>
        <Typography color="text.primary">{member?.full_name || code}</Typography>
      </Breadcrumbs>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
        <Stack direction="row" spacing={2} alignItems="center" sx={{ flexGrow: 1 }}>
          {member ? <MemberAvatar name={member.full_name} size={56} /> : <Avatar sx={{ width: 56, height: 56 }} />}
          <Box>
            <Typography variant="h5" component="h2">{member ? member.full_name : <Skeleton width={220} />}</Typography>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
              <Typography variant="body2" color="text.secondary">{code.toUpperCase()}</Typography>
              {member && <UserStatusChip status={member.status} />}
            </Stack>
          </Box>
        </Stack>
        {member && (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button variant="contained" startIcon={<FaceRetouchingNaturalOutlinedIcon />} onClick={() => actions.registerFace(member)}>
              {member.face_status === 'none' ? 'Đăng ký khuôn mặt' : 'Cập nhật khuôn mặt'}
            </Button>
            <Button variant="outlined" startIcon={<EditOutlinedIcon />} onClick={() => actions.edit(member)}>Sửa</Button>
            <Button
              variant="outlined"
              startIcon={member.status === 'active' ? <LockOutlinedIcon /> : <LockOpenOutlinedIcon />}
              onClick={() => actions.toggleLock(member)}
            >
              {member.status === 'active' ? 'Khoá' : 'Mở khoá'}
            </Button>
            <Button variant="outlined" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => actions.remove(member)}>Xoá</Button>
          </Stack>
        )}
      </Stack>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 5, lg: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 500, mb: 1 }}>Thông tin</Typography>
              {!member ? [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} height={36} />) : (
                <>
                  <InfoRow label="Email">{member.email || 'Chưa có'}</InfoRow>
                  <InfoRow label="Ngày tạo">{formatDate(member.created_at)}</InfoRow>
                  <InfoRow label="Lần cuối có mặt">{formatRelativeDay(member.last_seen_at)}</InfoRow>
                  <Divider sx={{ my: 1 }} />
                  <InfoRow label="Khuôn mặt"><FaceStatusChip status={member.face_status} /></InfoRow>
                  <InfoRow label="Cập nhật lúc">{member.face_updated_at ? formatDateTime(member.face_updated_at) : 'Chưa đăng ký'}</InfoRow>
                  {member.face_quality_score != null && (
                    <InfoRow label="Độ nét ảnh">
                      {`${Math.round(member.face_quality_score).toLocaleString('vi-VN')} (đạt; tối thiểu ${FACE_SHARPNESS_MIN})`}
                    </InfoRow>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 7, lg: 8 }}>
          <Stack spacing={2} sx={{ height: '100%' }}>
            <RangePicker value={range} onChange={setRange} presets={['week', 'month', 'last30']} />
            <ErrorAlert message={stats.error} onRetry={stats.reload} />
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <StatCard label="Số ngày có mặt" value={summary?.days_present ?? 0} loading={stats.loading} />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <StatCard
                  label="Tổng giờ"
                  value={formatHours(summary?.total_seconds)}
                  caption={summary?.days_present ? `TB ${formatDuration(summary.avg_seconds_per_day)} mỗi ngày` : undefined}
                  loading={stats.loading}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <StatCard
                  label="Lượt thiếu ra"
                  value={summary?.missing_out ?? 0}
                  caption="không được cộng giờ"
                  loading={stats.loading}
                  color={summary?.missing_out ? 'warning.main' : undefined}
                />
              </Grid>
            </Grid>
          </Stack>
        </Grid>
      </Grid>

      <Paper variant="outlined">
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 500, px: 2, pt: 2 }}>Lượt có mặt</Typography>
        <ErrorAlert message={sessions.error} onRetry={sessions.reload} />
        <Box>
          <DataGrid
            autoHeight
            rows={sessions.data?.data || []}
            columns={sessionColumns}
            getRowId={(r) => `${r.check_in || ''}|${r.check_out || ''}`}
            loading={sessions.loading}
            disableRowSelectionOnClick
            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
            pageSizeOptions={[25, 50, 100]}
            slots={{
              noRowsOverlay: () => (
                <EmptyState title="Không có lượt có mặt nào" description="Người này chưa quét khuôn mặt ở cửa trong khoảng thời gian đã chọn." />
              ),
            }}
            sx={{ border: 0 }}
          />
        </Box>
      </Paper>
      {elements}
    </Stack>
  );
}
