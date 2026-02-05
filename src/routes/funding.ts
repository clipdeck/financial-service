import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth';
import { sendError, badRequest } from '../lib/errors';
import * as balanceService from '../services/balanceService';
import * as coinbase from '../integrations/coinbase';
import { logAudit } from '../middleware/auditLog';

export async function fundingRoutes(app: FastifyInstance) {
  // POST /funding/campaign/:campaignId - Fund a campaign
  app.post<{ Params: { campaignId: string } }>(
    '/campaign/:campaignId',
    async (request, reply) => {
      try {
        const user = requireAuth(request);
        const body = request.body as { amount?: number };

        if (!body.amount || body.amount <= 0) {
          throw badRequest('A positive amount is required');
        }

        const result = await balanceService.addFunds(
          user.userId,
          body.amount,
          request.params.campaignId,
          `Campaign funding: ${request.params.campaignId}`
        );

        await logAudit(user.userId, 'CAMPAIGN_FUNDED', {
          campaignId: request.params.campaignId,
          amount: body.amount,
        });

        reply.status(201);
        return result;
      } catch (error) {
        sendError(reply, error);
      }
    }
  );

  // POST /funding/campaign/:campaignId/wallet - Create a campaign wallet
  app.post<{ Params: { campaignId: string } }>(
    '/campaign/:campaignId/wallet',
    async (request, reply) => {
      try {
        requireAuth(request);
        const wallet = await coinbase.createCampaignWallet(request.params.campaignId);
        reply.status(201);
        return wallet;
      } catch (error) {
        sendError(reply, error);
      }
    }
  );

  // GET /funding/campaign/:campaignId/wallet - Get campaign wallet balance
  app.get<{ Params: { campaignId: string } }>(
    '/campaign/:campaignId/wallet',
    async (request, reply) => {
      try {
        requireAuth(request);
        const query = request.query as Record<string, string>;

        if (!query.walletId) {
          throw badRequest('walletId query parameter is required');
        }

        const balance = await coinbase.getCampaignWalletBalance(query.walletId);
        return balance;
      } catch (error) {
        sendError(reply, error);
      }
    }
  );
}
