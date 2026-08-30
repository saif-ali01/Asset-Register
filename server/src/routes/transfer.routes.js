import multer from 'multer';
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { PERMISSIONS as P } from '../config/permissions.js';
import * as c from '../controllers/importExport.controller.js';
import * as u from '../controllers/userImport.controller.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|xlsm|xls|csv)$/i.test(file.originalname);
    cb(ok ? null : new Error('Upload a .xlsx, .xls or .csv file'), ok);
  },
});

router.use(authenticate);

// ---- assets ----
router.get('/template', authorize(P.ASSET_IMPORT), c.downloadTemplate);
router.get('/export/fields', authorize(P.ASSET_EXPORT), c.exportFields);
router.get('/export', authorize(P.ASSET_EXPORT), c.exportAssets);
router.post('/import/preview', authorize(P.ASSET_IMPORT), upload.single('file'), c.previewImport);
router.post('/import/commit', authorize(P.ASSET_IMPORT), upload.single('file'), c.commitImport);

/**
 * ---- people ----
 * Importing accounts is a people-management action, not a data-loading one,
 * so it needs user:write rather than asset:import. Someone who can load a
 * spreadsheet of assets should not thereby be able to create logins.
 */
router.get('/users/template', authorize(P.USER_WRITE), u.downloadUserTemplate);
router.get('/users/export', authorize(P.USER_READ), u.exportUsers);
router.post('/users/import/preview', authorize(P.USER_WRITE), upload.single('file'), u.previewUserImport);
router.post('/users/import/commit', authorize(P.USER_WRITE), upload.single('file'), u.commitUserImport);

export default router;
