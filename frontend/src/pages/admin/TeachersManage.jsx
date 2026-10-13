import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { Card, Input, Textarea, Button, Spinner, Alert, EmptyState, PageHeader } from '../../components/ui.jsx';

export default function TeachersManage() {
  const [teachers, setTeachers] = useState(null);
  const [form, setForm] = useState({ name: '', subject: '', designation: '', institution: '', description: '' });
  const [file, setFile] = useState(null);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const load = useCallback(() => {
    api.get('/api/teachers').then((r) => setTeachers(r.data.teachers)).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (file) fd.append('image', file);
      const res = await api.postForm('/api/teachers', fd);
      setMsg({ kind: 'success', text: res.message });
      setForm({ name: '', subject: '', designation: '', institution: '', description: '' });
      setFile(null);
      load();
    } catch (err) { setMsg({ kind: 'error', text: err.message }); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!confirming) return;
    setDeleting(true);
    try {
      const res = await api.del(`/api/teachers/${confirming.teacher_id}`);
      setNotice({ kind: 'success', text: res?.message || `Deleted ${confirming.name}.` });
      setConfirming(null);
      load();
    } catch (e) {
      // Keep the teacher visible; surface the actual API error.
      setNotice({ kind: 'error', text: e.message });
      setConfirming(null);
    } finally { setDeleting(false); }
  };

  return (
    <div>
      <PageHeader title="Manage Teacher Directory" />
      <Card className="mb-5">
        <h3 className="mb-3 font-bold text-ink">Add a teacher</h3>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <form onSubmit={submit} className="mt-2 grid gap-3 sm:grid-cols-2">
          <Input label="Name *" required value={form.name} onChange={set('name')} />
          <Input label="Subject" value={form.subject} onChange={set('subject')} />
          <Input label="Designation" value={form.designation} onChange={set('designation')} />
          <Input label="Institution" value={form.institution} onChange={set('institution')} />
          <div className="sm:col-span-2"><Textarea label="Description" value={form.description} onChange={set('description')} /></div>
          <div className="sm:col-span-2">
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => setFile(e.target.files[0])}
              className="rounded-lg border border-line px-3 py-2 text-sm" />
          </div>
          <div><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add teacher'}</Button></div>
        </form>
      </Card>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
      {!teachers && !error && <Spinner />}
      {teachers && teachers.length === 0 && <EmptyState title="No teachers listed." />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(teachers || []).map((t) => (
          <Card key={t.teacher_id}>
            {t.photo && <img src={`/uploads/${t.photo}`} alt={t.name} className="mb-2 h-32 w-full rounded-lg object-cover" />}
            <h3 className="font-bold text-ink">{t.name}</h3>
            <p className="text-sm text-ink-soft">{[t.subject, t.designation].filter(Boolean).join(' · ')}</p>
            {t.institution && <p className="mt-1 text-xs text-ink-soft">{t.institution}</p>}
            {t.description && <p className="mt-2 text-sm text-ink-soft">{t.description}</p>}
            <Button variant="danger" className="mt-3 !px-2 !py-1 text-xs"
              onClick={() => { setNotice(null); setConfirming(t); }}>Delete</Button>
          </Card>
        ))}
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <Card className="w-full max-w-sm">
            <p className="text-sm font-medium text-ink">Are you sure you want to delete this teacher?</p>
            <p className="mt-1 text-xs text-ink-soft">{confirming.name}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirming(null)} disabled={deleting}>Cancel</Button>
              <Button variant="danger" onClick={remove} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
