import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useColorScheme, useTheme } from '@mui/material/styles';

// Thẻ số liệu: nhãn, giá trị, dòng phụ giải thích.
export function StatCard({ label, value, caption, loading, color }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="body2" color="text.secondary" gutterBottom>{label}</Typography>
        {loading
          ? <Skeleton variant="text" width={64} sx={{ fontSize: '2.125rem' }} />
          : <Typography variant="h4" component="p" color={color}>{value}</Typography>}
        {caption && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {loading ? <Skeleton width="70%" /> : caption}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

// Thẻ có tiêu đề + nội dung (biểu đồ, bảng).
export function SectionCard({ title, action, children, sx }) {
  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', ...sx }}>
      <Stack direction="row" alignItems="center" sx={{ px: 2, pt: 2, pb: 1, minHeight: 56 }}>
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 500, flexGrow: 1 }}>{title}</Typography>
        {action}
      </Stack>
      <Box sx={{ flexGrow: 1, minHeight: 0, overflowX: 'auto' }}>{children}</Box>
    </Card>
  );
}

// Màu chuỗi dữ liệu biểu đồ lấy từ palette của theme (đúng chế độ sáng/tối hiện tại).
export function useChartColors() {
  const theme = useTheme();
  const { mode, systemMode } = useColorScheme();
  const scheme = (mode === 'system' ? systemMode : mode) || 'light';
  const palette = theme.colorSchemes?.[scheme]?.palette || theme.palette;
  return { primary: palette.primary.main, secondary: palette.warning.main };
}

export function ErrorAlert({ message, onRetry }) {
  if (!message) return null;
  return (
    <Alert
      severity="error"
      action={onRetry ? <Button color="inherit" size="small" onClick={() => onRetry()}>Thử lại</Button> : null}
      sx={{ mb: 2 }}
    >
      {message}
    </Alert>
  );
}

// Trạng thái trống: nói rõ vì sao trống và việc nên làm tiếp.
export function EmptyState({ title, description, action }) {
  return (
    <Stack alignItems="center" spacing={1} sx={{ py: 5, px: 2, textAlign: 'center' }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>{title}</Typography>
      {description && <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>{description}</Typography>}
      {action && <Box sx={{ pt: 1 }}>{action}</Box>}
    </Stack>
  );
}
