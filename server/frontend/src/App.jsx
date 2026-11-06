import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import AppShell from './components/AppShell.jsx';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import Stats from './pages/Stats.jsx';
import History from './pages/History.jsx';
import Members from './pages/Members.jsx';
import MemberDetail from './pages/MemberDetail.jsx';

function RequireAuth({ children }) {
  const { isLoggedIn } = useAuth();
  return isLoggedIn ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route path="/" element={<Overview />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/history" element={<History />} />
        <Route path="/members" element={<Members />} />
        <Route path="/members/:code" element={<MemberDetail />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
