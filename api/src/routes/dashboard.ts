import { Router } from 'express';
import { requirePermission } from '../auth/identity';
import { asyncHandler } from '../middleware/asyncHandler';
import { ctx } from './context';

export const dashboardRouter = Router();

dashboardRouter.get(
  '/',
  requirePermission('dashboard:read'),
  asyncHandler(async (req, res) => {
    res.json(await ctx(req).services.dashboard.get(req.query));
  }),
);
