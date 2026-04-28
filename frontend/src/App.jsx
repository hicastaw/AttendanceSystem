import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Header, Footer } from './components/Layout.jsx';
import Home from './pages/Home.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import StudentProfile from './pages/StudentProfile.jsx';
import AttendanceScan from './pages/AttendanceScan.jsx';
import TeacherDashboard from './pages/TeacherDashboard.jsx';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';

function RoleGate({ title, description }) {
  return (
    <main className="flex-grow bg-surface py-16 px-4 md:px-8">
      <div className="max-w-3xl mx-auto bg-white rounded-3xl border border-outline-variant/30 shadow-sm p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mx-auto mb-5">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h1 className="text-3xl font-black text-on-surface mb-3">{title}</h1>
        <p className="text-secondary leading-relaxed mb-6">{description}</p>
        <Link
          to="/"
          className="inline-flex items-center justify-center px-5 py-3 rounded-xl bg-primary-container text-white font-bold hover:opacity-90 transition"
        >
          Về trang chủ
        </Link>
      </div>
    </main>
  );
}

function ProtectedRoute({ allowedRoles, title, description, children }) {
  const { actor, isAuthenticated, authLoading } = useAuth();
  const location = useLocation();

  if (authLoading) {
    return (
      <main className="flex-grow bg-surface py-16 px-4 md:px-8">
        <div className="max-w-xl mx-auto bg-white rounded-3xl border border-outline-variant/30 shadow-sm p-8 text-center text-secondary">
          Đang kiểm tra phiên đăng nhập...
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }

  if (!allowedRoles.includes(actor.role)) {
    return <RoleGate title={title} description={description} />;
  }
  return children;
}

function AppRoutes() {
  const { isAuthenticated, authLoading } = useAuth();

  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col font-sans">
        <Header />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={authLoading ? null : (isAuthenticated ? <Navigate to="/" replace /> : <Login />)} />
          <Route path="/register" element={authLoading ? null : (isAuthenticated ? <Navigate to="/" replace /> : <Register />)} />
          <Route
            path="/teacher"
            element={
              <ProtectedRoute
                allowedRoles={['admin', 'lecturer']}
                title="Khu vực này dành cho giảng viên hoặc quản trị viên"
                description="Tài khoản hiện tại không có quyền vào dashboard giáo viên. Hãy đăng nhập bằng tài khoản giảng viên hoặc quản trị viên."
              >
                <TeacherDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute
                allowedRoles={['admin', 'student']}
                title="Khu vực này dành cho sinh viên hoặc quản trị viên"
                description="Tài khoản hiện tại không có quyền cập nhật hồ sơ sinh viên. Hãy đăng nhập bằng tài khoản sinh viên hoặc quản trị viên."
              >
                <StudentProfile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/scan"
            element={
              <ProtectedRoute
                allowedRoles={['admin', 'lecturer']}
                title="Khu vực này chỉ dành cho giáo viên và quản trị viên"
                description="Trang điểm danh dành cho giáo viên để mở phiên và quét khuôn mặt sinh viên. Tài khoản sinh viên không có quyền truy cập."
              >
                <AttendanceScan />
              </ProtectedRoute>
            }
          />
          <Route path="/student" element={<Navigate to="/profile" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Footer />
      </div>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
