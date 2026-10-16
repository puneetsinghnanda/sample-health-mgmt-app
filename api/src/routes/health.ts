import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { ctx } from './context';

export const healthRouter = Router();

healthRouter.get(
  '/health',
  asyncHandler(async (req, res) => {
    try {
      await ctx(req).db.query('SELECT 1');
      res.json({ status: 'ok', db: 'up' });
    } catch {
      res.status(503).json({ status: 'degraded', db: 'down' });
    }
  }),
);

// Hospital settings the web app needs to show times and money (PRD NFR-2).
healthRouter.get('/settings', (req, res) => {
  const { timeZone, currency, pageSize } = ctx(req).config;
  res.json({ timeZone, currency, pageSize });
});
