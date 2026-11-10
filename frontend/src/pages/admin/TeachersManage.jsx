import { mediaUrl } from '../../utils/format.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { Card, Input, Textarea, Button, Spinner, Alert, EmptyState, PageHeader } from '../../components/ui.jsx';

const EMPTY_FORM = { name: '', subject: '', designation: '', institution: '', description: '' };

export default function TeachersManage() {
  const [teachers, setTeachers] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [file, setFile] = useState(null);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [deleting, setDeleting] = useState(false);
  // Edit mode: the teacher row being updated (null = the form adds a new one).
  const [editing, setEditing] = useState(null);
  // Remounting the file input clears a previously chosen file when the form
  // switches between add and edit or moves to another teacher.
  const [fileKey, setFileKey] = useState(0);
  const formRef = useRef(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const load = useCallback(() => {
    api.get('/api/teachers').then((r) => setTeachers(r.data.teachers)).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setFile(null);
    setEditing(null);
    setFileKey((k) => k + 1);
  };

  const startEdit = (t) => {
    setMsg(null);
    setNotice(null);
    setEditing(t);
    setForm({
      name: t.name || '',
      subject: t.subject || '',
      designation: t.designation || '',
      institution: t.institution || '',
      description: t.description || '',
    });
    setFile(null);
    setFileKey((k) => k + 1);
    // The form lives at the top of the page; bring it into view.
    if (typeof formRef.current?.scrollIntoView === 'function') {
      formRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      // No new file selected -> the backend keeps the existing photo (it only
      // touches the column when an image is actually uploaded).
      if (file) fd.append('image', file);
      const res = editing
        ? await api.putForm(`/api/teachers/${editing.teacher_id}`, fd)
        : await api.postForm('/api/teachers', fd);
      setMsg({ kind: 'success', text: res.message || (editing ? 'Teacher updated' : 'Teacher added') });
      resetForm();
      load();
    } catch (err) {
      // Nothing was written: the existing teacher row (and its photo) is intact.
      setMsg({ kind: 'error', text: err.message });
    }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!confirming) return;
    setDeleting(true);
    try {
      const res = await api.del(`/api/teachers/${confirming.teacher_id}`);
      setNotice({ kind: 'success', text: res?.message || `Deleted ${confirming.name}.` });
      if (editing && editing.teacher_id === confirming.teacher_id) resetForm();
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
        <div ref={formRef} />
        <h3 className="mb-3 font-bold text-ink">
          {editing ? `Update teacher — ${editing.name}` : 'Add a teacher'}
        </h3>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <form onSubmit={submit} className="mt-2 grid gap-3 sm:grid-cols-2">
          <Input label="Name *" required value={form.name} onChange={set('name')} />
          <Input label="Subject" value={form.subject} onChange={set('subject')} />
          <Input label="Designation" value={form.designation} onChange={set('designation')} />
          <Input label="Institution" value={form.institution} onChange={set('institution')} />
          <div className="sm:col-span-2"><Textarea label="Description" value={form.description} onChange={set('description')} /></div>
          {editing && (
            <div className="flex items-center gap-3 sm:col-span-2">
              {editing.photo
                ? <img src={mediaUrl(editing.photo)} alt={editing.name} className="h-16 w-16 rounded-lg object-cover" />
                : <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-forest/10 font-black text-moss">No photo</div>}
              <p className="text-xs text-ink-soft">
                {file ? `New image selected: ${file.name}` : 'Current photo. Choose a file below to replace it — leaving it empty keeps this image.'}
              </p>
            </div>
          )}
          <div className="sm:col-span-2">
            <input key={fileKey} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => setFile(e.target.files[0])}
              className="rounded-lg border border-line px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : editing ? 'Update teacher' : 'Add teacher'}
            </Button>
            {editing && (
              <Button type="button" variant="outline" disabled={busy} onClick={() => { resetForm(); setMsg(null); }}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Card>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
      {!teachers && !error && <Spinner />}
      {teachers && teachers.length === 0 && <EmptyState title="No teachers listed." />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(teachers || []).map((t) => (
          <Card key={t.teacher_id}>
            {t.photo && <img src={mediaUrl(t.photo)} alt={t.name} className="mb-2 h-32 w-full rounded-lg object-cover" />}
            <h3 className="font-bold text-ink">{t.name}</h3>
            <p className="text-sm text-ink-soft">{[t.subject, t.designation].filter(Boolean).join(' · ')}</p>
            {t.institution && <p className="mt-1 text-xs text-ink-soft">{t.institution}</p>}
            {t.description && <p className="mt-2 text-sm text-ink-soft">{t.description}</p>}
            <div className="mt-3 flex gap-2">
              <Button variant="outline" className="!px-2 !py-1 text-xs"
                onClick={() => startEdit(t)}>Update</Button>
              <Button variant="danger" className="!px-2 !py-1 text-xs"
                onClick={() => { setNotice(null); setConfirming(t); }}>Delete</Button>
            </div>
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
