import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import type { TransactionType } from '@prisma/client';

/**
 * List transactions for a user with pagination.
 */
export async function getTransactions(userId: string, limit = 50, offset = 0) {
  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.transaction.count({ where: { userId } }),
  ]);

  return { transactions, total, limit, offset };
}

/**
 * Get transactions filtered by type for a user.
 */
export async function getTransactionsByType(userId: string, type: TransactionType) {
  const transactions = await prisma.transaction.findMany({
    where: { userId, type },
    orderBy: { createdAt: 'desc' },
  });

  return transactions;
}

/**
 * Calculate total earnings (sum of PAYOUT transactions) for a user.
 */
export async function getTotalEarnings(userId: string) {
  const result = await prisma.transaction.aggregate({
    where: { userId, type: 'PAYOUT' },
    _sum: { amount: true },
  });

  return result._sum.amount ?? 0;
}

/**
 * Get all transactions for a specific campaign.
 */
export async function getCampaignTransactions(campaignId: string) {
  const transactions = await prisma.transaction.findMany({
    where: { campaignId },
    orderBy: { createdAt: 'desc' },
  });

  return transactions;
}
