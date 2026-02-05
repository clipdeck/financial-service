import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { publisher, PaymentEvents, UserEvents, SERVICE_NAME } from '../lib/events';
import { notFound, badRequest } from '../lib/errors';
import type { TransactionType } from '@prisma/client';

/**
 * Get or create a balance record for a user.
 */
export async function getBalance(userId: string) {
  let balance = await prisma.balance.findUnique({ where: { userId } });

  if (!balance) {
    balance = await prisma.balance.create({
      data: { userId, available: 0, pending: 0 },
    });
  }

  return balance;
}

/**
 * Add funds to a user's available balance and create a transaction record.
 */
export async function addFunds(
  userId: string,
  amount: number,
  campaignId?: string,
  description?: string
) {
  if (amount <= 0) {
    throw badRequest('Amount must be positive');
  }

  const result = await prisma.$transaction(async (tx) => {
    // Upsert the balance
    const balance = await tx.balance.upsert({
      where: { userId },
      create: { userId, available: amount, pending: 0 },
      update: { available: { increment: amount } },
    });

    // Create the transaction
    const transaction = await tx.transaction.create({
      data: {
        userId,
        campaignId,
        amount,
        type: 'DEPOSIT',
        description: description ?? 'Funds added',
      },
    });

    return { balance, transaction };
  });

  logger.info({ userId, amount, transactionId: result.transaction.id }, 'Funds added to balance');

  // Publish balance changed event
  await publisher.publish(
    UserEvents.balanceChanged(
      {
        userId,
        oldAvailable: result.balance.available - amount,
        newAvailable: result.balance.available,
        oldPending: result.balance.pending,
        newPending: result.balance.pending,
        reason: description ?? 'Funds added',
      },
      SERVICE_NAME
    )
  );

  return result;
}

/**
 * Reserve funds: move amount from available to pending.
 * Used when a clip is approved and payment is reserved for the editor.
 */
export async function reserveFunds(
  userId: string,
  amount: number,
  campaignId: string,
  description: string
) {
  if (amount <= 0) {
    throw badRequest('Amount must be positive');
  }

  const result = await prisma.$transaction(async (tx) => {
    // Ensure balance exists
    const current = await tx.balance.findUnique({ where: { userId } });
    if (!current) {
      // Create balance with zero available; pending will be set
      await tx.balance.create({ data: { userId, available: 0, pending: 0 } });
    }

    // Move funds from available -> pending (for the editor, pending means "earned but not yet released")
    const balance = await tx.balance.update({
      where: { userId },
      data: {
        pending: { increment: amount },
      },
    });

    const transaction = await tx.transaction.create({
      data: {
        userId,
        campaignId,
        amount,
        type: 'RESERVATION',
        description,
      },
    });

    return { balance, transaction };
  });

  logger.info({ userId, amount, campaignId }, 'Funds reserved in pending balance');

  await publisher.publish(
    PaymentEvents.reserved(
      {
        clipId: '', // Will be set by the caller context
        userId,
        campaignId,
        amount,
      },
      SERVICE_NAME
    )
  );

  return result;
}

/**
 * Release pending funds to available.
 * Used when a campaign ends and editor payments are finalized.
 */
export async function releasePending(
  userId: string,
  amount: number,
  campaignId: string,
  description: string
) {
  if (amount <= 0) {
    throw badRequest('Amount must be positive');
  }

  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.balance.findUnique({ where: { userId } });
    if (!current) {
      throw notFound(`Balance not found for user ${userId}`);
    }
    if (current.pending < amount) {
      throw badRequest('Insufficient pending balance');
    }

    const balance = await tx.balance.update({
      where: { userId },
      data: {
        available: { increment: amount },
        pending: { decrement: amount },
      },
    });

    const transaction = await tx.transaction.create({
      data: {
        userId,
        campaignId,
        amount,
        type: 'PAYOUT',
        description,
      },
    });

    return { balance, transaction };
  });

  logger.info({ userId, amount, campaignId }, 'Pending funds released to available');

  await publisher.publish(
    PaymentEvents.released(
      {
        userId,
        campaignId,
        amount,
        transactionId: result.transaction.id,
      },
      SERVICE_NAME
    )
  );

  return result;
}

/**
 * Refund funds to a campaign creator's available balance.
 * Used when a campaign ends with remaining budget.
 */
export async function refundToCreator(
  userId: string,
  amount: number,
  campaignId: string,
  description: string
) {
  if (amount <= 0) {
    throw badRequest('Amount must be positive');
  }

  const result = await prisma.$transaction(async (tx) => {
    const balance = await tx.balance.upsert({
      where: { userId },
      create: { userId, available: amount, pending: 0 },
      update: { available: { increment: amount } },
    });

    const transaction = await tx.transaction.create({
      data: {
        userId,
        campaignId,
        amount,
        type: 'REFUND',
        description,
      },
    });

    return { balance, transaction };
  });

  logger.info({ userId, amount, campaignId }, 'Funds refunded to creator');

  await publisher.publish(
    UserEvents.balanceChanged(
      {
        userId,
        oldAvailable: result.balance.available - amount,
        newAvailable: result.balance.available,
        oldPending: result.balance.pending,
        newPending: result.balance.pending,
        reason: description,
      },
      SERVICE_NAME
    )
  );

  return result;
}
