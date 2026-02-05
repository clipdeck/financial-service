import { Coinbase, Wallet } from '@coinbase/coinbase-sdk';
import { config } from '../config';
import { logger } from '../lib/logger';

// ============================================================================
// Coinbase CDP Integration
// ============================================================================

let coinbaseClient: Coinbase | null = null;

/**
 * Lazily initialise the Coinbase client.
 * Returns null if credentials are not configured.
 */
function getCoinbaseClient(): Coinbase | null {
  if (coinbaseClient) return coinbaseClient;

  if (!config.cdpApiKeyName || !config.cdpApiKeyPrivateKey) {
    logger.warn('Coinbase CDP credentials not configured -- crypto features disabled');
    return null;
  }

  try {
    coinbaseClient = new Coinbase({
      apiKeyName: config.cdpApiKeyName,
      privateKey: config.cdpApiKeyPrivateKey,
    });
    logger.info('Coinbase CDP client initialised');
    return coinbaseClient;
  } catch (error) {
    logger.error(error, 'Failed to initialise Coinbase CDP client');
    return null;
  }
}

/**
 * Create a new wallet for a campaign on Base Sepolia.
 */
export async function createCampaignWallet(campaignId: string) {
  const client = getCoinbaseClient();
  if (!client) {
    throw new Error('Coinbase CDP not configured');
  }

  try {
    const wallet = await Wallet.create({ networkId: Coinbase.networks.BaseSepolia });
    const address = await wallet.getDefaultAddress();

    logger.info(
      { campaignId, walletId: wallet.getId(), address: address?.getId() },
      'Campaign wallet created'
    );

    return {
      walletId: wallet.getId(),
      address: address?.getId(),
      networkId: Coinbase.networks.BaseSepolia,
      walletData: JSON.stringify(await wallet.export()),
    };
  } catch (error) {
    logger.error({ campaignId, error }, 'Failed to create campaign wallet');
    throw error;
  }
}

/**
 * Get the USDC balance of a campaign wallet.
 */
export async function getCampaignWalletBalance(walletId: string) {
  const client = getCoinbaseClient();
  if (!client) {
    throw new Error('Coinbase CDP not configured');
  }

  try {
    const wallet = await Wallet.fetch(walletId);
    const balance = await wallet.getBalance(Coinbase.assets.Usdc);

    logger.info({ walletId, balance: balance.toString() }, 'Wallet balance fetched');

    return {
      walletId,
      balance: balance.toString(),
      asset: 'USDC',
    };
  } catch (error) {
    logger.error({ walletId, error }, 'Failed to get wallet balance');
    throw error;
  }
}

/**
 * Transfer USDC from a campaign wallet to a destination address.
 */
export async function transferCampaignFunds(
  walletId: string,
  destinationAddress: string,
  amount: number,
  walletDataJson?: string
) {
  const client = getCoinbaseClient();
  if (!client) {
    throw new Error('Coinbase CDP not configured');
  }

  try {
    let wallet: Wallet;

    if (walletDataJson) {
      // Import wallet from saved data for signing
      const walletData = JSON.parse(walletDataJson);
      wallet = await Wallet.import(walletData);
    } else {
      wallet = await Wallet.fetch(walletId);
    }

    const transfer = await wallet.createTransfer({
      amount,
      assetId: Coinbase.assets.Usdc,
      destination: destinationAddress,
    });

    // Wait for the transfer to complete
    await transfer.wait();

    logger.info(
      {
        walletId,
        destinationAddress,
        amount,
        transferId: transfer.getId(),
        status: transfer.getStatus(),
      },
      'Campaign funds transferred'
    );

    return {
      transferId: transfer.getId(),
      status: transfer.getStatus(),
      transactionHash: transfer.getTransactionHash(),
    };
  } catch (error) {
    logger.error({ walletId, destinationAddress, amount, error }, 'Failed to transfer campaign funds');
    throw error;
  }
}

/**
 * Verify that a campaign wallet has received the expected funding amount.
 */
export async function verifyFundingTransaction(walletId: string, expectedAmount: number) {
  const client = getCoinbaseClient();
  if (!client) {
    throw new Error('Coinbase CDP not configured');
  }

  try {
    const wallet = await Wallet.fetch(walletId);
    const balance = await wallet.getBalance(Coinbase.assets.Usdc);
    const balanceNumber = parseFloat(balance.toString());

    const isFunded = balanceNumber >= expectedAmount;

    logger.info(
      { walletId, expectedAmount, actualBalance: balanceNumber, isFunded },
      'Funding verification completed'
    );

    return {
      walletId,
      expectedAmount,
      actualBalance: balanceNumber,
      isFunded,
    };
  } catch (error) {
    logger.error({ walletId, expectedAmount, error }, 'Failed to verify funding transaction');
    throw error;
  }
}
