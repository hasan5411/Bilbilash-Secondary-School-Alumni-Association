# BILBILASH SECONDARY SCHOOL ALUMNI ASSOCIATION — Community Management System

Full-stack localhost-only alumni platform: member approval, directory, jobs, events, polls, notices, gallery, teachers, blood-group search, vision board, help requests.

## Stack
- **Frontend:** React 19 + Vite + Tailwind CSS 4 → http://localhost:5173
- **Backend:** Node.js + Express 5 → http://localhost:5000
- **Database:** MySQL 8 (localhost:3306), database `bilbilash_alumni`
- **Auth:** JWT + bcrypt

## Setup (first time)
1. Create `backend/.env` from `backend/.env.example` and fill in your real MySQL password, a long random `JWT_SECRET`, and the Authority password.
2. MySQL must be running (Windows service `MySQL80`).
3. Backend: `cd backend && npm install && npm run init-db && npm run dev`
4. Frontend: `cd frontend && npm install && npm run dev`
5. Open http://localhost:5173

## Roles
`AUTHORITY` (seeded from .env) → `ADMIN` (max 3) → `MEMBER` (approved) → `VISITOR` (pending)

Registration always creates a pending VISITOR. Admin/Authority approve members. Only Authority manages Admins.

See PROJECT_STATUS.md for current state.
