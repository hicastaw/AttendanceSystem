import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { postJson } from '../api/client.js';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const { isLoggedIn, login } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (isLoggedIn) return <Navigate to="/logs" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const data = await postJson('/auth/login', { password });
      login(data.data.token);
      navigate('/logs', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card login-card">
      <h1>Lab Access</h1>
      <p className="muted">Đăng nhập quản trị</p>
      <form onSubmit={handleSubmit}>
        <input
          type="password"
          placeholder="Mật khẩu admin"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          required
        />
        <button type="submit" disabled={submitting}>
          {submitting ? 'Đang đăng nhập...' : 'Đăng nhập'}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
