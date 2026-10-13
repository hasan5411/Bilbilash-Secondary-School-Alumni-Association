import fs from 'node:fs';
import path from 'node:path';
import { listGallery, submitGalleryItem, moderateGalleryItem, deleteGalleryItem } from '../services/galleryService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { uploadImageMiddleware, assertImageMagic } from '../middleware/upload.js';
import { persistUpload, removeUpload, STORAGE_BUCKETS, GALLERY_IMAGE_MAX_BYTES } from '../storage.js';
import { validate, parsePositiveId } from '../utils/validate.js';

export const list = asyncHandler(async (req, res) => {
  const items = await listGallery(req.user || null);
  res.json({ success: true, data: { items } });
});

export const submit = [
  uploadImageMiddleware,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      res.status(422).json({ success: false, message: 'An image file is required (field name: image)' });
      return;
    }
    assertImageMagic(fs.readFileSync(req.file.path));
    // 3 MB cap (gallery-images bucket limit) + gallery/ prefix organization.
    const imageRef = await persistUpload(req.file, {
      bucket: STORAGE_BUCKETS.galleryImages, prefix: 'gallery', maxBytes: GALLERY_IMAGE_MAX_BYTES,
    });
    const caption = (req.body.caption || '').toString().slice(0, 200);
    let data;
    try {
      data = await submitGalleryItem(req.user, imageRef, caption);
    } catch (err) {
      // DB save failed after a successful upload — do not leave an orphan object.
      await removeUpload(imageRef);
      throw err;
    }
    res.status(201).json({ success: true, message: 'Photo submitted for moderation', data });
  }),
];

export const moderate = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'gallery id');
  const data = validate(req.body, { action: { type: 'enum', values: ['approve', 'reject'], required: true } });
  const result = await moderateGalleryItem(req.user, id, data.action);
  res.json({ success: true, message: `Photo ${data.action}d`, data: result });
});

export const remove = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'gallery id');
  const data = validate(req.body, { reason: { type: 'string', minLength: 1, maxLength: 500 } });
  const result = await deleteGalleryItem(id);
  res.json({ success: true, message: `Photo deleted (reason: ${data.reason})`, data: result });
});
