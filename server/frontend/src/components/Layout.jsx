import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

const NAV_ITEMS = [
  { to: '/logs', label: 'Lịch sử ra/vào' },
  { to: '/users', label: 'Người dùng & khuôn mặt' },
];

export default function Layout() {
  const { logout } = useAuth();

  return (
    <div className="app">
      <header className="topbar">
        <h1>Lab Access</h1>
        <button type="button" className="link-btn" onClick={logout}>Đăng xuất</button>
      </header>

      <nav className="tabs">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `tab-btn${isActive ? ' active' : ''}`}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <main>
        <Outlet />
      </main>
    </div>
  );
}
