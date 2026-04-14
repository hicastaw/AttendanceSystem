import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Header, Footer } from './components/Layout.jsx';
import Home from './pages/Home.jsx';
import StudentProfile from './pages/StudentProfile.jsx';
import AttendanceScan from './pages/AttendanceScan.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col font-sans">
        <Header />
        <Routes>
          <Route path="/"        element={<Home />} />
          <Route path="/profile" element={<StudentProfile />} />
          <Route path="/scan"    element={<AttendanceScan />} />
          
          {/* Redirect url cũ/nhầm */}
          <Route path="/student" element={<Navigate to="/profile" replace />} />
          <Route path="*"        element={<Navigate to="/" replace />} />
        </Routes>
        <Footer />
      </div>
    </BrowserRouter>
  );
}
