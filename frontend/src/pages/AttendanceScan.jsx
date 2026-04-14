import { useState, useRef, useEffect, useCallback } from 'react';
import api from '../api/client.js';
import {
  Video, VideoOff, Play, Square, Plus, RefreshCw,
  CheckCircle2, XCircle, Clock, AlertTriangle, ChevronDown,
  AlertCircle, UserCheck, Wifi
} from 'lucide-react';

// ─── Status config ────────────────────────────
const STATUS_CONFIG = {
  on_time:          { label: 'ĐÚNG GIỜ',   color: 'text-green-700',  bg: 'bg-green-100',  icon: <CheckCircle2 className="w-4 h-4" /> },
  early:            { label: 'ĐẾN SỚM',    color: 'text-blue-700',   bg: 'bg-blue-100',   icon: <Clock className="w-4 h-4" /> },
  late:             { label: 'ĐI MUỘN',    color: 'text-amber-700',  bg: 'bg-amber-100',  icon: <AlertCircle className="w-4 h-4" /> },
  absent:           { label: 'KHÔNG GHI NHẬN', color: 'text-red-700',  bg: 'bg-red-100',    icon: <XCircle className="w-4 h-4" /> },
  not_found:        { label: 'KHÔNG HỢP LỆ', color: 'text-red-700',  bg: 'bg-red-100',    icon: <XCircle className="w-4 h-4" /> },
  no_face:          { label: 'KHÔNG CÓ MẶT', color: 'text-gray-500', bg: 'bg-gray-100',   icon: <VideoOff className="w-4 h-4" /> },
  blurry_rejected:  { label: 'ẢNH MỜ',     color: 'text-gray-500',  bg: 'bg-gray-100',   icon: <AlertTriangle className="w-4 h-4" /> },
  low_confidence:   { label: 'ĐỘ TIN CẬY THẤP', color: 'text-orange-700', bg: 'bg-orange-100', icon: <AlertTriangle className="w-4 h-4" /> },
};

// ─── Log Item Component ───────────────────────
function LogItem({ entry }) {
  const cfg = STATUS_CONFIG[entry.attendance_status || entry.status] || STATUS_CONFIG.not_found;
  const time = new Date(entry.timestamp).toLocaleTimeString('vi-VN');

  return (
    <div className="flex items-start gap-3 py-3 border-b border-surface-container-low last:border-0 animate-fade-in">
      <span className="text-xs font-mono text-secondary mt-0.5 w-14 shrink-0">{time}</span>
      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${cfg.bg} ${cfg.color} shrink-0`}>
        {cfg.icon}
        {cfg.label}
      </div>
      <div className="min-w-0">
        {entry.full_name ? (
          <>
            <p className="text-sm font-bold text-on-surface truncate">{entry.full_name}</p>
            <p className="text-xs text-secondary">{entry.student_code} • {entry.similarity}% khớp</p>
          </>
        ) : (
          <p className="text-sm text-secondary">{entry.message}</p>
        )}
      </div>
    </div>
  );
}

// ─── Camera overlay canvas ────────────────────
function CameraOverlay({ isActive }) {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Corner guides */}
      {[
        'top-[15%] left-[20%] border-t-4 border-l-4 rounded-tl-lg',
        'top-[15%] right-[20%] border-t-4 border-r-4 rounded-tr-lg',
        'bottom-[15%] left-[20%] border-b-4 border-l-4 rounded-bl-lg',
        'bottom-[15%] right-[20%] border-b-4 border-r-4 rounded-br-lg',
      ].map((cls, i) => (
        <div key={i} className={`absolute w-8 h-8 ${isActive ? 'border-primary-container' : 'border-gray-400'} ${cls} transition-colors duration-500`} />
      ))}

      {/* Center guide box */}
      <div className={`absolute top-[15%] left-[20%] right-[20%] bottom-[15%] border-2 ${isActive ? 'border-primary-container/40 border-pulse' : 'border-gray-300/40'} rounded-lg transition-colors duration-500`} />

      {/* Scan line khi active */}
      {isActive && (
        <div className="absolute left-[20%] right-[20%] top-[15%] bottom-[15%] overflow-hidden rounded-lg">
          <div className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-primary-container to-transparent scan-line" />
        </div>
      )}

      {/* Status indicator */}
      <div className="absolute top-3 left-3">
        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold backdrop-blur-sm ${
          isActive ? 'bg-black/50 text-green-400' : 'bg-black/50 text-gray-400'
        }`}>
          <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}`} />
          {isActive ? 'ĐANG QUÉT' : 'TẮT'}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────
export default function AttendanceScan() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const intervalRef = useRef(null);
  const streamRef = useRef(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [log, setLog] = useState([]);
  
  const seenStudentsRef = useRef(new Set());

  const [sections, setSections] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState('');
  
  // Global Session Form
  const [globalSessionStart, setGlobalSessionStart] = useState('07:00');
  const [globalSessionEnd, setGlobalSessionEnd] = useState('11:00');
  const [globalSessionLate, setGlobalSessionLate] = useState(15);

  // Cleanup khi unmount
  useEffect(() => {
    return () => { stopCamera(); };
  }, []);

  const addLog = (entry) => {
    setLog(prev => [{ ...entry, timestamp: new Date().toISOString() }, ...prev].slice(0, 100));
  };

  // ─── Camera ─────────────────────────────────
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch (err) {
      addLog({ status: 'no_face', message: `Không thể mở camera: ${err.message}` });
    }
  };

  const stopCamera = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    setScanning(false);
    setCameraOn(false);
    setSelectedSession(prev => prev); // keep session
  };

  const captureAndRecognize = useCallback(async (sessionIdToUse) => {
    const sId = sessionIdToUse || selectedSession;
    if (!videoRef.current || !canvasRef.current || !sId) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const formData = new FormData();
      formData.append('frame', blob, 'frame.jpg');
      formData.append('session_id', sId);

      try {
        const res = await api.post('/attendance/recognize', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        const d = res.data;

        if (d.status === 'no_face') return; // im lặng nếu không có mặt

        if (!d.recognized) {
          addLog({ status: 'not_found', message: d.message || 'Không tìm thấy trong hệ thống' });
          return;
        }

        const { student_code } = d.data;
        // Nếu SV đã điểm danh trong session này thì bỏ qua (tránh spam log)
        if (seenStudentsRef.current.has(student_code)) return;

        seenStudentsRef.current.add(student_code);
        addLog({ ...d.data, status: 'success', attendance_status: d.data.attendance_status });
      } catch (err) { 
        console.error("Lỗi khi gửi ảnh:", err);
      }
    }, 'image/jpeg', 0.85);
  }, [selectedSession]);

  // ─── Activate Session ────────────────────────
  const handleActivate = async () => {
    if (!globalSessionStart || !globalSessionEnd) {
      addLog({ status: 'not_found', message: 'Vui lòng nhập giờ bắt đầu và kết thúc.' }); return;
    }

    try {
      setScanning(true);
      const res = await api.post('/attendance/global-sessions', {
        start_time: globalSessionStart,
        end_time: globalSessionEnd,
        late_after_minutes: parseInt(globalSessionLate)
      });
      const newSessionId = res.data.data.session_id;
      setSelectedSession(String(newSessionId));
      
      seenStudentsRef.current.clear();
      setLog([]);
      if (!cameraOn) await startCamera();

      // Auto capture mỗi 2 giây
      intervalRef.current = setInterval(() => captureAndRecognize(String(newSessionId)), 2000);
      addLog({ status: 'no_face', message: '✅ Phiên điểm danh chung đã kích hoạt. Đang quét...' });
    } catch (err) {
      setScanning(false);
      addLog({ status: 'not_found', message: err.response?.data?.message || 'Lỗi kích hoạt điểm danh' });
    }
  };

  // ─── End Session ─────────────────────────────
  const handleEnd = async () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setScanning(false);

    if (selectedSession) {
      try {
        await api.put(`/attendance/sessions/${selectedSession}/close`);
        addLog({ status: 'no_face', message: '🔒 Phiên điểm danh đã kết thúc và khóa lại.' });
      } catch { /* session có thể đã closed */ }
    }
    stopCamera();
  };

  // ─── Create New Session ───────────────────────
  const handleCreateSession = async () => {
    if (!selectedSection || !newSession.session_title) return;
    setCreatingSession(true);
    try {
      const res = await api.post('/attendance/sessions', {
        section_id: parseInt(selectedSection),
        ...newSession,
        late_after_minutes: parseInt(newSession.late_after_minutes),
      });
      const created = res.data.data;
      const ssRes = await api.get(`/attendance/sessions?section_id=${selectedSection}`);
      setSessions(ssRes.data.data || []);
      setSelectedSession(String(created.session_id));
      setShowNewForm(false);
      addLog({ status: 'no_face', message: `✅ Tạo phiên: ${created.session_title}` });
    } catch (err) {
      addLog({ status: 'not_found', message: err.response?.data?.message || 'Lỗi tạo phiên' });
    } finally { setCreatingSession(false); }
  };

  return (
    <main className="flex-grow bg-surface py-8 px-4 md:px-8">
      <div className="max-w-6xl mx-auto">

        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-black text-on-surface mb-2">Điểm danh thời gian thực</h1>
          <p className="text-secondary">Camera sẽ tự động quét và ghi nhận điểm danh vào hệ thống</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* LEFT: Camera */}
          <div className="lg:col-span-3 space-y-4">
            {/* Video */}
            <div className="bg-black rounded-2xl overflow-hidden aspect-video relative shadow-xl">
              <video
                ref={videoRef}
                muted
                playsInline
                className="w-full h-full object-cover"
                style={{ display: cameraOn ? 'block' : 'none' }}
              />
              <canvas ref={canvasRef} className="hidden" />

              {!cameraOn && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white/60">
                  <VideoOff className="w-16 h-16" />
                  <p className="text-sm font-medium">Camera chưa được bật</p>
                  <button
                    onClick={startCamera}
                    className="flex items-center gap-2 bg-white/20 hover:bg-white/30 backdrop-blur px-5 py-2.5 rounded-lg text-white text-sm font-semibold transition-all"
                  >
                    <Video className="w-4 h-4" /> Bật camera
                  </button>
                </div>
              )}

              <CameraOverlay isActive={scanning} />
            </div>

            {/* Log Panel */}
            <div className="bg-white rounded-2xl border border-outline-variant/30 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-surface-container-low">
                <div className="flex items-center gap-2">
                  <Wifi className="w-4 h-4 text-primary-container" />
                  <span className="font-bold text-sm">LOG ĐIỂM DANH</span>
                  {log.length > 0 && (
                    <span className="bg-primary-container text-white text-xs px-2 py-0.5 rounded-full font-bold">
                      {log.filter(e => e.full_name).length}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setLog([])}
                  className="text-xs text-secondary hover:text-primary-container transition-colors"
                >
                  Xóa log
                </button>
              </div>
              <div className="divide-y divide-surface-container-low max-h-72 overflow-y-auto px-5">
                {log.length === 0 ? (
                  <div className="py-10 text-center text-secondary text-sm">
                    Kích hoạt điểm danh để bắt đầu quét...
                  </div>
                ) : (
                  log.map((entry, i) => <LogItem key={i} entry={entry} />)
                )}
              </div>
            </div>
          </div>

          {/* RIGHT: Controls */}
          <div className="lg:col-span-2 space-y-4">

            <div className="bg-white rounded-2xl border border-outline-variant/30 shadow-sm p-5">
              <h2 className="text-xs font-bold text-secondary uppercase tracking-wider mb-4">Cấu hình điểm danh</h2>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-secondary mb-1 block font-semibold">Giờ bắt đầu</label>
                    <input 
                      type="time" 
                      value={globalSessionStart}
                      onChange={e => setGlobalSessionStart(e.target.value)}
                      disabled={scanning}
                      className="w-full border border-outline-variant/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-container/30 transition-all font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-secondary mb-1 block font-semibold">Giờ kết thúc</label>
                    <input 
                      type="time" 
                      value={globalSessionEnd}
                      onChange={e => setGlobalSessionEnd(e.target.value)}
                      disabled={scanning}
                      className="w-full border border-outline-variant/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-container/30 transition-all font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-secondary mb-1 block font-semibold">Trễ sau (phút)</label>
                  <input 
                    type="number" 
                    min="0" max="60" 
                    value={globalSessionLate}
                    onChange={e => setGlobalSessionLate(e.target.value)}
                    disabled={scanning}
                    className="w-full border border-outline-variant/50 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-container/30 transition-all"
                  />
                  <p className="text-[10px] text-secondary mt-1">Sau khoảng thời gian này tính từ lúc bắt đầu sẽ bị đánh dấu đi muộn.</p>
                </div>
              </div>
            </div>

            {/* Attendance Rules Info */}
            <div className="bg-white rounded-2xl border border-outline-variant/30 shadow-sm p-5">
              <h2 className="text-xs font-bold text-secondary uppercase tracking-wider mb-3">Quy tắc điểm danh</h2>
              <div className="space-y-2 text-xs text-secondary">
                <div className="flex justify-between"><span>Bắt đầu:</span><span className="font-bold text-on-surface">{globalSessionStart}</span></div>
                <div className="flex justify-between"><span>Kết thúc:</span><span className="font-bold text-on-surface">{globalSessionEnd}</span></div>
                <div className="flex justify-between"><span>Trễ sau:</span><span className="font-bold text-amber-600">{globalSessionLate} phút</span></div>
                <hr className="border-outline-variant/30 my-2" />
                <div className="space-y-1">
                  <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-400" />Trước giờ → Đến sớm</div>
                  <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500" />Đúng giờ → Đúng giờ</div>
                  <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-400" />Sau {globalSessionLate}p → Đi muộn</div>
                  <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-400" />Không có → Vắng mặt</div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-3">
              <button
                onClick={handleActivate}
                disabled={scanning}
                className="w-full flex items-center justify-center gap-2 bg-green-600 text-white font-bold py-4 rounded-xl hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm text-sm"
              >
                <UserCheck className="w-5 h-5" />
                {scanning ? 'Đang điểm danh...' : 'Kích hoạt điểm danh'}
              </button>
              <button
                onClick={handleEnd}
                disabled={!scanning && !cameraOn}
                className="w-full flex items-center justify-center gap-2 bg-red-600 text-white font-bold py-4 rounded-xl hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm text-sm"
              >
                <Square className="w-5 h-5" />
                Kết thúc & Đóng phiên
              </button>
            </div>

            {/* Stats */}
            {log.length > 0 && (
              <div className="bg-white rounded-2xl border border-outline-variant/30 shadow-sm p-5">
                <h2 className="text-xs font-bold text-secondary uppercase tracking-wider mb-3">Thống kê phiên</h2>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Đúng giờ', val: log.filter(e => ['on_time','early'].includes(e.attendance_status)).length, color: 'text-green-600' },
                    { label: 'Đi muộn', val: log.filter(e => e.attendance_status === 'late').length, color: 'text-amber-600' },
                    { label: 'Không hợp lệ', val: log.filter(e => e.status === 'not_found').length, color: 'text-red-600' },
                  ].map((s, i) => (
                    <div key={i} className="text-center bg-surface-container-low rounded-lg py-3">
                      <div className={`text-2xl font-black ${s.color}`}>{s.val}</div>
                      <div className="text-xs text-secondary mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
