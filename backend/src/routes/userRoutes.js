// User / profile routes (Account_Service surface) — Requirements 9.1, 9.2,
// 9.3, 9.5.
//
// Mounted at `/api/users` by `server.js`. Every route is protected by
// `authMiddleware`, which sets the TRUSTED acting identity on `req.user` from
// the verified JWT `sub` claim; the controller scopes all reads/writes to
// `req.user.id` so a user only ever sees or mutates their OWN profile.
//
// | Method & Path       | Middleware     | Controller                     |
// | ------------------- | -------------- | ------------------------------ |
// | GET  /api/users/me  | auth           | accountController.getProfile    |
// | PUT  /api/users/me  | auth, validate | accountController.updateProfile |
//
// The update route accepts ONLY `phone` and `address` (both optional). Any
// `balance`, `accountNumber`, `role`, or `email` field is ignored by the
// controller's strict whitelist (Requirement 9.4) and is not validated here.
import { Router } from 'express';
import { body } from 'express-validator';

import { authMiddleware } from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validate.js';
import accountController from '../controllers/accountController.js';

const router = Router();

// Validation chains for the profile update (Requirement 9.5). Both fields are
// optional (a client may update one, the other, or neither). `phone` must be
// 7–20 characters containing only digits and the characters `+ - space ( )`;
// `address` must be 1–255 characters. Values are trimmed before validation.
const updateProfileValidation = [
  body('phone')
    .optional()
    .isString()
    .withMessage('phone must be a string')
    .bail()
    .trim()
    .matches(/^[0-9+\-\s()]{7,20}$/)
    .withMessage(
      'phone must be 7-20 characters of digits, +, -, spaces, or parentheses'
    ),
  body('address')
    .optional()
    .isString()
    .withMessage('address must be a string')
    .bail()
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('address must be 1-255 characters'),
];

// GET /api/users/me — safe profile (password omitted) for the authenticated
// user.
router.get('/me', authMiddleware, accountController.getProfile);

// PUT /api/users/me — update only the authenticated user's phone and/or
// address after validation.
router.put(
  '/me',
  authMiddleware,
  validate(updateProfileValidation),
  accountController.updateProfile
);

export default router;
