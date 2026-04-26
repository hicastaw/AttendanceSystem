import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import {
  Camera,
  CameraOff,
  RefreshCw,
  Search,
  CheckCircle2,
  XCircle,
  Clock3,
  AlertTriangle,
  UserCheck,
  BookOpen,
  School,
  ScanFace,
  Play,
  Square,
} from 'lucide-react';

const STATUS_CONFIG = {
  on_time: {
    label: 'Đúng giờ',
    badge: 'bg-emerald-100 text-emerald-700',
    icon: <CheckCircle2 className="w-4 h-4" />,
  },
  early: {
    label: 'Đến sớm',
    badge: 'bg-sky-100 text-sky-700',
    icon: <Clock3 className="w-4 h-4" />,
  },
  late: {
    label: 'Đi muộn',
    badge: 'bg-amber-100 text-amber-700',
    icon: <AlertTriangle className="w-4 h-4" />,
  },
  absent: {
    label: 'Vắng',
    badge: 'bg-rose-100 text-rose-700',
    icon: <XCircle className="w-4 h-4" />,
  },
  low_confidence: {
    label: 'Độ tin cậy thấp',
    badge: 'bg-orange-100 text-orange-700',
    icon: <AlertTriangle className="w-4 h-4" />,
  },
  blurry_rejected: {
    label: 'Ảnh mờ',
    badge: 'bg-slate-100 text-slate-700',
    icon: <AlertTriangle className="w-4 h-4" />,
  },
  no_face: {
    label: 'Không thấy khuôn mặt',
    badge: 'bg-slate-100 text-slate-700',
    icon: <CameraOff className="w-4 h-4" />,
  },
  not_found: {
    label: 'Không hợp lệ',
    badge: 'bg-rose-100 text-rose-700',
    icon: <XCircle className="w-4 h-4" />,
  },
  success: {
    label: 'Điểm danh thành công',
    badge: 'bg-emerald-100 text-emerald-700',
    icon: <CheckCircle2 className="w-4 h-4" />,
  },
};

function formatDateTime(value) {
  if (!value) return '--';
  return new Date(value).toLocaleString('vi-VN');
}

function SessionCard({ session, isSelected, onSelect }) {
  const statusStyle = session.current_attendance_status
    ? STATUS_CONFIG[session.current_attendance_status] || STATUS_CONFIG.success
    : null;

  return (
    <button
      onClick={() => onSelect(session.session_id)}
      className={`w-full text-left rounded-2xl border p-4 transition-all ${
        isSelected
          ? 'border-primary-container bg-rose-50 shadow-sm'
          : 'border-outline-variant/30 bg-white hover:border-primary-container/40 hover:shadow-sm'
      } ${session.is_enrolled ? '' : 'opacity-60'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-on-surface">
            {session.session_title}
          </div>
          <div className="text-xs text-secondary mt-1 flex flex-wrap gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1"><BookOpen className="w-3.5 h-3.5" />{session.course_code} - {session.course_name}</span>
            <span className="inline-flex items-center gap-1"><School className="w-3.5 h-3.5" />{session.class_code} - {session.class_name}</span>
          </div>
          <div className="text-xs text-secondary mt-2">
            {formatDateTime(session.start_time)} → {formatDateTime(session.end_time)}
          </div>
          <div className="text-xs text-secondary mt-1">GV: {session.lecturer_name}</div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-700">
            {session.status}
          </span>
          {session.is_enrolled ? (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-sky-100 text-sky-700">
              Thuộc phiên này
            </span>
          ) : (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600">
              Không thuộc lớp
            </span>
          )}
        </div>
      </div>

      {session.current_attendance_status && (
        <div className="mt-3 pt-3 border-t border-outline-variant/20 flex items-center justify-between gap-3">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${statusStyle?.badge || 'bg-slate-100 text-slate-700'}`}>
            {statusStyle?.icon}
            {statusStyle?.label || session.current_attendance_status}
          </span>
          <span className="text-xs text-secondary">{formatDateTime(session.current_checkin_time)}</span>
        </div>
      )}
    </button>
  );
}

function LogItem({ entry }) {
  const cfg = STATUS_CONFIG[entry.attendance_status || entry.status] || STATUS_CONFIG.not_found;

  return (
    <div className="py-3 border-b border-surface-container-low last:border-0">
      <div className="flex items-start gap-3">
        <span className="text-xs text-secondary font-mono mt-1 w-16 shrink-0">
          {new Date(entry.timestamp).toLocaleTimeString('vi-VN')}
        </span>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${cfg.badge}`}>
          {cfg.icon}
          {cfg.label}
        </span>
        <div className="min-w-0 flex-1">
          {entry.full_name ? (
            <>
              <div className="font-bold text-sm text-on-surface">{entry.full_name}</div>
              <div className="text-xs text-secondary mt-1">
                {entry.student_code} • {entry.session_title} • {entry.similarity ? `${entry.similarity}% khớp` : 'đã ghi nhận'}
              </div>
            </>
          ) : (
            <div className="text-sm text-secondary">{entry.message}</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AttendanceScan() {
  const { actor, isAdmin, isStudent } = useAuth();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [studentCodeInput, setStudentCodeInput] = useState('');
  const [studentCode, setStudentCode] = useState('');
  const [openSessions, setOpenSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [logs, setLogs] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  const selectedSession = useMemo(
    () => openSessions.find((session) => String(session.session_id) === String(selectedSessionId)),
    [openSessions, selectedSessionId]
  );

  const eligibleSessions = useMemo(() => {
    if (!studentCode) return openSessions;
    return openSessions.filter((session) => session.is_enrolled);
  }, [openSessions, studentCode]);

  const stats = useMemo(() => ({
    success: logs.filter((item) => ['on_time', 'early', 'late'].includes(item.attendance_status)).length,
    failed: logs.filter((item) => ['not_found', 'low_confidence', 'blurry_rejected'].includes(item.status || item.attendance_status)).length,
  }), [logs]);

  const addLog = useCallback((entry) => {
    setLogs((prev) => [{ ...entry, timestamp: new Date().toISOString() }, ...prev].slice(0, 50));
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraOn(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch (error) {
      addLog({ status: 'no_face', message: `Không thể mở camera: ${error.message}` });
    }
  };

  const loadOpenSessions = async (nextStudentCode = studentCode) => {
    setLoadingSessions(true);
    try {
      const query = nextStudentCode ? `?student_code=${encodeURIComponent(nextStudentCode)}` : '';
      const res = await api.get(`/attendance/open-sessions${query}`);
      const sessionList = res.data?.data || [];
      setOpenSessions(sessionList);

      const selectable = sessionList.filter((item) => !nextStudentCode || item.is_enrolled);
      if (selectable.length === 0) {
        setSelectedSessionId('');
      } else if (!selectable.some((item) => String(item.session_id) === String(selectedSessionId))) {
        setSelectedSessionId(String(selectable[0].session_id));
      }
    } catch (error) {
      addLog({ status: 'not_found', message: error.response?.data?.message || 'Không tải được danh sách phiên đang mở.' });
    } finally {
      setLoadingSessions(false);
    }
  };

  useEffect(() => {
    const initialCode = isStudent ? actor.studentCode : '';
    if (initialCode) {
      setStudentCodeInput(initialCode);
      setStudentCode(initialCode);
    }
    loadOpenSessions(initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor.studentCode, isStudent]);

  const handleFindSessions = async () => {
    const normalized = studentCodeInput.trim().toUpperCase();
    setStudentCode(normalized);
    await loadOpenSessions(normalized);
  };

  const captureAndSubmit = async () => {
    if (!selectedSessionId) {
      addLog({ status: 'not_found', message: 'Hãy chọn một phiên điểm danh đang mở.' });
      return;
    }
    if (studentCode && selectedSession && !selectedSession.is_enrolled) {
      addLog({ status: 'not_found', message: 'Mã sinh viên này không thuộc lớp của phiên đã chọn.' });
      return;
    }
    if (!videoRef.current || !canvasRef.current) {
      addLog({ status: 'no_face', message: 'Camera chưa sẵn sàng.' });
      return;
    }

    setSubmitting(true);
    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (!blob) {
        throw new Error('Không tạo được ảnh từ camera.');
      }

      const formData = new FormData();
      formData.append('frame', blob, 'student-checkin.jpg');
      formData.append('session_id', selectedSessionId);
      if (studentCode) formData.append('student_code', studentCode);

      const res = await api.post('/attendance/recognize', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const payload = res.data;

      if (!payload.recognized) {
        addLog({ status: payload.status || 'not_found', message: payload.message || 'Điểm danh thất bại.' });
        return;
      }

      addLog({
        ...payload.data,
        status: 'success',
        attendance_status: payload.data.attendance_status,
      });
      await loadOpenSessions(studentCode);
    } catch (error) {
      addLog({ status: 'not_found', message: error.response?.data?.message || error.message || 'Không thể gửi điểm danh.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex-grow bg-surface py-8 px-4 md:px-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-4xl font-black text-on-surface mb-2">Điểm danh cho sinh viên</h1>
          <p className="text-secondary max-w-3xl">
            Chọn đúng phiên mà giáo viên đã mở cho lớp của bạn, bật camera và thực hiện check-in một lần để hệ thống ghi nhận trạng thái điểm danh.
          </p>
          {isStudent && (
            <p className="text-sm text-primary-container font-semibold mt-2">Bạn đang thao tác với quyền sinh viên: {actor.studentCode}. Mã sinh viên sẽ được tự khóa theo phiên hiện tại.</p>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
          <div className="xl:col-span-2 space-y-4">
            <section className="bg-white rounded-2xl border border-outline-variant/30 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <UserCheck className="w-5 h-5 text-primary-container" />
                <h2 className="text-lg font-black text-on-surface">Tìm phiên của bạn</h2>
              </div>

              <div className="space-y-3">
                <label className="block">
                  <span className="text-xs font-bold text-secondary uppercase tracking-wide">Mã sinh viên</span>
                  <div className="mt-2 flex gap-2">
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
                      <input
                        value={studentCodeInput}
                        disabled={isStudent && !isAdmin}
                        onChange={(e) => setStudentCodeInput(e.target.value.toUpperCase())}
                        placeholder="VD: B22DCCN001"
                        className="w-full rounded-xl border border-outline-variant/40 pl-10 pr-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-container/25"
                      />
                    </div>
                    <button
                      onClick={handleFindSessions}
                      className="px-4 py-3 rounded-xl bg-primary-container text-white font-bold hover:opacity-90"
                    >
                      Lọc
                    </button>
                  </div>
                </label>

                <div className="flex gap-2">
                  <button
                    onClick={() => loadOpenSessions(studentCode)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-container-low font-semibold hover:bg-surface-container"
                  >
                    <RefreshCw className="w-4 h-4" /> Làm mới phiên mở
                  </button>
                  <button
                    onClick={() => {
                      setStudentCode('');
                      setStudentCodeInput('');
                      loadOpenSessions('');
                    }}
                    className="px-4 py-2.5 rounded-xl border border-outline-variant/30 font-semibold"
                  >
                    Bỏ lọc
                  </button>
                </div>
              </div>
            </section>

            <section className="bg-white rounded-2xl border border-outline-variant/30 shadow-sm p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-primary-container" />
                  <h2 className="text-lg font-black text-on-surface">Phiên đang mở</h2>
                </div>
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
                  {eligibleSessions.length} phiên
                </span>
              </div>

              <div className="space-y-3 max-h-[520px] overflow-auto">
                {loadingSessions ? (
                  <div className="text-sm text-secondary">Đang tải danh sách phiên...</div>
                ) : eligibleSessions.length === 0 ? (
                  <div className="text-sm text-secondary">
                    {studentCode
                      ? 'Không có phiên mở nào phù hợp với mã sinh viên này.'
                      : 'Hiện chưa có phiên điểm danh nào đang mở.'}
                  </div>
                ) : (
                  eligibleSessions.map((session) => (
                    <SessionCard
                      key={session.session_id}
                      session={session}
                      isSelected={String(session.session_id) === String(selectedSessionId)}
                      onSelect={setSelectedSessionId}
                    />
                  ))
                )}
              </div>
            </section>
          </div>

          <div className="xl:col-span-3 space-y-4">
            <section className="bg-white rounded-2xl border border-outline-variant/30 shadow-sm p-5">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <ScanFace className="w-5 h-5 text-primary-container" />
                    <h2 className="text-lg font-black text-on-surface">Check-in bằng khuôn mặt</h2>
                  </div>
                  <p className="text-sm text-secondary">
                    {selectedSession
                      ? `${selectedSession.session_title} • ${selectedSession.course_name} • ${selectedSession.class_name}`
                      : 'Hãy chọn một phiên đang mở ở bên trái.'}
                  </p>
                </div>
                <div className="flex gap-2">
                  {!cameraOn ? (
                    <button
                      onClick={startCamera}
                      className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-primary-container text-white font-bold hover:opacity-90"
                    >
                      <Camera className="w-4 h-4" /> Bật camera
                    </button>
                  ) : (
                    <button
                      onClick={stopCamera}
                      className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-slate-700 text-white font-bold hover:bg-slate-800"
                    >
                      <Square className="w-4 h-4" /> Tắt camera
                    </button>
                  )}
                  <button
                    onClick={captureAndSubmit}
                    disabled={!cameraOn || !selectedSessionId || submitting}
                    className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    Check-in ngay
                  </button>
                </div>
              </div>

              <div className="bg-black rounded-2xl overflow-hidden aspect-video relative shadow-lg">
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                  style={{ display: cameraOn ? 'block' : 'none' }}
                />
                <canvas ref={canvasRef} className="hidden" />

                {!cameraOn && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white/70">
                    <CameraOff className="w-16 h-16" />
                    <div className="text-center">
                      <div className="font-bold">Camera chưa bật</div>
                      <div className="text-sm text-white/50 mt-1">Bật camera để chụp ảnh check-in</div>
                    </div>
                  </div>
                )}

                {cameraOn && (
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute inset-[12%] border-2 border-primary-container/50 rounded-2xl border-pulse" />
                    <div className="absolute left-[12%] right-[12%] top-1/2 h-0.5 bg-gradient-to-r from-transparent via-primary-container to-transparent" />
                    <div className="absolute top-4 left-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/45 text-white text-xs font-bold">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      Sẵn sàng nhận diện
                    </div>
                  </div>
                )}
              </div>
            </section>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <section className="bg-white rounded-2xl border border-outline-variant/30 shadow-sm p-5">
                <div className="text-sm text-secondary">Phiên đã chọn</div>
                <div className="text-xl font-black mt-2 text-on-surface">{selectedSession ? `#${selectedSession.session_id}` : '--'}</div>
                <div className="text-sm text-secondary mt-2">{selectedSession?.class_name || 'Chưa chọn phiên'}</div>
              </section>
              <section className="bg-white rounded-2xl border border-outline-variant/30 shadow-sm p-5">
                <div className="text-sm text-secondary">Check-in thành công</div>
                <div className="text-xl font-black mt-2 text-emerald-700">{stats.success}</div>
                <div className="text-sm text-secondary mt-2">Trong log hiện tại</div>
              </section>
              <section className="bg-white rounded-2xl border border-outline-variant/30 shadow-sm p-5">
                <div className="text-sm text-secondary">Lỗi / không hợp lệ</div>
                <div className="text-xl font-black mt-2 text-rose-700">{stats.failed}</div>
                <div className="text-sm text-secondary mt-2">Để kiểm tra lại ánh sáng, vị trí camera</div>
              </section>
            </div>

            <section className="bg-white rounded-2xl border border-outline-variant/30 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-surface-container-low">
                <div className="font-black text-on-surface">Nhật ký điểm danh</div>
                <button
                  onClick={() => setLogs([])}
                  className="text-sm text-secondary hover:text-primary-container"
                >
                  Xóa log
                </button>
              </div>
              <div className="px-5 max-h-[340px] overflow-auto">
                {logs.length === 0 ? (
                  <div className="py-12 text-center text-sm text-secondary">
                    Chưa có thao tác nào. Hãy chọn phiên, bật camera và bấm check-in.
                  </div>
                ) : (
                  logs.map((entry, index) => <LogItem key={`${entry.timestamp}-${index}`} entry={entry} />)
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
