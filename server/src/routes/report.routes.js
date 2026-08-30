import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { PERMISSIONS as P } from '../config/permissions.js';
import * as c from '../controllers/report.controller.js';

const router = Router();
router.use(authenticate, authorize(P.ASSET_READ));

router.get('/', c.listReports);
router.post('/run', validate({ body: c.reportSpecSchema }), c.runReportHandler);
router.post('/export', authorize(P.ASSET_EXPORT), validate({ body: c.reportSpecSchema }), c.exportReport);

export default router;
