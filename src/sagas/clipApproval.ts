import { logger } from '../lib/logger';
import { logAudit } from '../middleware/auditLog';
import { publisher, PaymentEvents, SERVICE_NAME } from '../lib/events';
import * as balanceService from '../services/balanceService';

/**
 * Handle clip approval payment reservation.
 * Reserves the payment amount in the editor's pending balance.
 */
export async function handleClipApproved(
  clipId: string,
  campaignId: string,
  userId: string,
  paymentAmount: number
) {
  logger.info({ clipId, campaignId, userId, paymentAmount }, 'Handling clip approval payment');

  try {
    // Reserve payment in editor's pending balance
    const result = await balanceService.reserveFunds(
      userId,
      paymentAmount,
      campaignId,
      `Payment reserved for clip ${clipId}`
    );

    // Publish payment reserved event
    await publisher.publish(
      PaymentEvents.reserved(
        {
          clipId,
          userId,
          campaignId,
          amount: paymentAmount,
        },
        SERVICE_NAME
      )
    );

    // Audit log
    await logAudit(userId, 'CLIP_PAYMENT_RESERVED', {
      clipId,
      campaignId,
      amount: paymentAmount,
      transactionId: result.transaction.id,
    });

    logger.info(
      { clipId, campaignId, userId, transactionId: result.transaction.id },
      'Clip approval payment reserved'
    );

    return result;
  } catch (error) {
    logger.error({ clipId, campaignId, userId, paymentAmount, error }, 'Failed to reserve clip payment');
    throw error;
  }
}
