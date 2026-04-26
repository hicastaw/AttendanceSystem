import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import {
  LayoutDashboard,
  Users,
  ClipboardList,
  Play,
  Square,
  RefreshCw,
  Search,
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
  User,
  Mail,
  Save,
  X,
  UserPlus,
  Layers,
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
  submitted: 'bg-violet-100 text-violet-700',
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
  const { actor, isAdmin, isLecturer } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const [students, setStudents] = useState([]);
  const [sections, setSections] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [records, setRecords] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [overrideForm, setOverrideForm] = useState({
    record_id: '',
    student_code: '',
    student_name: '',
    attendance_status: 'on_time',
    note: '',
  });

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

  // ── Lecturer profile modal ─────────────────────────────────────────────────
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [modalTab, setModalTab] = useState('profile'); // 'profile' | 'my-sections' | 'register'
  const [lecturerList, setLecturerList] = useState([]);
  const [lecturerCode, setLecturerCode] = useState('');
  const [lecturerInfo, setLecturerInfo] = useState(null);
  const [lecturerForm, setLecturerForm] = useState({ full_name: '', email: '' });
  const [lecturerSaving, setLecturerSaving] = useState(false);
  const [lecturerLoading, setLecturerLoading] = useState(false);
  const [lecturerFound, setLecturerFound] = useState(false);
  const lecturerCodeRef = useRef(null);
  // sections state
  const [mySections, setMySections] = useState([]);
  const [mySectionsLoading, setMySectionsLoading] = useState(false);
  const [availableSections, setAvailableSections] = useState([]);
  const [availLoading, setAvailLoading] = useState(false);
  const [availSearch, setAvailSearch] = useState('');
  const [availFilter, setAvailFilter] = useState('all'); // 'all' | 'mine' | 'other'
  const [registeringId, setRegisteringId] = useState(null);

  // ── Notifications ─────────────────────────────────────────────────────────
  const notify = (text, type = 'success') => {
    setMessage({ text, type });
    window.clearTimeout(window.__teacher_msg_timer__);
    window.__teacher_msg_timer__ = window.setTimeout(() => {
      setMessage(null);
    }, 3000);
  };

  // ── Data fetching ─────────────────────────────────────────────────────────
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
    if (!sessionId) { setRecords([]); return; }
    setRecordsLoading(true);
    try {
      const res = await api.get(`/attendance/sessions/${sessionId}/records`);
      setRecords(res.data?.data || []);
    } catch {
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
    } catch {
      notify('Không tải được dữ liệu dashboard', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);
  useEffect(() => { if (selectedSessionId) fetchRecords(selectedSessionId); }, [selectedSessionId]);
  useEffect(() => {
    if (isLecturer && actor.lecturerCode) {
      setLecturerCode(actor.lecturerCode);
    }
  }, [actor.lecturerCode, isLecturer]);

  useEffect(() => {
    if (showProfileModal && isLecturer && lecturerCode && !lecturerFound) {
      handleLecturerSearch();
    }
  }, [showProfileModal, isLecturer, lecturerCode]);

  // ── Lecturer profile handlers ──────────────────────────────────────────────
  const fetchLecturerList = async () => {
    try {
      const res = await api.get('/lecturers');
      setLecturerList(res.data?.data || []);
    } catch {}
  };

  const openProfileModal = () => {
    setLecturerCode(isLecturer ? actor.lecturerCode : '');
    setLecturerForm({ full_name: '', email: '' });
    setLecturerInfo(null);
    setLecturerFound(false);
    setModalTab('profile');
    setMySections([]);
    setAvailableSections([]);
    setAvailSearch('');
    setAvailFilter('all');
    setShowProfileModal(true);
    if (isAdmin) fetchLecturerList();
    setTimeout(() => lecturerCodeRef.current?.focus(), 100);
  };

  const handleLecturerSearch = async () => {
    if (!lecturerCode.trim()) return;
    setLecturerLoading(true);
    setLecturerFound(false);
    setMySections([]);
    setAvailableSections([]);
    try {
      const res = await api.get(`/lecturers/${lecturerCode.trim().toUpperCase()}`);
      const d = res.data.data;
      setLecturerInfo(d);
      setLecturerForm({ full_name: d.full_name || '', email: d.email || '' });
      setLecturerFound(true);
    } catch (err) {
      const msg = err.response?.status === 404
        ? 'Không tìm thấy giáo viên với mã này'
        : 'Lỗi kết nối server';
      notify(msg, 'error');
    } finally {
      setLecturerLoading(false);
    }
  };

  const fetchMySections = async () => {
    if (!lecturerCode.trim()) return;
    setMySectionsLoading(true);
    try {
      const res = await api.get(`/lecturers/${lecturerCode.trim().toUpperCase()}/sections`);
      setMySections(res.data?.data || []);
    } catch {
      notify('Không tải được danh sách học phần', 'error');
    } finally {
      setMySectionsLoading(false);
    }
  };

  const fetchAvailableSections = async () => {
    if (!lecturerCode.trim()) return;
    setAvailLoading(true);
    try {
      const res = await api.get(`/lecturers/${lecturerCode.trim().toUpperCase()}/available-sections`);
      setAvailableSections(res.data?.data || []);
    } catch {
      notify('Không tải được danh sách học phần', 'error');
    } finally {
      setAvailLoading(false);
    }
  };

  const handleModalTabChange = (tab) => {
    setModalTab(tab);
    if (tab === 'my-sections' && mySections.length === 0) fetchMySections();
    if (tab === 'register' && availableSections.length === 0) fetchAvailableSections();
  };

  const handleRegisterSection = async (sectionId) => {
    if (!lecturerCode.trim()) return;
    setRegisteringId(sectionId);
    try {
      const res = await api.post(`/lecturers/${lecturerCode.trim().toUpperCase()}/sections`, { section_id: sectionId });
      notify(res.data?.message || 'Đã đăng ký giảng dạy!');
      await Promise.all([fetchMySections(), fetchAvailableSections()]);
    } catch (err) {
      notify(err.response?.data?.message || 'Lỗi khi đăng ký', 'error');
    } finally {
      setRegisteringId(null);
    }
  };

  const handleLecturerSave = async () => {
    if (!lecturerForm.full_name.trim()) {
      notify('Họ tên không được để trống', 'error');
      return;
    }
    setLecturerSaving(true);
    try {
      await api.put(`/lecturers/${lecturerCode.trim().toUpperCase()}`, lecturerForm);
      notify('Cập nhật profile giáo viên thành công!');
      setLecturerInfo((prev) => prev ? { ...prev, ...lecturerForm } : prev);
    } catch (err) {
      notify(err.response?.data?.message || 'Lỗi khi cập nhật', 'error');
    } finally {
      setLecturerSaving(false);
    }
  };

  // ── Session handlers ───────────────────────────────────────────────────────
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
      setForm((prev) => ({ ...prev, session_title: '' }));
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
      if (String(selectedSessionId) === String(id)) await fetchRecords(id);
    } catch (err) {
      notify(err.response?.data?.message || 'Không thể mở phiên', 'error');
    }
  };

  const handleCloseSession = async (id) => {
    try {
      await api.put(`/attendance/sessions/${id}/close`);
      notify('Đã đóng phiên điểm danh');
      await fetchSessions();
      if (String(selectedSessionId) === String(id)) await fetchRecords(id);
    } catch (err) {
      notify(err.response?.data?.message || 'Không thể đóng phiên', 'error');
    }
  };

  const handleSubmitSession = async (id) => {
    try {
      await api.put(`/attendance/sessions/${id}/submit`);
      notify('Đã chốt phiên điểm danh');
      await fetchSessions();
      if (String(selectedSessionId) === String(id)) await fetchRecords(id);
    } catch (err) {
      notify(err.response?.data?.message || 'Không thể chốt phiên', 'error');
    }
  };

  const handleSelectSession = (id) => {
    setSelectedSessionId(String(id));
    setActiveTab('records');
  };

  const handleExport = async (id) => {
    try {
      const res = await api.get(`/attendance/sessions/${id}/export`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `attendance_session_${id}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      notify('Đã export báo cáo điểm danh');
    } catch {
      notify('Không thể export báo cáo', 'error');
    }
  };

  const openOverrideModal = (record) => {
    setOverrideForm({
      record_id: record.record_id,
      student_code: record.student_code || '',
      student_name: record.student_name || '',
      attendance_status: record.attendance_status || 'on_time',
      note: record.note || '',
    });
    setShowOverrideModal(true);
  };

  const closeOverrideModal = () => {
    if (overrideSaving) return;
    setShowOverrideModal(false);
  };

  const handleSaveOverride = async () => {
    if (!selectedSessionId || !overrideForm.record_id) return;
    setOverrideSaving(true);
    try {
      await api.put(
        `/attendance/sessions/${selectedSessionId}/records/${overrideForm.record_id}/manual-override`,
        {
          attendance_status: overrideForm.attendance_status,
          note: overrideForm.note,
        }
      );
      notify('Đã cập nhật điểm danh thủ công');
      setShowOverrideModal(false);
      await fetchRecords(selectedSessionId);
    } catch (err) {
      notify(err.response?.data?.message || 'Không thể cập nhật điểm danh thủ công', 'error');
    } finally {
      setOverrideSaving(false);
    }
  };

  const handleClearOverride = async (record) => {
    if (!selectedSessionId || !record?.record_id) return;
    setOverrideSaving(true);
    try {
      await api.delete(`/attendance/sessions/${selectedSessionId}/records/${record.record_id}/manual-override`);
      notify('Đã bỏ manual override');
      await fetchRecords(selectedSessionId);
    } catch (err) {
      notify(err.response?.data?.message || 'Không thể bỏ manual override', 'error');
    } finally {
      setOverrideSaving(false);
    }
  };

  // ── Computed ────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    totalStudents: students.length,
    totalSections: sections.length,
    totalSessions: sessions.length,
    openSessions: sessions.filter((s) => s.status === 'open').length,
    faceReady: students.filter((s) => s.has_face_profile || s.image_path).length,
    noFace: students.length - students.filter((s) => s.has_face_profile || s.image_path).length,
  }), [students, sections, sessions]);

  const filteredStudents = useMemo(() => {
    const kw = studentKeyword.trim().toLowerCase();
    if (!kw) return students;
    return students.filter((s) =>
      [s.student_code, s.full_name, s.class_name, s.email, s.enrolled_courses_summary]
        .filter(Boolean).join(' ').toLowerCase().includes(kw)
    );
  }, [students, studentKeyword]);

  const filteredSessions = useMemo(() => {
    const kw = sessionKeyword.trim().toLowerCase();
    return sessions.filter((s) => {
      const matchKw = !kw || [s.session_title, s.course_name, s.class_name, s.status]
        .filter(Boolean).join(' ').toLowerCase().includes(kw);
      const matchStatus = sessionStatusFilter === 'all' || s.status === sessionStatusFilter;
      return matchKw && matchStatus;
    });
  }, [sessions, sessionKeyword, sessionStatusFilter]);

  const attendanceSummary = useMemo(() => ({
    early: records.filter((r) => r.attendance_status === 'early').length,
    on_time: records.filter((r) => r.attendance_status === 'on_time').length,
    late: records.filter((r) => r.attendance_status === 'late').length,
    absent: records.filter((r) => r.attendance_status === 'absent').length,
  }), [records]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <main className="flex-grow bg-surface py-10 px-4 md:px-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {message && (
          <div className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
            message.type === 'error'
              ? 'bg-rose-50 text-rose-700 border-rose-200'
              : 'bg-emerald-50 text-emerald-700 border-emerald-200'
          }`}>
            {message.text}
          </div>
        )}

        {/* ── Header ────────────────────────────────────────────────────── */}
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
              Quản lý học phần, phiên điểm danh, xem kết quả và cập nhật thông tin giáo viên từ một màn hình duy nhất.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={openProfileModal}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-lg bg-white border border-outline-variant/30 font-bold hover:bg-surface-container-low"
            >
              <User className="w-4 h-4" />
              {isAdmin ? 'Quản lý giáo viên' : 'Hồ sơ giảng viên'}
            </button>
            <button
              onClick={fetchAll}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-lg bg-white border border-outline-variant/30 font-bold hover:bg-surface-container-low"
            >
              <RefreshCw className="w-4 h-4" />
              Làm mới
            </button>
          </div>
        </div>

        {/* ── Lecturer Management Modal ────────────────────────────────── */}
        {showProfileModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col" style={{ maxHeight: '90vh' }}>

              {/* Modal header */}
              <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-outline-variant/20 shrink-0">
                <div>
                  <h2 className="text-lg font-black text-on-surface">Quản lý giáo viên</h2>
                  {lecturerInfo && (
                    <p className="text-sm text-secondary mt-0.5">{lecturerInfo.lecturer_code} — {lecturerInfo.full_name}</p>
                  )}
                </div>
                <button onClick={() => setShowProfileModal(false)} className="text-secondary hover:text-on-surface p-1">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Lecturer picker */}
              <div className="px-6 py-4 bg-surface-container-low/50 border-b border-outline-variant/20 shrink-0">
                <div className="flex gap-2">
                  <select
                    disabled={!isAdmin}
                    className="flex-1 border border-outline-variant/50 rounded-lg px-3 py-2.5 text-sm bg-white"
                    value={lecturerCode}
                    onChange={(e) => {
                      setLecturerCode(e.target.value);
                      setLecturerFound(false);
                      setLecturerInfo(null);
                      setLecturerForm({ full_name: '', email: '' });
                      setMySections([]);
                      setAvailableSections([]);
                    }}
                  >
                    <option value="">-- Chọn giáo viên --</option>
                    {lecturerList.map((l) => (
                      <option key={l.lecturer_id} value={l.lecturer_code}>
                        {l.lecturer_code} — {l.full_name}
                      </option>
                    ))}
                  </select>
                  <input
                    ref={lecturerCodeRef}
                    disabled={!isAdmin}
                    type="text"
                    placeholder="Mã GV (VD: GV001)"
                    value={lecturerCode}
                    onChange={(e) => {
                      setLecturerCode(e.target.value.toUpperCase());
                      setLecturerFound(false);
                      setLecturerInfo(null);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handleLecturerSearch()}
                    className="w-36 border border-outline-variant/50 rounded-lg px-3 py-2.5 text-sm"
                  />
                  <button
                    onClick={handleLecturerSearch}
                    disabled={(!isAdmin && isLecturer) || lecturerLoading || !lecturerCode.trim()}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-primary-container text-white font-bold text-sm disabled:opacity-50 shrink-0"
                  >
                    {lecturerLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    Tìm
                  </button>
                </div>
              </div>

              {!lecturerFound ? (
                <div className="px-6 py-10 text-center text-secondary text-sm">
                  {isAdmin ? 'Chọn hoặc nhập mã giáo viên rồi nhấn ' : 'Đang mở hồ sơ theo quyền giảng viên hiện tại. '}<strong>{isAdmin ? 'Tìm' : actor.lecturerCode || 'GV'}</strong>{isAdmin ? ' để bắt đầu.' : ''}
                </div>
              ) : (
                <>
                  {/* Tab bar */}
                  <div className="flex gap-1 px-6 pt-4 shrink-0 border-b border-outline-variant/10 pb-3">
                    {[
                      { key: 'profile', label: 'Profile', icon: <User className="w-4 h-4" /> },
                      { key: 'my-sections', label: 'Lớp đang dạy', icon: <BookOpen className="w-4 h-4" /> },
                      { key: 'register', label: 'Đăng ký giảng dạy', icon: <UserPlus className="w-4 h-4" /> },
                    ].map((t) => (
                      <button
                        key={t.key}
                        onClick={() => handleModalTabChange(t.key)}
                        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold transition ${
                          modalTab === t.key
                            ? 'bg-primary-container text-white'
                            : 'text-secondary hover:bg-surface-container-low'
                        }`}
                      >
                        {t.icon}{t.label}
                      </button>
                    ))}
                  </div>

                  {/* Scrollable tab content */}
                  <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">

                    {/* TAB: Profile */}
                    {modalTab === 'profile' && (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs font-bold text-secondary uppercase mb-2">Họ và tên *</label>
                          <div className="relative">
                            <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
                            <input
                              type="text"
                              value={lecturerForm.full_name}
                              onChange={(e) => setLecturerForm((p) => ({ ...p, full_name: e.target.value }))}
                              className="w-full border border-outline-variant/50 rounded-lg pl-10 pr-4 py-3 text-sm"
                              placeholder="VD: Nguyễn Văn An"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-secondary uppercase mb-2">Email</label>
                          <div className="relative">
                            <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
                            <input
                              type="email"
                              value={lecturerForm.email}
                              onChange={(e) => setLecturerForm((p) => ({ ...p, email: e.target.value }))}
                              className="w-full border border-outline-variant/50 rounded-lg pl-10 pr-4 py-3 text-sm"
                              placeholder="VD: an.nguyen@university.edu.vn"
                            />
                          </div>
                        </div>
                        <div className="flex gap-3 pt-2">
                          <button
                            onClick={() => setShowProfileModal(false)}
                            className="flex-1 py-3 rounded-lg border border-outline-variant/50 font-semibold text-secondary hover:bg-surface-container-low text-sm"
                          >
                            Đóng
                          </button>
                          <button
                            onClick={handleLecturerSave}
                            disabled={lecturerSaving}
                            className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-lg bg-primary-container text-white font-bold text-sm disabled:opacity-50"
                          >
                            {lecturerSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {lecturerSaving ? 'Đang lưu...' : 'Lưu profile'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* TAB: My Sections */}
                    {modalTab === 'my-sections' && (
                      <div>
                        <div className="flex items-center justify-between mb-4">
                          <p className="text-sm text-secondary">
                            Các học phần <span className="font-bold text-on-surface">{lecturerInfo?.full_name}</span> đang phụ trách
                          </p>
                          <button onClick={fetchMySections} className="inline-flex items-center gap-1 text-xs text-secondary hover:text-on-surface">
                            <RefreshCw className="w-3.5 h-3.5" /> Làm mới
                          </button>
                        </div>

                        {mySectionsLoading ? (
                          <div className="text-secondary text-sm text-center py-8">Đang tải...</div>
                        ) : mySections.length === 0 ? (
                          <div className="text-center py-10 text-secondary text-sm">
                            <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
                            <p>Giáo viên này chưa phụ trách học phần nào.</p>
                            <p className="mt-1 text-xs">Chuyển sang tab <strong>Đăng ký giảng dạy</strong> để thêm học phần.</p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {mySections.map((s) => (
                              <div key={s.section_id} className="rounded-xl border border-outline-variant/20 bg-white p-4 hover:border-primary-container/40 transition">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="font-bold text-on-surface">{s.course_code} — {s.course_name}</div>
                                    <div className="text-sm text-secondary mt-1">
                                      Lớp: <span className="font-semibold">{s.class_name}</span>
                                      {s.schedule_note && <span className="ml-2 text-xs text-secondary">({s.schedule_note})</span>}
                                    </div>
                                  </div>
                                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                                    <span className="inline-flex items-center gap-1 text-xs font-bold bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full">
                                      <Users className="w-3 h-3" />{s.enrolled_count} SV
                                    </span>
                                    <span className="text-xs text-secondary">{s.session_count} phiên</span>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* TAB: Register */}
                    {modalTab === 'register' && (
                      <div>
                        {/* Filter bar */}
                        <div className="flex flex-wrap gap-2 mb-4">
                          <div className="relative flex-1 min-w-40">
                            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
                            <input
                              type="text"
                              placeholder="Tìm môn học, lớp..."
                              value={availSearch}
                              onChange={(e) => setAvailSearch(e.target.value)}
                              className="w-full border border-outline-variant/50 rounded-lg pl-8 pr-3 py-2 text-sm"
                            />
                          </div>
                          <select
                    disabled={!isAdmin}
                            value={availFilter}
                            onChange={(e) => setAvailFilter(e.target.value)}
                            className="border border-outline-variant/50 rounded-lg px-3 py-2 text-sm"
                          >
                            <option value="all">Tất cả học phần</option>
                            <option value="mine">Đang dạy</option>
                            <option value="other">Của GV khác</option>
                          </select>
                          <button
                            onClick={fetchAvailableSections}
                            className="inline-flex items-center gap-1 text-xs px-3 py-2 border border-outline-variant/50 rounded-lg text-secondary hover:bg-surface-container-low"
                          >
                            <RefreshCw className="w-3.5 h-3.5" /> Làm mới
                          </button>
                        </div>

                        {availLoading ? (
                          <div className="text-secondary text-sm text-center py-8">Đang tải...</div>
                        ) : (() => {
                          const kw = availSearch.trim().toLowerCase();
                          const filtered = availableSections.filter((s) => {
                            const matchKw = !kw || `${s.course_code} ${s.course_name} ${s.class_name} ${s.class_code}`.toLowerCase().includes(kw);
                            const matchFilter = availFilter === 'all' ? true : availFilter === 'mine' ? s.is_mine : !s.is_mine;
                            return matchKw && matchFilter;
                          });

                          if (filtered.length === 0) return (
                            <div className="text-center py-10 text-secondary text-sm">
                              <Layers className="w-10 h-10 mx-auto mb-3 opacity-30" />
                              Không có học phần nào phù hợp.
                            </div>
                          );

                          return (
                            <div className="space-y-2">
                              {filtered.map((s) => (
                                <div
                                  key={s.section_id}
                                  className={`rounded-xl border p-3.5 flex items-center justify-between gap-3 transition ${
                                    s.is_mine
                                      ? 'border-emerald-200 bg-emerald-50'
                                      : 'border-outline-variant/20 hover:border-outline-variant/50 bg-white'
                                  }`}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="font-bold text-on-surface text-sm">{s.course_code} — {s.course_name}</div>
                                    <div className="text-xs text-secondary mt-0.5">
                                      Lớp: <span className="font-semibold">{s.class_name}</span>
                                      {s.schedule_note && <span className="ml-1.5">({s.schedule_note})</span>}
                                    </div>
                                    {!s.is_mine && (
                                      <div className="text-xs text-secondary mt-0.5">
                                        GV hiện tại: <span className="font-semibold">{s.current_lecturer_name}</span>
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span className="text-xs text-secondary">{s.enrolled_count} SV</span>
                                    {s.is_mine ? (
                                      <span className="inline-flex items-center gap-1 text-xs font-bold bg-emerald-100 text-emerald-700 px-2.5 py-1.5 rounded-lg">
                                        <CheckCircle2 className="w-3.5 h-3.5" />Đang dạy
                                      </span>
                                    ) : (
                                      <button
                                        onClick={() => handleRegisterSection(s.section_id)}
                                        disabled={registeringId === s.section_id}
                                        className="inline-flex items-center gap-1 text-xs font-bold bg-primary-container text-white px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50"
                                      >
                                        {registeringId === s.section_id
                                          ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                          : <UserPlus className="w-3.5 h-3.5" />
                                        }
                                        Đăng ký
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    )}

                  </div>{/* end scrollable */}
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Stats ─────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 xl:grid-cols-6 gap-4">
          <StatCard icon={<Users className="w-6 h-6" />} label="Tổng sinh viên" value={stats.totalStudents} />
          <StatCard icon={<BookOpen className="w-6 h-6" />} label="Tổng học phần" value={stats.totalSections} />
          <StatCard icon={<ClipboardList className="w-6 h-6" />} label="Tổng phiên" value={stats.totalSessions} />
          <StatCard icon={<Play className="w-6 h-6" />} label="Phiên đang mở" value={stats.openSessions} tone="success" />
          <StatCard icon={<CheckCircle2 className="w-6 h-6" />} label="Đã có face profile" value={stats.faceReady} tone="success" />
          <StatCard icon={<AlertTriangle className="w-6 h-6" />} label="Chưa có face profile" value={stats.noFace} tone="warning" />
        </div>

        {/* ── Tab nav ────────────────────────────────────────────────────── */}
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

        {/* ── Tab: Overview ─────────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-1">
              <Card title="Tạo phiên điểm danh" icon={<Plus className="w-5 h-5" />}>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-secondary uppercase mb-2">Học phần</label>
                    <select
                    disabled={!isAdmin}
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
                    <label className="block text-xs font-bold text-secondary uppercase mb-2">Tên phiên</label>
                    <input
                      type="text"
                      value={form.session_title}
                      onChange={(e) => setForm({ ...form, session_title: e.target.value })}
                      placeholder="VD: Buổi học tuần 3"
                      className="w-full border border-outline-variant/50 rounded-lg px-4 py-3 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-secondary uppercase mb-2">Ngày</label>
                    <input
                      type="date"
                      value={form.session_date}
                      onChange={(e) => setForm({ ...form, session_date: e.target.value })}
                      className="w-full border border-outline-variant/50 rounded-lg px-4 py-3 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-secondary uppercase mb-2">Bắt đầu</label>
                      <input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} className="w-full border border-outline-variant/50 rounded-lg px-4 py-3 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-secondary uppercase mb-2">Kết thúc</label>
                      <input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} className="w-full border border-outline-variant/50 rounded-lg px-4 py-3 text-sm" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-secondary uppercase mb-2">Cho phép đi muộn (phút)</label>
                    <input type="number" min="0" value={form.late_after_minutes} onChange={(e) => setForm({ ...form, late_after_minutes: e.target.value })} className="w-full border border-outline-variant/50 rounded-lg px-4 py-3 text-sm" />
                  </div>
                  <button onClick={handleCreateSession} className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-primary-container text-white font-bold hover:opacity-90">
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
                        <div className="font-bold text-on-surface">{s.session_title || `Phiên #${s.session_id}`}</div>
                        <div className="text-sm text-secondary mt-1">{s.course_name} • {s.class_name}</div>
                        <div className="text-sm text-secondary mt-1">{formatDateTime(s.start_time)}</div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={sessionStatusClass[s.status] || 'bg-slate-100 text-slate-700'}>{s.status}</Badge>
                        <button onClick={() => handleSelectSession(s.session_id)} className="px-3 py-2 rounded-lg bg-surface-container-low font-semibold">Xem</button>
                        <button onClick={() => handleExport(s.session_id)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-outline-variant/30 font-semibold">
                          <FileDown className="w-4 h-4" />Export
                        </button>
                      </div>
                    </div>
                  ))}
                  {sessions.length === 0 && <p className="text-secondary text-sm">Chưa có phiên điểm danh nào.</p>}
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* ── Tab: Sessions ─────────────────────────────────────────────── */}
        {activeTab === 'sessions' && (
          <Card
            title="Quản lý phiên điểm danh"
            icon={<ClipboardList className="w-5 h-5" />}
            action={
              <div className="flex flex-wrap gap-2">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
                  <input type="text" placeholder="Tìm theo tên phiên, môn học..." value={sessionKeyword} onChange={(e) => setSessionKeyword(e.target.value)} className="pl-9 pr-3 py-2 rounded-lg border border-outline-variant/50 text-sm" />
                </div>
                <div className="relative">
                  <Filter className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
                  <select value={sessionStatusFilter} onChange={(e) => setSessionStatusFilter(e.target.value)} className="pl-9 pr-8 py-2 rounded-lg border border-outline-variant/50 text-sm">
                    <option value="all">Tất cả trạng thái</option>
                    <option value="draft">Draft</option>
                    <option value="open">Open</option>
                    <option value="closed">Closed</option>
                    <option value="submitted">Submitted</option>
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
                          <Badge className={sessionStatusClass[s.status] || 'bg-slate-100 text-slate-700'}>{s.status}</Badge>
                        </td>
                        <td className="py-3 text-right">
                          <div className="inline-flex flex-wrap gap-2 justify-end">
                            <button onClick={() => handleSelectSession(s.session_id)} className="px-3 py-2 rounded-lg bg-surface-container-low font-semibold">Xem kết quả</button>
                            <button onClick={() => handleOpenSession(s.session_id)} disabled={s.status === 'open'} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-50">
                              <Play className="w-4 h-4" />Mở
                            </button>
                            <button onClick={() => handleCloseSession(s.session_id)} disabled={s.status === 'closed' || s.status === 'submitted'} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-rose-600 text-white disabled:opacity-50">
                              <Square className="w-4 h-4" />Đóng
                            </button>
                            <button onClick={() => handleSubmitSession(s.session_id)} disabled={s.status === 'submitted' || s.status === 'draft'} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-violet-600 text-white disabled:opacity-50">
                              <CheckCircle2 className="w-4 h-4" />Chốt
                            </button>
                            <button onClick={() => handleExport(s.session_id)} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-white border border-outline-variant/30 font-semibold">
                              <FileDown className="w-4 h-4" />Export
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

        {/* ── Tab: Records ──────────────────────────────────────────────── */}
        {activeTab === 'records' && (
          <Card
            title="Kết quả điểm danh"
            icon={<CheckCircle2 className="w-5 h-5" />}
            action={
              <select value={selectedSessionId} onChange={(e) => setSelectedSessionId(e.target.value)} className="px-3 py-2 rounded-lg border border-outline-variant/50 text-sm">
                <option value="">Chọn phiên điểm danh</option>
                {sessions.map((s) => (
                  <option key={s.session_id} value={s.session_id}>#{s.session_id} - {s.session_title || 'Phiên điểm danh'}</option>
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
                        <th className="py-3 pr-4">Ghi chú</th>
                        <th className="py-3 pr-4 text-right">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r, idx) => (
                        <tr key={`${r.student_code || 'row'}-${idx}`} className="border-b border-outline-variant/10 align-top">
                          <td className="py-3 pr-4 font-semibold">{r.student_code || '--'}</td>
                          <td className="py-3 pr-4">{r.student_name || '--'}</td>
                          <td className="py-3 pr-4">{r.class_name || r.class_code || '--'}</td>
                          <td className="py-3 pr-4">{formatDateTime(r.checkin_time)}</td>
                          <td className="py-3 pr-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge className={attendanceStatusClass[r.attendance_status] || 'bg-slate-100 text-slate-700'}>{r.attendance_status}</Badge>
                              {r.is_manual_override && (
                                <Badge className="bg-violet-100 text-violet-700">manual</Badge>
                              )}
                            </div>
                          </td>
                          <td className="py-3 pr-4">
                            <div>{r.recognition_status || '--'}</div>
                            {typeof r.confidence_score === 'number' && (
                              <div className="text-xs text-secondary mt-1">Độ tin cậy: {r.confidence_score}%</div>
                            )}
                          </td>
                          <td className="py-3 pr-4 max-w-56 text-secondary text-xs">{r.note || '--'}</td>
                          <td className="py-3 pr-4">
                            <div className="flex flex-wrap justify-end gap-2">
                              <button
                                onClick={() => openOverrideModal(r)}
                                className="px-3 py-2 rounded-lg bg-surface-container-low font-semibold"
                              >
                                Chỉnh tay
                              </button>
                              {r.is_manual_override && (
                                <button
                                  onClick={() => handleClearOverride(r)}
                                  disabled={overrideSaving}
                                  className="px-3 py-2 rounded-lg border border-outline-variant/40 font-semibold disabled:opacity-50"
                                >
                                  Bỏ override
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end">
                  <button onClick={() => handleExport(selectedSessionId)} className="inline-flex items-center gap-2 px-4 py-3 rounded-lg bg-primary-container text-white font-bold hover:opacity-90">
                    <FileDown className="w-4 h-4" />Export CSV
                  </button>
                </div>
              </div>
            )}
          </Card>
        )}

        {/* ── Tab: Students ─────────────────────────────────────────────── */}
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
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}


        {showOverrideModal && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-outline-variant/30 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/20">
                <div>
                  <h3 className="text-lg font-black text-on-surface">Chỉnh điểm danh thủ công</h3>
                  <p className="text-sm text-secondary mt-1">{overrideForm.student_name} • {overrideForm.student_code}</p>
                </div>
                <button onClick={closeOverrideModal} className="w-9 h-9 rounded-full hover:bg-surface-container-low flex items-center justify-center">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-secondary uppercase mb-2">Trạng thái điểm danh</label>
                  <select
                    disabled={!isAdmin}
                    value={overrideForm.attendance_status}
                    onChange={(e) => setOverrideForm((prev) => ({ ...prev, attendance_status: e.target.value }))}
                    className="w-full border border-outline-variant/50 rounded-lg px-4 py-3 text-sm"
                  >
                    <option value="early">Đến sớm</option>
                    <option value="on_time">Đúng giờ</option>
                    <option value="late">Đi muộn</option>
                    <option value="absent">Vắng mặt</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-secondary uppercase mb-2">Ghi chú</label>
                  <textarea
                    rows="4"
                    value={overrideForm.note}
                    onChange={(e) => setOverrideForm((prev) => ({ ...prev, note: e.target.value }))}
                    placeholder="VD: Sinh viên có mặt nhưng camera nhận diện lỗi"
                    className="w-full border border-outline-variant/50 rounded-lg px-4 py-3 text-sm resize-none"
                  />
                </div>
              </div>

              <div className="px-5 py-4 border-t border-outline-variant/20 flex flex-wrap gap-3 justify-end bg-surface-container-low/40">
                <button onClick={closeOverrideModal} className="px-4 py-2.5 rounded-lg border border-outline-variant/40 font-semibold">
                  Hủy
                </button>
                <button
                  onClick={handleSaveOverride}
                  disabled={overrideSaving}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-container text-white font-bold disabled:opacity-50"
                >
                  {overrideSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {overrideSaving ? 'Đang lưu...' : 'Lưu chỉnh sửa'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
