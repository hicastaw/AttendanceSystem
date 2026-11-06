import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useColorScheme, useTheme } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import HistoryIcon from '@mui/icons-material/History';
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutline';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import { useAuth } from '../auth.jsx';
import DeviceChip from './DeviceChip.jsx';

const DRAWER_WIDTH = 240;

export const NAV_ITEMS = [
  { to: '/', label: 'Tổng quan', icon: <DashboardOutlinedIcon /> },
  { to: '/stats', label: 'Thống kê', icon: <InsightsOutlinedIcon /> },
  { to: '/history', label: 'Lịch sử ra/vào', icon: <HistoryIcon /> },
  { to: '/members', label: 'Thành viên', icon: <PeopleOutlineIcon /> },
];

function pageTitle(pathname) {
  if (pathname.startsWith('/members/')) return 'Chi tiết thành viên';
  return NAV_ITEMS.find((item) => item.to === pathname)?.label || 'Lab Access';
}

function ColorModeButton() {
  const { mode, systemMode, setMode } = useColorScheme();
  const current = mode === 'system' ? systemMode : mode;
  if (!current) return null;
  const next = current === 'dark' ? 'light' : 'dark';
  return (
    <Tooltip title={next === 'dark' ? 'Chuyển sang giao diện tối' : 'Chuyển sang giao diện sáng'}>
      <IconButton color="inherit" onClick={() => setMode(next)} aria-label="Đổi giao diện sáng/tối">
        {current === 'dark' ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}
      </IconButton>
    </Tooltip>
  );
}

export default function AppShell() {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const smUp = useMediaQuery(theme.breakpoints.up('sm'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const { logout } = useAuth();
  const { pathname } = useLocation();

  const nav = (
    <>
      <Toolbar>
        <Typography variant="h6" component="div" sx={{ fontWeight: 500 }}>Lab Access</Typography>
      </Toolbar>
      <List component="nav" aria-label="Điều hướng chính">
        {NAV_ITEMS.map((item) => {
          const selected = item.to === '/' ? pathname === '/' : pathname.startsWith(item.to);
          return (
            <ListItemButton
              key={item.to}
              component={NavLink}
              to={item.to}
              selected={selected}
              onClick={() => setMobileOpen(false)}
              sx={{ mx: 1, borderRadius: 1 }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          );
        })}
      </List>
    </>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar
        position="fixed"
        sx={{ width: { md: `calc(100% - ${DRAWER_WIDTH}px)` }, ml: { md: `${DRAWER_WIDTH}px` } }}
      >
        <Toolbar sx={{ gap: 1 }}>
          {!desktop && (
            <IconButton color="inherit" edge="start" onClick={() => setMobileOpen(true)} aria-label="Mở menu">
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="h6" component="h1" noWrap sx={{ flexGrow: 1 }}>
            {pageTitle(pathname)}
          </Typography>
          <Stack direction="row" spacing={1}>
            <DeviceChip compact={!smUp} />
          </Stack>
          <ColorModeButton />
          <Tooltip title="Đăng xuất">
            <IconButton color="inherit" onClick={logout} aria-label="Đăng xuất">
              <LogoutIcon />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}>
        <Drawer
          variant={desktop ? 'permanent' : 'temporary'}
          open={desktop || mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' } }}
        >
          {nav}
        </Drawer>
      </Box>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, p: { xs: 2, md: 3 } }}>
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  );
}
