import { prisma } from '../lib/prisma';
import { campaignClient } from '../lib/serviceClients';
import { logger } from '../lib/logger';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function isRecent(date: Date): boolean {
  return Date.now() - date.getTime() < CACHE_TTL_MS;
}

/**
 * Sync campaign data into local cache (from event payload or API)
 */
export async function syncCampaignCache(
  campaignId: string,
  data?: { title?: string; status?: string; createdBy?: string; totalBudget?: number; isFunded?: boolean }
): Promise<void> {
  try {
    if (data && data.title) {
      await prisma.campaignCache.upsert({
        where: { id: campaignId },
        update: { ...data, syncedAt: new Date() },
        create: {
          id: campaignId,
          title: data.title,
          status: data.status || 'UNKNOWN',
          createdBy: data.createdBy,
          totalBudget: data.totalBudget,
          isFunded: data.isFunded ?? false,
          syncedAt: new Date(),
        },
      });
      return;
    }

    if (!campaignClient) {
      logger.warn('Campaign service URL not configured, skipping cache sync');
      return;
    }

    const response = await campaignClient.get(`/campaigns/${campaignId}`);
    const campaign = response.data;

    await prisma.campaignCache.upsert({
      where: { id: campaignId },
      update: {
        title: campaign.title,
        status: campaign.status,
        createdBy: campaign.createdBy,
        totalBudget: campaign.totalBudget,
        isFunded: campaign.isFunded ?? false,
        syncedAt: new Date(),
      },
      create: {
        id: campaignId,
        title: campaign.title,
        status: campaign.status,
        createdBy: campaign.createdBy,
        totalBudget: campaign.totalBudget,
        isFunded: campaign.isFunded ?? false,
        syncedAt: new Date(),
      },
    });
  } catch (error) {
    logger.error({ campaignId, error }, 'Failed to sync campaign cache');
  }
}

/**
 * Get campaign data from cache, refreshing if stale
 */
export async function getCampaignFromCache(campaignId: string) {
  const cached = await prisma.campaignCache.findUnique({ where: { id: campaignId } });

  if (cached && isRecent(cached.syncedAt)) {
    return cached;
  }

  await syncCampaignCache(campaignId);
  return prisma.campaignCache.findUnique({ where: { id: campaignId } });
}
