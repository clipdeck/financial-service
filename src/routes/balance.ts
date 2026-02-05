import type { FastifyInstance } from 'fastify';
import { requireAuth, requireStaff } from '../middleware/auth';
import { sendError } from '../lib/errors';
import * as balanceService from '../services/balanceService';
import * as transactionService from '../services/transactionService';

export async function balanceRoutes(app: FastifyInstance) {
  // GET /balance - Get current user's balance with recent transactions and total earnings
  app.get('/', async (request, reply) => {
    try {
      const user = requireAuth(request);

      const [balance, transactions, totalEarnings] = await Promise.all([
        balanceService.getBalance(user.userId),
        transactionService.getTransactions(user.userId, 10, 0),
        transactionService.getTotalEarnings(user.userId),
      ]);

      return {
        balance,
        recentTransactions: transactions.transactions,
        totalEarnings,
      };
    } catch (error) {
      sendError(reply, error);
    }
  });

  // GET /balance/:userId - Get a specific user's balance (staff only)
  app.get<{ Params: { userId: string } }>('/:userId', async (request, reply) => {
    try {
      requireStaff(request);
      const balance = await balanceService.getBalance(request.params.userId);
      return balance;
    } catch (error) {
      sendError(reply, error);
    }
  });
}
