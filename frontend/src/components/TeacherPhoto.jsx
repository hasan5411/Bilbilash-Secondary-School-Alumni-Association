import { mediaUrl } from '../utils/format.js';
import { useEffect, useRef, useState } from 'react';

/**
 * Teacher photo tile with a letter fallback; a missing/failed file never shows
 * a broken image.
 *
 * Painting order matters: an absolutely-positioned element (the fallback
 * letter) paints ABOVE a static one regardless of DOM order, which is exactly
 * why the letter used to sit on top of a perfectly good photograph. So the
 * <img> is `relative` (same trick as components/Avatar.jsx) and the letter is
 * only rendered while the file is still loading or has failed — once the photo
 * is up, no letter element exists at all, so nothing can bleed through it.
 */
export default function TeacherPhoto({ teacher, className = '' }) {
  const [state, setState] = useState('loading'); // 'loading' | 'ok' | 'failed'
  const imgRef = useRef(null);
  const name = teacher?.name || '';
  const src = mediaUrl(teacher?.photo);
  const initial = (name.trim().charAt(0) || '?').toUpperCase();

  // Cached images can finish before React attaches onLoad — re-check on mount.
  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0) setState('ok');
    else setState('loading');
  }, [src]);

  if (!src || state === 'failed') {
    return (
      <div
        role="img"
        aria-label={name}
        className={`flex items-center justify-center bg-forest/10 font-black text-moss ${className}`}
      >
        {initial}
      </div>
    );
  }

  return (
    <span className={`relative block ${className}`}>
      {state !== 'ok' && (
        <span aria-hidden className="absolute inset-0 flex items-center justify-center bg-forest/10 font-black text-moss">
          {initial}
        </span>
      )}
      <img
        ref={imgRef}
        src={src}
        alt={name}
        onLoad={() => setState('ok')}
        onError={() => setState('failed')}
        className={`relative h-full w-full object-cover transition-opacity ${state === 'ok' ? 'opacity-100' : 'opacity-0'}`}
      />
    </span>
  );
}
