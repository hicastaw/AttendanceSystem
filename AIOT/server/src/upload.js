import multer from 'multer';

const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(Object.assign(new Error('Chỉ chấp nhận ảnh định dạng JPG, PNG'),{status:400}), false);
  }
};

// Memory storage: ảnh đăng ký khuôn mặt chỉ đi qua RAM để forward sang AI Service,
// không cần lưu file tạm trên đĩa (khác upload.js cũ của project gốc).
export const uploadMemory = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0, parts: 2,
            fieldNameSize: 64, fieldArrayIndexLimit: 0 },
});

// R50 uses a separate bounded parser. Legacy single-image upload is unchanged.
const r50Image = multer({storage:multer.memoryStorage(),
  fileFilter:(_req,file,cb)=>['image/jpeg','image/jpg','image/png'].includes(file.mimetype)
    ? cb(null,true) : cb(Object.assign(new Error('Unsupported image'),{status:415,code:'unsupported_format'})),
  limits:{fileSize:5*1024*1024,files:1,fields:0,parts:1,fieldNameSize:64,fieldArrayIndexLimit:0}
}).single('face_image');

export function receiveR50Image(req,res,next) {
  if(!req.is('multipart/form-data'))return next();
  r50Image(req,res,error=>{
    if(error || !req.file) {
      req.file?.buffer?.fill(0);
      const status=error?.code==='LIMIT_FILE_SIZE'?413:error?.status || 400;
      return res.status(status).json({status:'error',code:status===413?'image_too_large':status===415?'unsupported_format':'invalid_image',
        message:'Exactly one bounded JPEG/PNG face_image is required.'});
    }
    next();
  });
}
