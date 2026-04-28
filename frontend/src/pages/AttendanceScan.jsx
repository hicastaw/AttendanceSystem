import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import {
  Camera, CameraOff, RefreshCw, CheckCircle2, XCircle, Clock3,
  AlertTriangle, BookOpen, School, ScanFace, Square, Play, Pause,
  Users, UserCheck, ChevronDown, Timer, X, Download, StopCircle,
} from 'lucide-react';

const STATUS_CFG = {
  on_time:         { label: 'Đúng giờ',            cls: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  early:           { label: 'Đến sớm',             cls: 'bg-sky-100 text-sky-700',         icon: <Clock3 className="w-3.5 h-3.5" /> },
  late:            { label: 'Đi muộn',             cls: 'bg-amber-100 text-amber-700',     icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  absent:          { label: 'Vắng',                cls: 'bg-rose-100 text-rose-700',       icon: <XCircle className="w-3.5 h-3.5" /> },
  low_confidence:  { label: 'Độ tin cậy thấp',    cls: 'bg-orange-100 text-orange-700',   icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  blurry_rejected: { label: 'Ảnh mờ',             cls: 'bg-slate-100 text-slate-600',     icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  no_face:         { label: 'Không thấy mặt',     cls: 'bg-slate-100 text-slate-600',     icon: <CameraOff className="w-3.5 h-3.5" /> },
  not_found:       { label: 'Không khớp',         cls: 'bg-rose-100 text-rose-700',       icon: <XCircle className="w-3.5 h-3.5" /> },
  duplicate:       { label: 'Đã điểm danh',       cls: 'bg-purple-100 text-purple-700',   icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  success:         { label: 'Thành công',         cls: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
};

function fmt(v) { return v ? new Date(v).toLocaleString('vi-VN') : '--'; }
function fmtTime(v) { return v ? new Date(v).toLocaleTimeString('vi-VN') : '--'; }

function Badge({ status, extra = '' }) {
  const c = STATUS_CFG[status] || STATUS_CFG.not_found;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${c.cls} ${extra}`}>
      {c.icon}{c.label}
    </span>
  );
}

function StatCard({ label, value, color = 'text-on-surface', sub }) {
  return (
    <div className="bg-white rounded-2xl border border-outline-variant/30 shadow-sm p-4">
      <div className="text-xs text-secondary mb-1">{label}</div>
      <div className={`text-2xl font-black ${color}`}>{value}</div>
      {sub && <div className="text-xs text-secondary mt-1">{sub}</div>}
    </div>
  );
}

export default function AttendanceScan() {
  const { isAdmin, isLecturer } = useAuth();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);

  const [sessions, setSessions] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [records, setRecords] = useState([]);
  const [logs, setLogs] = useState([]);
  const [cameraOn, setCameraOn] = useState(false);
  const [autoScan, setAutoScan] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [scanInterval, setScanInterval] = useState(2);
  const [closingSession, setClosingSession] = useState(false);

  const selectedSession = sessions.find(s => String(s.session_id) === String(selectedId));

  const addLog = useCallback((entry) => {
    setLogs(prev => [{ ...entry, ts: new Date().toISOString() }, ...prev].slice(0, 100));
  }, []);

  const stopCamera = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setCameraOn(false);
    setAutoScan(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const loadSessions = async () => {
    setLoadingSessions(true);
    try {
      const res = await api.get('/attendance/open-sessions');
      const list = res.data?.data || [];
      setSessions(list);
      if (list.length > 0 && !selectedId) setSelectedId(String(list[0].session_id));
    } catch (e) {
      addLog({ status: 'not_found', message: e.response?.data?.message || 'Không tải được phiên.' });
    } finally { setLoadingSessions(false); }
  };

  const loadRecords = async (sid) => {
    if (!sid) return;
    try {
      const res = await api.get(`/attendance/sessions/${sid}/records`);
      setRecords(res.data?.data || []);
    } catch { /* ignore */ }
  };

  useEffect(() => { loadSessions(); }, []);
  useEffect(() => { loadRecords(selectedId); }, [selectedId]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setCameraOn(true);
    } catch (e) {
      addLog({ status: 'no_face', message: `Không mở được camera: ${e.message}` });
    }
  };

  const capture = useCallback(async () => {
    if (scanning || !selectedId || !videoRef.current || !canvasRef.current) return;
    setScanning(true);
    try {
      const v = videoRef.current, c = canvasRef.current;
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
      if (!blob) return;
      const fd = new FormData();
      fd.append('frame', blob, 'frame.jpg');
      fd.append('session_id', selectedId);
      const res = await api.post('/attendance/recognize', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const d = res.data;
      if (d.recognized) {
        addLog({ status: 'success', attendance_status: d.data.attendance_status, full_name: d.data.full_name, student_code: d.data.student_code, similarity: d.data.similarity });
        loadRecords(selectedId);
      } else {
        addLog({ status: d.status || 'not_found', message: d.message });
      }
    } catch (e) {
      const msg = e.response?.data?.message || e.message;
      if (!msg?.includes('đã điểm danh')) addLog({ status: 'no_face', message: msg });
    } finally { setScanning(false); }
  }, [scanning, selectedId, addLog]);

  const toggleAutoScan = useCallback(() => {
    if (autoScan) {
      clearInterval(intervalRef.current); intervalRef.current = null;
      setAutoScan(false);
    } else {
      if (!cameraOn) return;
      setAutoScan(true);
      intervalRef.current = setInterval(() => capture(), scanInterval * 1000);
    }
  }, [autoScan, cameraOn, capture, scanInterval]);

  useEffect(() => {
    if (autoScan && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => capture(), scanInterval * 1000);
    }
  }, [scanInterval, autoScan, capture]);

  const handleCloseSession = async () => {
    if (!selectedId) return;
    setClosingSession(true);
    try {
      await api.put(`/attendance/sessions/${selectedId}/close`);
      addLog({ status: 'success', message: `Đã đóng phiên #${selectedId}` });
      stopCamera();
      await loadSessions();
      setSelectedId('');
      setRecords([]);
    } catch (e) {
      addLog({ status: 'not_found', message: e.response?.data?.message || 'Không đóng được phiên.' });
    } finally { setClosingSession(false); }
  };

  const attended = records.filter(r => r.attendance_status && r.attendance_status !== 'absent');
  const onTime   = records.filter(r => r.attendance_status === 'on_time' || r.attendance_status === 'early');
  const late     = records.filter(r => r.attendance_status === 'late');
  const absent   = records.filter(r => !r.attendance_status || r.attendance_status === 'absent');

  return (
    <main className="flex-grow bg-surface py-6 px-4 md:px-8">
      <div className="max-w-7xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black text-on-surface">Điểm danh bằng khuôn mặt</h1>
            <p className="text-secondary text-sm mt-1">Chọn phiên → Bật camera → Bật auto-scan để nhận diện liên tục</p>
          </div>
          <button onClick={loadSessions} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-container-low font-semibold text-sm hover:bg-surface-container">
            <RefreshCw className="w-4 h-4" />Làm mới phiên
          </button>
        </div>

        {/* Session selector */}
        <section className="bg-white rounded-2xl border border-outline-variant/30 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="w-5 h-5 text-primary-container" />
            <h2 className="text-base font-black text-on-surface">Chọn phiên điểm danh</h2>
            <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">{sessions.length} phiên đang mở</span>
          </div>
          {loadingSessions ? (
            <div className="text-sm text-secondary">Đang tải...</div>
          ) : sessions.length === 0 ? (
            <div className="text-sm text-secondary py-4 text-center">Hiện chưa có phiên nào đang mở.</div>
          ) : (
            <div className="relative">
              <select
                value={selectedId}
                onChange={e => { setSelectedId(e.target.value); stopCamera(); setLogs([]); }}
                className="w-full rounded-xl border border-outline-variant/40 px-4 py-3 pr-10 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary-container/25 appearance-none"
              >
                <option value="">-- Chọn phiên --</option>
                {sessions.map(s => (
                  <option key={s.session_id} value={s.session_id}>
                    #{s.session_id} | {s.session_title} — {s.course_code} {s.class_code} ({fmt(s.start_time)} → {fmt(s.end_time)})
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-secondary pointer-events-none" />
            </div>
          )}
          {selectedSession && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-secondary">
              <span className="inline-flex items-center gap-1"><School className="w-3.5 h-3.5" />{selectedSession.class_name}</span>
              <span className="inline-flex items-center gap-1"><BookOpen className="w-3.5 h-3.5" />{selectedSession.course_name}</span>
              <span className="inline-flex items-center gap-1"><Timer className="w-3.5 h-3.5" />Muộn sau {selectedSession.late_after_minutes} phút</span>
              <span className="ml-auto font-bold text-emerald-600">● Đang mở</span>
            </div>
          )}
        </section>

        {/* Stats */}
        {selectedId && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Tổng sinh viên" value={records.length} sub="trong phiên" />
            <StatCard label="Đã điểm danh" value={attended.length} color="text-emerald-700" sub={`${records.length ? Math.round(attended.length/records.length*100) : 0}%`} />
            <StatCard label="Đúng giờ / Sớm" value={onTime.length} color="text-sky-700" sub={`Muộn: ${late.length}`} />
            <StatCard label="Chưa điểm danh" value={absent.length} color="text-rose-700" sub="vắng mặt" />
          </div>
        )}

        {/* Main grid */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
          {/* Camera panel */}
          <div className="xl:col-span-3 space-y-4">
            <section className="bg-white rounded-2xl border border-outline-variant/30 shadow-sm p-5">
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <ScanFace className="w-5 h-5 text-primary-container" />
                <h2 className="text-base font-black text-on-surface flex-1">Camera nhận diện</h2>
                {/* Interval selector */}
                <div className="flex items-center gap-1.5">
                  <Timer className="w-4 h-4 text-secondary" />
                  <span className="text-xs text-secondary font-semibold">Tần suất:</span>
                  {[1, 2, 3, 5].map(s => (
                    <button key={s} onClick={() => setScanInterval(s)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${scanInterval === s ? 'bg-primary-container text-white' : 'bg-surface-container-low text-secondary hover:bg-surface-container'}`}>
                      {s}s
                    </button>
                  ))}
                </div>
              </div>

              {/* Camera buttons */}
              <div className="flex flex-wrap gap-2 mb-4">
                {!cameraOn ? (
                  <button onClick={startCamera} disabled={!selectedId}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-container text-white font-bold hover:opacity-90 disabled:opacity-50 text-sm">
                    <Camera className="w-4 h-4" />Bật camera
                  </button>
                ) : (
                  <button onClick={stopCamera}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-700 text-white font-bold hover:bg-slate-800 text-sm">
                    <Square className="w-4 h-4" />Tắt camera
                  </button>
                )}
                <button onClick={toggleAutoScan} disabled={!cameraOn || !selectedId}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all disabled:opacity-50 ${autoScan ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
                  {autoScan ? <><Pause className="w-4 h-4" />Dừng auto-scan</> : <><Play className="w-4 h-4" />Bắt đầu auto-scan</>}
                </button>
                <button onClick={() => capture()} disabled={!cameraOn || !selectedId || scanning}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 text-white font-bold hover:bg-sky-700 disabled:opacity-50 text-sm">
                  {scanning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ScanFace className="w-4 h-4" />}Quét thủ công
                </button>
                {selectedSession && (isAdmin || isLecturer) && (
                  <button onClick={handleCloseSession} disabled={closingSession}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600 text-white font-bold hover:bg-rose-700 disabled:opacity-50 text-sm ml-auto">
                    <StopCircle className="w-4 h-4" />{closingSession ? 'Đang đóng...' : 'Đóng phiên'}
                  </button>
                )}
              </div>

              {/* Video */}
              <div className="bg-black rounded-2xl overflow-hidden aspect-video relative shadow-inner">
                <video ref={videoRef} muted playsInline className="w-full h-full object-cover" style={{ display: cameraOn ? 'block' : 'none' }} />
                <canvas ref={canvasRef} className="hidden" />
                {!cameraOn && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/60">
                    <CameraOff className="w-14 h-14" />
                    <div className="text-center">
                      <div className="font-bold">Camera chưa bật</div>
                      <div className="text-sm text-white/40 mt-1">{selectedId ? 'Bật camera để bắt đầu điểm danh' : 'Hãy chọn phiên điểm danh trước'}</div>
                    </div>
                  </div>
                )}
                {cameraOn && (
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute inset-[10%] border-2 border-primary-container/50 rounded-3xl" />
                    <div className="absolute left-[10%] right-[10%] top-1/2 h-px bg-gradient-to-r from-transparent via-primary-container/60 to-transparent" />
                    <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/50 text-white text-xs font-bold">
                      <span className={`w-2 h-2 rounded-full ${autoScan ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                      {autoScan ? `Auto-scan mỗi ${scanInterval}s` : 'Camera sẵn sàng'}
                    </div>
                    {scanning && (
                      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary-container/90 text-white text-xs font-bold">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />Đang nhận diện...
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* Log */}
            <section className="bg-white rounded-2xl border border-outline-variant/30 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-container-low">
                <div className="font-black text-on-surface text-sm">Nhật ký nhận diện</div>
                <button onClick={() => setLogs([])} className="text-xs text-secondary hover:text-rose-600 flex items-center gap-1">
                  <X className="w-3.5 h-3.5" />Xóa log
                </button>
              </div>
              <div className="max-h-[260px] overflow-auto px-5 py-2">
                {logs.length === 0 ? (
                  <div className="py-8 text-center text-sm text-secondary">Chưa có kết quả nào. Bật camera và auto-scan để bắt đầu.</div>
                ) : logs.map((e, i) => (
                  <div key={i} className="py-2.5 border-b border-surface-container-low last:border-0 flex items-start gap-3">
                    <span className="text-xs text-secondary font-mono mt-0.5 w-14 shrink-0">{fmtTime(e.ts)}</span>
                    <Badge status={e.attendance_status || e.status} />
                    <div className="min-w-0 flex-1">
                      {e.full_name ? (
                        <>
                          <div className="font-bold text-sm text-on-surface truncate">{e.full_name}</div>
                          <div className="text-xs text-secondary">{e.student_code}{e.similarity ? ` • ${e.similarity}% khớp` : ''}</div>
                        </>
                      ) : (
                        <div className="text-sm text-secondary">{e.message}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Student list panel */}
          <div className="xl:col-span-2">
            <section className="bg-white rounded-2xl border border-outline-variant/30 shadow-sm overflow-hidden h-full">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-container-low">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary-container" />
                  <span className="font-black text-on-surface text-sm">Danh sách lớp</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">
                    <UserCheck className="w-3 h-3 inline mr-0.5" />{attended.length}/{records.length}
                  </span>
                  <button onClick={() => loadRecords(selectedId)} className="text-xs text-secondary hover:text-primary-container">
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="overflow-auto max-h-[700px]">
                {records.length === 0 ? (
                  <div className="py-12 text-center text-sm text-secondary">
                    {selectedId ? 'Chưa có dữ liệu sinh viên.' : 'Hãy chọn phiên để xem danh sách.'}
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-surface-container-low/60 text-xs text-secondary font-bold uppercase tracking-wide sticky top-0">
                      <tr>
                        <th className="text-left px-4 py-2">Sinh viên</th>
                        <th className="text-center px-3 py-2">Trạng thái</th>
                        <th className="text-right px-4 py-2">Check-in</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r, i) => {
                        const isPresent = r.attendance_status && r.attendance_status !== 'absent';
                        return (
                          <tr key={i} className={`border-b border-surface-container-low/60 hover:bg-surface-container-low/30 transition-colors ${isPresent ? '' : 'opacity-70'}`}>
                            <td className="px-4 py-2.5">
                              <div className="font-semibold text-on-surface truncate max-w-[130px]">{r.student_name}</div>
                              <div className="text-xs text-secondary">{r.student_code}</div>
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <Badge status={r.attendance_status || 'absent'} />
                            </td>
                            <td className="px-4 py-2.5 text-right text-xs text-secondary">
                              {r.checkin_time ? fmtTime(r.checkin_time) : '--'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              {records.length > 0 && selectedId && (
                <div className="px-5 py-3 border-t border-surface-container-low">
                  <a href={`/api/v1/attendance/sessions/${selectedId}/export`}
                    className="inline-flex items-center gap-2 text-xs font-bold text-primary-container hover:underline">
                    <Download className="w-3.5 h-3.5" />Xuất CSV
                  </a>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
