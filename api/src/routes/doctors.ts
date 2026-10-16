import { Router } from 'express';
import { actorOf, requirePermission } from '../auth/identity';
import { parseId, parsePage } from '../lib/codes';
import { badRequest } from '../lib/errors';
import { isDay } from '../lib/time';
import { bodyOf } from '../lib/validate';
import { asyncHandler } from '../middleware/asyncHandler';
import { ctx } from './context';

export const doctorsRouter = Router();

doctorsRouter.get(
  '/',
  requirePermission('doctors:read'),
  asyncHandler(async (req, res) => {
    res.json(await ctx(req).services.doctors.list(req.query, parsePage(req.query.page)));
  }),
);

doctorsRouter.post(
  '/',
  requirePermission('doctors:write'),
  asyncHandler(async (req, res) => {
    res.status(201).json(await ctx(req).services.doctors.create(bodyOf(req.body), actorOf(res).id));
  }),
);

doctorsRouter.get(
  '/:id',
  requirePermission('doctors:read'),
  asyncHandler(async (req, res) => {
    res.json(await ctx(req).services.doctors.get(parseId(req.params.id, 'id')));
  }),
);

doctorsRouter.patch(
  '/:id',
  requirePermission('doctors:write'),
  asyncHandler(async (req, res) => {
    res.json(await ctx(req).services.doctors.update(parseId(req.params.id, 'id'), bodyOf(req.body), actorOf(res).id));
  }),
);

doctorsRouter.delete(
  '/:id',
  requirePermission('doctors:write'),
  asyncHandler(async (req, res) => {
    await ctx(req).services.doctors.delete(parseId(req.params.id, 'id'));
    res.status(204).end();
  }),
);

doctorsRouter.put(
  '/:id/availability',
  requirePermission('doctors:write'),
  asyncHandler(async (req, res) => {
    res.json(await ctx(req).services.doctors.replaceAvailability(parseId(req.params.id, 'id'), req.body));
  }),
);

// APT-1 / APT-10: one day of the doctor's slots, booked and free.
doctorsRouter.get(
  '/:id/slots',
  requirePermission('appointments:read'),
  asyncHandler(async (req, res) => {
    const date = req.query.date;
    if (typeof date !== 'string' || !isDay(date)) throw badRequest('date must be a date in YYYY-MM-DD form');
    res.json(await ctx(req).services.doctors.schedule(parseId(req.params.id, 'id'), date));
  }),
);
