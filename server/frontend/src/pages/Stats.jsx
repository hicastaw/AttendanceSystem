import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import { BarChart } from '@mui/x-charts/BarChart';
import { DataGrid } from '@mui/x-data-grid';
import { apiGet } from '../api/client.js';
import useApi from '../hooks/useApi.js';
import RangePicker, { presetRange, toQuery } from '../components/RangePicker.jsx';
import { EmptyState, ErrorAlert, SectionCard, StatCard, useChartColors } from '../components/common.jsx';
import { downloadCsv, formatDay, formatDuration, formatHours, formatRelativeDay } from '../utils/format.js';

const columns = [
  { field: 'full_name', headerName: 'Thành viên', flex: 1.4, minWidth: 180 },
  { field: 'user_code', headerName: 'Mã', width: 110 },
  { field: 'days_present', headerName: 'Số ngày có mặt', type: 'number', width: 140 },
  { field: 'total_seconds', headerName: 'Tổng giờ', type: 'number', width: 150, valueFormatter: (v) => formatDuration(v) },
  { field: 'avg_seconds_per_day', headerName: 'TB mỗi ngày', type: 'number', width: 150, valueFormatter: (v) => (v ? formatDuration(v) : '—') },
  {
    field: 'missing_out',
    headerName: 'Thiếu lượt ra',
    type: 'number',
    width: 130,
    description: 'Lượt vào không có lượt ra trong ngày; không được cộng giờ.',
    cellClassName: (params) => (params.value ? 'cell-warning' : ''),
  },
  { field: 'last_seen', headerName: 'Lần cuối có mặt', width: 170, valueFormatter: (v) => formatRelativeDay(v) },
];

export default function Stats() {
  const navigate = useNavigate();
  const colors = useChartColors();
  const [range, setRange] = useState(() => presetRange('week'));
  const query = toQuery(range);
  const { data, loading, error, reload } = useApi(() => apiGet('/stats', query), [query.from, query.to]);
  const stats = data?.data;
  const members = stats?.members || [];
  const daily = (stats?.daily || []).map((d) => ({ ...d, label: formatDay(d.day), hours: +(d.total_seconds / 3600).toFixed(1) }));

  function exportCsv() {
    downloadCsv(`thong-ke_${query.from}_${query.to}.csv`, [
      { header: 'Mã', value: (r) => r.user_code },
      { header: 'Họ tên', value: (r) => r.full_name },
      { header: 'Số ngày có mặt', value: (r) => r.days_present },
      { header: 'Tổng giờ', value: (r) => (r.total_seconds / 3600).toFixed(2) },
      { header: 'TB giờ mỗi ngày', value: (r) => (r.avg_seconds_per_day / 3600).toFixed(2) },
      { header: 'Số lượt thiếu ra', value: (r) => r.missing_out },
      { header: 'Lần cuối có mặt', value: (r) => r.last_seen || '' },
    ], members);
  }

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ lg: 'center' }}>
        <RangePicker value={range} onChange={setRange} />
        <Button
          variant="outlined"
          startIcon={<FileDownloadOutlinedIcon />}
          onClick={exportCsv}
          disabled={loading || !members.length}
        >
          Xuất CSV
        </Button>
      </Stack>

      <ErrorAlert message={error} onRetry={reload} />

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard label="Người có mặt" value={stats?.summary.people_present ?? 0} caption={`trên ${members.length} thành viên`} loading={loading} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard label="Tổng giờ có mặt" value={formatHours(stats?.summary.total_seconds)} caption="gồm lượt đang ở lab tới hiện tại; không tính lượt thiếu ra" loading={loading} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard label="Lượt vào" value={stats?.summary.check_ins ?? 0} loading={loading} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            label="Lượt thiếu ra"
            value={stats?.summary.missing_out ?? 0}
            caption="không được cộng giờ"
            loading={loading}
            color={stats?.summary.missing_out ? 'warning.main' : undefined}
          />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 6 }}>
          <SectionCard title="Số người và lượt vào theo ngày">
            {loading ? <Skeleton variant="rounded" height={280} sx={{ mx: 2, mb: 2 }} /> : (
              <BarChart
                dataset={daily}
                xAxis={[{ scaleType: 'band', dataKey: 'label' }]}
                yAxis={[{ tickMinStep: 1, width: 36 }]}
                series={[
                  { dataKey: 'people', label: 'Số người', color: colors.primary, valueFormatter: (v) => `${v} người` },
                  { dataKey: 'check_in', label: 'Lượt vào', color: colors.secondary, valueFormatter: (v) => `${v} lượt` },
                ]}
                height={280}
                margin={{ left: 8, right: 16 }}
              />
            )}
          </SectionCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <SectionCard title="Tổng giờ có mặt theo ngày">
            {loading ? <Skeleton variant="rounded" height={280} sx={{ mx: 2, mb: 2 }} /> : (
              <BarChart
                dataset={daily}
                xAxis={[{ scaleType: 'band', dataKey: 'label' }]}
                yAxis={[{ width: 56, label: 'Giờ' }]}
                series={[{ dataKey: 'hours', label: 'Giờ có mặt', color: colors.primary, valueFormatter: (v) => `${v.toLocaleString('vi-VN')} giờ` }]}
                height={280}
                hideLegend
                margin={{ left: 8, right: 16 }}
              />
            )}
          </SectionCard>
        </Grid>
      </Grid>

      <Paper variant="outlined">
        <Box>
          <DataGrid
            autoHeight
            rows={members}
            columns={columns}
            getRowId={(r) => r.user_code}
            loading={loading}
            initialState={{ sorting: { sortModel: [{ field: 'total_seconds', sort: 'desc' }] } }}
            onRowClick={(p) => navigate(`/members/${p.row.user_code}`)}
            disableRowSelectionOnClick
            hideFooterSelectedRowCount
            slots={{ noRowsOverlay: () => <EmptyState title="Chưa có thành viên" description="Thêm thành viên ở trang Thành viên để bắt đầu thống kê." /> }}
            sx={{
              border: 0,
              '& .MuiDataGrid-row': { cursor: 'pointer' },
              '& .cell-warning': { color: 'warning.main', fontWeight: 500 },
            }}
          />
        </Box>
      </Paper>
    </Stack>
  );
}
