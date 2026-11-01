import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';

export default function Logs() {
  const [filterCode, setFilterCode] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadLogs = useCallback(async (code) => {
    setLoading(true);
    setError('');
    try {
      const qs = code ? `?user_code=${encodeURIComponent(code)}` : '';
      const data = await api(`/access-events${qs}`);
      setRows(data.data);
    } catch (err) {
      setError(`Không tải được log: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLogs('');
  }, [loadLogs]);

  function handleSubmit(e) {
    e.preventDefault();
    loadLogs(filterCode.trim());
  }

  return (
    <div className="card">
      <form className="row" onSubmit={handleSubmit}>
        <input
          placeholder="Lọc theo mã người dùng (tuỳ chọn)"
          value={filterCode}
          onChange={(e) => setFilterCode(e.target.value)}
        />
        <button type="submit" disabled={loading}>{loading ? 'Đang tải...' : 'Làm mới'}</button>
      </form>
      {error && <p className="error">{error}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Thời gian</th><th>Mã</th><th>Họ tên</th>
              <th>Sự kiện</th><th>Độ tin cậy</th><th>Thiết bị</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.event_id}>
                <td>{row.event_time}</td>
                <td>{row.user_code}</td>
                <td>{row.full_name}</td>
                <td>
                  <span className={`badge ${row.event_type === 'check_in' ? 'badge-in' : 'badge-out'}`}>
                    {row.event_type === 'check_in' ? 'Vào' : 'Ra'}
                  </span>
                </td>
                <td>{row.confidence ?? '-'}</td>
                <td>{row.device_id}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="muted">Chưa có sự kiện nào.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
