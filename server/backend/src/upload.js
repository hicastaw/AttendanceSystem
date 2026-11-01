import multer from 'multer';

const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Chỉ chấp nhận ảnh định dạng JPG, PNG, WEBP'), false);
  }
};

// Memory storage: ảnh đăng ký khuôn mặt chỉ đi qua RAM để forward sang AI Service,
// không cần lưu file tạm trên đĩa (khác upload.js cũ của project gốc).
export const uploadMemory = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});
