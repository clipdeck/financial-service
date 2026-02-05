import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth';
import { sendError } from '../lib/errors';
import * as transactionService from '../services/transactionService';

export async function transactionRoutes(app: FastifyInstance) {
  // GET /transactions - List current user's transactions with pagination
  app.get('/', async (request, reply) => {
    try {
      const user = requireAuth(request);
      const query = request.query as Record<string, string>;

      const limit = query.limit ? parseInt(query.limit, 10) : 50;
      const offset = query.offset ? parseInt(query.offset, 10) : 0;

      const result = await transactionService.getTransactions(user.userId, limit, offset);
      return result;
    } catch (error) {
      sendError(reply, error);
    }
  });

  // GET /transactions/campaign/:campaignId - Get transactions for a campaign
  app.get<{ Params: { campaignId: string } }>(
    '/campaign/:campaignId',
    async (request, reply) => {
      try {
        requireAuth(request);
        const transactions = await transactionService.getCampaignTransactions(
          request.params.campaignId
        );
        return { transactions };
      } catch (error) {
        sendError(reply, error);
      }
    }
  );
}
