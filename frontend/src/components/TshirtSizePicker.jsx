import { useState } from 'react';
import { api } from '../api/client.js';
import { Button } from './ui.jsx';

const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

/**
 * Member-side T-shirt size control for an event whose registration is
 * confirmed. The backend re-checks ownership, event configuration and payment
 * status on every save — this UI only decides where to show the control.
 */
export default function TshirtSizePicker({ eventId, size, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(size || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const save = async () => {
    if (!value) { setMsg({ kind: 'error', text: 'Choose a size first.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await api.put(`/api/events/${eventId}/tshirt-size`, { size: value });
      setMsg({ kind: 'success', text: res.message || 'T-shirt size saved.' });
      setEditing(false);
      if (onSaved) onSaved();
    } catch (e) { setMsg({ kind: 'error', text: e.message }); }
    finally { setBusy(false); }
  };

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
          🎽 {size ? `T-shirt size: ${size}` : 'T-shirt included'}
        </span>
        {!editing && (
          <Button
            variant="outline"
            className="!px-2 !py-1 text-xs"
            onClick={() => { setValue(size || ''); setMsg(null); setEditing(true); }}
          >
            {size ? 'Change size' : 'T-shirt Included – Select Size'}
          </Button>
        )}
      </div>

      {editing && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="text-xs font-semibold text-ink-soft" htmlFor={`tshirt-${eventId}`}>Size</label>
          <select
            id={`tshirt-${eventId}`}
            className="rounded-lg border border-line bg-white px-2 py-1 text-sm outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          >
            <option value="">Select…</option>
            {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <Button className="!px-2 !py-1 text-xs" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save size'}
          </Button>
          <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => { setEditing(false); setMsg(null); }}>
            Cancel
          </Button>
        </div>
      )}

      {msg && (
        <p className={`mt-1 text-xs font-semibold ${msg.kind === 'success' ? 'text-emerald-700' : 'text-red-600'}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
