import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { PERMISSIONS as P } from '../config/permissions.js';
import * as c from '../controllers/user.controller.js';

const router = Router();
router.use(authenticate);

router.get('/roles', c.listRoles);
router.get('/', authorize(P.USER_READ), c.listUsers);
router.post('/', authorize(P.USER_WRITE), validate({ body: c.createUserSchema }), c.createUser);
router.get('/:id', authorize(P.USER_READ), c.getUser);
router.patch('/:id', authorize(P.USER_WRITE), validate({ body: c.updateUserSchema }), c.updateUser);
router.post('/:id/reset-password', authorize(P.USER_WRITE), validate({ body: c.resetPasswordSchema }), c.resetUserPassword);
router.delete('/:id', authorize(P.USER_DELETE), c.deleteUser);

export default router;
