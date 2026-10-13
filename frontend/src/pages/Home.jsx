import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { Card, Spinner, Alert } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import heroImg from '../assets/hero.jpg';

const FACEBOOK_URL = 'https://www.facebook.com/share/g/1F9UbsYEn5/';
const LINKEDIN_URL = 'https://linkedin.com/company/your-alumni';
const X_URL = 'https://x.com/your-alumni';

const SOCIALS = [
  {
    href: FACEBOOK_URL,
    label: 'Facebook',
    bg: 'bg-[#1877F2]',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
        <path fill="#fff" d="M13.5 21v-7.5h2.52l.48-3h-3V8.58c0-.87.24-1.46 1.49-1.46H16.6V4.44c-.28-.04-1.22-.12-2.32-.12-2.3 0-3.87 1.4-3.87 3.98v2.2H7.88v3h2.53V21h3.09z" />
      </svg>
    ),
  },
  {
    href: LINKEDIN_URL,
    label: 'LinkedIn',
    bg: 'bg-[#0A66C2]',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
        <path fill="#fff" d="M5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zM7.119 20.452H3.555V9h3.564v11.452zM20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286z" />
      </svg>
    ),
  },
  {
    href: X_URL,
    label: 'X (Twitter)',
    bg: 'bg-black',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
        <path fill="#fff" transform="translate(1.8 1.8) scale(0.85)" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
      </svg>
    ),
  },
];

const UsersIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const MegaphoneIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true">
    <path d="m3 11 18-5v12L3 14v-3z" />
    <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
  </svg>
);

const BriefcaseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true">
    <path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    <rect width="20" height="14" x="2" y="6" rx="2" />
  </svg>
);

const HeartIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true">
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
  </svg>
);

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);

const ACTIONS = [
  {
    to: '/directory',
    title: 'Connect',
    desc: 'Stay connected with your Batchmates, Seniors and Juniors.',
    card: 'bg-emerald-50',
    titleColor: 'text-emerald-700',
    iconBg: 'bg-emerald-600',
    Icon: UsersIcon,
  },
  {
    to: '/notices',
    title: 'Get Updates',
    desc: 'Never miss important notices and events.',
    card: 'bg-amber-50',
    titleColor: 'text-amber-600',
    iconBg: 'bg-amber-500',
    Icon: MegaphoneIcon,
  },
  {
    to: '/jobs',
    title: 'Build Your Career',
    desc: 'Explore job opportunities and professional network.',
    card: 'bg-sky-100',
    titleColor: 'text-blue-700',
    iconBg: 'bg-blue-600',
    Icon: BriefcaseIcon,
  },
  {
    to: '/help',
    title: 'Give Back',
    desc: 'Support your alma mater and future generations.',
    card: 'bg-gradient-to-br from-emerald-50 to-white',
    titleColor: 'text-emerald-700',
    iconBg: 'bg-emerald-600',
    Icon: HeartIcon,
  },
];

export default function Home() {
  const { user, isAdmin } = useAuth();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAdmin) { setLoading(false); return; }
    (async () => {
      try {
        const s = await api.get('/api/stats/overview');
        setStats(s.data.stats);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, [isAdmin]);

  return (
    <div>
      <section className="relative -mx-4 -mt-6 overflow-hidden bg-gradient-to-br from-white via-ice to-emerald-50">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-12 pt-12 sm:pt-16 lg:grid-cols-2">
          <div>
            <span className="inline-flex items-center rounded-full bg-brand-dark px-5 py-1.5 text-sm font-bold text-white shadow-sm">
              Welcome to
            </span>
            <h1 className="mt-5 text-4xl font-black leading-tight sm:text-5xl">
              <span className="text-brand-dark">BSS</span>{' '}
              <span className="text-slate-900">Alumni Community</span>
            </h1>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-slate-600 sm:text-lg">
              Reconnecting our past, building a stronger future. Together we grow, support and make a difference.
            </p>
            <div className="mt-7 flex gap-3">
              {SOCIALS.map(({ href, label, bg, icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className={`flex h-11 w-11 items-center justify-center rounded-full text-white shadow-md transition hover:scale-105 hover:brightness-110 ${bg}`}
                >
                  {icon}
                </a>
              ))}
            </div>
          </div>

          <div>
            <div className="overflow-hidden rounded-3xl border-l-4 border-t-4 border-brand-dark">
              <img src={heroImg} alt="Once a BSSian Always a BSSian — Bilbilash Secondary School" className="w-full object-cover" />
            </div>
          </div>
        </div>
      </section>

      {loading && <Spinner />}
      {error && <Alert kind="error">{error}</Alert>}

      <section className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {ACTIONS.map(({ to, title, desc, card, titleColor, iconBg, Icon }) => (
          <div key={title} className={`flex flex-col rounded-2xl p-6 shadow-sm ring-1 ring-black/5 transition hover:shadow-md ${card}`}>
            <span className={`flex h-12 w-12 items-center justify-center rounded-full text-white shadow ${iconBg}`}>
              <Icon />
            </span>
            <h3 className={`mt-4 text-lg font-bold ${titleColor}`}>{title}</h3>
            <p className="mt-1 flex-1 text-sm leading-relaxed text-slate-600">{desc}</p>
            <div className="mt-4 flex justify-end">
              <Link
                to={to}
                aria-label={`Go to ${title}`}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-slate-600 transition hover:bg-brand-dark hover:text-white"
              >
                <ArrowIcon />
              </Link>
            </div>
          </div>
        ))}
      </section>

      {isAdmin && stats && (
        <section className="mt-8 mb-8 grid grid-cols-2 gap-4 sm:grid-cols-5">
          {[
            ['Members', stats.members], ['Pending approval', stats.pending], ['Admins', stats.admins],
            ['Open jobs', stats.jobs], ['Upcoming events', stats.events],
          ].map(([label, value]) => (
            <Card key={label} className="text-center">
              <div className="text-3xl font-black text-brand-dark">{value}</div>
              <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
            </Card>
          ))}
        </section>
      )}

      <section className="mt-10 overflow-hidden rounded-2xl bg-gradient-to-r from-brand to-brand-dark p-8 text-center text-white shadow-md">
        <h2 className="text-2xl font-black sm:text-3xl">Ready to Join Our Community?</h2>
        <p className="mx-auto mt-2 max-w-xl text-sky-100">Reconnect with your classmates and give back to the Bilbilash family.</p>
        {!user && (
          <Link to="/register" className="mt-5 inline-block rounded-lg bg-gradient-to-r from-sun to-brand px-6 py-3 font-bold text-white shadow-md transition hover:brightness-110">Get Started Now</Link>
        )}
      </section>
    </div>
  );
}
