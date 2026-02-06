import { createConsumer, withRetry, withLogging } from '@clipdeck/events';
import type { EventConsumer } from '@clipdeck/events';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config';
import { handleClipApproved } from '../sagas/clipApproval';
import { handleCampaignEnded } from '../sagas/campaignClosure';
import { logAudit } from '../middleware/auditLog';
import { syncCampaignCache, getCampaignFromCache } from '../services/cacheService';
import { campaignClient } from '../lib/serviceClients';

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
    routingKeys: ['clip.approved', 'clip.rejected', 'campaign.ended', 'campaign.funded', 'campaign.created', 'campaign.status_changed'],
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

  // Handle campaign ended: run closure saga using cached data
  consumer.on(
    'campaign.ended',
    withRetry(
      withLogging(async (event, ctx) => {
        const { campaignId, hasLeaderboard, totalPaid } = event.payload;

        try {
          // Try cache first, then fallback to API
          let campaignData = await getCampaignFromCache(campaignId);

          if (!campaignData && campaignClient) {
            const response = await campaignClient.get(`/campaigns/${campaignId}`);
            campaignData = response.data;
          }

          if (!campaignData) {
            logger.error({ campaignId }, 'Failed to fetch campaign data for closure');
            await ctx.nack(true);
            return;
          }

          await handleCampaignEnded(campaignId, {
            campaignId,
            createdBy: campaignData.createdBy ?? '',
            title: campaignData.title ?? '',
            totalBudget: campaignData.totalBudget ?? 0,
            spentBudget: totalPaid ?? 0,
            isFunded: campaignData.isFunded ?? false,
            enableLeaderboard: hasLeaderboard,
            hasLeaderboard,
          });

          // Update cache with ended status
          await syncCampaignCache(campaignId, { status: 'ENDED' });

          await ctx.ack();
        } catch (error) {
          logger.error({ campaignId, error }, 'Campaign closure handler failed');
          await ctx.nack(true);
        }
      })
    )
  );

  // Handle campaign funded: log the funding transaction + sync cache
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

        // Sync campaign cache with funded status
        await syncCampaignCache(campaignId, { isFunded: true });

        logger.info({ campaignId, amount, fundedBy }, 'Campaign funding recorded');
        await ctx.ack();
      })
    )
  );

  // Handle campaign created: cache campaign data
  consumer.on(
    'campaign.created',
    withRetry(
      withLogging(async (event, ctx) => {
        const { campaignId, title, ownerId } = event.payload;
        await syncCampaignCache(campaignId, { title, createdBy: ownerId, status: 'ACTIVE' });
        logger.info({ campaignId, title }, 'Campaign created - cached');
        await ctx.ack();
      })
    )
  );

  // Handle campaign status changed: update cache
  consumer.on(
    'campaign.status_changed',
    withRetry(
      withLogging(async (event, ctx) => {
        const { campaignId, newStatus } = event.payload;
        await syncCampaignCache(campaignId, { status: newStatus });
        logger.debug({ campaignId, newStatus }, 'Campaign status changed - cache synced');
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
