import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config';
import { publisher, PaymentEvents, SERVICE_NAME } from '../lib/events';
import * as balanceService from './balanceService';
import { badRequest, notFound } from '../lib/errors';

// ============================================================================
// Types
// ============================================================================

interface ClipPaymentInput {
  views: number;
  paymentType: 'PAY_PER_VIEW' | 'FIXED' | 'HYBRID';
  basePay: number;
  rewardPerView: number;
  limitPerClip?: number;
}

interface CampaignData {
  id: string;
  title: string;
  createdBy: string;
  paymentType: string;
  basePay: number;
  rewardPerView: number;
  limitPerClip?: number;
  totalBudget: number;
  spentBudget: number;
  isFunded: boolean;
}

interface ClipData {
  id: string;
  userId: string;
  campaignId: string;
  views: number;
  status: string;
}

interface EditorPayment {
  editorId: string;
  clipId: string;
  views: number;
  grossAmount: number;
  platformFee: number;
  netAmount: number;
}

// ============================================================================
// Payment Calculation (from monolith paymentCalculator.ts)
// ============================================================================

/**
 * Calculate payment for a single clip based on its views and campaign payment config.
 * Pure calculation function, no side effects.
 */
export function calculateClipPayment(input: ClipPaymentInput): number {
  const { views, paymentType, basePay, rewardPerView, limitPerClip } = input;

  let amount = 0;

  switch (paymentType) {
    case 'FIXED':
      amount = basePay;
      break;
    case 'PAY_PER_VIEW':
      amount = views * rewardPerView;
      break;
    case 'HYBRID':
      amount = basePay + views * rewardPerView;
      break;
    default:
      amount = 0;
  }

  // Apply per-clip limit if set
  if (limitPerClip && limitPerClip > 0 && amount > limitPerClip) {
    amount = limitPerClip;
  }

  return Math.round(amount);
}

// ============================================================================
// Cross-Service API Helpers
// ============================================================================

async function fetchCampaignData(campaignId: string): Promise<CampaignData> {
  const response = await fetch(`${config.campaignServiceUrl}/campaigns/${campaignId}`);
  if (!response.ok) {
    throw notFound(`Campaign ${campaignId} not found`);
  }
  return response.json() as Promise<CampaignData>;
}

async function fetchApprovedClips(campaignId: string): Promise<ClipData[]> {
  const response = await fetch(
    `${config.clipServiceUrl}/clips?campaignId=${campaignId}&status=APPROVED`
  );
  if (!response.ok) {
    logger.warn({ campaignId }, 'Failed to fetch clips from clip-service');
    return [];
  }
  const data = (await response.json()) as { clips: ClipData[] };
  return data.clips ?? [];
}

// ============================================================================
// Campaign Payments
// ============================================================================

/**
 * Calculate payment breakdown for all editors in a campaign.
 * Does not execute any payments, just returns the breakdown.
 */
export async function calculateCampaignPayments(campaignId: string): Promise<EditorPayment[]> {
  const campaign = await fetchCampaignData(campaignId);
  const clips = await fetchApprovedClips(campaignId);

  const feePercent = config.platformFeePercent;

  const payments: EditorPayment[] = clips.map((clip) => {
    const grossAmount = calculateClipPayment({
      views: clip.views,
      paymentType: campaign.paymentType as ClipPaymentInput['paymentType'],
      basePay: campaign.basePay,
      rewardPerView: campaign.rewardPerView,
      limitPerClip: campaign.limitPerClip,
    });

    const platformFee = Math.round(grossAmount * (feePercent / 100));
    const netAmount = grossAmount - platformFee;

    return {
      editorId: clip.userId,
      clipId: clip.id,
      views: clip.views,
      grossAmount,
      platformFee,
      netAmount,
    };
  });

  return payments;
}

/**
 * Execute payouts for a campaign: calculate, create transactions, update balances.
 * Moves pending -> available for each editor.
 */
export async function processPayouts(campaignId: string) {
  logger.info({ campaignId }, 'Processing payouts for campaign');

  const payments = await calculateCampaignPayments(campaignId);

  if (payments.length === 0) {
    logger.info({ campaignId }, 'No payments to process');
    return { processed: 0, payments: [] };
  }

  const results: Array<{ editorId: string; amount: number; transactionId: string }> = [];

  for (const payment of payments) {
    try {
      const result = await balanceService.releasePending(
        payment.editorId,
        payment.netAmount,
        campaignId,
        `Payout for clip ${payment.clipId}`
      );
      results.push({
        editorId: payment.editorId,
        amount: payment.netAmount,
        transactionId: result.transaction.id,
      });
    } catch (error) {
      logger.error(
        { editorId: payment.editorId, clipId: payment.clipId, error },
        'Failed to process payout for editor'
      );
    }
  }

  logger.info(
    { campaignId, processed: results.length, total: payments.length },
    'Payouts processed'
  );

  return { processed: results.length, payments: results };
}
