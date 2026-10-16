import { Router } from 'express';
import { requirePermission } from '../auth/identity';
import { asyncHandler } from '../middleware/asyncHandler';
import { referenceHandlers } from './reference';

export const departmentsRouter = Router();
const h = referenceHandlers('departments');

departmentsRouter.get('/', requirePermission('reference:read'), asyncHandler(h.list));
departmentsRouter.post('/', requirePermission('reference:write'), asyncHandler(h.create));
departmentsRouter.patch('/:id', requirePermission('reference:write'), asyncHandler(h.update));
departmentsRouter.delete('/:id', requirePermission('reference:write'), asyncHandler(h.remove));
