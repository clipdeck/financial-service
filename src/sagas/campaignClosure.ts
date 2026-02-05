import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { logAudit } from '../middleware/auditLog';
import * as payoutService from '../services/payoutService';
import * as prizeService from '../services/prizeService';
import * as balanceService from '../services/balanceService';

interface CampaignClosureData {
  campaignId: string;
  createdBy: string;
  title: string;
  totalBudget: number;
  spentBudget: number;
  isFunded: boolean;
  enableLeaderboard: boolean;
  hasLeaderboard: boolean;
}

export async function handleCampaignEnded(campaignId: string, campaignData: CampaignClosureData) {
  logger.info({ campaignId }, 'Starting campaign closure saga');

  try {
    // Step 1: Finalize leaderboard if enabled
    if (campaignData.enableLeaderboard || campaignData.hasLeaderboard) {
      await prizeService.finalizeLeaderboard(campaignId);
      await prizeService.distributePrizes(campaignId);
    }

    // Step 2: Process payouts (pending -> available for all participants)
    // Fetch participants with pending balances and batch release
    const pendingTransactions = await prisma.transaction.findMany({
      where: { campaignId, type: 'RESERVATION' },
      select: { userId: true, amount: true },
    });

    // Aggregate pending amounts per editor
    const pendingByEditor = new Map<string, number>();
    for (const tx of pendingTransactions) {
      const current = pendingByEditor.get(tx.userId) ?? 0;
      pendingByEditor.set(tx.userId, current + tx.amount);
    }

    // Check for already-released payouts to avoid double release
    const existingPayouts = await prisma.transaction.findMany({
      where: { campaignId, type: 'PAYOUT' },
      select: { userId: true, amount: true },
    });

    const releasedByEditor = new Map<string, number>();
    for (const tx of existingPayouts) {
      const current = releasedByEditor.get(tx.userId) ?? 0;
      releasedByEditor.set(tx.userId, current + tx.amount);
    }

    for (const [editorId, pendingAmount] of pendingByEditor) {
      const alreadyReleased = releasedByEditor.get(editorId) ?? 0;
      const remaining = pendingAmount - alreadyReleased;
      if (remaining > 0) {
        try {
          await balanceService.releasePending(
            editorId,
            remaining,
            campaignId,
            `Campaign closure payout: ${campaignData.title}`
          );
        } catch (error) {
          logger.error({ editorId, remaining, campaignId, error }, 'Failed to release pending for editor');
        }
      }
    }

    // Step 3: Refund unused budget to campaign creator
    const remainingBudget = campaignData.totalBudget - campaignData.spentBudget;
    if (remainingBudget > 0 && campaignData.isFunded) {
      await balanceService.refundToCreator(
        campaignData.createdBy,
        remainingBudget,
        campaignId,
        `Refund unused budget: ${campaignData.title}`
      );
    }

    // Step 4: Audit log
    await logAudit(campaignData.createdBy, 'CAMPAIGN_CLOSURE', {
      campaignId,
      refunded: remainingBudget,
    });

    logger.info({ campaignId }, 'Campaign closure saga completed');
  } catch (error) {
    logger.error({ campaignId, error }, 'Campaign closure saga failed');
    throw error;
  }
}
