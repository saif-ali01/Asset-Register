import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { PERMISSIONS as P } from '../config/permissions.js';
import * as c from '../controllers/asset.controller.js';

const router = Router();
router.use(authenticate);

router.get('/', authorize(P.ASSET_READ), c.listAssets);
router.post('/', authorize(P.ASSET_CREATE), validate({ body: c.assetBodySchema }), c.createAsset);
router.post('/bulk', authorize(P.ASSET_UPDATE), validate({ body: c.bulkUpdateSchema }), c.bulkUpdate);

router.get('/:id', authorize(P.ASSET_READ), c.getAsset);
router.patch('/:id', authorize(P.ASSET_UPDATE), validate({ body: c.assetBodySchema.partial() }), c.updateAsset);
router.post('/:id/restore', authorize(P.ASSET_UPDATE), c.restoreAsset);
router.delete('/:id', authorize(P.ASSET_DELETE), c.deleteAsset);

export default router;
