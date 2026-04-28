import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { KeyRound, LogIn, ShieldCheck, UserRound, AlertCircle } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';

function useNextPath() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  return params.get('next') || '/';
}

export default function Login() {
  const navigate = useNavigate();
  const nextPath = useNextPath();
  const { login, isAuthenticated, authLoading } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showDemo, setShowDemo] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(nextPath, { replace: true });
    }
  }, [authLoading, isAuthenticated, navigate, nextPath]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await login(identifier, password);
      navigate(nextPath, { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Đăng nhập thất bại.');
    } finally {
      setSubmitting(false);
    }
  };

  const useDemo = (id, pwd) => {
    setIdentifier(id);
    setPassword(pwd);
  };

  return (
    <main className="flex-grow bg-surface py-14 px-4 md:px-8">
      <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-8 items-start">
        <section className="bg-gradient-to-br from-primary via-primary-container to-red-600 text-white rounded-3xl p-8 shadow-xl overflow-hidden relative">
          <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '36px 36px' }} />
          <div className="relative space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-semibold">
              <ShieldCheck className="w-4 h-4" />
              Xác thực thật • Token bảo vệ API • Phân quyền theo tài khoản
            </div>
            <h1 className="text-4xl font-black leading-tight">Đăng nhập vào hệ thống điểm danh</h1>
            <p className="text-white/85 leading-relaxed">
              Sinh viên, giảng viên và quản trị viên đều đăng nhập bằng tài khoản riêng. Sau khi xác thực,
              hệ thống tự khóa đúng hồ sơ và chức năng được phép thao tác.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              {[
                { title: 'Sinh viên', desc: 'Chỉ xem/sửa hồ sơ và điểm danh của chính mình' },
                { title: 'Giảng viên', desc: 'Quản lý học phần, phiên và kết quả phụ trách' },
                { title: 'Admin', desc: 'Toàn quyền vận hành và cấu hình hệ thống' },
              ].map((item) => (
                <div key={item.title} className="rounded-2xl bg-white/12 border border-white/10 p-4">
                  <div className="font-black">{item.title}</div>
                  <div className="text-sm text-white/80 mt-1 leading-relaxed">{item.desc}</div>
                </div>
              ))}
            </div>
            <div className="rounded-2xl bg-black/15 border border-white/10 p-4 text-sm leading-relaxed">
              <div className="font-bold mb-2">Tài khoản demo mặc định</div>
              <div>Admin: <span className="font-mono">admin</span> / <span className="font-mono">Admin@123</span></div>
              <div>Giảng viên: <span className="font-mono">gv001</span> / <span className="font-mono">GV001@123</span></div>
              <div>Sinh viên: <span className="font-mono">sv0001</span> / <span className="font-mono">SV0001@123</span></div>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-3xl border border-outline-variant/30 shadow-sm p-7 md:p-8">
          <div className="mb-6">
            <h2 className="text-2xl font-black text-on-surface">Đăng nhập</h2>
            <p className="text-secondary mt-1">Nhập username, mã giảng viên, mã sinh viên hoặc email.</p>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <label className="block">
              <span className="text-xs font-bold text-secondary uppercase tracking-wide">Tài khoản</span>
              <div className="mt-2 relative">
                <UserRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
                <input
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="admin, gv001, sv0001 hoặc email"
                  className="w-full rounded-xl border border-outline-variant/35 pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-container/25"
                />
              </div>
            </label>

            <label className="block">
              <span className="text-xs font-bold text-secondary uppercase tracking-wide">Mật khẩu</span>
              <div className="mt-2 relative">
                <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Nhập mật khẩu"
                  className="w-full rounded-xl border border-outline-variant/35 pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-container/25"
                />
              </div>
            </label>

            {error && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !identifier.trim() || !password}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-primary-container text-white font-bold disabled:opacity-60"
            >
              <LogIn className="w-4 h-4" />
              {submitting ? 'Đang đăng nhập...' : 'Đăng nhập'}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-outline-variant/20">
            <button
              type="button"
              onClick={() => setShowDemo((v) => !v)}
              className="text-sm font-bold text-primary-container"
            >
              {showDemo ? 'Ẩn' : 'Hiện'} tài khoản demo nhanh
            </button>
            {showDemo && (
              <div className="mt-4 grid grid-cols-1 gap-3">
                {[
                  { title: 'Admin', identifier: 'admin', password: 'Admin@123' },
                  { title: 'Giảng viên demo', identifier: 'gv001', password: 'GV001@123' },
                  { title: 'Sinh viên demo', identifier: 'sv0001', password: 'SV0001@123' },
                ].map((item) => (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => useDemo(item.identifier, item.password)}
                    className="rounded-2xl border border-outline-variant/25 p-4 text-left hover:border-primary-container/30 hover:bg-surface-container-low"
                  >
                    <div className="font-black text-on-surface">{item.title}</div>
                    <div className="text-xs text-secondary mt-1 font-mono">{item.identifier} / {item.password}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-6 text-sm text-secondary">
            Sau khi đăng nhập, bạn sẽ được chuyển về đúng màn hình trước đó.{' '}
            <Link to="/" className="font-bold text-primary-container">Về trang chủ</Link>
          </div>



        </section>
      </div>
    </main>
  );
}
