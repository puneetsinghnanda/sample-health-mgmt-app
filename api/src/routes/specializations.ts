import { Router } from 'express';
import { requirePermission } from '../auth/identity';
import { asyncHandler } from '../middleware/asyncHandler';
import { referenceHandlers } from './reference';

export const specializationsRouter = Router();
const h = referenceHandlers('specializations');

specializationsRouter.get('/', requirePermission('reference:read'), asyncHandler(h.list));
specializationsRouter.post('/', requirePermission('reference:write'), asyncHandler(h.create));
specializationsRouter.patch('/:id', requirePermission('reference:write'), asyncHandler(h.update));
specializationsRouter.delete('/:id', requirePermission('reference:write'), asyncHandler(h.remove));
