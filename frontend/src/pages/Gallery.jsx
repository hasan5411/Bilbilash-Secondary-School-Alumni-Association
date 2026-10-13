import { mediaUrl } from '../utils/format.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { Card, Button, Spinner, Alert, EmptyState, PageHeader, Badge, Input } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Gallery() {
  const { isMember, isAdmin } = useAuth();
  const [items, setItems] = useState(null);
  const [caption, setCaption] = useState('');
  const [file, setFile] = useState(null);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get('/api/gallery'); setItems(r.data.items); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    if (!file) { setMsg({ kind: 'error', text: 'Choose an image first (JPG/PNG/WEBP/GIF, max 3 MB).' }); return; }
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.append('image', file);
      fd.append('caption', caption);
      const res = await api.postForm('/api/gallery', fd);
      setMsg({ kind: 'success', text: res.message });
      setCaption(''); if (fileRef.current) fileRef.current.value = ''; setFile(null);
      load();
    } catch (err) { setMsg({ kind: 'error', text: err.message }); }
    finally { setBusy(false); }
  };

  const moderate = async (id, action) => {
    try { await api.put(`/api/gallery/${id}/moderate`, { action }); load(); }
    catch (e) { alert(e.message); }
  };

  const remove = async (id) => {
    if (!window.confirm('Are you sure you want to delete this photo?')) return;
    setDeleting(id);
    setMsg(null);
    try {
      await api.del(`/api/gallery/${id}`, { reason: 'Removed by admin' });
      setMsg({ kind: 'success', text: 'Photo deleted.' });
      load();
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div>
      <PageHeader title="Alumni Gallery" subtitle="Moments from school and reunions." />

      {isMember && (
        <Card className="mb-5">
          <h3 className="mb-3 font-bold text-ink">Share a photo (goes to moderation)</h3>
          {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
          <form onSubmit={submit} className="mt-2 flex flex-wrap items-end gap-3">
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => setFile(e.target.files[0])}
              className="rounded-lg border border-line px-3 py-2 text-sm" />
            <div className="flex-1"><Input label="" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption (optional)" /></div>
            <Button type="submit" disabled={busy}>{busy ? 'Uploading…' : 'Upload'}</Button>
          </form>
        </Card>
      )}

      {loading && <Spinner />}
      {error && <Alert kind="error">{error}</Alert>}
      {items && items.length === 0 && <EmptyState title="No photos yet." />}

      <div className="grid gap-4 lg:grid-cols-2">
        {(items || []).map((g) => (
          <Card key={g.gallery_id} className="!p-3">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="w-full shrink-0 sm:w-[70%]">
                <div className="aspect-[4/3] w-full overflow-hidden rounded-lg bg-mist">
                  <img src={mediaUrl(g.image_path)} alt={g.caption || 'Gallery photo'} className="h-full w-full object-contain" />
                </div>
              </div>
              <div className="flex w-full min-w-0 flex-col sm:w-[30%]">
                <p className="break-words text-sm leading-relaxed text-ink-soft">{g.caption || <span className="text-ink-soft">No caption</span>}</p>
                <div className="mt-auto space-y-2 pt-2">
                  {isAdmin && <div><Badge value={g.status} /></div>}
                  {isAdmin && g.status === 'pending' && (
                    <div className="flex gap-2">
                      <Button variant="outline" className="!px-2 !py-1 text-xs" onClick={() => moderate(g.gallery_id, 'approve')}>Approve</Button>
                      <Button variant="danger" className="!px-2 !py-1 text-xs" onClick={() => moderate(g.gallery_id, 'reject')}>Reject</Button>
                    </div>
                  )}
                  {isAdmin && (
                    <div className="flex gap-2">
                      <Button variant="ghost" className="!px-2 !py-1 text-xs text-red-600 hover:bg-red-50" onClick={() => remove(g.gallery_id)} disabled={deleting === g.gallery_id}>
                        {deleting === g.gallery_id ? 'Deleting…' : 'Delete'}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
