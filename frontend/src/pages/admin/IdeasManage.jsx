import Visions from '../Visions.jsx';

/**
 * Administration Dashboard entry point for "Manage Vision & Ideas".
 *
 * Thin wrapper only: it renders the EXISTING Vision & Ideas page in manageOnly
 * mode, so the admin actions (approve, reject, mark implemented, delete) and the
 * /api/visions calls stay exactly the one implementation that already exists.
 * No business logic lives here.
 */
export default function IdeasManage() {
  return <Visions manageOnly />;
}
