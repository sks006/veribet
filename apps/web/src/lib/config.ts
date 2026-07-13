export interface Config {
  network: 'mainnet' | 'devnet';
  rpcUrl: string;
  programId: string;
  txlineApiOrigin: string;
  txlineServiceLevel: number;
  txlineDurationWeeks: number;
}

export function getConfig(env: NodeJS.ProcessEnv): Config {
  const network = (env.NEXT_PUBLIC_SOLANA_NETWORK || env.SOLANA_NETWORK || 'devnet') as 'mainnet' | 'devnet';
  const rpcUrl = env.NEXT_PUBLIC_RPC_URL || env.RPC_URL || 'https://api.devnet.solana.com';
  const programId = env.NEXT_PUBLIC_VERIBET_PROGRAM_ID || env.VERIBET_PROGRAM_ID || '2Syq46YQQ4iGbCouFYxjeHEcABScMd669NAK5XrxZFWG';
  const txlineApiOrigin = env.NEXT_PUBLIC_TXLINE_API_ORIGIN || env.TXLINE_API_ORIGIN || 'https://txline-dev.txodds.com';
  const txlineServiceLevel = parseInt(env.NEXT_PUBLIC_TXLINE_SERVICE_LEVEL || env.TXLINE_SERVICE_LEVEL || '1', 10);
  const txlineDurationWeeks = parseInt(env.NEXT_PUBLIC_TXLINE_DURATION_WEEKS || env.TXLINE_DURATION_WEEKS || '4', 10);

  // Validate required fields
  if (!programId) {
    throw new Error('Program ID is not set in environment variables (NEXT_PUBLIC_VERIBET_PROGRAM_ID)');
  }
  if (!rpcUrl) {
    throw new Error('RPC URL is not set (NEXT_PUBLIC_RPC_URL)');
  }

  return {
    network,
    rpcUrl,
    programId,
    txlineApiOrigin,
    txlineServiceLevel,
    txlineDurationWeeks,
  };
}

export const config = getConfig(process.env);
