import { useMemo, useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { Camera, UserCircle, ScanFace, BookUser, LayoutDashboard, ShieldCheck, LogOut, Settings2, LogIn, KeyRound, AlertCircle } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { getActorLabel } from '../auth/session.js';

function AccountModal({ open, onClose }) {
  const navigate = useNavigate();
  const { actor, isAuthenticated, logout, changePassword } = useAuth();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

  const resetForm = () => {
    setOldPassword('');
    setNewPassword('');
    setMessage(null);
  };

  if (!open) return null;

  const handleLogout = () => {
    logout();
    resetForm();
    onClose();
    navigate('/login');
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      await changePassword(oldPassword, newPassword);
      setMessage({ type: 'success', text: 'Đổi mật khẩu thành công.' });
      setOldPassword('');
      setNewPassword('');
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.message || 'Không thể đổi mật khẩu.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/45 flex items-center justify-center px-4" onClick={() => { resetForm(); onClose(); }}>
      <div className="w-full max-w-xl bg-white rounded-3xl shadow-2xl border border-outline-variant/20 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 border-b border-outline-variant/15">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-11 h-11 rounded-2xl bg-primary-container text-white flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-black text-on-surface">Tài khoản hệ thống</h2>
              <p className="text-sm text-secondary">Đăng nhập thật bằng token, kèm phân quyền theo vai trò.</p>
            </div>
          </div>
        </div>

        {!isAuthenticated ? (
          <div className="p-6 space-y-4">
            <div className="rounded-2xl bg-surface-container-low border border-outline-variant/15 px-4 py-4 text-sm text-secondary">
              Bạn chưa đăng nhập. Hãy vào trang đăng nhập để truy cập các chức năng có bảo vệ quyền.
            </div>
            <button
              onClick={() => {
                resetForm();
                onClose();
                navigate('/login');
              }}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-primary-container text-white font-bold"
            >
              <LogIn className="w-4 h-4" />
              Đi tới đăng nhập
            </button>
          </div>
        ) : (
          <>
            <div className="p-6 space-y-4">
              <div className="rounded-2xl bg-surface-container-low border border-outline-variant/15 px-4 py-4 text-sm text-secondary space-y-1">
                <div><span className="font-bold text-on-surface">Phiên hiện tại:</span> {getActorLabel(actor)}</div>
                <div><span className="font-bold text-on-surface">Username:</span> {actor.username || '--'}</div>
                <div><span className="font-bold text-on-surface">Vai trò:</span> {actor.role}</div>
                {actor.email && <div><span className="font-bold text-on-surface">Email:</span> {actor.email}</div>}
              </div>

              {actor.mustChangePassword && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>Bạn đang dùng mật khẩu mặc định. Nên đổi mật khẩu ngay để bảo mật hơn.</span>
                </div>
              )}

              <form className="space-y-3" onSubmit={handleChangePassword}>
                <div className="text-sm font-black text-on-surface flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-primary-container" /> Đổi mật khẩu
                </div>
                <input
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  placeholder="Mật khẩu hiện tại"
                  className="w-full rounded-xl border border-outline-variant/35 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-container/25"
                />
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Mật khẩu mới (ít nhất 8 ký tự)"
                  className="w-full rounded-xl border border-outline-variant/35 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-container/25"
                />
                {message && (
                  <div className={`rounded-2xl px-4 py-3 text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                    {message.text}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={submitting || !oldPassword || !newPassword}
                  className="w-full px-5 py-3 rounded-xl bg-primary-container text-white font-bold disabled:opacity-60"
                >
                  {submitting ? 'Đang cập nhật...' : 'Đổi mật khẩu'}
                </button>
              </form>
            </div>

            <div className="px-6 py-4 border-t border-outline-variant/15 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 bg-surface-container-low/40">
              <button
                onClick={handleLogout}
                className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-outline-variant/25 bg-white font-bold text-secondary hover:text-on-surface"
              >
                <LogOut className="w-4 h-4" />
                Đăng xuất
              </button>
              <button onClick={() => { resetForm(); onClose(); }} className="px-4 py-3 rounded-xl border border-outline-variant/25 bg-white font-bold text-secondary">
                Đóng
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function Header() {
  const { actor, isAuthenticated, isAdmin, isLecturer, isStudent } = useAuth();
  const [showAccountModal, setShowAccountModal] = useState(false);

  const navItems = useMemo(() => {
    if (!isAuthenticated) return [];
    if (isAdmin) return [
      { to: '/teacher', label: 'Giáo viên', icon: <LayoutDashboard className="w-4 h-4" /> },
      { to: '/profile', label: 'Cập nhật Profile', icon: <BookUser className="w-4 h-4" /> },
      { to: '/scan', label: 'Điểm danh', icon: <ScanFace className="w-4 h-4" /> },
    ];
    if (isLecturer) return [
      { to: '/teacher', label: 'Giáo viên', icon: <LayoutDashboard className="w-4 h-4" /> },
      { to: '/scan', label: 'Điểm danh', icon: <ScanFace className="w-4 h-4" /> },
    ];
    if (isStudent) return [
      { to: '/profile', label: 'Cập nhật Profile', icon: <BookUser className="w-4 h-4" /> },
    ];
    return [];
  }, [isAuthenticated, isAdmin, isLecturer, isStudent]);

  return (
    <>
      <header className="w-full sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-outline-variant/40 shadow-sm">
        <div className="flex justify-between items-center px-8 py-4 max-w-7xl mx-auto w-full gap-4">
          <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity shrink-0">
            <div className="w-9 h-9 rounded-lg bg-primary-container flex items-center justify-center">
              <Camera className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-extrabold text-primary-container tracking-tight">AttendanceSystem</span>
          </Link>

          <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
                    isActive ? 'bg-primary-container text-white shadow-sm' : 'text-on-surface hover:bg-surface-container-low hover:text-primary-container'
                  }`
                }
              >
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            {isAuthenticated ? (
              <button
                onClick={() => setShowAccountModal(true)}
                className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-outline-variant/25 bg-white hover:bg-surface-container-low transition-all"
              >
                <Settings2 className="w-4 h-4 text-primary-container" />
                <div className="text-left">
                  <div className="text-[11px] uppercase tracking-wide text-secondary font-bold">Tài khoản</div>
                  <div className="text-sm font-bold text-on-surface leading-tight max-w-[260px] truncate">{getActorLabel(actor)}</div>
                </div>
              </button>
            ) : (
              <Link
                to="/login"
                className="hidden sm:inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary-container text-white font-bold hover:opacity-90 transition-all shadow-sm"
              >
                <LogIn className="w-4 h-4" />
                Đăng nhập
              </Link>
            )}
            <button
              onClick={() => setShowAccountModal(true)}
              className="p-2 rounded-lg text-secondary hover:text-primary-container hover:bg-surface-container-low transition-all"
              title={isAuthenticated ? 'Tài khoản' : 'Đăng nhập'}
            >
              <UserCircle className="w-6 h-6" />
            </button>
          </div>
        </div>
      </header>
      <AccountModal open={showAccountModal} onClose={() => setShowAccountModal(false)} />
    </>
  );
}

export function Footer() {
  return (
    <footer className="w-full py-8 px-8 bg-surface-container-low border-t border-outline-variant/20 mt-auto">
      <div className="flex flex-col md:flex-row justify-between items-center max-w-7xl mx-auto gap-4">
        <div className="text-sm text-secondary">© 2026 PTIT — Hệ thống điểm danh khuôn mặt tự động</div>
        <div className="text-xs text-secondary/60 text-center md:text-right">Auth thật: Token Bearer • RBAC: Admin • Lecturer • Student • AI: YuNet + MBF (w600k)</div>
      </div>
    </footer>
  );
}
