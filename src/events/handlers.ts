import { createConsumer, withRetry, withLogging } from '@clipdeck/events';
import type { EventConsumer } from '@clipdeck/events';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config';
import { handleClipApproved } from '../sagas/clipApproval';
import { handleCampaignEnded } from '../sagas/campaignClosure';
import { logAudit } from '../middleware/auditLog';

let consumer: EventConsumer | null = null;

/**
 * Set up event handlers for events this service consumes from other services
 */
export async function setupEventHandlers() {
  consumer = createConsumer({
    serviceName: 'financial-service',
    connectionUrl: config.rabbitmqUrl,
    exchange: config.eventExchange,
    queueName: 'financial.events',
    routingKeys: ['clip.approved', 'clip.rejected', 'campaign.ended', 'campaign.funded'],
    enableLogging: true,
    logger: {
      info: (msg, data) => logger.info(data, msg),
      error: (msg, err) => logger.error(err, msg),
      debug: (msg, data) => logger.debug(data, msg),
    },
  });

  // Handle clip approval: reserve payment for editor
  consumer.on(
    'clip.approved',
    withRetry(
      withLogging(async (event, ctx) => {
        const { clipId, campaignId, userId, paymentAmount } = event.payload;
        await handleClipApproved(clipId, campaignId, userId, paymentAmount);
        await ctx.ack();
      })
    )
  );

  // Handle clip rejection: log for auditing (no financial action needed)
  consumer.on(
    'clip.rejected',
    withRetry(
      withLogging(async (event, ctx) => {
        const { clipId, campaignId, userId, reason } = event.payload;
        logger.info({ clipId, campaignId, userId, reason }, 'Clip rejected - no financial action');
        await ctx.ack();
      })
    )
  );

  // Handle campaign ended: run closure saga
  consumer.on(
    'campaign.ended',
    withRetry(
      withLogging(async (event, ctx) => {
        const { campaignId, hasLeaderboard, totalPaid } = event.payload;

        // Fetch full campaign data from campaign-service for the saga
        try {
          const response = await fetch(`${config.campaignServiceUrl}/campaigns/${campaignId}`);
          if (!response.ok) {
            logger.error({ campaignId }, 'Failed to fetch campaign data for closure');
            await ctx.nack(true);
            return;
          }

          const campaignData = (await response.json()) as Record<string, any>;
          await handleCampaignEnded(campaignId, {
            campaignId,
            createdBy: campaignData.createdBy ?? campaignData.ownerId,
            title: campaignData.title ?? '',
            totalBudget: campaignData.totalBudget ?? 0,
            spentBudget: campaignData.spentBudget ?? totalPaid ?? 0,
            isFunded: campaignData.isFunded ?? false,
            enableLeaderboard: campaignData.enableLeaderboard ?? hasLeaderboard,
            hasLeaderboard,
          });

          await ctx.ack();
        } catch (error) {
          logger.error({ campaignId, error }, 'Campaign closure handler failed');
          await ctx.nack(true);
        }
      })
    )
  );

  // Handle campaign funded: log the funding transaction
  consumer.on(
    'campaign.funded',
    withRetry(
      withLogging(async (event, ctx) => {
        const { campaignId, amount, fundedBy } = event.payload;

        await prisma.transaction.create({
          data: {
            userId: fundedBy,
            campaignId,
            amount,
            type: 'FUNDING',
            description: `Campaign funded: ${campaignId}`,
          },
        });

        await logAudit(fundedBy, 'CAMPAIGN_FUNDING_RECEIVED', {
          campaignId,
          amount,
        });

        logger.info({ campaignId, amount, fundedBy }, 'Campaign funding recorded');
        await ctx.ack();
      })
    )
  );

  await consumer.start();
  logger.info('Financial event handlers started');
}

export async function stopEventHandlers() {
  if (consumer) {
    await consumer.stop();
    consumer = null;
  }
}
