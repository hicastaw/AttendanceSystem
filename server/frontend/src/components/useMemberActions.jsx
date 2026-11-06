import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import { patchJson } from '../api/client.js';
import { DeleteMemberDialog, FaceRegisterDialog, MemberFormDialog } from './MemberDialogs.jsx';

// Hành động trên 1 thành viên (thêm, sửa, đăng ký mặt, khoá/mở, xoá) dùng chung cho
// trang Thành viên và trang chi tiết. `onChanged(code, action)` để trang tải lại dữ liệu.
export default function useMemberActions(onChanged) {
  const [dialog, setDialog] = useState(null); // { type: 'form'|'face'|'delete', member }
  const [toast, setToast] = useState(null); // { severity, message }

  const close = () => setDialog(null);
  const done = (message, code, action) => {
    setDialog(null);
    setToast({ severity: 'success', message });
    onChanged?.(code, action);
  };

  async function toggleLock(member) {
    const status = member.status === 'active' ? 'inactive' : 'active';
    try {
      await patchJson(`/users/${member.user_code}`, { status });
      done(status === 'inactive'
        ? `Đã khoá ${member.full_name}; thiết bị ở cửa sẽ không nhận diện người này nữa.`
        : `Đã mở khoá ${member.full_name}.`, member.user_code, 'status');
    } catch (err) {
      setToast({ severity: 'error', message: err.message });
    }
  }

  const actions = {
    add: () => setDialog({ type: 'form', member: null }),
    edit: (member) => setDialog({ type: 'form', member }),
    registerFace: (member) => setDialog({ type: 'face', member }),
    remove: (member) => setDialog({ type: 'delete', member }),
    toggleLock,
  };

  const elements = (
    <>
      <MemberFormDialog
        open={dialog?.type === 'form'}
        member={dialog?.member}
        onClose={close}
        onSaved={(code) => done(dialog?.member ? 'Đã lưu thông tin thành viên.' : `Đã thêm thành viên ${code}.`, code, dialog?.member ? 'edit' : 'add')}
      />
      <FaceRegisterDialog
        open={dialog?.type === 'face'}
        member={dialog?.member}
        onClose={close}
        onSaved={(code) => done(`Đã đăng ký khuôn mặt cho ${code}. Thiết bị ở cửa sẽ cập nhật trong khoảng 30 giây.`, code, 'face')}
      />
      <DeleteMemberDialog
        open={dialog?.type === 'delete'}
        member={dialog?.member}
        onClose={close}
        onDeleted={(code) => done(`Đã xoá thành viên ${code}.`, code, 'delete')}
      />
      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={5000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)}>{toast.message}</Alert> : undefined}
      </Snackbar>
    </>
  );

  return { actions, elements };
}
