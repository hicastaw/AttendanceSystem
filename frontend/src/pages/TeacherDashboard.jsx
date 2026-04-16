import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client.js';
import {
  LayoutDashboard,
  Users,
  ClipboardList,
  Play,
  Square,
  RefreshCw,
  Search,
  Camera,
  GraduationCap,
  FileDown,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Clock3,
  XCircle,
  Filter,
  Eye,
  BookOpen,
} from 'lucide-react';

const tabs = [
  { key: 'overview', label: 'Tổng quan' },
  { key: 'sessions', label: 'Phiên điểm danh' },
  { key: 'records', label: 'Kết quả điểm danh' },
  { key: 'students', label: 'Sinh viên' },
];

const sessionStatusClass = {
  draft: 'bg-slate-100 text-slate-700',
  open: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-rose-100 text-rose-700',
};

const attendanceStatusClass = {
  early: 'bg-sky-100 text-sky-700',
  on_time: 'bg-emerald-100 text-emerald-700',
  late: 'bg-amber-100 text-amber-700',
  absent: 'bg-rose-100 text-rose-700',
};

function Badge({ children, className = '' }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${className}`}>
      {children}
    </span>
  );
}

function Card({ title, icon, children, action }) {
  return (
    <section className="bg-white rounded-2xl border border-outline-variant/30 shadow-sm p-5">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="text-primary-container">{icon}</div>
          <h2 className="text-lg font-black text-on-surface">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function StatCard({ icon, label, value, tone = 'default' }) {
  const toneClass =
    tone === 'success'
      ? 'bg-emerald-50'
      : tone === 'warning'
      ? 'bg-amber-50'
      : tone === 'danger'
      ? 'bg-rose-50'
      : 'bg-surface-container-low';

  return (
    <div className={`rounded-2xl p-5 border border-outline-variant/30 ${toneClass}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-primary-container">{icon}</div>
      </div>
      <div className="text-3xl font-black text-on-surface">{value}</div>
      <div className="text-sm text-secondary mt-1">{label}</div>
    </div>
  );
}

function formatDateTime(value) {
  if (!value) return '--';
  return new Date(value).toLocaleString('vi-VN');
}

export default function TeacherDashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  const [students, setStudents] = useState([]);
  const [sections, setSections] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [records, setRecords] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const [studentKeyword, setStudentKeyword] = useState('');
  const [sessionKeyword, setSessionKeyword] = useState('');
  const [sessionStatusFilter, setSessionStatusFilter] = useState('all');

  const [form, setForm] = useState({
    section_id: '',
    session_title: '',
    session_date: new Date().toISOString().slice(0, 10),
    start_time: '07:00',
    end_time: '09:00',
    late_after_minutes: 15,
  });

  const notify = (text, type = 'success') => {
    setMessage({ text, type });
    window.clearTimeout(window.__teacher_msg_timer__);
    window.__teacher_msg_timer__ = window.setTimeout(() => {
      setMessage(null);
    }, 3000);
  };

  const fetchStudents = async () => {
    const res = await api.get('/students');
    setStudents(res.data?.data || []);
  };

  const fetchSections = async () => {
    const res = await api.get('/attendance/sections');
    const list = res.data?.data || [];
    setSections(list);
    setForm((prev) => ({
      ...prev,
      section_id: prev.section_id || (list[0] ? String(list[0].section_id) : ''),
    }));
  };

  const fetchSessions = async () => {
    const res = await api.get('/attendance/sessions');
    const list = res.data?.data || [];
    setSessions(list);
    if (!selectedSessionId && list.length > 0) {
      setSelectedSessionId(String(list[0].session_id));
    }
  };

  const fetchRecords = async (sessionId) => {
    if (!sessionId) {
      setRecords([]);
      return;
    }
    setRecordsLoading(true);
    try {
      const res = await api.get(`/attendance/sessions/${sessionId}/records`);
      setRecords(res.data?.data || []);
    } catch (err) {
      notify('Không tải được kết quả điểm danh', 'error');
      setRecords([]);
    } finally {
      setRecordsLoading(false);
    }
  };

  const fetchAll = async () => {
    setLoading(true);
    try {
      await Promise.all([fetchStudents(), fetchSections(), fetchSessions()]);
    } catch (err) {
      notify('Không tải được dữ liệu dashboard', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  useEffect(() => {
    if (selectedSessionId) {
      fetchRecords(selectedSessionId);
    }
  }, [selectedSessionId]);

  const stats = useMemo(() => {
    const totalStudents = students.length;
    const totalSections = sections.length;
    const totalSessions = sessions.length;
    const openSessions = sessions.filter((s) => s.status === 'open').length;
    const faceReady = students.filter((s) => s.has_face_profile || s.image_path).length;
    const noFace = totalStudents - faceReady;

    return {
      totalStudents,
      totalSections,
      totalSessions,
      openSessions,
      faceReady,
      noFace,
    };
  }, [students, sections, sessions]);

  const filteredStudents = useMemo(() => {
    const keyword = studentKeyword.trim().toLowerCase();
    if (!keyword) return students;

    return students.filter((s) => {
      const target = [
        s.student_code,
        s.full_name,
        s.class_name,
        s.email,
        s.enrolled_courses_summary,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return target.includes(keyword);
    });
  }, [students, studentKeyword]);

  const filteredSessions = useMemo(() => {
    const keyword = sessionKeyword.trim().toLowerCase();

    return sessions.filter((s) => {
      const matchKeyword = !keyword
        ? true
        : [s.session_title, s.course_name, s.class_name, s.status]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(keyword);

      const matchStatus =
        sessionStatusFilter === 'all' ? true : s.status === sessionStatusFilter;

      return matchKeyword && matchStatus;
    });
  }, [sessions, sessionKeyword, sessionStatusFilter]);

  const attendanceSummary = useMemo(() => {
    return {
      early: records.filter((r) => r.attendance_status === 'early').length,
      on_time: records.filter((r) => r.attendance_status === 'on_time').length,
      late: records.filter((r) => r.attendance_status === 'late').length,
      absent: records.filter((r) => r.attendance_status === 'absent').length,
    };
  }, [records]);

  const handleCreateSession = async () => {
    if (!form.section_id || !form.session_title.trim()) {
      notify('Vui lòng chọn học phần và nhập tên phiên điểm danh', 'error');
      return;
    }

    try {
      const payload = {
        section_id: Number(form.section_id),
        session_title: form.session_title,
        session_date: form.session_date,
        start_time: `${form.session_date} ${form.start_time}:00`,
        end_time: `${form.session_date} ${form.end_time}:00`,
        late_after_minutes: Number(form.late_after_minutes),
      };

      await api.post('/attendance/sessions', payload);

      notify('Tạo phiên điểm danh thành công');
      setForm((prev) => ({
        ...prev,
        session_title: '',
      }));
      await fetchSessions();
      setActiveTab('sessions');
    } catch (err) {
      notify(err.response?.data?.message || 'Không thể tạo phiên điểm danh', 'error');
    }
  };

  const handleOpenSession = async (id) => {
    try {
      await api.put(`/attendance/sessions/${id}/open`);
      notify('Đã mở phiên điểm danh');
      await fetchSessions();
      if (String(selectedSessionId) === String(id)) {
        await fetchRecords(id);
      }
    } catch (err) {
      notify(err.response?.data?.message || 'Không thể mở phiên', 'error');
    }
  };

  const handleCloseSession = async (id) => {
    try {
      await api.put(`/attendance/sessions/${id}/close`);
      notify('Đã đóng phiên điểm danh');
      await fetchSessions();
      if (String(selectedSessionId) === String(id)) {
        await fetchRecords(id);
      }
    } catch (err) {
      notify(err.response?.data?.message || 'Không thể đóng phiên', 'error');
    }
  };

  const handleSelectSession = async (id) => {
    setSelectedSessionId(String(id));
    setActiveTab('records');
  };

  const handleExport = async (id) => {
    try {
      const res = await api.get(`/attendance/sessions/${id}/export`, {
        responseType: 'blob',
      });

      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `attendance_session_${id}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      notify('Đã export báo cáo điểm danh');
    } catch (err) {
      notify('Không thể export báo cáo', 'error');
    }
  };

  return (
    <main className="flex-grow bg-surface py-10 px-4 md:px-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {message && (
          <div
            className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
              message.type === 'error'
                ? 'bg-rose-50 text-rose-700 border-rose-200'
                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary-container/10 text-primary-container font-bold text-sm mb-3">
              <LayoutDashboard className="w-4 h-4" />
              Teacher Dashboard
            </div>
            <h1 className="text-4xl font-black text-on-surface mb-2">
              Trang điều khiển giáo viên
            </h1>
            <p className="text-secondary max-w-3xl">
              Quản lý học phần, phiên điểm danh, xem kết quả và chuyển nhanh sang chế độ quét camera từ một màn hình duy nhất.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              to="/profile"
              className="inline-flex items-center gap-2 px-4 py-3 rounded-lg bg-white border border-outline-variant/30 font-bold hover:bg-surface-container-low"
            >
              <GraduationCap className="w-4 h-4" />
              Cập nhật profile
            </Link>

            <Link
              to="/scan"
              className="inline-flex items-center gap-2 px-4 py-3 rounded-lg bg-primary-container text-white font-bold hover:opacity-90"
            >
              <Camera className="w-4 h-4" />
              Sang trang scan
            </Link>

            <button
              onClick={fetchAll}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-lg bg-white border border-outline-variant/30 font-bold hover:bg-surface-container-low"
            >
              <RefreshCw className="w-4 h-4" />
              Làm mới
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-6 gap-4">
          <StatCard icon={<Users className="w-6 h-6" />} label="Tổng sinh viên" value={stats.totalStudents} />
          <StatCard icon={<BookOpen className="w-6 h-6" />} label="Tổng học phần" value={stats.totalSections} />
          <StatCard icon={<ClipboardList className="w-6 h-6" />} label="Tổng phiên" value={stats.totalSessions} />
          <StatCard icon={<Play className="w-6 h-6" />} label="Phiên đang mở" value={stats.openSessions} tone="success" />
          <StatCard icon={<CheckCircle2 className="w-6 h-6" />} label="Đã có face profile" value={stats.faceReady} tone="success" />
          <StatCard icon={<AlertTriangle className="w-6 h-6" />} label="Chưa có face profile" value={stats.noFace} tone="warning" />
        </div>

        <div className="bg-white rounded-2xl border border-outline-variant/30 shadow-sm p-2">
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2.5 rounded-xl text-sm font-bold transition ${
                  activeTab === tab.key
                    ? 'bg-primary-container text-white'
                    : 'text-on-surface hover:bg-surface-container-low'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-1">
              <Card title="Tạo phiên điểm danh" icon={<Plus className="w-5 h-5" />}>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-secondary uppercase mb-2">
                      Học phần
                    </label>
                    <select
                      value={form.section_id}
                      onChange={(e) => setForm({ ...form, section_id: e.target.value })}
                      className="w-full border border-outline-variant/50 rounded-lg px-4 py-3 text-sm"
                    >
                      <option value="">Chọn học phần</option>
                      {sections.map((section) => (
                        <option key={section.section_id} value={section.section_id}>
                          {section.course_code} - {section.course_name} - {section.class_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-secondary uppercase mb-2">
                      Tên phiên
                    </label>
                    <input
                      type="text"
                      value={form.session_title}
                      onChange={(e) => setForm({ ...form, session_title: e.target.value })}
                      placeholder="VD: Buổi học tuần 3"
                      className="w-full border border-outline-variant/50 rounded-lg px-4 py-3 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-secondary uppercase mb-2">
                      Ngày
                    </label>
                    <input
                      type="date"
                      value={form.session_date}
                      onChange={(e) => setForm({ ...form, session_date: e.target.value })}
                      className="w-full border border-outline-variant/50 rounded-lg px-4 py-3 text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-secondary uppercase mb-2">
                        Bắt đầu
                      </label>
                      <input
                        type="time"
                        value={form.start_time}
                        onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                        className="w-full border border-outline-variant/50 rounded-lg px-4 py-3 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-secondary uppercase mb-2">
                        Kết thúc
                      </label>
                      <input
                        type="time"
                        value={form.end_time}
                        onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                        className="w-full border border-outline-variant/50 rounded-lg px-4 py-3 text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-secondary uppercase mb-2">
                      Cho phép đi muộn (phút)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={form.late_after_minutes}
                      onChange={(e) => setForm({ ...form, late_after_minutes: e.target.value })}
                      className="w-full border border-outline-variant/50 rounded-lg px-4 py-3 text-sm"
                    />
                  </div>

                  <button
                    onClick={handleCreateSession}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-primary-container text-white font-bold hover:opacity-90"
                  >
                    <Plus className="w-4 h-4" />
                    Tạo phiên mới
                  </button>
                </div>
              </Card>
            </div>

            <div className="xl:col-span-2 space-y-6">
              <Card title="Tóm tắt kết quả phiên đang chọn" icon={<Eye className="w-5 h-5" />}>
                {!selectedSessionId ? (
                  <p className="text-secondary text-sm">Chưa có phiên nào được chọn.</p>
                ) : recordsLoading ? (
                  <p className="text-secondary text-sm">Đang tải dữ liệu điểm danh...</p>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard icon={<Clock3 className="w-5 h-5" />} label="Đến sớm" value={attendanceSummary.early} />
                    <StatCard icon={<CheckCircle2 className="w-5 h-5" />} label="Đúng giờ" value={attendanceSummary.on_time} tone="success" />
                    <StatCard icon={<AlertTriangle className="w-5 h-5" />} label="Đi muộn" value={attendanceSummary.late} tone="warning" />
                    <StatCard icon={<XCircle className="w-5 h-5" />} label="Vắng mặt" value={attendanceSummary.absent} tone="danger" />
                  </div>
                )}
              </Card>

              <Card title="Phiên gần đây" icon={<ClipboardList className="w-5 h-5" />}>
                <div className="space-y-3">
                  {sessions.slice(0, 5).map((s) => (
                    <div key={s.session_id} className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border border-outline-variant/20 rounded-xl p-4">
                      <div>
                        <div className="font-bold text-on-surface">
                          {s.session_title || `Phiên #${s.session_id}`}
                        </div>
                        <div className="text-sm text-secondary mt-1">
                          {s.course_name} • {s.class_name}
                        </div>
                        <div className="text-sm text-secondary mt-1">
                          {formatDateTime(s.start_time)}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={sessionStatusClass[s.status] || 'bg-slate-100 text-slate-700'}>
                          {s.status}
                        </Badge>

                        <button
                          onClick={() => handleSelectSession(s.session_id)}
                          className="px-3 py-2 rounded-lg bg-surface-container-low font-semibold"
                        >
                          Xem
                        </button>

                        <button
                          onClick={() => handleExport(s.session_id)}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-outline-variant/30 font-semibold"
                        >
                          <FileDown className="w-4 h-4" />
                          Export
                        </button>
                      </div>
                    </div>
                  ))}

                  {sessions.length === 0 && (
                    <p className="text-secondary text-sm">Chưa có phiên điểm danh nào.</p>
                  )}
                </div>
              </Card>
            </div>
          </div>
        )}

        {activeTab === 'sessions' && (
          <Card
            title="Quản lý phiên điểm danh"
            icon={<ClipboardList className="w-5 h-5" />}
            action={
              <div className="flex flex-wrap gap-2">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
                  <input
                    type="text"
                    placeholder="Tìm theo tên phiên, môn học..."
                    value={sessionKeyword}
                    onChange={(e) => setSessionKeyword(e.target.value)}
                    className="pl-9 pr-3 py-2 rounded-lg border border-outline-variant/50 text-sm"
                  />
                </div>

                <div className="relative">
                  <Filter className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
                  <select
                    value={sessionStatusFilter}
                    onChange={(e) => setSessionStatusFilter(e.target.value)}
                    className="pl-9 pr-8 py-2 rounded-lg border border-outline-variant/50 text-sm"
                  >
                    <option value="all">Tất cả trạng thái</option>
                    <option value="draft">Draft</option>
                    <option value="open">Open</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>
              </div>
            }
          >
            {loading ? (
              <div className="text-secondary text-sm">Đang tải phiên điểm danh...</div>
            ) : filteredSessions.length === 0 ? (
              <div className="text-secondary text-sm">Không có phiên nào phù hợp.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b border-outline-variant/20">
                      <th className="py-3 pr-4">ID</th>
                      <th className="py-3 pr-4">Tên phiên</th>
                      <th className="py-3 pr-4">Môn học</th>
                      <th className="py-3 pr-4">Lớp</th>
                      <th className="py-3 pr-4">Bắt đầu</th>
                      <th className="py-3 pr-4">Muộn sau</th>
                      <th className="py-3 pr-4">Trạng thái</th>
                      <th className="py-3 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSessions.map((s) => (
                      <tr key={s.session_id} className="border-b border-outline-variant/10">
                        <td className="py-3 pr-4 font-bold">#{s.session_id}</td>
                        <td className="py-3 pr-4">{s.session_title || '--'}</td>
                        <td className="py-3 pr-4">{s.course_name || '--'}</td>
                        <td className="py-3 pr-4">{s.class_name || '--'}</td>
                        <td className="py-3 pr-4">{formatDateTime(s.start_time)}</td>
                        <td className="py-3 pr-4">{s.late_after_minutes ?? '--'} phút</td>
                        <td className="py-3 pr-4">
                          <Badge className={sessionStatusClass[s.status] || 'bg-slate-100 text-slate-700'}>
                            {s.status}
                          </Badge>
                        </td>
                        <td className="py-3 text-right">
                          <div className="inline-flex flex-wrap gap-2 justify-end">
                            <button
                              onClick={() => handleSelectSession(s.session_id)}
                              className="px-3 py-2 rounded-lg bg-surface-container-low font-semibold"
                            >
                              Xem kết quả
                            </button>

                            <button
                              onClick={() => handleOpenSession(s.session_id)}
                              disabled={s.status === 'open'}
                              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-50"
                            >
                              <Play className="w-4 h-4" />
                              Mở
                            </button>

                            <button
                              onClick={() => handleCloseSession(s.session_id)}
                              disabled={s.status === 'closed'}
                              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-rose-600 text-white disabled:opacity-50"
                            >
                              <Square className="w-4 h-4" />
                              Đóng
                            </button>

                            <button
                              onClick={() => handleExport(s.session_id)}
                              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-white border border-outline-variant/30 font-semibold"
                            >
                              <FileDown className="w-4 h-4" />
                              Export
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {activeTab === 'records' && (
          <Card
            title="Kết quả điểm danh"
            icon={<CheckCircle2 className="w-5 h-5" />}
            action={
              <select
                value={selectedSessionId}
                onChange={(e) => setSelectedSessionId(e.target.value)}
                className="px-3 py-2 rounded-lg border border-outline-variant/50 text-sm"
              >
                <option value="">Chọn phiên điểm danh</option>
                {sessions.map((s) => (
                  <option key={s.session_id} value={s.session_id}>
                    #{s.session_id} - {s.session_title || 'Phiên điểm danh'}
                  </option>
                ))}
              </select>
            }
          >
            {!selectedSessionId ? (
              <div className="text-secondary text-sm">Hãy chọn một phiên để xem kết quả.</div>
            ) : recordsLoading ? (
              <div className="text-secondary text-sm">Đang tải kết quả điểm danh...</div>
            ) : records.length === 0 ? (
              <div className="text-secondary text-sm">Phiên này chưa có dữ liệu điểm danh.</div>
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatCard icon={<Clock3 className="w-5 h-5" />} label="Đến sớm" value={attendanceSummary.early} />
                  <StatCard icon={<CheckCircle2 className="w-5 h-5" />} label="Đúng giờ" value={attendanceSummary.on_time} tone="success" />
                  <StatCard icon={<AlertTriangle className="w-5 h-5" />} label="Đi muộn" value={attendanceSummary.late} tone="warning" />
                  <StatCard icon={<XCircle className="w-5 h-5" />} label="Vắng mặt" value={attendanceSummary.absent} tone="danger" />
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b border-outline-variant/20">
                        <th className="py-3 pr-4">Mã SV</th>
                        <th className="py-3 pr-4">Họ tên</th>
                        <th className="py-3 pr-4">Lớp</th>
                        <th className="py-3 pr-4">Check-in</th>
                        <th className="py-3 pr-4">Trạng thái</th>
                        <th className="py-3 pr-4">Nhận diện</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r, idx) => (
                        <tr key={`${r.student_code || 'row'}-${idx}`} className="border-b border-outline-variant/10">
                          <td className="py-3 pr-4 font-semibold">{r.student_code || '--'}</td>
                          <td className="py-3 pr-4">{r.student_name || '--'}</td>
                          <td className="py-3 pr-4">{r.class_name || r.class_code || '--'}</td>
                          <td className="py-3 pr-4">{formatDateTime(r.checkin_time)}</td>
                          <td className="py-3 pr-4">
                            <Badge className={attendanceStatusClass[r.attendance_status] || 'bg-slate-100 text-slate-700'}>
                              {r.attendance_status}
                            </Badge>
                          </td>
                          <td className="py-3 pr-4">{r.recognition_status || '--'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={() => handleExport(selectedSessionId)}
                    className="inline-flex items-center gap-2 px-4 py-3 rounded-lg bg-primary-container text-white font-bold hover:opacity-90"
                  >
                    <FileDown className="w-4 h-4" />
                    Export CSV
                  </button>
                </div>
              </div>
            )}
          </Card>
        )}

        {activeTab === 'students' && (
          <Card
            title="Danh sách sinh viên"
            icon={<Users className="w-5 h-5" />}
            action={
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
                <input
                  type="text"
                  placeholder="Tìm theo mã, tên, lớp, email..."
                  value={studentKeyword}
                  onChange={(e) => setStudentKeyword(e.target.value)}
                  className="pl-9 pr-3 py-2 rounded-lg border border-outline-variant/50 text-sm w-72 max-w-full"
                />
              </div>
            }
          >
            {loading ? (
              <div className="text-secondary text-sm">Đang tải dữ liệu sinh viên...</div>
            ) : filteredStudents.length === 0 ? (
              <div className="text-secondary text-sm">Không có sinh viên phù hợp.</div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {filteredStudents.map((s) => (
                  <div key={s.student_code} className="rounded-2xl border border-outline-variant/20 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-lg font-bold text-on-surface">{s.full_name}</div>
                        <div className="text-sm text-secondary mt-1">{s.student_code}</div>
                        <div className="text-sm text-secondary">{s.class_name || 'Chưa có lớp'}</div>
                        <div className="text-sm text-secondary">{s.email || 'Chưa có email'}</div>
                        <div className="text-sm text-secondary mt-1">Đăng ký học phần: {s.enrolled_section_count || 0}</div>
                        {s.enrolled_courses_summary && (
                          <div className="text-xs text-secondary mt-1 line-clamp-3">{s.enrolled_courses_summary}</div>
                        )}
                      </div>

                      <Badge className={(s.has_face_profile || s.image_path) ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}>
                        {(s.has_face_profile || s.image_path) ? 'Đã có face' : 'Chưa có face'}
                      </Badge>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link
                        to="/profile"
                        className="px-3 py-2 rounded-lg bg-surface-container-low font-semibold"
                      >
                        Cập nhật profile
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    </main>
  );
}
