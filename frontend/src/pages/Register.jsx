import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Eye,
  EyeOff,
  GraduationCap,
  KeyRound,
  Loader2,
  LogIn,
  UserPlus,
  UserRound,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import axios from 'axios';

const authApi = axios.create({
  baseURL: '/api/v1/auth',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

const ROLES = [
  {
    key: 'student',
    label: 'Sinh viên',
    icon: GraduationCap,
    description: 'Đăng ký bằng mã số sinh viên của bạn',
    codeLabel: 'Mã sinh viên',
    codePlaceholder: 'Ví dụ: SV0001',
    color: 'from-blue-500 to-indigo-600',
    lightColor: 'bg-blue-50 border-blue-200 text-blue-700',
    ringColor: 'ring-blue-400',
  },
  {
    key: 'lecturer',
    label: 'Giảng viên',
    icon: BookOpen,
    description: 'Đăng ký bằng mã giảng viên của bạn',
    codeLabel: 'Mã giảng viên',
    codePlaceholder: 'Ví dụ: GV001',
    color: 'from-emerald-500 to-teal-600',
    lightColor: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    ringColor: 'ring-emerald-400',
  },
];

function StrengthBar({ password }) {
  const checks = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^a-zA-Z0-9]/.test(password),
  ];
  const score = checks.filter(Boolean).length;
  const colors = ['bg-red-400', 'bg-orange-400', 'bg-yellow-400', 'bg-green-500'];
  const labels = ['Rất yếu', 'Yếu', 'Trung bình', 'Mạnh'];

  if (!password) return null;

  return (
    <div className="mt-2 space-y-1">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
              i < score ? colors[score - 1] : 'bg-gray-200'
            }`}
          />
        ))}
      </div>
      <p className={`text-xs font-medium ${score <= 1 ? 'text-red-500' : score === 2 ? 'text-orange-500' : score === 3 ? 'text-yellow-600' : 'text-green-600'}`}>
        Độ mạnh: {labels[score - 1] || 'Rất yếu'}
      </p>
    </div>
  );
}

export default function Register() {
  const navigate = useNavigate();
  const { isAuthenticated, authLoading, login } = useAuth();

  const [selectedRole, setSelectedRole] = useState('student');
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [authLoading, isAuthenticated, navigate]);

  const roleInfo = ROLES.find((r) => r.key === selectedRole);

  const validate = () => {
    if (!code.trim()) return 'Vui lòng nhập mã sinh viên/giảng viên.';
    if (!username.trim()) return 'Vui lòng nhập tên đăng nhập.';
    if (username.length < 4) return 'Tên đăng nhập phải có ít nhất 4 ký tự.';
    if (!/^[a-zA-Z0-9._-]+$/.test(username))
      return 'Tên đăng nhập chỉ được chứa chữ cái, số và ký tự . _ -';
    if (!password) return 'Vui lòng nhập mật khẩu.';
    if (password.length < 8) return 'Mật khẩu phải có ít nhất 8 ký tự.';
    if (password !== confirmPassword) return 'Mật khẩu xác nhận không khớp.';
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    try {
      await authApi.post('/register', {
        role: selectedRole,
        code: code.trim().toUpperCase(),
        username: username.trim().toLowerCase(),
        password,
      });

      setSuccess(true);
      // Tự động đăng nhập sau 1.5 giây
      setTimeout(async () => {
        try {
          await login(username.trim().toLowerCase(), password);
          navigate('/', { replace: true });
        } catch {
          navigate('/login', { replace: true });
        }
      }, 1500);
    } catch (err) {
      setError(err.response?.data?.message || 'Đăng ký thất bại. Vui lòng thử lại.');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <main className="flex-grow bg-surface py-14 px-4 md:px-8 flex items-center justify-center">
        <div className="bg-white rounded-3xl border border-outline-variant/30 shadow-sm p-10 text-center max-w-md w-full">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5 animate-bounce">
            <CheckCircle2 className="w-10 h-10 text-green-600" />
          </div>
          <h2 className="text-2xl font-black text-on-surface mb-2">Đăng ký thành công!</h2>
          <p className="text-secondary">Đang tự động đăng nhập vào hệ thống...</p>
          <div className="mt-4 flex justify-center">
            <Loader2 className="w-6 h-6 text-primary-container animate-spin" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-grow bg-surface py-12 px-4 md:px-8">
      <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-8 items-start">

        {/* Left panel - Info */}
        <section
          className={`bg-gradient-to-br ${roleInfo.color} text-white rounded-3xl p-8 shadow-xl overflow-hidden relative transition-all duration-500`}
        >
          <div
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage:
                'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
              backgroundSize: '36px 36px',
            }}
          />
          <div className="relative space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-semibold">
              <UserPlus className="w-4 h-4" />
              Tạo tài khoản mới • Liên kết với mã của bạn
            </div>

            <h1 className="text-4xl font-black leading-tight">
              Đăng ký tài khoản hệ thống điểm danh
            </h1>

            <p className="text-white/85 leading-relaxed">
              Nhập mã sinh viên hoặc mã giảng viên để xác thực danh tính, sau đó tạo
              tên đăng nhập và mật khẩu riêng của bạn.
            </p>

            {/* Hướng dẫn */}
            <div className="space-y-3 pt-1">
              {[
                { step: '1', text: 'Chọn vai trò của bạn (Sinh viên / Giảng viên)' },
                { step: '2', text: 'Nhập mã sinh viên hoặc mã giảng viên' },
                { step: '3', text: 'Đặt tên đăng nhập và mật khẩu bảo mật' },
                { step: '4', text: 'Hệ thống tự đăng nhập sau khi đăng ký' },
              ].map((item) => (
                <div key={item.step} className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center shrink-0 text-sm font-black">
                    {item.step}
                  </div>
                  <p className="text-sm text-white/90 leading-relaxed pt-0.5">{item.text}</p>
                </div>
              ))}
            </div>

            <div className="rounded-2xl bg-black/15 border border-white/10 p-4 text-sm leading-relaxed">
              <div className="font-bold mb-1">⚠️ Lưu ý quan trọng</div>
              <div className="text-white/85">
                Mã sinh viên/giảng viên phải đã được đăng ký trong hệ thống trước.
                Nếu chưa có, hãy liên hệ quản trị viên.
              </div>
            </div>
          </div>
        </section>

        {/* Right panel - Form */}
        <section className="bg-white rounded-3xl border border-outline-variant/30 shadow-sm p-7 md:p-8">
          <div className="mb-6">
            <h2 className="text-2xl font-black text-on-surface">Tạo tài khoản</h2>
            <p className="text-secondary mt-1 text-sm">Điền đầy đủ thông tin bên dưới để đăng ký.</p>
          </div>

          {/* Role selector */}
          <div className="mb-6">
            <span className="text-xs font-bold text-secondary uppercase tracking-wide block mb-2">
              Vai trò
            </span>
            <div className="grid grid-cols-2 gap-3">
              {ROLES.map((role) => {
                const Icon = role.icon;
                const isSelected = selectedRole === role.key;
                return (
                  <button
                    key={role.key}
                    type="button"
                    onClick={() => {
                      setSelectedRole(role.key);
                      setCode('');
                      setError('');
                    }}
                    className={`rounded-2xl border-2 p-4 text-left transition-all duration-200 ${
                      isSelected
                        ? 'border-primary-container bg-primary-container/8 shadow-sm'
                        : 'border-outline-variant/30 hover:border-outline-variant/60'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div
                        className={`w-8 h-8 rounded-xl flex items-center justify-center bg-gradient-to-br ${role.color}`}
                      >
                        <Icon className="w-4 h-4 text-white" />
                      </div>
                      <span className="font-black text-on-surface text-sm">{role.label}</span>
                      {isSelected && (
                        <CheckCircle2 className="w-4 h-4 text-primary-container ml-auto" />
                      )}
                    </div>
                    <p className="text-xs text-secondary leading-relaxed">{role.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit} noValidate>
            {/* Mã SV/GV */}
            <label className="block">
              <span className="text-xs font-bold text-secondary uppercase tracking-wide">
                {roleInfo.codeLabel}
              </span>
              <div className="mt-2 relative">
                <roleInfo.icon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
                <input
                  id="register-code"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={roleInfo.codePlaceholder}
                  className="w-full rounded-xl border border-outline-variant/35 pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-container/25 uppercase"
                  autoComplete="off"
                />
              </div>
            </label>

            {/* Username */}
            <label className="block">
              <span className="text-xs font-bold text-secondary uppercase tracking-wide">
                Tên đăng nhập
              </span>
              <div className="mt-2 relative">
                <UserRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
                <input
                  id="register-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  placeholder="Ví dụ: nguyenvana"
                  className="w-full rounded-xl border border-outline-variant/35 pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-container/25"
                  autoComplete="username"
                />
              </div>
              <p className="mt-1 text-xs text-secondary">Chỉ dùng chữ cái, số và ký tự . _ - (tối thiểu 4 ký tự)</p>
            </label>

            {/* Password */}
            <label className="block">
              <span className="text-xs font-bold text-secondary uppercase tracking-wide">
                Mật khẩu
              </span>
              <div className="mt-2 relative">
                <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
                <input
                  id="register-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Tối thiểu 8 ký tự"
                  className="w-full rounded-xl border border-outline-variant/35 pl-10 pr-10 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-container/25"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-secondary hover:text-on-surface"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <StrengthBar password={password} />
            </label>

            {/* Confirm Password */}
            <label className="block">
              <span className="text-xs font-bold text-secondary uppercase tracking-wide">
                Xác nhận mật khẩu
              </span>
              <div className="mt-2 relative">
                <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
                <input
                  id="register-confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Nhập lại mật khẩu"
                  className={`w-full rounded-xl border pl-10 pr-10 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-container/25 ${
                    confirmPassword && confirmPassword !== password
                      ? 'border-red-300 bg-red-50'
                      : confirmPassword && confirmPassword === password
                      ? 'border-green-300 bg-green-50'
                      : 'border-outline-variant/35'
                  }`}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-secondary hover:text-on-surface"
                  tabIndex={-1}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {confirmPassword && confirmPassword !== password && (
                <p className="mt-1 text-xs text-red-500">Mật khẩu không khớp</p>
              )}
              {confirmPassword && confirmPassword === password && (
                <p className="mt-1 text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Mật khẩu khớp
                </p>
              )}
            </label>

            {/* Error */}
            {error && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              id="register-submit-btn"
              disabled={submitting || !code.trim() || !username.trim() || !password || !confirmPassword}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-primary-container text-white font-bold disabled:opacity-60 hover:opacity-90 transition-opacity"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Đang đăng ký...
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  Đăng ký tài khoản
                </>
              )}
            </button>
          </form>

          {/* Link to login */}
          <div className="mt-6 pt-6 border-t border-outline-variant/20 text-sm text-secondary text-center">
            Đã có tài khoản?{' '}
            <Link
              to="/login"
              className="font-bold text-primary-container inline-flex items-center gap-1 hover:opacity-80"
            >
              <LogIn className="w-3.5 h-3.5" />
              Đăng nhập ngay
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
