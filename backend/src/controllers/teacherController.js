import fs from 'node:fs';
import { listTeachers, getTeacherById, createTeacher, updateTeacher, deleteTeacher } from '../services/teacherService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { uploadImageMiddleware, assertImageMagic } from '../middleware/upload.js';
import { validate, parsePositiveId } from '../utils/validate.js';

export const list = asyncHandler(async (_req, res) => {
  const teachers = await listTeachers();
  res.json({ success: true, data: { teachers } });
});

export const getOne = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'teacher id');
  const teacher = await getTeacherById(id);
  res.json({ success: true, data: { teacher } });
});

const teacherRules = {
  name: { type: 'string', required: true, max: 120 },
  subject: { type: 'string', max: 120 },
  designation: { type: 'string', max: 120 },
  institution: { type: 'string', max: 150 },
  description: { type: 'string', max: 500 },
};

export const create = [
  uploadImageMiddleware,
  asyncHandler(async (req, res) => {
    const data = validate(req.body, teacherRules);
    let photoFilename;
    if (req.file) {
      assertImageMagic(fs.readFileSync(req.file.path));
      photoFilename = req.file.filename;
    }
    const result = await createTeacher(req.user, data, photoFilename);
    res.status(201).json({ success: true, message: 'Teacher added', data: result });
  }),
];

export const update = [
  uploadImageMiddleware,
  asyncHandler(async (req, res) => {
    const id = parsePositiveId(req.params.id, 'teacher id');
    const data = validate(req.body, teacherRules);
    let photoFilename;
    if (req.file) {
      assertImageMagic(fs.readFileSync(req.file.path));
      photoFilename = req.file.filename;
    }
    const result = await updateTeacher(id, data, photoFilename);
    res.json({ success: true, message: 'Teacher updated', data: result });
  }),
];

export const remove = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'teacher id');
  const result = await deleteTeacher(id);
  res.json({ success: true, message: 'Teacher removed', data: result });
});
