import { query, queryOne } from '../db/pool.js';
import { removeUpload } from '../storage.js';

export async function listTeachers() {
  return query(`SELECT teacher_id, name, subject, designation, institution, photo, description, created_at FROM teachers ORDER BY name LIMIT 500`);
}

/** Public columns only — never expose created_by or other private data. */
export async function getTeacherById(teacherId) {
  const teacher = await queryOne(
    `SELECT teacher_id, name, subject, designation, institution, photo, description, created_at FROM teachers WHERE teacher_id = ? LIMIT 1`,
    [teacherId]
  );
  if (!teacher) {
    const err = new Error('Teacher not found');
    err.status = 404;
    throw err;
  }
  return teacher;
}

export async function createTeacher(user, data, photoFilename) {
  const res = await query(
    `INSERT INTO teachers (created_by, name, subject, designation, institution, photo, description) VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING teacher_id`,
    [user.user_id, data.name, data.subject || null, data.designation || null, data.institution || null, photoFilename || null, data.description || null]
  );
  return { teacher_id: res.insertId };
}

export async function updateTeacher(teacherId, data, photoFilename) {
  const previous = photoFilename !== undefined
    ? await queryOne(`SELECT photo FROM teachers WHERE teacher_id = ? LIMIT 1`, [teacherId])
    : null;

  await query(
    `UPDATE teachers SET name = ?, subject = ?, designation = ?, institution = ?, description = ?${photoFilename !== undefined ? ', photo = ?' : ''} WHERE teacher_id = ?`,
    photoFilename !== undefined
      ? [data.name, data.subject || null, data.designation || null, data.institution || null, data.description || null, photoFilename, teacherId]
      : [data.name, data.subject || null, data.designation || null, data.institution || null, data.description || null, teacherId]
  );

  // The row now points at the new photo; drop the old file if it is no longer referenced.
  if (previous?.photo && previous.photo !== photoFilename) {
    removePhotoFile(previous.photo);
  }
  return { teacher_id: teacherId };
}

export async function deleteTeacher(teacherId) {
  const existing = await queryOne(`SELECT photo FROM teachers WHERE teacher_id = ? LIMIT 1`, [teacherId]);
  const res = await query(`DELETE FROM teachers WHERE teacher_id = ?`, [teacherId]);
  if (res.affectedRows === 0) {
    const err = new Error('Teacher not found');
    err.status = 404;
    throw err;
  }
  if (existing?.photo) removePhotoFile(existing.photo);
  return { deleted: true };
}

/** Remove the stored photo (local file or cloud object) — same fail-safe pattern as galleryService. */
function removePhotoFile(filename) {
  removeUpload(filename); // best-effort, never throws
}
