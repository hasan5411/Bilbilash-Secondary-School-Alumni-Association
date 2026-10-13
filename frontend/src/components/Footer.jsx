import { Link } from 'react-router-dom';
import emblem from '../assets/bilbilash-emblem.png';

const FACEBOOK_URL = 'https://www.facebook.com/share/g/1F9UbsYEn5/';
const LINKEDIN_URL = 'https://linkedin.com/company/your-alumni';
const X_URL = 'https://x.com/your-alumni';
const MAPS_URL = 'https://maps.app.goo.gl/iDwKM32LVx5DqTrU9';
const CONTACT_EMAIL = 'bssalumniassociation@gmail.com';
const CONTACT_PHONE = '01792355958';

function IconBadge({ children, href, external = false, label }) {
  return (
    <a
      href={href}
      aria-label={label}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm transition hover:bg-sun hover:text-slate-900"
    >
      {children}
    </a>
  );
}

const FacebookIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
    <path fill="#1877F2" d="M13.5 21v-7.5h2.52l.48-3h-3V8.58c0-.87.24-1.46 1.49-1.46H16.6V4.44c-.28-.04-1.22-.12-2.32-.12-2.3 0-3.87 1.4-3.87 3.98v2.2H7.88v3h2.53V21h3.09z" />
  </svg>
);

const LinkedInIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
    <path fill="#0A66C2" d="M5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zM7.119 20.452H3.555V9h3.564v11.452zM20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286z" />
  </svg>
);

const XIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
    <path fill="#111827" transform="translate(1.8 1.8) scale(0.85)" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
  </svg>
);

const MailIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m2 7 10 6 10-6" />
  </svg>
);

const PhoneIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const PinIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

function ColumnHeading({ children }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-white">
      <span className="h-4 w-1 rounded-full bg-gradient-to-b from-brand to-sun" aria-hidden="true" />
      {children}
    </h3>
  );
}

const footerLink =
  'text-sm text-slate-400 transition hover:text-white hover:underline';

export default function Footer() {
  return (
    <footer className="bg-[#0F4C3A] text-slate-300">
      <div className="mx-auto max-w-7xl px-4 py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* LEFT: brand + tagline + social links */}
          <div className="sm:col-span-2 lg:col-span-1">
            <div className="flex items-center gap-3">
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white p-1 shadow">
                <img src={emblem} alt="Bilbilash Secondary School Students Community Alumni Association emblem" className="h-full w-full object-contain" />
              </span>
              <div>
                <p className="text-base font-bold leading-tight text-white">Bilbilash Secondary School</p>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-white">Students Community</p>
                <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">Alumni Association</p>
              </div>
            </div>
            <h3 className="mt-5 text-lg font-bold text-white underline decoration-sun decoration-2 underline-offset-[6px]">
              Together for a Brighter Tomorrow
            </h3>
            <div className="mt-5 flex gap-2">
              <IconBadge href={FACEBOOK_URL} external label="Facebook">
                <FacebookIcon />
              </IconBadge>
              <IconBadge href={LINKEDIN_URL} external label="LinkedIn">
                <LinkedInIcon />
              </IconBadge>
              <IconBadge href={X_URL} external label="X (Twitter)">
                <XIcon />
              </IconBadge>
            </div>
          </div>

          {/* Explore links */}
          <div>
            <ColumnHeading>Explore</ColumnHeading>
            <ul className="mt-4 space-y-2">
              <li><Link to="/" className={footerLink}>Home</Link></li>
              <li><Link to="/directory" className={footerLink}>Directory</Link></li>
              <li><Link to="/notices" className={footerLink}>Notices</Link></li>
              <li><Link to="/teachers" className={footerLink}>Teachers</Link></li>
              <li><Link to="/jobs" className={footerLink}>Jobs</Link></li>
            </ul>
          </div>

          {/* Community links */}
          <div>
            <ColumnHeading>Community</ColumnHeading>
            <ul className="mt-4 space-y-2">
              <li><Link to="/events" className={footerLink}>Events</Link></li>
              <li><Link to="/visions" className={footerLink}>Visions</Link></li>
              <li><Link to="/help" className={footerLink}>Help</Link></li>
              <li><Link to="/polls" className={footerLink}>Polls</Link></li>
              <li><Link to="/payments" className={footerLink}>Payments</Link></li>
            </ul>
          </div>

          {/* Contact us */}
          <div>
            <ColumnHeading>Contact Us</ColumnHeading>
            <ul className="mt-4 space-y-3">
              <li className="flex items-center gap-3">
                <IconBadge href={`mailto:${CONTACT_EMAIL}`} label="Email">
                  <MailIcon />
                </IconBadge>
                <a href={`mailto:${CONTACT_EMAIL}`} className={footerLink}>{CONTACT_EMAIL}</a>
              </li>
              <li className="flex items-center gap-3">
                <IconBadge href={`tel:${CONTACT_PHONE}`} label="Phone">
                  <PhoneIcon />
                </IconBadge>
                <a href={`tel:${CONTACT_PHONE}`} className={footerLink}>{CONTACT_PHONE}</a>
              </li>
              <li className="flex items-center gap-3">
                <IconBadge href={MAPS_URL} external label="Location map">
                  <PinIcon />
                </IconBadge>
                <a href={MAPS_URL} target="_blank" rel="noopener noreferrer" className={footerLink}>
                  Bilbilash Secondary School
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <p className="text-xs text-slate-400">
            © {new Date().getFullYear()} BSS Alumni Association. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            <Link to="/login" className={footerLink}>Login</Link>
            <Link to="/register" className={footerLink}>Register</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
