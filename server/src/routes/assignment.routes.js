import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { PERMISSIONS as P } from '../config/permissions.js';
import * as c from '../controllers/assignment.controller.js';

const router = Router();
router.use(authenticate);

router.get('/', authorize(P.ASSIGNMENT_READ), c.listAssignments);
router.post('/checkout', authorize(P.ASSIGNMENT_CHECKOUT), validate({ body: c.checkoutSchema }), c.checkout);
router.post('/:id/checkin', authorize(P.ASSIGNMENT_CHECKIN), validate({ body: c.checkinSchema }), c.checkin);
router.post('/:id/transfer', authorize(P.ASSIGNMENT_CHECKOUT), validate({ body: c.transferSchema }), c.transfer);

export default router;
