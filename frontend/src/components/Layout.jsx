import { NavLink, Link } from 'react-router-dom';
import { Camera, UserCircle, ScanFace, BookUser } from 'lucide-react';

export function Header() {
  return (
    <header className="w-full sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-outline-variant/40 shadow-sm">
      <div className="flex justify-between items-center px-8 py-4 max-w-7xl mx-auto w-full">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <div className="w-9 h-9 rounded-lg bg-primary-container flex items-center justify-center">
            <Camera className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-extrabold text-primary-container tracking-tight">
            AttendanceSystem
          </span>
        </Link>

        {/* Nav */}
        <nav className="hidden md:flex items-center gap-1">
          <NavLink
            to="/profile"
            className={({ isActive }) =>
              `flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
                isActive
                  ? 'bg-primary-container text-white shadow-sm'
                  : 'text-on-surface hover:bg-surface-container-low hover:text-primary-container'
              }`
            }
          >
            <BookUser className="w-4 h-4" />
            Cập nhật Profile
          </NavLink>
          <NavLink
            to="/scan"
            className={({ isActive }) =>
              `flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
                isActive
                  ? 'bg-primary-container text-white shadow-sm'
                  : 'text-on-surface hover:bg-surface-container-low hover:text-primary-container'
              }`
            }
          >
            <ScanFace className="w-4 h-4" />
            Điểm danh
          </NavLink>
        </nav>

        {/* User icon */}
        <button className="p-2 rounded-lg text-secondary hover:text-primary-container hover:bg-surface-container-low transition-all">
          <UserCircle className="w-6 h-6" />
        </button>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="w-full py-8 px-8 bg-surface-container-low border-t border-outline-variant/20 mt-auto">
      <div className="flex flex-col md:flex-row justify-between items-center max-w-7xl mx-auto gap-4">
        <div className="text-sm text-secondary">
          © 2025 PTIT — Hệ thống điểm danh khuôn mặt tự động
        </div>
        <div className="text-xs text-secondary/60">
          AI: YuNet + MBF (w600k) • DB: PostgreSQL + pgvector
        </div>
      </div>
    </footer>
  );
}
