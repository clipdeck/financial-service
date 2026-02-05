import type { FastifyReply } from 'fastify';

export class ServiceError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export function notFound(message: string): ServiceError {
  return new ServiceError(404, 'NOT_FOUND', message);
}

export function badRequest(message: string, details?: unknown): ServiceError {
  return new ServiceError(400, 'BAD_REQUEST', message, details);
}

export function unauthorized(message = 'Unauthorized'): ServiceError {
  return new ServiceError(401, 'UNAUTHORIZED', message);
}

export function forbidden(message = 'Forbidden'): ServiceError {
  return new ServiceError(403, 'FORBIDDEN', message);
}

export function conflict(message: string): ServiceError {
  return new ServiceError(409, 'CONFLICT', message);
}

export function sendError(reply: FastifyReply, error: unknown): void {
  if (error instanceof ServiceError) {
    reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
    return;
  }

  // Unknown error
  reply.status(500).send({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}
