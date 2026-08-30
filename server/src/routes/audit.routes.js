import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { PERMISSIONS as P } from '../config/permissions.js';
import * as c from '../controllers/audit.controller.js';

const router = Router();
router.use(authenticate, authorize(P.AUDIT_READ));

router.get('/', c.listAudit);
router.get('/actions', c.auditActions);

export default router;
