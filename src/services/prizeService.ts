import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config';
import { publisher, PaymentEvents, SERVICE_NAME } from '../lib/events';
import * as balanceService from './balanceService';

// ============================================================================
// Types
// ============================================================================

/** Matches the LeaderboardMetric enum in prisma/schema.prisma */
type LeaderboardMetric = 'VIEWS' | 'LIKES' | 'ENGAGEMENT';

interface ClipData {
  id: string;
  userId: string;
  campaignId: string;
  views: number;
  likes: number;
  engagement: number;
  status: string;
}

// ============================================================================
// Cross-Service API Helpers
// ============================================================================

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
// Leaderboard
// ============================================================================

/**
 * Calculate leaderboard scores for a campaign by fetching approved clips,
 * scoring them based on the given metric, and upserting leaderboard entries.
 */
export async function calculateLeaderboard(campaignId: string, metric: LeaderboardMetric) {
  const clips = await fetchApprovedClips(campaignId);

  if (clips.length === 0) {
    logger.info({ campaignId }, 'No clips found for leaderboard');
    return [];
  }

  // Score each clip based on the metric
  const scored = clips.map((clip) => {
    let score = 0;
    switch (metric) {
      case 'VIEWS':
        score = clip.views;
        break;
      case 'LIKES':
        score = clip.likes;
        break;
      case 'ENGAGEMENT':
        score = clip.engagement;
        break;
    }
    return { ...clip, score };
  });

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  // Upsert leaderboard entries with rank
  const entries = await Promise.all(
    scored.map((clip, index) =>
      prisma.leaderboardEntry.upsert({
        where: { submissionId: clip.id },
        create: {
          campaignId,
          editorId: clip.userId,
          submissionId: clip.id,
          views: clip.views,
          likes: clip.likes,
          engagement: clip.engagement,
          score: clip.score,
          rank: index + 1,
        },
        update: {
          views: clip.views,
          likes: clip.likes,
          engagement: clip.engagement,
          score: clip.score,
          rank: index + 1,
        },
      })
    )
  );

  logger.info({ campaignId, entries: entries.length }, 'Leaderboard calculated');
  return entries;
}

/**
 * Finalize leaderboard: lock final rankings so they cannot change.
 */
export async function finalizeLeaderboard(campaignId: string) {
  const entries = await prisma.leaderboardEntry.findMany({
    where: { campaignId },
    orderBy: { score: 'desc' },
  });

  // Re-rank to ensure consistency at finalization
  for (let i = 0; i < entries.length; i++) {
    await prisma.leaderboardEntry.update({
      where: { id: entries[i].id },
      data: { rank: i + 1 },
    });
  }

  logger.info({ campaignId, totalEntries: entries.length }, 'Leaderboard finalized');
  return entries;
}

// ============================================================================
// Prize Distribution
// ============================================================================

/**
 * Distribute prizes for a campaign based on prize configuration and leaderboard rankings.
 */
export async function distributePrizes(campaignId: string) {
  // Get prize configuration
  const prizeConfig = await prisma.prizeDistribution.findMany({
    where: { campaignId },
    orderBy: { position: 'asc' },
  });

  if (prizeConfig.length === 0) {
    logger.info({ campaignId }, 'No prize configuration found for campaign');
    return [];
  }

  // Get leaderboard entries
  const leaderboard = await prisma.leaderboardEntry.findMany({
    where: { campaignId },
    orderBy: { rank: 'asc' },
  });

  const distributed: Array<{
    position: number;
    editorId: string;
    amount: number;
    label: string;
  }> = [];

  for (const prize of prizeConfig) {
    // Find the leaderboard entry at this position
    const entry = leaderboard.find((e) => e.rank === prize.position);
    if (!entry) {
      logger.warn({ campaignId, position: prize.position }, 'No editor at prize position');
      continue;
    }

    try {
      // Add prize amount to editor's pending balance
      await balanceService.reserveFunds(
        entry.editorId,
        prize.reward,
        campaignId,
        `Prize: ${prize.label} (Position #${prize.position})`
      );

      // Publish prize distributed event
      await publisher.publish(
        PaymentEvents.prizeDistributed(
          {
            campaignId,
            editorId: entry.editorId,
            position: prize.position,
            amount: prize.reward,
            clipId: entry.submissionId,
          },
          SERVICE_NAME
        )
      );

      distributed.push({
        position: prize.position,
        editorId: entry.editorId,
        amount: prize.reward,
        label: prize.label,
      });
    } catch (error) {
      logger.error(
        { campaignId, position: prize.position, editorId: entry.editorId, error },
        'Failed to distribute prize'
      );
    }
  }

  logger.info(
    { campaignId, distributed: distributed.length, total: prizeConfig.length },
    'Prizes distributed'
  );

  return distributed;
}
