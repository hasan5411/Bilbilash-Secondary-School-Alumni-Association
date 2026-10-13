import { Router } from 'express';
import { list, create, archive, remove } from '../controllers/noticeController.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

// Public: published notices visible without login (token optional).
router.get('/', (req, res, next) => {
  if (req.headers.authorization) {
    authenticate(req, res, (err) => {
      // Invalid/expired/ ineligible token -> fall back to the PUBLIC list.
      // (Calling next() here used to re-enter the authenticate below and
      // answer 401 instead of the public noticeboard.)
      if (err) return list(req, res, next);
      list(req, res, next);
    });
    return;
  }
  list(req, res, next);
});

router.use(authenticate, requireRole('ADMIN'));
router.post('/', create);
router.put('/:id/archive', archive);
router.delete('/:id', remove);

export default router;
