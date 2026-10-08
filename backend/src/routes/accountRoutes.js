// Account routes (Account_Service surface) — Requirements 4.3, 4.4.
//
// Mounted at `/api/accounts` by `server.js`. Every route here is protected by
// `authMiddleware`, which establishes the TRUSTED acting identity on `req.user`
// from the verified JWT `sub` claim. The controller then scopes its lookup to
// `req.user.id`, so a user can only ever read their OWN account.
//
// | Method & Path          | Middleware | Controller                 |
// | ---------------------- | ---------- | -------------------------- |
// | GET /api/accounts/me   | auth       | accountController.getAccount |
import { Router } from 'express';

import { authMiddleware } from '../middleware/authMiddleware.js';
import accountController from '../controllers/accountController.js';

const router = Router();

// GET /api/accounts/me — account overview (accountNumber, balance, currency,
// accountType, status) for the authenticated user; 404 when none exists.
router.get('/me', authMiddleware, accountController.getAccount);

export default router;
