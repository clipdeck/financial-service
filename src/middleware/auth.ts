import type { FastifyRequest, FastifyReply } from 'fastify';
import { unauthorized, forbidden } from '../lib/errors';

/**
 * Decoded JWT payload expected from the API Gateway / auth service.
 * In production, the API Gateway validates the JWT and forwards
 * user info as headers or a verified token.
 */
export interface AuthUser {
  userId: string;
  discordId?: string;
  email?: string;
  name?: string;
  isStaff?: boolean;
}

/**
 * Extract and verify auth info from the request.
 *
 * In the microservices architecture, the API Gateway handles JWT validation
 * and forwards user info via headers:
 *   X-User-Id, X-User-Discord-Id, X-User-Email, X-User-Name, X-User-Staff
 *
 * For development, also supports a Bearer token that can be decoded locally.
 */
export function getAuthUser(request: FastifyRequest): AuthUser | null {
  const userId = request.headers['x-user-id'] as string | undefined;

  if (!userId) {
    return null;
  }

  return {
    userId,
    discordId: request.headers['x-user-discord-id'] as string | undefined,
    email: request.headers['x-user-email'] as string | undefined,
    name: request.headers['x-user-name'] as string | undefined,
    isStaff: request.headers['x-user-staff'] === 'true',
  };
}

/**
 * Require authentication -- returns AuthUser or throws
 */
export function requireAuth(request: FastifyRequest): AuthUser {
  const user = getAuthUser(request);
  if (!user) {
    throw unauthorized('Authentication required');
  }
  return user;
}

/**
 * Require staff role
 */
export function requireStaff(request: FastifyRequest): AuthUser {
  const user = requireAuth(request);
  if (!user.isStaff) {
    throw forbidden('Staff access required');
  }
  return user;
}
