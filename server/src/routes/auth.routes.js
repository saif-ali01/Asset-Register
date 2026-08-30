import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import * as c from '../controllers/auth.controller.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  message: { error: 'Too many attempts from this network. Try again in a few minutes.' },
});

router.post('/register', authLimiter, validate({ body: c.registerSchema }), c.register);
router.post('/login', authLimiter, validate({ body: c.loginSchema }), c.login);
router.post('/refresh', c.refresh);
router.post('/logout', c.logout);

router.get('/me', authenticate, c.me);
router.patch('/me', authenticate, validate({ body: c.updateMeSchema }), c.updateMe);
router.post('/change-password', authenticate, validate({ body: c.changePasswordSchema }), c.changePassword);

export default router;
