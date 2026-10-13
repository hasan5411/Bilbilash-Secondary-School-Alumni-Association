import { useEffect, useRef, useState } from 'react';
import { mediaUrl } from '../utils/format.js';

/**
 * Avatar with the project's letter-avatar fallback.
 *
 * Behaviour (spec):
 *   - no photo ref           -> initials (or a single letter for teachers)
 *   - photo still loading    -> initials stay visible underneath
 *   - photo loaded           -> image fades in over the initials
 *   - broken URL / 404 / CORS-> initials again (never a broken-image icon)
 *
 * The <img> stays mounted while "invisible" so the browser actually fetches
 * the file; onLoad reveals it, onError permanently falls back.
 *
 * `className` carries the size (e.g. "h-11 w-11"); `textClass` the initials'
 * typography, matching each call site's original design exactly.
 */
export default function Avatar({ name = '', photoRef, className = '', textClass = 'font-bold', single = false }) {
  const [state, setState] = useState('loading'); // 'loading' | 'ok' | 'failed'
  const imgRef = useRef(null);
  const src = mediaUrl(photoRef);

  // Cached images can finish BEFORE React attaches onLoad — check on mount and
  // whenever the ref changes so a fast/cached image never sticks on "loading".
  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0) setState('ok');
    else setState('loading');
  }, [src]);

  const parts = String(name).trim().split(/\s+/);
  const initials = single
    ? (parts[0]?.[0] || '?').toUpperCase()
    : `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`.toUpperCase() || '?';

  if (!src || state === 'failed') {
    return (
      <div role="img" aria-label={name}
        className={`flex items-center justify-center rounded-full bg-forest/10 text-moss ${className} ${textClass}`}>
        {initials}
      </div>
    );
  }

  return (
    <div role="img" aria-label={name} className={`relative ${className}`}>
      <div className="absolute inset-0 flex items-center justify-center rounded-full bg-forest/10 text-moss">
        <span className={textClass}>{initials}</span>
      </div>
      <img
        ref={imgRef}
        src={src}
        alt={name}
        loading="lazy"
        onLoad={() => setState('ok')}
        onError={() => setState('failed')}
        className={`relative h-full w-full rounded-full object-cover transition-opacity ${state === 'ok' ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
}
