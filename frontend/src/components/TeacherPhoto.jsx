import { useState } from 'react';

/** Teacher photo with a letter-avatar fallback; a missing/failed file never shows a broken image. */
export default function TeacherPhoto({ teacher, className = '' }) {
  const [failed, setFailed] = useState(false);
  const name = teacher?.name || '';

  if (teacher?.photo && !failed) {
    return (
      <img
        src={`/uploads/${teacher.photo}`}
        alt={name}
        onError={() => setFailed(true)}
        className={`object-cover ${className}`}
      />
    );
  }
  return (
    <div
      role="img"
      aria-label={name}
      className={`flex items-center justify-center bg-forest/10 font-black text-moss ${className}`}
    >
      {(name.trim().charAt(0) || '?').toUpperCase()}
    </div>
  );
}
