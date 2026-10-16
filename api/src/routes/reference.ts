import type { Request, Response } from 'express';
import { actorOf } from '../auth/identity';
import { parseId } from '../lib/codes';
import { bodyOf } from '../lib/validate';
import type { Services } from '../services';
import { ctx } from './context';

type Kind = 'departments' | 'specializations';
const svc = (req: Request, kind: Kind): Services[Kind] => ctx(req).services[kind];

/** Handlers shared by the departments and specializations routers (PRD §4.5). */
export const referenceHandlers = (kind: Kind) => ({
  list: async (req: Request, res: Response) => {
    res.json({ items: await svc(req, kind).list() });
  },
  create: async (req: Request, res: Response) => {
    res.status(201).json(await svc(req, kind).create(bodyOf(req.body), actorOf(res).id));
  },
  update: async (req: Request, res: Response) => {
    res.json(await svc(req, kind).update(parseId(req.params.id, 'id'), bodyOf(req.body), actorOf(res).id));
  },
  remove: async (req: Request, res: Response) => {
    await svc(req, kind).delete(parseId(req.params.id, 'id'));
    res.status(204).end();
  },
});
