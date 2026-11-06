import { createTheme } from '@mui/material/styles';
import { viVN as coreViVN } from '@mui/material/locale';
import { viVN as gridViVN } from '@mui/x-data-grid/locales';
import { viVN as pickersViVN } from '@mui/x-date-pickers/locales';

// Material Design chuẩn của MUI (hướng "canon" đã chọn): giữ màu primary/secondary và
// typography mặc định, chỉ chỉnh những gì trình duyệt để mặc định (chọn chữ, số liệu dạng
// bảng) và nền xám nhạt để thẻ nổi trên nền.
const theme = createTheme(
  {
    cssVariables: { colorSchemeSelector: 'class' },
    colorSchemes: {
      light: {
        palette: {
          background: { default: '#f5f5f5', paper: '#ffffff' },
          warning: { main: '#ed6c02', contrastText: 'rgba(0, 0, 0, 0.87)' },
        },
      },
      dark: {
        palette: {
          background: { default: '#121212', paper: '#1e1e1e' },
        },
      },
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: (t) => ({
          body: { fontVariantNumeric: 'tabular-nums' },
          '::selection': { backgroundColor: t.vars.palette.primary.main, color: t.vars.palette.primary.contrastText },
        }),
      },
      MuiCard: {
        defaultProps: { variant: 'outlined' },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { textTransform: 'none', fontWeight: 500 } },
      },
      MuiToggleButton: {
        styleOverrides: { root: { textTransform: 'none' } },
      },
    },
  },
  coreViVN,
  gridViVN,
  pickersViVN,
);

export default theme;
