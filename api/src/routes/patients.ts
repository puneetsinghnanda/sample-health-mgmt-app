import { Router } from 'express';
import { actorOf, requirePermission } from '../auth/identity';
import { parseId, parsePage } from '../lib/codes';
import { bodyOf } from '../lib/validate';
import { asyncHandler } from '../middleware/asyncHandler';
import { ctx } from './context';

export const patientsRouter = Router();

patientsRouter.get(
  '/',
  requirePermission('patients:read'),
  asyncHandler(async (req, res) => {
    res.json(await ctx(req).services.patients.list(req.query, parsePage(req.query.page)));
  }),
);

patientsRouter.post(
  '/',
  requirePermission('patients:write'),
  asyncHandler(async (req, res) => {
    res.status(201).json(await ctx(req).services.patients.create(bodyOf(req.body), actorOf(res).id));
  }),
);

patientsRouter.get(
  '/:id',
  requirePermission('patients:read'),
  asyncHandler(async (req, res) => {
    res.json(await ctx(req).services.patients.get(parseId(req.params.id, 'id')));
  }),
);

patientsRouter.patch(
  '/:id',
  requirePermission('patients:write'),
  asyncHandler(async (req, res) => {
    res.json(await ctx(req).services.patients.update(parseId(req.params.id, 'id'), bodyOf(req.body), actorOf(res).id));
  }),
);

patientsRouter.delete(
  '/:id',
  requirePermission('patients:write'),
  asyncHandler(async (req, res) => {
    await ctx(req).services.patients.delete(parseId(req.params.id, 'id'));
    res.status(204).end();
  }),
);
