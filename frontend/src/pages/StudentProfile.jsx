import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import {
  Upload, CheckCircle2, XCircle, AlertCircle,
  User, Mail, GraduationCap, Save, RefreshCw, Camera, Video, BookOpen, Users,
  Search, UserSearch,
} from 'lucide-react';

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

function formatSection(section) {
  return `${section.course_code} - ${section.course_name} • ${section.class_code} • ${section.schedule_note || 'Chưa có lịch'} • GV: ${section.lecturer_name}`;
}

export default function StudentProfile() {
  const { actor, isAdmin, isStudent, refreshCurrentUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [toast, setToast] = useState(null);
  const [dataLoaded, setDataLoaded] = useState(false);

  // Admin-only: search by student code
  const [searchCode, setSearchCode] = useState('');
  const [searching, setSearching] = useState(false);

  const [classes, setClasses] = useState([]);
  const [allSections, setAllSections] = useState([]);
  const [form, setForm] = useState({ student_code: '', full_name: '', class_id: '', email: '' });
  const [selectedSections, setSelectedSections] = useState([]);
  const [faceData, setFaceData] = useState(null);
  const [aiResult, setAIResult] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [existingImageUrl, setExistingImageUrl] = useState(null);
  const [cameraOn, setCameraOn] = useState(false);

  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    return () => {
      stopCamera();
      if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Load base data and auto-load student info on mount
  useEffect(() => {
    const init = async () => {
      const [classRes, sectionRes] = await Promise.all([
        api.get('/students/classes'),
        api.get('/students/course-sections'),
      ]);
      setClasses(classRes.data.data || []);
      setAllSections(sectionRes.data.data || []);

      // Auto-load student profile if student role
      const code = actor?.studentCode || '';
      if (code) {
        await loadStudentData(code);
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3500);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const showToast = (message, type = 'success') => setToast({ message, type });

  // Admin-only: search a student by code
  const handleSearch = async () => {
    const code = searchCode.trim().toUpperCase();
    if (!code) return showToast('Vui lòng nhập mã sinh viên để tra cứu.', 'error');
    setSearching(true);
    try {
      await loadStudentData(code);
      showToast(`Đã tải hồ sơ sinh viên: ${code}`);
    } catch {
      showToast('Không tìm thấy sinh viên với mã này.', 'error');
    } finally {
      setSearching(false);
    }
  };

  const classSections = useMemo(() => {
    if (!form.class_id) return [];
    return allSections.filter(section => String(section.class_id) === String(form.class_id));
  }, [allSections, form.class_id]);

  useEffect(() => {
    if (!form.class_id) {
      setSelectedSections([]);
      return;
    }
    setSelectedSections(prev => prev.filter(id => classSections.some(section => String(section.section_id) === String(id))));
  }, [form.class_id, classSections]);

  const loadStudentData = async (code) => {
    if (!code) return;
    setLoading(true);
    try {
      const res = await api.get(`/students/${code}`);
      const d = res.data.data;
      setForm({
        student_code: d.student_code,
        full_name: d.full_name,
        class_id: String(d.class_id),
        email: d.email || '',
      });
      setSelectedSections((d.enrollment_section_ids || []).map(String));
      if (d.image_path) {
        const url = `/uploads/${d.image_path.replace(/^uploads\//, '')}`;
        setPreviewUrl(url);
        setExistingImageUrl(url);
      } else {
        setPreviewUrl(null);
        setExistingImageUrl(null);
      }
      setFaceData(null);
      setAIResult(null);
      setDataLoaded(true);
    } catch (err) {
      // Student not yet in DB → just populate student_code
      setForm(prev => ({ ...prev, student_code: code }));
      if (err.response?.status !== 404) {
        showToast('Lỗi kết nối. Kiểm tra backend đang chạy.', 'error');
      }
      setDataLoaded(true);
    } finally {
      setLoading(false);
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch {
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

  const handleImageUpload = async (file) => {
    if (!file) return;
    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
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
    } finally {
      setValidating(false);
    }
  };

  const toggleSection = (sectionId) => {
    setSelectedSections((prev) => prev.includes(String(sectionId))
      ? prev.filter((id) => id !== String(sectionId))
      : [...prev, String(sectionId)]);
  };

  const handleSave = async () => {
    if (!form.student_code || !form.full_name || !form.class_id) {
      return showToast('Vui lòng điền đủ: Mã SV, Họ tên, Lớp hành chính', 'error');
    }
    if (!faceData && !existingImageUrl) {
      return showToast('Vui lòng upload và xác thực ảnh khuôn mặt trước.', 'error');
    }
    setSaving(true);
    try {
      await api.post('/students/profile', {
        student_code: form.student_code,
        full_name: form.full_name,
        class_id: Number(form.class_id),
        email: form.email,
        face_path: faceData?.face_path || null,
        embedding: faceData?.embedding || null,
        enrollment_section_ids: selectedSections.map(Number),
      });
      showToast('Lưu hồ sơ và đăng ký học phần thành công!');
      setExistingImageUrl(previewUrl || existingImageUrl);
      setFaceData(null);
      setAIResult(null);
      // Refresh account info so header/navbar reflects the updated name & email
      await refreshCurrentUser();
    } catch (err) {
      showToast(err.response?.data?.message || 'Lỗi khi lưu hồ sơ.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    const code = isStudent ? actor.studentCode : '';
    setForm({ student_code: code, full_name: '', class_id: '', email: '' });
    setSelectedSections([]);
    setFaceData(null);
    setAIResult(null);
    setPreviewUrl(null);
    setExistingImageUrl(null);
    setDataLoaded(false);
    if (code) loadStudentData(code);
  };

  return (
    <main className="flex-grow bg-surface py-10 px-4 md:px-8">
      <Toast toast={toast} />
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-black text-on-surface mb-2">Cập nhật thông tin sinh viên</h1>
          <p className="text-secondary">Đăng ký profile, ảnh khuôn mặt và học phần để tham gia đúng các phiên điểm danh giáo viên tạo.</p>
          {isStudent && (
            <p className="text-sm text-primary-container font-semibold mt-2">Bạn đang thao tác với quyền sinh viên: {actor.studentCode}. Mã sinh viên được khóa theo phiên hiện tại.</p>
          )}
        </div>

        {/* ── Admin-only: Student Lookup Panel ── */}
        {isAdmin && (
          <div className="mb-8 bg-white rounded-2xl border border-outline-variant/30 shadow-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
                <UserSearch className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-on-surface">Tra cứu sinh viên</h2>
                <p className="text-xs text-secondary">Nhập mã sinh viên để tải hồ sơ và chỉnh sửa thông tin.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="relative flex-1">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary">
                  <GraduationCap className="w-4 h-4" />
                </div>
                <input
                  id="admin-search-code"
                  type="text"
                  value={searchCode}
                  onChange={e => setSearchCode(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="VD: B23DCCN312"
                  className="w-full bg-white border border-outline-variant/50 rounded-lg pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 transition-all"
                />
              </div>
              <button
                id="admin-search-btn"
                onClick={handleSearch}
                disabled={searching || loading}
                className="flex items-center gap-2 bg-indigo-600 text-white font-bold px-6 py-3 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm shadow-sm"
              >
                {searching
                  ? <RefreshCw className="w-4 h-4 animate-spin" />
                  : <Search className="w-4 h-4" />
                }
                {searching ? 'Đang tìm...' : 'Tìm kiếm'}
              </button>
            </div>
            {dataLoaded && form.student_code && (
              <div className="mt-3 flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Đang hiển thị hồ sơ của sinh viên: <span className="font-bold">{form.student_code}</span>
              </div>
            )}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-3 py-10 text-secondary">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span className="text-sm">Đang tải thông tin...</span>
          </div>
        )}

        {!loading && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-white rounded-2xl border border-outline-variant/30 shadow-sm p-6">
                <h2 className="text-sm font-bold text-secondary uppercase tracking-wider mb-4">Ảnh khuôn mặt</h2>

                <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-surface-container-low border-2 border-dashed border-outline-variant hover:border-primary-container transition-all group mb-4">
                  <video ref={videoRef} muted playsInline className={`w-full h-full object-cover ${cameraOn ? 'block' : 'hidden'}`} />
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
                  <button onClick={() => fileInputRef.current?.click()} className="flex-1 flex items-center justify-center gap-2 border-2 border-outline-variant/50 text-secondary font-semibold py-3 rounded-lg hover:border-primary-container hover:text-primary-container transition-all text-sm">
                    <Upload className="w-4 h-4" />Tải lên
                  </button>
                  {cameraOn ? (
                    <button onClick={captureImage} className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white font-semibold py-3 rounded-lg hover:bg-blue-700 transition-all text-sm">
                      <Camera className="w-4 h-4" />Chụp
                    </button>
                  ) : (
                    <button onClick={startCamera} className="flex-1 flex items-center justify-center gap-2 border-2 border-blue-200 text-blue-600 font-semibold py-3 rounded-lg hover:bg-blue-50 transition-all text-sm">
                      <Video className="w-4 h-4" />Webcam
                    </button>
                  )}
                </div>
              </div>

              {validating && (
                <div className="bg-white rounded-xl border border-outline-variant/30 p-4 flex items-center gap-3">
                  <RefreshCw className="w-5 h-5 text-primary-container animate-spin" />
                  <span className="text-sm text-secondary">Đang phân tích ảnh...</span>
                </div>
              )}
              <AIBadge result={aiResult} />
            </div>

            <div className="lg:col-span-3 bg-white rounded-2xl border border-outline-variant/30 shadow-sm p-6">
              <h2 className="text-sm font-bold text-secondary uppercase tracking-wider mb-6">Thông tin sinh viên &amp; đăng ký học phần</h2>

              <div className="space-y-5">
                <InputField label="Mã sinh viên *" id="student_code" icon={<GraduationCap className="w-4 h-4" />} value={form.student_code} onChange={e => setForm(p => ({ ...p, student_code: e.target.value.toUpperCase() }))} placeholder="VD: B23DCCN312" disabled={isStudent && !isAdmin} />
                <InputField label="Họ và tên *" id="full_name" icon={<User className="w-4 h-4" />} value={form.full_name} onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))} placeholder="VD: Trần Trung Hiếu" />

                <div>
                  <label className="block text-xs font-bold text-secondary uppercase tracking-wider mb-2">Lớp hành chính *</label>
                  <select
                    id="class_id"
                    value={form.class_id}
                    onChange={e => setForm(p => ({ ...p, class_id: e.target.value }))}
                    className="w-full bg-white border border-outline-variant/50 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-container/30 focus:border-primary-container transition-all"
                  >
                    <option value="">-- Chọn lớp --</option>
                    {classes.map(c => (
                      <option key={c.class_id} value={c.class_id}>{c.class_name} ({c.class_code})</option>
                    ))}
                  </select>
                </div>

                <InputField label="Email" id="email" icon={<Mail className="w-4 h-4" />} type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="VD: hieu.tt@student.ptit.edu.vn" />

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <BookOpen className="w-4 h-4 text-secondary" />
                    <label className="block text-xs font-bold text-secondary uppercase tracking-wider">Đăng ký học phần của lớp</label>
                  </div>
                  <p className="text-xs text-secondary mb-3">Các học phần đã chọn sẽ là cơ sở để giáo viên tạo phiên điểm danh và để sinh viên nhìn thấy đúng phiên của mình ở trang scan.</p>

                  {!form.class_id ? (
                    <div className="rounded-xl border border-dashed border-outline-variant/50 p-4 text-sm text-secondary bg-surface-container-low">
                      Chọn lớp hành chính trước để hiện danh sách học phần phù hợp.
                    </div>
                  ) : classSections.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-outline-variant/50 p-4 text-sm text-secondary bg-surface-container-low">
                      Lớp này hiện chưa có học phần để đăng ký.
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-72 overflow-auto pr-1">
                      {classSections.map(section => {
                        const checked = selectedSections.includes(String(section.section_id));
                        return (
                          <label key={section.section_id} className={`flex items-start gap-3 rounded-xl border p-4 cursor-pointer transition-all ${checked ? 'border-primary-container bg-primary-container/5' : 'border-outline-variant/30 hover:border-primary-container/40'}`}>
                            <input type="checkbox" checked={checked} onChange={() => toggleSection(section.section_id)} className="mt-1" />
                            <div className="min-w-0">
                              <div className="font-semibold text-on-surface">{section.course_code} - {section.course_name}</div>
                              <div className="text-sm text-secondary mt-1">{section.schedule_note || 'Chưa có ghi chú lịch học'} • GV: {section.lecturer_name}</div>
                              <div className="text-xs text-secondary mt-1 flex items-center gap-2">
                                <Users className="w-3.5 h-3.5" />
                                Đã có {section.enrolled_count} sinh viên đăng ký
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                {selectedSections.length > 0 && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <p className="text-sm font-bold text-emerald-700 mb-2">Học phần đã chọn ({selectedSections.length})</p>
                    <div className="space-y-2 text-xs text-emerald-800">
                      {classSections.filter(section => selectedSections.includes(String(section.section_id))).map(section => (
                        <div key={section.section_id}>{formatSection(section)}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {!faceData && (
                <div className="mt-6 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-700">Cần có hồ sơ khuôn mặt hợp lệ trước khi lưu. Nếu sinh viên đã có ảnh trong hệ thống, bạn có thể chỉ cập nhật lớp và học phần mà không cần tải lại ảnh.</p>
                </div>
              )}

              <div className="flex gap-3 mt-6">
                <button onClick={handleReset} className="flex items-center gap-2 border border-outline-variant/50 text-secondary font-semibold px-5 py-3 rounded-lg hover:bg-surface-container-low transition-all text-sm">
                  <RefreshCw className="w-4 h-4" />Reset
                </button>
                <button onClick={handleSave} disabled={saving || (!faceData && !existingImageUrl) || (!!faceData && !aiResult?.is_valid)} className="flex-1 flex items-center justify-center gap-2 bg-primary-container text-white font-bold py-3 rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-sm shadow-sm">
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {saving ? 'Đang lưu...' : 'Lưu hồ sơ'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
