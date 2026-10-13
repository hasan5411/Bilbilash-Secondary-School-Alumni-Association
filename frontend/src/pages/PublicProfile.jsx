import Avatar from '../components/Avatar.jsx';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { Card, Spinner, Alert } from '../components/ui.jsx';

export default function PublicProfile() {
  const { id } = useParams();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get(`/api/directory/${id}`);
        setProfile(res.data.profile);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, [id]);

  if (loading) return <Spinner />;
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!profile) return <Alert kind="error">Member not found.</Alert>;

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <div className="flex items-center gap-4">
          <Avatar name={`${profile.first_name || ''} ${profile.last_name || ''}`} photoRef={profile.profile_photo} className="h-20 w-20" textClass="text-2xl font-black" />
          <div>
            <h1 className="text-2xl font-bold text-ink">{profile.first_name} {profile.last_name}</h1>
            <p className="text-sm text-ink-soft">Member since {new Date(profile.created_at).toLocaleDateString()}</p>
          </div>
          {profile.blood_group && (
            <div className="ml-auto flex flex-col items-center">
              <span className="rounded-full bg-red-50 px-3 py-1 font-bold text-red-600">{profile.blood_group}</span>
              {!!profile.active_donor && <span className="mt-0.5 whitespace-nowrap text-[11px] font-medium text-red-500">🩸 Active Donor</span>}
            </div>
          )}
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-ink-soft">SSC batch</dt><dd className="font-semibold">{profile.ssc_batch ?? '—'}</dd></div>
          <div><dt className="text-ink-soft">Profession</dt><dd className="font-semibold">{profile.profession ?? '—'}</dd></div>
          <div><dt className="text-ink-soft">Institute</dt><dd className="font-semibold">{profile.institute ?? '—'}</dd></div>
          <div><dt className="text-ink-soft">Blood group</dt><dd className="font-semibold">{profile.blood_group ?? '—'}</dd></div>
          <div><dt className="text-ink-soft">Phone</dt><dd className="font-semibold">{profile.phone ?? 'Not provided'}</dd></div>
          <div><dt className="text-ink-soft">Present address</dt><dd className="font-semibold">{profile.present_address ?? 'Not provided'}</dd></div>
          <div><dt className="text-ink-soft">Permanent address</dt><dd className="font-semibold">{profile.permanent_address ?? 'Not provided'}</dd></div>
          {profile.facebook_url && (
            <div>
              <dt className="text-ink-soft">Facebook</dt>
              <dd className="font-semibold">
                <a href={profile.facebook_url} target="_blank" rel="noopener noreferrer" className="text-[#1877F2] hover:underline">Facebook</a>
              </dd>
            </div>
          )}
        </dl>
        {profile.bio && <p className="mt-4 rounded-lg bg-mint p-3 text-sm text-ink-soft">{profile.bio}</p>}
      </Card>
    </div>
  );
}
