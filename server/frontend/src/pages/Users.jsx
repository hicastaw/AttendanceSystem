import { useCallback, useEffect, useState } from 'react';
import { api, postJson } from '../api/client.js';
import FaceCapture from '../components/FaceCapture.jsx';

export default function Users() {
  const [users, setUsers] = useState([]);
  const [listError, setListError] = useState('');

  const [form, setForm] = useState({ user_code: '', full_name: '', email: '' });
  const [currentCode, setCurrentCode] = useState('');
  const [userStatus, setUserStatus] = useState('');

  const [faceBlob, setFaceBlob] = useState(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState('');

  const loadUsers = useCallback(async () => {
    try {
      const data = await api('/users');
      setUsers(data.data);
      setListError('');
    } catch (err) {
      setListError(`Không tải được danh sách: ${err.message}`);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  function updateField(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleCreate(e) {
    e.preventDefault();
    const code = form.user_code.trim().toUpperCase();
    const fullName = form.full_name.trim();
    if (!code || !fullName) {
      setUserStatus('Cần nhập mã người dùng và họ tên.');
      return;
    }
    try {
      await postJson('/users', { user_code: code, full_name: fullName, email: form.email.trim() });
      setUserStatus(`Đã tạo người dùng mới: ${code}`);
      loadUsers();
    } catch (err) {
      // 409 = user_code đã tồn tại -> vẫn hợp lệ để đăng ký/cập nhật khuôn mặt cho người này
      setUserStatus(err.status === 409
        ? `Người dùng ${code} đã tồn tại, dùng để đăng ký/cập nhật khuôn mặt.`
        : `Lỗi: ${err.message}`);
      if (err.status !== 409) return;
    }
    setCurrentCode(code);
    setResult('');
  }

  function selectUser(user) {
    setForm({ user_code: user.user_code, full_name: user.full_name, email: user.email || '' });
    setCurrentCode(user.user_code);
    setUserStatus(`Đang đăng ký khuôn mặt cho ${user.user_code} — ${user.full_name}`);
    setResult('');
  }

  async function handleSaveFace() {
    if (!currentCode || !faceBlob) return;
    setSaving(true);
    setResult('Đang xử lý...');
    try {
      const body = new FormData();
      body.append('face_image', faceBlob, 'face.jpg');
      const data = await api(`/users/${encodeURIComponent(currentCode)}/face`, { method: 'POST', body });
      setResult(`Đã lưu khuôn mặt cho ${currentCode} (độ sắc nét: ${data.data.sharpness_score ?? '-'})`);
      loadUsers();
    } catch (err) {
      setResult(`Lỗi: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="card">
        <h2>1. Người dùng</h2>
        <form className="row row-form" onSubmit={handleCreate}>
          <input name="user_code" placeholder="Mã người dùng (vd: NV001)" value={form.user_code} onChange={updateField} />
          <input name="full_name" placeholder="Họ tên" value={form.full_name} onChange={updateField} />
          <input name="email" placeholder="Email (tuỳ chọn)" value={form.email} onChange={updateField} />
          <button type="submit">Tạo / dùng người dùng này</button>
        </form>
        {userStatus && <p className="muted">{userStatus}</p>}
      </div>

      <div className="card">
        <h2>2. Ảnh khuôn mặt</h2>
        <FaceCapture onChange={setFaceBlob} />
        <button type="button" onClick={handleSaveFace} disabled={!currentCode || !faceBlob || saving}>
          {saving ? 'Đang lưu...' : 'Lưu khuôn mặt'}
        </button>
        {!currentCode && <p className="muted">Chọn hoặc tạo người dùng ở bước 1 trước.</p>}
        {result && <p className="muted">{result}</p>}
      </div>

      <div className="card">
        <h2>Danh sách người dùng</h2>
        {listError && <p className="error">{listError}</p>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Mã</th><th>Họ tên</th><th>Email</th><th>Khuôn mặt</th><th /></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user_id}>
                  <td>{u.user_code}</td>
                  <td>{u.full_name}</td>
                  <td>{u.email || '-'}</td>
                  <td>
                    {u.has_face_profile
                      ? <span className="badge badge-in">Đã đăng ký</span>
                      : <span className="badge badge-out">Chưa có</span>}
                  </td>
                  <td>
                    <button type="button" className="small-btn" onClick={() => selectUser(u)}>
                      {u.has_face_profile ? 'Cập nhật mặt' : 'Đăng ký mặt'}
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && !listError && (
                <tr><td colSpan={5} className="muted">Chưa có người dùng nào.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
