import { useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import { DataGrid } from '@mui/x-data-grid';
import dayjs from 'dayjs';
import { apiGet } from '../api/client.js';
import useApi from '../hooks/useApi.js';
import RangePicker, { presetRange, toQuery } from '../components/RangePicker.jsx';
import { EmptyState, ErrorAlert } from '../components/common.jsx';
import { EVENT_TYPE_LABEL, EventTypeChip } from '../components/StatusChips.jsx';
import { downloadCsv, formatDateTime, formatDuration, formatPercent } from '../utils/format.js';

// Lệch giữa lúc quét và lúc server nhận quá 2 phút = edge gửi bù sau khi mất mạng.
const SYNC_DELAY_THRESHOLD_S = 120;

function syncDelaySeconds(row) {
  if (!row.received_at) return 0;
  return Math.max(0, (dayjs(row.received_at).valueOf() - dayjs(row.event_time).valueOf()) / 1000);
}

const columns = [
  { field: 'event_time', headerName: 'Thời gian', width: 190, sortable: false, valueFormatter: (v) => formatDateTime(v) },
  { field: 'full_name', headerName: 'Thành viên', flex: 1, minWidth: 180, sortable: false },
  { field: 'user_code', headerName: 'Mã', width: 110, sortable: false },
  {
    field: 'event_type', headerName: 'Sự kiện', width: 110, sortable: false,
    renderCell: (p) => <EventTypeChip type={p.value} />,
  },
  { field: 'confidence', headerName: 'Độ tin cậy', type: 'number', width: 120, sortable: false, valueFormatter: (v) => formatPercent(v) },
  { field: 'device_id', headerName: 'Thiết bị', width: 120, sortable: false },
  {
    field: 'sync', headerName: 'Đồng bộ', width: 190, sortable: false,
    valueGetter: (_, row) => syncDelaySeconds(row),
    renderCell: (p) => (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center' }}>
        {p.value > SYNC_DELAY_THRESHOLD_S ? (
          <Tooltip title="Thiết bị ghi nhận lúc mất mạng và gửi lên server sau.">
            <Typography variant="body2" color="warning.main">Đồng bộ sau {formatDuration(p.value)}</Typography>
          </Tooltip>
        ) : <Typography variant="body2" color="text.secondary">Trực tiếp</Typography>}
      </Box>
    ),
  },
];

export default function History() {
  const [range, setRange] = useState(() => presetRange('week'));
  const [member, setMember] = useState(null);
  const [eventType, setEventType] = useState('');
  const [pagination, setPagination] = useState({ page: 0, pageSize: 50 });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const filters = { ...toQuery(range), user_code: member?.user_code, event_type: eventType };
  const users = useApi(() => apiGet('/users'));
  const events = useApi(
    () => apiGet('/access-events', { ...filters, limit: pagination.pageSize, offset: pagination.page * pagination.pageSize }),
    [filters.from, filters.to, filters.user_code, filters.event_type, pagination.page, pagination.pageSize],
  );

  const updateFilter = (setter) => (value) => {
    setter(value);
    setPagination((p) => ({ ...p, page: 0 }));
  };

  async function exportCsv() {
    setExporting(true);
    setExportError('');
    try {
      const rows = [];
      for (let offset = 0; ; offset += 1000) {
        const page = await apiGet('/access-events', { ...filters, limit: 1000, offset });
        rows.push(...page.data);
        if (rows.length >= page.total || !page.data.length) break;
      }
      downloadCsv(`lich-su-ra-vao_${filters.from}_${filters.to}.csv`, [
        { header: 'Thời gian', value: (r) => formatDateTime(r.event_time) },
        { header: 'Mã', value: (r) => r.user_code },
        { header: 'Họ tên', value: (r) => r.full_name },
        { header: 'Sự kiện', value: (r) => EVENT_TYPE_LABEL[r.event_type] },
        { header: 'Độ tin cậy (%)', value: (r) => r.confidence ?? '' },
        { header: 'Thiết bị', value: (r) => r.device_id },
        { header: 'Server nhận lúc', value: (r) => formatDateTime(r.received_at) },
      ], rows);
    } catch (err) {
      setExportError(`Không xuất được CSV: ${err.message}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap" alignItems="center">
        <RangePicker value={range} onChange={updateFilter(setRange)} />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ flexGrow: 1, minWidth: 0 }}>
          <Autocomplete
            size="small"
            options={users.data?.data || []}
            value={member}
            onChange={(_, v) => updateFilter(setMember)(v)}
            getOptionLabel={(u) => `${u.full_name} (${u.user_code})`}
            isOptionEqualToValue={(a, b) => a.user_code === b.user_code}
            loading={users.loading}
            sx={{ minWidth: 200, flexGrow: 1, maxWidth: 280 }}
            renderInput={(params) => <TextField {...params} label="Thành viên" placeholder="Tất cả" />}
          />
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel id="event-type-label">Sự kiện</InputLabel>
            <Select
              labelId="event-type-label"
              label="Sự kiện"
              value={eventType}
              onChange={(e) => updateFilter(setEventType)(e.target.value)}
            >
              <MenuItem value="">Tất cả</MenuItem>
              <MenuItem value="check_in">VÀO</MenuItem>
              <MenuItem value="check_out">RA</MenuItem>
            </Select>
          </FormControl>
        </Stack>
        <Button
          variant="outlined"
          startIcon={<FileDownloadOutlinedIcon />}
          onClick={exportCsv}
          disabled={exporting || !events.data?.total}
          sx={{ flexShrink: 0, ml: { lg: 'auto' } }}
        >
          {exporting ? 'Đang xuất…' : 'Xuất CSV'}
        </Button>
      </Stack>

      <ErrorAlert message={events.error || exportError} onRetry={events.error ? events.reload : undefined} />

      <Paper variant="outlined">
        <Box sx={{ height: 640 }}>
          <DataGrid
            rows={events.data?.data || []}
            columns={columns}
            getRowId={(r) => r.event_id}
            rowCount={events.data?.total ?? 0}
            loading={events.loading}
            paginationMode="server"
            paginationModel={pagination}
            onPaginationModelChange={setPagination}
            pageSizeOptions={[25, 50, 100]}
            disableColumnFilter
            disableRowSelectionOnClick
            slots={{
              noRowsOverlay: () => (
                <EmptyState title="Không có lượt ra/vào nào" description="Thử chọn khoảng thời gian khác hoặc bỏ bớt bộ lọc." />
              ),
            }}
            sx={{ border: 0 }}
          />
        </Box>
      </Paper>
    </Stack>
  );
}
