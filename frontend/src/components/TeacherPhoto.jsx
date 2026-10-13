import { mediaUrl } from '../utils/format.js';
import { useEffect, useRef, useState } from 'react';

/**
 * Teacher photo tile with a letter fallback; a missing/failed/slow file never
 * shows a broken image. The letter stays visible until the photo has actually
 * loaded (identical gating to components/Avatar.jsx, rectangular variant).
 */
export default function TeacherPhoto({ teacher, className = '' }) {
  const [state, setState] = useState('loading'); // 'loading' | 'ok' | 'failed'
  const imgRef = useRef(null);
  const name = teacher?.name || '';
  const src = mediaUrl(teacher?.photo);

  // Cached images can finish before React attaches onLoad — re-check on mount.
  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0) setState('ok');
    else setState('loading');
  }, [src]);

  if (teacher?.photo && src && state !== 'failed') {
    return (
      <span className={`relative block ${className}`}>
        <span aria-hidden className="absolute inset-0 flex items-center justify-center bg-forest/10 font-black text-moss">
          {(name.trim().charAt(0) || '?').toUpperCase()}
        </span>
        <img
          ref={imgRef}
          src={src}
          alt={name}
          onLoad={() => setState('ok')}
          onError={() => setState('failed')}
          className={`h-full w-full object-cover transition-opacity ${state === 'ok' ? 'opacity-100' : 'opacity-0'}`}
        />
      </span>
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
