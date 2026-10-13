import multer from 'multer';
import path from 'node:path';
import { ApiError } from '../utils/errors.js';
import { uploadDir } from '../config/env.js';

const ALLOWED = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    // Never trust the original filename — generate a safe one.
    const ext = ALLOWED[file.mimetype] || path.extname(file.originalname).toLowerCase();
    const safe = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
    cb(null, safe);
  },
});

const fileFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED[file.mimetype]) return cb(new ApiError(422, 'Only JPG, PNG, WEBP, or GIF images are allowed'));
  if (!Object.values(ALLOWED).includes(ext)) return cb(new ApiError(422, 'File extension does not match an image type'));
  cb(null, true);
};

export const uploadImage = multer({
  storage,
  fileFilter,
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
}).single('image');

/** Wrap multer errors into ApiError (size too large, wrong field name, etc). */
export function uploadImageMiddleware(req, res, next) {
  uploadImage(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(new ApiError(422, 'Image must be 3 MB or smaller'));
    if (err.message) return next(new ApiError(422, err.message));
    next(err);
  });
}

/** Basic magic-number sniffing so renamed executables are rejected. */
export function assertImageMagic(buffer) {
  if (!buffer || buffer.length < 12) throw new ApiError(422, 'Invalid image file');
  const b = buffer;
  const isJpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const isPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const isGif = b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46;
  const isWebp = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45;
  if (!(isJpeg || isPng || isGif || isWebp)) throw new ApiError(422, 'File content is not a valid image');
}
