import HelpRequests from '../HelpRequests.jsx';

/**
 * Administration Dashboard entry point for "Manage Help Requests".
 *
 * Thin wrapper only: it renders the EXISTING Help Requests page in manageOnly
 * mode, so the admin actions (start progress, mark resolved, close, delete) and
 * the /api/help calls stay exactly the one implementation that already exists.
 * No business logic lives here.
 */
export default function HelpManage() {
  return <HelpRequests manageOnly />;
}
