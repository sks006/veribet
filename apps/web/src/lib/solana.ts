import { Connection, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { 
  getAssociatedTokenAddress, 
  createAssociatedTokenAccountInstruction, 
  createSyncNativeInstruction 
} from '@solana/spl-token';

export const PROGRAM_ID = new PublicKey('2Syq46YQQ4iGbCouFYxjeHEcABScMd669NAK5XrxZFWG');

export function getMarketPda(marketId: number): PublicKey {
  const [marketAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), new anchor.BN(marketId).toArrayLike(Buffer, 'le', 8)],
    PROGRAM_ID
  );
  return marketAddress;
}

export function getUserPositionPda(marketAddress: PublicKey, userWallet: PublicKey): PublicKey {
  const [positionAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from('position'), marketAddress.toBuffer(), userWallet.toBuffer()],
    PROGRAM_ID
  );
  return positionAddress;
}

export function getVaultPda(marketAddress: PublicKey): PublicKey {
  const [vaultAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), marketAddress.toBuffer()],
    PROGRAM_ID
  );
  return vaultAddress;
}

/**
 * Builds a PlacePosition transaction, co-signs it with the server-side
 * delegated authority, and broadcasts it to the network.
 */
export async function placePositionWithDelegation(
  connection: Connection,
  program: any,
  userWallet: PublicKey,
  marketAddress: PublicKey,
  collateralAmount: number,
  predictionVector: number,
  tierLevel: number,
  referenceNonce: number,
  walletSignTransaction: (tx: Transaction) => Promise<Transaction>
): Promise<string> {
  const positionAddress = getUserPositionPda(marketAddress, userWallet);
  const vaultAddress = getVaultPda(marketAddress);

  // 1. Fetch market account to get vault token info
  const market = await program.account.parametricMarket.fetch(marketAddress);

  // 2. Fetch or mock the delegated authority address from the endpoint
  const authResponse = await fetch('/api/position/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionHex: '00' }) // Dummy check
  }).then(r => r.json()).catch(() => ({ authorizedBy: PublicKey.default.toBase58() }));
  
  const delegatedAuthority = new PublicKey(authResponse.authorizedBy || PublicKey.default.toBase58());

  // 3. Derive user token account
  // Read vault token account to get its mint
  let vaultMint = PublicKey.default;
  try {
    const vaultInfo: any = await connection.getParsedAccountInfo(market.vaultTokenAccount);
    vaultMint = new PublicKey(vaultInfo.value?.data.parsed.info.mint);
  } catch (err) {
    console.error('Failed to parse vault mint, defaulting to WSOL:', err);
    vaultMint = new PublicKey('So11111111111111111111111111111111111111112'); // WSOL fallback
  }

  const userTokenAccount = await getAssociatedTokenAddress(vaultMint, userWallet);

  // 4. Build instruction
  const placePositionInstruction = await program.methods
    .placePosition(
      predictionVector,
      new anchor.BN(collateralAmount),
      tierLevel,
      referenceNonce
    )
    .accounts({
      market: marketAddress,
      userPosition: positionAddress,
      user: userWallet,
      vaultTokenAccount: market.vaultTokenAccount,
      userTokenAccount: userTokenAccount,
      delegatedAuthority: delegatedAuthority,
    } as any)
    .instruction();

  // 5. Build and serialize Transaction
  const tx = new Transaction();

  const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

  // If vault mint is WSOL, automatically handle creation and wrapping of SOL
  if (vaultMint.equals(WSOL_MINT)) {
    const ataInfo = await connection.getAccountInfo(userTokenAccount);
    if (!ataInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          userWallet,
          userTokenAccount,
          userWallet,
          WSOL_MINT
        )
      );
    }

    // Transfer SOL to the user's WSOL ATA
    tx.add(
      SystemProgram.transfer({
        fromPubkey: userWallet,
        toPubkey: userTokenAccount,
        lamports: collateralAmount,
      })
    );

    // Sync native to wrap the transferred SOL
    tx.add(createSyncNativeInstruction(userTokenAccount));
  }

  tx.add(placePositionInstruction);
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = userWallet;

  // Sign with user wallet
  const partiallySignedTx = await walletSignTransaction(tx);
  const serializedTx = partiallySignedTx.serialize({ requireAllSignatures: false }).toString('hex');

  // 6. Sign with server delegated authority
  const signResponse = await fetch('/api/position/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionHex: serializedTx, isVersioned: false })
  }).then(r => r.json());

  if (!signResponse.success) {
    throw new Error(signResponse.error || 'Server-side delegated signing failed.');
  }

  // 7. Deserialize & Broadcast
  const finalTx = Transaction.from(Buffer.from(signResponse.transactionHex, 'hex'));
  const txSig = await connection.sendRawTransaction(finalTx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed'
  });

  return txSig;
}
