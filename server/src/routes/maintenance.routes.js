import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { PERMISSIONS as P } from '../config/permissions.js';
import * as c from '../controllers/maintenance.controller.js';

const router = Router();
router.use(authenticate);

router.get('/', authorize(P.MAINTENANCE_READ), c.listMaintenance);
router.post('/', authorize(P.MAINTENANCE_WRITE), validate({ body: c.maintenanceSchema }), c.createMaintenance);
router.patch('/:id', authorize(P.MAINTENANCE_WRITE), validate({ body: c.maintenanceSchema.partial() }), c.updateMaintenance);
router.delete('/:id', authorize(P.MAINTENANCE_WRITE), c.deleteMaintenance);

export default router;
