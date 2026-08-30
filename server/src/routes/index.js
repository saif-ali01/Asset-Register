import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { PERMISSIONS as P } from '../config/permissions.js';
import { dashboard } from '../controllers/dashboard.controller.js';
import { dataQuality } from '../controllers/quality.controller.js';

import authRoutes from './auth.routes.js';
import assetRoutes from './asset.routes.js';
import assignmentRoutes from './assignment.routes.js';
import maintenanceRoutes from './maintenance.routes.js';
import lookupRoutes from './lookup.routes.js';
import userRoutes from './user.routes.js';
import auditRoutes from './audit.routes.js';
import transferRoutes from './transfer.routes.js';
import reportRoutes from './report.routes.js';

const router = Router();

router.get('/health', (_req, res) => res.json({ ok: true, at: new Date().toISOString() }));
router.get('/dashboard', authenticate, authorize(P.DASHBOARD_READ), dashboard);

router.get('/quality', authenticate, authorize(P.AUDIT_READ, P.ASSET_UPDATE), dataQuality);

router.use('/auth', authRoutes);
router.use('/assets', assetRoutes);
router.use('/assignments', assignmentRoutes);
router.use('/maintenance', maintenanceRoutes);
router.use('/lookups', lookupRoutes);
router.use('/users', userRoutes);
router.use('/audit', auditRoutes);
router.use('/data', transferRoutes);
router.use('/reports', reportRoutes);

export default router;
