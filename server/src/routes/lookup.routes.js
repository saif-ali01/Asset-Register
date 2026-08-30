import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { PERMISSIONS as P } from '../config/permissions.js';
import * as c from '../controllers/lookup.controller.js';

// :resource is one of categories | departments | sites | vendors
const router = Router();
router.use(authenticate);

router.get('/:resource', authorize(P.LOOKUP_READ), c.listLookups);
router.post('/:resource', authorize(P.LOOKUP_WRITE), validate({ body: c.lookupSchema }), c.createLookup);
router.patch('/:resource/:id', authorize(P.LOOKUP_WRITE), validate({ body: c.lookupSchema.partial() }), c.updateLookup);
router.delete('/:resource/:id', authorize(P.LOOKUP_WRITE), c.deleteLookup);

export default router;
