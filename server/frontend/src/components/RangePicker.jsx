import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs from 'dayjs';

export const PRESETS = {
  today: { label: 'Hôm nay', range: () => [dayjs(), dayjs()] },
  week: { label: 'Tuần này', range: () => [dayjs().startOf('week'), dayjs()] },
  month: { label: 'Tháng này', range: () => [dayjs().startOf('month'), dayjs()] },
  last30: { label: '30 ngày', range: () => [dayjs().subtract(29, 'day'), dayjs()] },
};

export function presetRange(key) {
  const [from, to] = PRESETS[key].range();
  return { preset: key, from, to };
}

export const toQuery = (range) => ({ from: range.from.format('YYYY-MM-DD'), to: range.to.format('YYYY-MM-DD') });

// Khoảng thời gian: chọn nhanh (Hôm nay / Tuần / Tháng / 30 ngày) hoặc tự chọn Từ ngày – Đến ngày.
export default function RangePicker({ value, onChange, presets = Object.keys(PRESETS) }) {
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={value.preset}
        onChange={(_, key) => key && onChange(presetRange(key))}
        aria-label="Khoảng thời gian"
      >
        {presets.map((key) => <ToggleButton key={key} value={key}>{PRESETS[key].label}</ToggleButton>)}
      </ToggleButtonGroup>
      <Stack direction="row" spacing={1.5}>
        <DatePicker
          label="Từ ngày"
          value={value.from}
          maxDate={value.to}
          onChange={(d) => d?.isValid() && onChange({ preset: null, from: d, to: value.to })}
          slotProps={{ textField: { size: 'small', sx: { width: 160 } } }}
        />
        <DatePicker
          label="Đến ngày"
          value={value.to}
          minDate={value.from}
          disableFuture
          onChange={(d) => d?.isValid() && onChange({ preset: null, from: value.from, to: d })}
          slotProps={{ textField: { size: 'small', sx: { width: 160 } } }}
        />
      </Stack>
    </Stack>
  );
}
