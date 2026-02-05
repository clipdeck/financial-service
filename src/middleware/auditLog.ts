import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import type { FastifyRequest } from 'fastify';

export async function logAudit(userId: string, action: string, details?: object, ip?: string) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        details: details ? JSON.stringify(details) : null,
        ip: ip ?? null,
      },
    });
  } catch (err) {
    logger.error(err, 'Failed to write audit log');
  }
}
