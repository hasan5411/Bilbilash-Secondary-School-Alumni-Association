import React from 'react';
import { Routes, Route, NavLink, Link, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { Spinner, Button } from './components/ui.jsx';
import NotificationBell from './components/NotificationBell.jsx';
import Footer from './components/Footer.jsx';
import logo from './assets/bilbilash-logo.png';

import Home from './pages/Home.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Directory from './pages/Directory.jsx';
import PublicProfile from './pages/PublicProfile.jsx';
import Notices from './pages/Notices.jsx';
import Teachers from './pages/Teachers.jsx';
import TeacherDetails from './pages/TeacherDetails.jsx';
import HelpRequests from './pages/HelpRequests.jsx';
import Jobs from './pages/Jobs.jsx';
import JobDetail from './pages/JobDetail.jsx';
import MyApplications from './pages/MyApplications.jsx';
import Events from './pages/Events.jsx';
import MyEventRegistrations from './pages/MyEventRegistrations.jsx';
import Visions from './pages/Visions.jsx';
import Polls from './pages/Polls.jsx';
import Gallery from './pages/Gallery.jsx';
import Profile from './pages/Profile.jsx';
import Payments from './pages/Payments.jsx';
import Analytics from './pages/analytics/Analytics.jsx';
import Notifications from './pages/Notifications.jsx';
import AdminApprovals from './pages/admin/Approvals.jsx';
import AdminUsers from './pages/admin/Users.jsx';
import AdminMembers from './pages/admin/Members.jsx';
import AdminPayments from './pages/admin/Payments.jsx';
import AdminModeration from './pages/admin/Moderation.jsx';
import AdminEventsManage from './pages/admin/EventsManage.jsx';
import AdminPollsManage from './pages/admin/PollsManage.jsx';
import AdminNoticesManage from './pages/admin/NoticesManage.jsx';
import AdminTeachersManage from './pages/admin/TeachersManage.jsx';
import Stats from './pages/admin/Stats.jsx';

function Navbar() {
  const { user, logout, role, isAdmin, isMember } = useAuth();
  const navigate = useNavigate();

  const link = ({ isActive }) =>
    `rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? 'bg-brand text-white' : 'text-slate-600 hover:bg-white hover:text-brand'}`;

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-ice/90 backdrop-blur">
      <nav className="mx-auto flex max-w-7xl flex-wrap items-center gap-1 px-4 py-3">
        <Link to="/" className="mr-3 flex items-center gap-2">
          <img src={logo} alt="Bilbilash Alumni Association logo" className="h-9 w-9 rounded-lg object-contain" />
          <span className="hidden text-lg font-bold text-slate-800 sm:block">Bilbilash Alumni</span>
        </Link>
        <NavLink to="/" end className={link}>Home</NavLink>
        <NavLink to="/directory" className={link}>Directory</NavLink>
        <NavLink to="/notices" className={link}>Notices</NavLink>
        <NavLink to="/teachers" className={link}>Teachers</NavLink>
        {user && <NavLink to="/jobs" className={link}>Jobs</NavLink>}
        {user && <NavLink to="/events" className={link}>Events</NavLink>}
        {user && isMember && <NavLink to="/visions" className={link}>Visions</NavLink>}
        {user && isMember && <NavLink to="/help" className={link}>Help</NavLink>}
        {user && isMember && <NavLink to="/polls" className={link}>Polls</NavLink>}
        {user && isMember && <NavLink to="/payments" className={link}>Payments</NavLink>}
        {user && user.status === 'approved' && isMember && <NavLink to="/analytics" className={link}>Analytics</NavLink>}
        {user && <NavLink to="/gallery" className={link}>Gallery</NavLink>}
        {isAdmin && <NavLink to="/admin" className={link}>Admin</NavLink>}
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <NotificationBell />
              <NavLink to="/profile" className={link}>{user.first_name} <span className="ml-1 rounded bg-sun/30 px-1.5 py-0.5 text-[10px] font-bold uppercase">{role}</span></NavLink>
              <Button variant="ghost" onClick={() => { logout(); navigate('/'); }}>Logout</Button>
            </>
          ) : (
            <>
              <NavLink to="/login" className={link}>Login</NavLink>
              <NavLink to="/register" className={link}>Register</NavLink>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}

function RequireRole({ min, approved, children }) {
  const { user, role } = useAuth();
  if (!user) return <Navigate to="/login" replace state={{ notice: 'Please log in as an approved member to view full profile details.' }} />;
  if (approved && user.status !== 'approved') {
    return (
      <div className="mx-auto mt-10 max-w-lg rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <h2 className="text-lg font-bold text-red-700">Not allowed</h2>
        <p className="mt-2 text-sm text-red-600">You must be an approved member to view full profile details.</p>
      </div>
    );
  }
  const rank = { VISITOR: 1, MEMBER: 2, ADMIN: 3, AUTHORITY: 4 };
  if ((rank[role] || 0) < rank[min]) {
    return (
      <div className="mx-auto mt-10 max-w-lg rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <h2 className="text-lg font-bold text-red-700">Not allowed</h2>
        <p className="mt-2 text-sm text-red-600">This page requires role <b>{min}</b> or higher. Your role: <b>{role}</b>.</p>
      </div>
    );
  }
  return children;
}

export default function App() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <React.Suspense fallback={<Spinner />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/directory" element={<Directory />} />
            <Route path="/directory/:id" element={<RequireRole min="VISITOR" approved><PublicProfile /></RequireRole>} />
            <Route path="/notices" element={<Notices />} />
            <Route path="/teachers" element={<Teachers />} />
            <Route path="/teachers/:id" element={<TeacherDetails />} />
            <Route path="/jobs" element={<RequireRole min="VISITOR"><Jobs /></RequireRole>} />
            <Route path="/jobs/:id" element={<RequireRole min="VISITOR"><JobDetail /></RequireRole>} />
            <Route path="/my-applications" element={<RequireRole min="VISITOR"><MyApplications /></RequireRole>} />
            <Route path="/events" element={<RequireRole min="VISITOR"><Events /></RequireRole>} />
            <Route path="/my-registrations" element={<RequireRole min="VISITOR"><MyEventRegistrations /></RequireRole>} />
            <Route path="/visions" element={<RequireRole min="MEMBER"><Visions /></RequireRole>} />
            <Route path="/help" element={<RequireRole min="MEMBER"><HelpRequests /></RequireRole>} />
            <Route path="/polls" element={<RequireRole min="MEMBER"><Polls /></RequireRole>} />
            <Route path="/gallery" element={<RequireRole min="VISITOR"><Gallery /></RequireRole>} />
            <Route path="/profile" element={<RequireRole min="VISITOR"><Profile /></RequireRole>} />
            <Route path="/payments" element={<RequireRole min="MEMBER"><Payments /></RequireRole>} />
            {/* Analytics: approved members and above only (backend enforces the same rule). */}
            <Route path="/analytics" element={<RequireRole min="MEMBER" approved><Analytics /></RequireRole>} />
            <Route path="/notifications" element={<RequireRole min="VISITOR"><Notifications /></RequireRole>} />

            <Route path="/admin" element={<RequireRole min="ADMIN"><Stats /></RequireRole>} />
            <Route path="/admin/approvals" element={<RequireRole min="ADMIN"><AdminApprovals /></RequireRole>} />
            <Route path="/admin/users" element={<RequireRole min="ADMIN"><AdminUsers /></RequireRole>} />
            <Route path="/admin/members" element={<RequireRole min="ADMIN"><AdminMembers /></RequireRole>} />
            <Route path="/admin/payments" element={<RequireRole min="ADMIN"><AdminPayments /></RequireRole>} />
            <Route path="/admin/moderation" element={<RequireRole min="ADMIN"><AdminModeration /></RequireRole>} />
            <Route path="/admin/events" element={<RequireRole min="ADMIN"><AdminEventsManage /></RequireRole>} />
            <Route path="/admin/polls" element={<RequireRole min="ADMIN"><AdminPollsManage /></RequireRole>} />
            <Route path="/admin/notices" element={<RequireRole min="ADMIN"><AdminNoticesManage /></RequireRole>} />
            <Route path="/admin/teachers" element={<RequireRole min="ADMIN"><AdminTeachersManage /></RequireRole>} />

            <Route path="*" element={<div className="py-20 text-center text-slate-500">Page not found</div>} />
          </Routes>
        </React.Suspense>
      </main>
      <Footer />
    </div>
  );
}
