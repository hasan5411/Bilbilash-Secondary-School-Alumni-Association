import fs from 'node:fs';
import path from 'node:path';
import { getOwnProfile, updateOwnProfile, validateBloodGroup } from '../services/profileService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { uploadImageMiddleware, assertImageMagic } from '../middleware/upload.js';
import { persistUpload } from '../storage.js';
import { validate } from '../utils/validate.js';

export const getProfile = asyncHandler(async (req, res) => {
  const profile = await getOwnProfile(req.user.user_id);
  res.json({ success: true, data: { profile } });
});

/** PUT /api/profile — multipart/form-data. Ownership implicit: req.user only. */
export const updateProfile = [
  uploadImageMiddleware,
  asyncHandler(async (req, res) => {
    const data = validate(req.body, {
      first_name: { type: 'string', required: true, max: 60 },
      last_name: { type: 'string', required: true, max: 60 },
      phone: { type: 'string', max: 20 },
      registration_number: { type: 'string', required: true, max: 50 },
      ssc_batch: { type: 'int', min: 1960, max: 2100 },
      blood_group: { type: 'enum', values: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
      profession: { type: 'string', max: 120 },
      institute: { type: 'string', max: 120 },
      present_address: { type: 'string', required: true, max: 255 },
      permanent_address: { type: 'string', required: true, max: 255 },
      bio: { type: 'string', max: 500 },
      facebook_url: { type: 'string', max: 255, pattern: {
        // Optional; when present must be a real http(s) Facebook URL (facebook.com / fb.com / m.facebook.com etc.).
        re: /^(https?:\/\/([a-z0-9-]+\.)+facebook\.com\/\S*|https?:\/\/(www\.)?fb\.com\/\S*)$/i,
        message: 'facebook_url must be a valid Facebook profile URL (https://www.facebook.com/username)',
      } },
      active_donor: { type: 'boolean' },
    });
    validateBloodGroup(data.blood_group);

    let photoFilename;
    if (req.file) {
      // Re-check content: reject renamed executables disguised as images.
      const buffer = fs.readFileSync(req.file.path);
      assertImageMagic(buffer);
      photoFilename = await persistUpload(req.file); // local filename, or cloud URL when configured
      // Best-effort cleanup of a previous avatar file is intentionally skipped (simplicity).
      void path;
    }
    const profile = await updateOwnProfile(req.user.user_id, data, photoFilename);
    res.json({ success: true, message: 'Profile updated', data: { profile } });
  }),
];
