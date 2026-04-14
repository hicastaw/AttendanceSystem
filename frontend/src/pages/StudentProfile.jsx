import { useState, useRef, useEffect } from 'react';
import api from '../api/client.js';
import {
  Search, Upload, CheckCircle2, XCircle, AlertCircle,
  User, Mail, GraduationCap, Save, RefreshCw, Camera, Video
} from 'lucide-react';

// ─── Status Badge Component ──────────────────
function AIBadge({ result }) {
  if (!result) return null;
  const isOk = result.is_valid;
  return (
    <div className={`rounded-xl p-4 border ${isOk ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
      <div className="flex items-start gap-3">
        {isOk
          ? <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
          : <XCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
        }
        <div>
          <p className={`text-sm font-bold ${isOk ? 'text-green-700' : 'text-red-600'}`}>
            {isOk ? 'Ảnh hợp lệ' : 'Ảnh không hợp lệ'}
          </p>
          <p className="text-xs text-secondary mt-1">{result.message}</p>
          {result.sharpness_score > 0 && (
            <p className="text-xs text-secondary mt-1">
              Độ sắc nét: <span className="font-semibold">{result.sharpness_score}</span>
              {isOk && result.confidence && ` • Confidence: ${result.confidence}%`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Toast Component ─────────────────────────
function Toast({ toast }) {
  if (!toast) return null;
  const isSuccess = toast.type === 'success';
  return (
    <div className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-4 rounded-xl shadow-2xl border text-sm font-semibold transition-all
      ${isSuccess ? 'bg-green-600 text-white border-green-700' : 'bg-red-600 text-white border-red-700'}`}>
      {isSuccess ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
      {toast.message}
    </div>
  );
}

// ─── InputField Component ─────────────────────
function InputField({ label, icon, id, ...props }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-bold text-secondary uppercase tracking-wider mb-2">
        {label}
      </label>
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary">
          {icon}
        </div>
        <input
          id={id}
          className="w-full bg-white border border-outline-variant/50 rounded-lg pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-container/30 focus:border-primary-container transition-all"
          {...props}
        />
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────
export default function StudentProfile() {
  const [searchCode, setSearchCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [toast, setToast] = useState(null);

  const [classes, setClasses] = useState([]);
  const [form, setForm] = useState({ student_code: '', full_name: '', class_id: '', email: '' });
  const [faceData, setFaceData] = useState(null);   // { face_path, embedding, sharpness_score }
  const [aiResult, setAIResult] = useState(null);   // AI validate result
  const [previewUrl, setPreviewUrl] = useState(null);
  const [cameraOn, setCameraOn] = useState(false);

  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
      setPreviewUrl(null);
    } catch (err) {
      showToast('Không thể mở camera', 'error');
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(t => t.stop());
    }
    setCameraOn(false);
  };

  const captureImage = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      const file = new File([blob], 'snapshot.jpg', { type: 'image/jpeg' });
      handleImageUpload(file);
      stopCamera();
    }, 'image/jpeg', 0.9);
  };

  // Load danh sách lớp khi mount
  useEffect(() => {
    api.get('/students/classes').then(res => setClasses(res.data.data || []));
  }, []);

  // Auto-hide toast
  useEffect(() => {
    if (toast) { const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); }
  }, [toast]);

  const showToast = (message, type = 'success') => setToast({ message, type });

  // Tìm sinh viên theo mã
  const handleSearch = async () => {
    if (!searchCode.trim()) return;
    setLoading(true);
    try {
      const res = await api.get(`/students/${searchCode.trim().toUpperCase()}`);
      const d = res.data.data;
      setForm({
        student_code: d.student_code,
        full_name: d.full_name,
        class_id: String(d.class_id),
        email: d.email || '',
      });
      if (d.image_path) {
        setPreviewUrl(`/uploads/${d.image_path.replace('uploads/', '')}`);
      }
      showToast(`Đã tải thông tin: ${d.full_name}`);
    } catch (err) {
      if (err.response?.status === 404) {
        setForm(prev => ({ ...prev, student_code: searchCode.trim().toUpperCase() }));
        showToast('Sinh viên chưa có trong hệ thống. Điền thông tin để đăng ký.', 'error');
      } else {
        showToast('Lỗi kết nối. Kiểm tra backend đang chạy.', 'error');
      }
    } finally { setLoading(false); }
  };

  // Upload ảnh và validate với AI
  const handleImageUpload = async (file) => {
    if (!file) return;
    setPreviewUrl(URL.createObjectURL(file));
    setAIResult(null);
    setFaceData(null);
    setValidating(true);

    const formData = new FormData();
    formData.append('face_image', file);
    if (form.student_code) formData.append('student_code', form.student_code);

    try {
      const res = await api.post('/students/face/validate', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const d = res.data.data;
      setAIResult({ is_valid: true, message: res.data.message, sharpness_score: d.sharpness_score });
      setFaceData({ face_path: d.face_path, embedding: d.embedding });
    } catch (err) {
      const d = err.response?.data;
      setAIResult({
        is_valid: false,
        message: d?.message || 'Lỗi không xác định',
        sharpness_score: d?.sharpness_score || 0,
      });
    } finally { setValidating(false); }
  };

  // Lưu hồ sơ
  const handleSave = async () => {
    if (!form.student_code || !form.full_name) {
      return showToast('Vui lòng điền đủ: Mã SV, Họ tên', 'error');
    }
    if (!faceData) {
      return showToast('Vui lòng upload và xác thực ảnh khuôn mặt trước.', 'error');
    }
    setSaving(true);
    try {
      await api.post('/students/profile', {
        student_code: form.student_code,
        full_name: form.full_name,
        class_id: form.class_id ? parseInt(form.class_id) : null,
        email: form.email,
        face_path: faceData.face_path,
        embedding: faceData.embedding,
      });
      showToast('Lưu hồ sơ thành công!');
      setFaceData(null);
      setAIResult(null);
    } catch (err) {
      showToast(err.response?.data?.message || 'Lỗi khi lưu hồ sơ.', 'error');
    } finally { setSaving(false); }
  };

  const handleReset = () => {
    setForm({ student_code: '', full_name: '', class_id: '', email: '' });
    setFaceData(null); setAIResult(null); setPreviewUrl(null); setSearchCode('');
  };

  return (
    <main className="flex-grow bg-surface py-10 px-4 md:px-8">
      <Toast toast={toast} />
      <div className="max-w-5xl mx-auto">

        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-black text-on-surface mb-2">Cập nhật thông tin sinh viên</h1>
          <p className="text-secondary">Đăng ký hoặc cập nhật profile và dữ liệu khuôn mặt cho hệ thống điểm danh</p>
        </div>

        {/* Search Bar */}
        <div className="bg-white rounded-2xl border border-outline-variant/30 shadow-sm p-6 mb-6">
          <label className="block text-xs font-bold text-secondary uppercase tracking-wider mb-2">
            Tìm kiếm theo mã sinh viên
          </label>
          <div className="flex gap-3">
            <div className="relative flex-grow">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary" />
              <input
                type="text"
                placeholder="VD: B23DCCN312"
                value={searchCode}
                onChange={e => setSearchCode(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                className="w-full border border-outline-variant/50 rounded-lg pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-container/30 focus:border-primary-container transition-all uppercase"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={loading}
              className="flex items-center gap-2 bg-primary-container text-white font-bold px-6 py-3 rounded-lg hover:opacity-90 disabled:opacity-50 transition-all text-sm"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Tìm
            </button>
          </div>
        </div>

        {/* Main Form */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* LEFT: Face Upload */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-2xl border border-outline-variant/30 shadow-sm p-6">
              <h2 className="text-sm font-bold text-secondary uppercase tracking-wider mb-4">Ảnh khuôn mặt</h2>

              {/* Preview */}
              <div
                className="relative w-full aspect-square rounded-xl overflow-hidden bg-surface-container-low border-2 border-dashed border-outline-variant hover:border-primary-container transition-all group mb-4"
              >
                <video 
                  ref={videoRef} 
                  muted playsInline 
                  className={`w-full h-full object-cover ${cameraOn ? 'block' : 'hidden'}`} 
                />
                <canvas ref={canvasRef} className="hidden" />

                {!cameraOn && previewUrl ? (
                  <>
                    <img src={previewUrl} alt="preview" className="w-full h-full object-cover" />
                    <div onClick={() => fileInputRef.current?.click()} className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition-opacity">
                      <Camera className="w-8 h-8 text-white" />
                    </div>
                  </>
                ) : !cameraOn && !previewUrl ? (
                  <div onClick={() => fileInputRef.current?.click()} className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-secondary cursor-pointer">
                    <div className="w-16 h-16 rounded-full bg-surface-container-low border-2 border-dashed border-outline-variant flex items-center justify-center">
                      <Upload className="w-7 h-7" />
                    </div>
                    <span className="text-xs font-medium text-center px-4">
                      Click để upload ảnh<br />hoặc bật webcam bên dưới
                    </span>
                  </div>
                ) : null}

                {validating && (
                  <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                    <RefreshCw className="w-8 h-8 text-primary-container animate-spin" />
                  </div>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={e => { stopCamera(); handleImageUpload(e.target.files?.[0]); }}
              />

              <div className="flex gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 flex items-center justify-center gap-2 border-2 border-outline-variant/50 text-secondary font-semibold py-3 rounded-lg hover:border-primary-container hover:text-primary-container transition-all text-sm"
                >
                  <Upload className="w-4 h-4" />
                  Tải lên
                </button>
                {cameraOn ? (
                  <button
                    onClick={captureImage}
                    className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white font-semibold py-3 rounded-lg hover:bg-blue-700 transition-all text-sm"
                  >
                    <Camera className="w-4 h-4" />
                    Chụp
                  </button>
                ) : (
                  <button
                    onClick={startCamera}
                    className="flex-1 flex items-center justify-center gap-2 border-2 border-blue-200 text-blue-600 font-semibold py-3 rounded-lg hover:bg-blue-50 transition-all text-sm"
                  >
                    <Video className="w-4 h-4" />
                    Webcam
                  </button>
                )}
              </div>
            </div>

            {/* AI Feedback */}
            {validating && (
              <div className="bg-white rounded-xl border border-outline-variant/30 p-4 flex items-center gap-3">
                <RefreshCw className="w-5 h-5 text-primary-container animate-spin" />
                <span className="text-sm text-secondary">Đang phân tích ảnh...</span>
              </div>
            )}
            <AIBadge result={aiResult} />
          </div>

          {/* RIGHT: Info Form */}
          <div className="lg:col-span-3 bg-white rounded-2xl border border-outline-variant/30 shadow-sm p-6">
            <h2 className="text-sm font-bold text-secondary uppercase tracking-wider mb-6">Thông tin sinh viên</h2>

            <div className="space-y-5">
              <InputField
                label="Mã sinh viên *"
                id="student_code"
                icon={<GraduationCap className="w-4 h-4" />}
                value={form.student_code}
                onChange={e => setForm(p => ({ ...p, student_code: e.target.value.toUpperCase() }))}
                placeholder="VD: B23DCCN312"
              />
              <InputField
                label="Họ và tên *"
                id="full_name"
                icon={<User className="w-4 h-4" />}
                value={form.full_name}
                onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))}
                placeholder="VD: Trần Trung Hiếu"
              />

              {/* <div className="hidden">
                <label className="block text-xs font-bold text-secondary uppercase tracking-wider mb-2">
                  Lớp hành chính *
                </label>
                <select
                  id="class_id"
                  value={form.class_id}
                  onChange={e => setForm(p => ({ ...p, class_id: e.target.value }))}
                  className="w-full bg-white border border-outline-variant/50 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-container/30 focus:border-primary-container transition-all"
                >
                  <option value="">-- Chọn lớp --</option>
                  {classes.map(c => (
                    <option key={c.class_id} value={c.class_id}>{c.class_name}</option>
                  ))}
                </select>
              </div> */}

              <InputField
                label="Email"
                id="email"
                icon={<Mail className="w-4 h-4" />}
                type="email"
                value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                placeholder="VD: hieu.tt@student.ptit.edu.vn"
              />
            </div>

            {/* Lưu ý */}
            {!faceData && (
              <div className="mt-6 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-700">Upload và xác thực ảnh khuôn mặt trước khi lưu hồ sơ.</p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={handleReset}
                className="flex items-center gap-2 border border-outline-variant/50 text-secondary font-semibold px-5 py-3 rounded-lg hover:bg-surface-container-low transition-all text-sm"
              >
                <RefreshCw className="w-4 h-4" />
                Reset
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !faceData || !aiResult?.is_valid}
                className="flex-1 flex items-center justify-center gap-2 bg-primary-container text-white font-bold py-3 rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-sm shadow-sm"
              >
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {saving ? 'Đang lưu...' : 'Lưu hồ sơ'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
