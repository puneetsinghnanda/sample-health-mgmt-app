import { Router } from 'express';
import { requirePermission } from '../auth/identity';
import { parseId } from '../lib/codes';
import { asyncHandler } from '../middleware/asyncHandler';
import { ctx } from './context';
import { referenceHandlers } from './reference';

export const specializationsRouter = Router();
const h = referenceHandlers('specializations');

specializationsRouter.get('/', requirePermission('reference:read'), asyncHandler(h.list));
specializationsRouter.post('/', requirePermission('reference:write'), asyncHandler(h.create));
specializationsRouter.patch('/:id', requirePermission('reference:write'), asyncHandler(h.update));
specializationsRouter.delete('/:id', requirePermission('reference:write'), asyncHandler(h.remove));

// HMS-11: each Active doctor of the specialization with their earliest free slot. Same slot data as the day schedule.
specializationsRouter.get(
  '/:id/earliest-slots',
  requirePermission('appointments:read'),
  asyncHandler(async (req, res) => {
    res.json(await ctx(req).services.doctors.earliestSlots(parseId(req.params.id, 'id')));
  }),
);
