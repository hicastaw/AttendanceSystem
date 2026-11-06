import { useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import VideocamOutlinedIcon from '@mui/icons-material/VideocamOutlined';
import { api, apiDelete, patchJson, postJson } from '../api/client.js';

// --- Thêm / sửa thành viên ----------------------------------------------------

export function MemberFormDialog({ open, member, onClose, onSaved }) {
  const editing = Boolean(member);
  const [form, setForm] = useState({ user_code: '', full_name: '', email: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ user_code: member?.user_code || '', full_name: member?.full_name || '', email: member?.email || '' });
      setError('');
    }
  }, [open, member]);

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const missing = !form.full_name.trim() || (!editing && !form.user_code.trim());

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editing) {
        await patchJson(`/users/${member.user_code}`, { full_name: form.full_name, email: form.email });
      } else {
        await postJson('/users', form);
      }
      onSaved(editing ? member.user_code : form.user_code.trim().toUpperCase());
    } catch (err) {
      setError(err.status === 409 ? `Mã ${form.user_code.trim().toUpperCase()} đã được dùng cho thành viên khác.` : err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs" component="form" onSubmit={handleSubmit}>
      <DialogTitle>{editing ? 'Sửa thông tin thành viên' : 'Thêm thành viên'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Mã thành viên"
            value={form.user_code}
            onChange={update('user_code')}
            disabled={editing}
            required
            autoFocus={!editing}
            helperText={editing ? 'Mã không đổi được sau khi tạo.' : 'Ví dụ NV001 — tự viết hoa.'}
          />
          <TextField label="Họ tên" value={form.full_name} onChange={update('full_name')} required autoFocus={editing} />
          <TextField label="Email" type="email" value={form.email} onChange={update('email')} helperText="Không bắt buộc" />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Huỷ</Button>
        <Button type="submit" variant="contained" disabled={saving || missing}>
          {saving ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Thêm thành viên'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// --- Đăng ký khuôn mặt ----------------------------------------------------------

const FACE_TIPS = 'Nhìn thẳng vào camera, đủ sáng, không đeo khẩu trang; chỉ một khuôn mặt trong khung.';

export function FaceRegisterDialog({ open, member, onClose, onSaved }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileRef = useRef(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [blob, setBlob] = useState(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  };

  useEffect(() => {
    if (!open) {
      stopCamera();
      setBlob(null);
      setPreview('');
      setError('');
    }
    return stopCamera;
  }, [open]);

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  async function startCamera() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      streamRef.current = stream;
      setCameraOn(true);
      requestAnimationFrame(() => { if (videoRef.current) videoRef.current.srcObject = stream; });
    } catch (err) {
      setError(`Không mở được camera của máy tính (${err.message}). Có thể tải ảnh lên thay thế.`);
    }
  }

  function setImage(next) {
    setBlob(next);
    setPreview(URL.createObjectURL(next));
    setError('');
  }

  function capture() {
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob((b) => b && setImage(b), 'image/jpeg', 0.92);
    stopCamera();
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      const body = new FormData();
      body.append('face_image', blob, 'face.jpg');
      await api(`/users/${member.user_code}/face`, { method: 'POST', body });
      onSaved(member.user_code);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Đăng ký khuôn mặt · {member?.full_name}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>{FACE_TIPS}</DialogContentText>
        <Box
          sx={{
            height: 380, width: '100%', bgcolor: 'action.hover', borderRadius: 1, overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {cameraOn && <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
          {!cameraOn && preview && <img src={preview} alt="Ảnh khuôn mặt sẽ đăng ký" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
          {!cameraOn && !preview && (
            <Typography variant="body2" color="text.secondary">Bật camera hoặc tải ảnh lên để xem trước</Typography>
          )}
        </Box>
        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          {cameraOn ? (
            <Button variant="contained" startIcon={<PhotoCameraOutlinedIcon />} onClick={capture}>Chụp ảnh</Button>
          ) : (
            <Button variant="outlined" startIcon={<VideocamOutlinedIcon />} onClick={startCamera}>
              {preview ? 'Chụp lại' : 'Bật camera'}
            </Button>
          )}
          <Button variant="outlined" startIcon={<UploadFileOutlinedIcon />} onClick={() => fileRef.current?.click()}>
            Tải ảnh lên
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { stopCamera(); setImage(f); } e.target.value = ''; }}
          />
        </Stack>
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Huỷ</Button>
        <Button
          variant="contained"
          onClick={save}
          disabled={!blob || saving || cameraOn}
          startIcon={saving ? <CircularProgress size={18} color="inherit" /> : null}
        >
          {saving ? 'Đang kiểm tra ảnh…' : 'Lưu khuôn mặt'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// --- Xoá thành viên ------------------------------------------------------------

export function DeleteMemberDialog({ open, member, onClose, onDeleted }) {
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => { if (open) setError(''); }, [open]);

  async function handleDelete() {
    setDeleting(true);
    try {
      await apiDelete(`/users/${member.user_code}`);
      onDeleted(member.user_code);
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Xoá {member?.full_name}?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Xoá {member?.user_code} sẽ xoá luôn khuôn mặt đã đăng ký và toàn bộ lịch sử ra/vào của người này.
          Không khôi phục được. Nếu chỉ muốn tạm ngưng, hãy dùng <b>Khoá</b>.
        </DialogContentText>
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Huỷ</Button>
        <Button color="error" variant="contained" onClick={handleDelete} disabled={deleting}>
          {deleting ? 'Đang xoá…' : 'Xoá vĩnh viễn'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
