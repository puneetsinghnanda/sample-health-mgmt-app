import path from 'node:path';
import express, { type Express } from 'express';
import { identify } from './auth/identity';
import type { AppConfig } from './config';
import type { Database } from './db';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestLog } from './middleware/requestLog';
import { appointmentsRouter } from './routes/appointments';
import { dashboardRouter } from './routes/dashboard';
import { departmentsRouter } from './routes/departments';
import { doctorsRouter } from './routes/doctors';
import { healthRouter } from './routes/health';
import { patientsRouter } from './routes/patients';
import { specializationsRouter } from './routes/specializations';
import { createContext } from './services';

export function createApp(db: Database, config: AppConfig, clock?: () => Date): Express {
  const app = express();
  app.disable('x-powered-by');
  app.locals.ctx = createContext(db, config, clock);

  app.use(express.json({ limit: '100kb' }));
  app.use(requestLog);
  app.use('/api', identify);

  app.use('/api', healthRouter);
  app.use('/api/departments', departmentsRouter);
  app.use('/api/specializations', specializationsRouter);
  app.use('/api/doctors', doctorsRouter);
  app.use('/api/patients', patientsRouter);
  app.use('/api/appointments', appointmentsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api', notFoundHandler);

  // Shared environment: the built web app is served from the same origin, with client-side routing.
  if (config.webDistDir) {
    const dir = path.resolve(config.webDistDir);
    app.use(express.static(dir, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method === 'GET' || req.method === 'HEAD') res.sendFile(path.join(dir, 'index.html'));
      else next();
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
