import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import PersonAddAlt1OutlinedIcon from '@mui/icons-material/PersonAddAlt1Outlined';
import FaceRetouchingNaturalOutlinedIcon from '@mui/icons-material/FaceRetouchingNaturalOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { DataGrid, GridActionsCellItem } from '@mui/x-data-grid';
import { apiGet } from '../api/client.js';
import useApi from '../hooks/useApi.js';
import useMemberActions from '../components/useMemberActions.jsx';
import { EmptyState, ErrorAlert } from '../components/common.jsx';
import { FACE_STATUS_LABEL, FaceStatusChip, UserStatusChip } from '../components/StatusChips.jsx';
import { downloadCsv, formatRelativeDay } from '../utils/format.js';
import MemberAvatar from '../components/MemberAvatar.jsx';

export default function Members() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi(() => apiGet('/users'));
  const { actions, elements } = useMemberActions((code, action) => {
    if (action === 'add') navigate(`/members/${code}`);
    else reload(true);
  });

  const theme = useTheme();
  const smUp = useMediaQuery(theme.breakpoints.up('sm'));

  function exportCsv() {
    downloadCsv('thanh-vien.csv', [
      { header: 'Mã', value: (r) => r.user_code },
      { header: 'Họ tên', value: (r) => r.full_name },
      { header: 'Email', value: (r) => r.email || '' },
      { header: 'Trạng thái', value: (r) => (r.status === 'active' ? 'Đang hoạt động' : 'Đã khoá') },
      { header: 'Khuôn mặt', value: (r) => FACE_STATUS_LABEL[r.face_status] },
      { header: 'Lần cuối có mặt', value: (r) => r.last_seen_at || '' },
    ], data?.data || []);
  }

  const columns = useMemo(() => [
    {
      field: 'full_name', headerName: 'Thành viên', flex: 1.4, minWidth: smUp ? 220 : 150,
      renderCell: (p) => (
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ height: '100%', minWidth: 0 }}>
          <MemberAvatar name={p.value} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>{p.value}</Typography>
            {/* Màn hẹp ẩn cột Trạng thái: người bị khoá được đánh dấu dưới tên. */}
            {!smUp && p.row.status === 'inactive' && (
              <Typography variant="caption" color="text.secondary" display="block">Đã khoá</Typography>
            )}
          </Box>
        </Stack>
      ),
    },
    { field: 'user_code', headerName: 'Mã', width: 110 },
    { field: 'email', headerName: 'Email', flex: 1, minWidth: 180, valueFormatter: (v) => v || '—' },
    {
      field: 'status', headerName: 'Trạng thái', width: 130,
      valueFormatter: (v) => (v === 'active' ? 'Đang hoạt động' : 'Đã khoá'),
      renderCell: (p) => <UserStatusChip status={p.value} />,
    },
    {
      field: 'face_status', headerName: 'Khuôn mặt', width: smUp ? 170 : 120,
      valueFormatter: (v) => FACE_STATUS_LABEL[v],
      renderCell: (p) => <FaceStatusChip status={p.value} short={!smUp} />,
    },
    { field: 'last_seen_at', headerName: 'Lần cuối có mặt', width: 170, valueFormatter: (v) => formatRelativeDay(v) },
    {
      field: 'actions', type: 'actions', headerName: '', width: 100,
      getActions: ({ row }) => [
        <GridActionsCellItem
          key="face"
          icon={<FaceRetouchingNaturalOutlinedIcon />}
          label={row.face_status === 'none' ? 'Đăng ký khuôn mặt' : 'Cập nhật khuôn mặt'}
          onClick={() => actions.registerFace(row)}
        />,
        <GridActionsCellItem key="edit" icon={<EditOutlinedIcon />} label="Sửa thông tin" onClick={() => actions.edit(row)} showInMenu />,
        <GridActionsCellItem
          key="lock"
          icon={row.status === 'active' ? <LockOutlinedIcon /> : <LockOpenOutlinedIcon />}
          label={row.status === 'active' ? 'Khoá' : 'Mở khoá'}
          onClick={() => actions.toggleLock(row)}
          showInMenu
        />,
        <GridActionsCellItem
          key="delete"
          icon={<DeleteOutlineIcon color="error" />}
          label="Xoá vĩnh viễn"
          onClick={() => actions.remove(row)}
          showInMenu
          sx={{ color: 'error.main' }}
        />,
      ],
    },
  ], [actions, smUp]);

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2} useFlexGap>
        <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
          {data ? `${data.data.length} thành viên · bấm vào một người để xem lịch sử có mặt` : ' '}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ ml: 'auto' }}>
          {smUp ? (
            <Button
              variant="outlined"
              startIcon={<FileDownloadOutlinedIcon />}
              onClick={exportCsv}
              disabled={!data?.data.length}
              sx={{ whiteSpace: 'nowrap' }}
            >
              Xuất CSV
            </Button>
          ) : (
            <Tooltip title="Xuất CSV">
              <span>
                <IconButton color="primary" onClick={exportCsv} disabled={!data?.data.length} aria-label="Xuất CSV">
                  <FileDownloadOutlinedIcon />
                </IconButton>
              </span>
            </Tooltip>
          )}
          <Button variant="contained" startIcon={<PersonAddAlt1OutlinedIcon />} onClick={actions.add} sx={{ whiteSpace: 'nowrap' }}>
            Thêm thành viên
          </Button>
        </Stack>
      </Stack>

      <ErrorAlert message={error} onRetry={reload} />

      <Paper variant="outlined">
        <Box>
          <DataGrid
            autoHeight
            rows={data?.data || []}
            columns={columns}
            getRowId={(r) => r.user_code}
            loading={loading}
            showToolbar
            slotProps={{ toolbar: { showQuickFilter: true, csvOptions: { disableToolbarButton: true }, printOptions: { disableToolbarButton: true } } }}
            columnVisibilityModel={smUp ? undefined : { email: false, last_seen_at: false, user_code: false, status: false, actions: false }}
            initialState={{ pagination: { paginationModel: { pageSize: 50 } } }}
            pageSizeOptions={[25, 50, 100]}
            onCellClick={(p) => p.field !== 'actions' && navigate(`/members/${p.row.user_code}`)}
            disableRowSelectionOnClick
            slots={{
              noRowsOverlay: () => (
                <EmptyState
                  title="Chưa có thành viên nào"
                  description="Thêm thành viên rồi đăng ký khuôn mặt để thiết bị ở cửa nhận diện được."
                  action={<Button variant="contained" onClick={actions.add}>Thêm thành viên</Button>}
                />
              ),
            }}
            sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' } }}
          />
        </Box>
      </Paper>
      {elements}
    </Stack>
  );
}
