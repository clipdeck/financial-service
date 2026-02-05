import type { FastifyInstance } from 'fastify';
import { requireAuth, requireStaff } from '../middleware/auth';
import { sendError } from '../lib/errors';
import * as payoutService from '../services/payoutService';

export async function payoutRoutes(app: FastifyInstance) {
  // GET /payouts/campaign/:campaignId - Calculate campaign payment breakdown
  app.get<{ Params: { campaignId: string } }>(
    '/campaign/:campaignId',
    async (request, reply) => {
      try {
        requireAuth(request);
        const payments = await payoutService.calculateCampaignPayments(
          request.params.campaignId
        );
        return { campaignId: request.params.campaignId, payments };
      } catch (error) {
        sendError(reply, error);
      }
    }
  );

  // POST /payouts/campaign/:campaignId/process - Execute payouts (staff only)
  app.post<{ Params: { campaignId: string } }>(
    '/campaign/:campaignId/process',
    async (request, reply) => {
      try {
        requireStaff(request);
        const result = await payoutService.processPayouts(request.params.campaignId);
        return result;
      } catch (error) {
        sendError(reply, error);
      }
    }
  );
}
