import { Router } from 'express';
import { actorOf, requirePermission } from '../auth/identity';
import { parseId, parsePage } from '../lib/codes';
import { bodyOf } from '../lib/validate';
import { asyncHandler } from '../middleware/asyncHandler';
import { ctx } from './context';

export const appointmentsRouter = Router();

appointmentsRouter.get(
  '/',
  requirePermission('appointments:read'),
  asyncHandler(async (req, res) => {
    res.json(await ctx(req).services.appointments.list(req.query, parsePage(req.query.page)));
  }),
);

appointmentsRouter.post(
  '/',
  requirePermission('appointments:write'),
  asyncHandler(async (req, res) => {
    res.status(201).json(await ctx(req).services.appointments.book(bodyOf(req.body), actorOf(res).id));
  }),
);

appointmentsRouter.get(
  '/:id',
  requirePermission('appointments:read'),
  asyncHandler(async (req, res) => {
    res.json(await ctx(req).services.appointments.get(parseId(req.params.id, 'id')));
  }),
);

appointmentsRouter.post(
  '/:id/reschedule',
  requirePermission('appointments:write'),
  asyncHandler(async (req, res) => {
    res.json(await ctx(req).services.appointments.reschedule(parseId(req.params.id, 'id'), bodyOf(req.body), actorOf(res).id));
  }),
);

appointmentsRouter.post(
  '/:id/cancel',
  requirePermission('appointments:write'),
  asyncHandler(async (req, res) => {
    res.json(await ctx(req).services.appointments.cancel(parseId(req.params.id, 'id'), bodyOf(req.body), actorOf(res).id));
  }),
);

appointmentsRouter.post(
  '/:id/complete',
  requirePermission('appointments:write'),
  asyncHandler(async (req, res) => {
    res.json(await ctx(req).services.appointments.close(parseId(req.params.id, 'id'), 'COMPLETED', actorOf(res).id));
  }),
);

appointmentsRouter.post(
  '/:id/no-show',
  requirePermission('appointments:write'),
  asyncHandler(async (req, res) => {
    res.json(await ctx(req).services.appointments.close(parseId(req.params.id, 'id'), 'NO_SHOW', actorOf(res).id));
  }),
);
