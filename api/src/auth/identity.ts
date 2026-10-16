import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { forbidden } from '../lib/errors';

/**
 * Identity and permissions (PRD §4.6, AUTH-1..4). The MVP has no sign-in: every request is the actor "staff" and
 * every permission is granted. Adding sign-in later replaces `identify` (verify the organisation's OIDC token)
 * and `allows` (check roles); routes and services stay as they are.
 */

export type Permission =
  | 'reference:read' | 'reference:write'
  | 'doctors:read' | 'doctors:write'
  | 'patients:read' | 'patients:write'
  | 'appointments:read' | 'appointments:write'
  | 'dashboard:read';

export interface Actor {
  id: string;
  roles: string[];
}

export const MVP_ACTOR: Actor = { id: 'staff', roles: ['staff'] };

/** AUTH-1: every API request passes through here. */
export function identify(_req: Request, res: Response, next: NextFunction): void {
  res.locals.actor = MVP_ACTOR;
  next();
}

/** AUTH-2: in the MVP every actor holds every permission. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function allows(_actor: Actor, _permission: Permission): boolean {
  return true;
}

/** AUTH-2: routes declare the permission they need. */
export function requirePermission(permission: Permission): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (!allows(actorOf(res), permission)) {
      next(forbidden(`Missing permission ${permission}`));
      return;
    }
    next();
  };
}

/** AUTH-3: the actor whose id fills created_by / updated_by and the appointment history. */
export function actorOf(res: Response): Actor {
  const actor = res.locals.actor as Actor | undefined;
  if (!actor) throw new Error('identify middleware did not run');
  return actor;
}
