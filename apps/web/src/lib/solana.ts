import { Connection, PublicKey, Transaction, SystemProgram, SendTransactionError } from '@solana/web3.js';
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
  console.log('[Client] PlacePositionInstruction keys:', placePositionInstruction.keys.map((k: any) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner })));

  // Intercept the Transaction object and ensure that the delegatedAuthority key is marked as isSigner = true
  for (const ix of tx.instructions) {
    for (const keyMeta of ix.keys) {
      if (keyMeta.pubkey.equals(delegatedAuthority)) {
        keyMeta.isSigner = true;
      }
    }
  }

  console.log('[Client] After interception, instruction keys:', tx.instructions.map((ix: any) => ix.keys.map((k: any) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner }))));

  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = userWallet;

  // Sign with user wallet
  const partiallySignedTx = await walletSignTransaction(tx);
  console.log('[Client] After walletSignTransaction, signatures:', partiallySignedTx.signatures.map((s: any) => ({ publicKey: s.publicKey.toBase58(), signature: s.signature ? 'present' : 'null' })));
  
  // Inspecting instruction keys in the signed transaction returned by wallet adapter
  console.log('[Client] After walletSignTransaction, instruction keys:', partiallySignedTx.instructions.map((ix: any) => ix.keys.map((k: any) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner }))));

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
  try {
    const txSig = await connection.sendRawTransaction(finalTx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    });
    return txSig;
  } catch (err: any) {
    console.error('[Client] sendRawTransaction failed:', err);
    let logs: string[] = [];
    if (err instanceof SendTransactionError) {
      try {
        // Try getting logs synchronously or asynchronously
        const possibleLogs = (err as any).logs || await (err as any).getLogs(connection);
        if (Array.isArray(possibleLogs)) {
          logs = possibleLogs;
        }
      } catch (logErr) {
        console.error('Failed to retrieve logs from SendTransactionError:', logErr);
      }
    } else if (err.logs && Array.isArray(err.logs)) {
      logs = err.logs;
    } else if (typeof err.getLogs === 'function') {
      try {
        const possibleLogs = err.getLogs();
        if (Array.isArray(possibleLogs)) {
          logs = possibleLogs;
        }
      } catch (logErr) {
        console.error('Failed to call getLogs():', logErr);
      }
    }

    if (logs.length > 0) {
      console.error('[Client] Transaction logs:', logs);
      throw new Error(`Simulation failed. Message: ${err.message}. Logs: ${JSON.stringify(logs)}`);
    }
    throw err;
  }
}

export async function createPropMarket(
  connection: Connection,
  program: any,
  creatorWallet: PublicKey,
  matchIdStr: string,
  eventType: number,
  team: number,
  comparator: number,
  threshold: number,
  window: number,
  displayTitle: string,
  bettingClosesAtSecs: number,
  walletSignTransaction: (tx: Transaction) => Promise<Transaction>
): Promise<string> {
  const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

  // 1. Generate unique random 32-byte market ID
  const marketIdBytes = crypto.getRandomValues(new Uint8Array(32));

  // 2. Derive PDA for the market
  const [marketAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from('prop_market'), marketIdBytes],
    PROGRAM_ID
  );

  // 3. Derive PDA for the vault
  const [vaultAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from('prop_vault'), marketAddress.toBuffer()],
    PROGRAM_ID
  );

  const matchIdBytes = Buffer.alloc(32);
  Buffer.from(matchIdStr).copy(matchIdBytes);

  const createInstruction = await program.methods
    .createPropMarket(
      Array.from(marketIdBytes),
      Array.from(matchIdBytes),
      eventType,
      team,
      comparator,
      threshold,
      window,
      displayTitle,
      new anchor.BN(bettingClosesAtSecs)
    )
    .accounts({
      market: marketAddress,
      creator: creatorWallet,
      vaultTokenAccount: vaultAddress,
      vaultMint: WSOL_MINT,
      oracleAuthority: creatorWallet,
    } as any)
    .instruction();

  const tx = new Transaction();
  tx.add(createInstruction);

  const latestBlockhash = await connection.getLatestBlockhash();
  tx.recentBlockhash = latestBlockhash.blockhash;
  tx.feePayer = creatorWallet;

  const signedTx = await walletSignTransaction(tx);
  const txSig = await connection.sendRawTransaction(signedTx.serialize());
  await connection.confirmTransaction(txSig, 'confirmed');

  return txSig;
}

export async function placePropBet(
  connection: Connection,
  program: any,
  bettorWallet: PublicKey,
  marketAddress: PublicKey,
  side: boolean,
  amountInSol: number,
  walletSignTransaction: (tx: Transaction) => Promise<Transaction>
): Promise<string> {
  const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

  const [positionAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from('prop_position'), marketAddress.toBuffer(), bettorWallet.toBuffer()],
    PROGRAM_ID
  );

  const [vaultAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from('prop_vault'), marketAddress.toBuffer()],
    PROGRAM_ID
  );

  const userTokenAccount = await getAssociatedTokenAddress(WSOL_MINT, bettorWallet);
  const amountLamports = amountInSol * 1e9;

  const tx = new Transaction();

  // Create user's WSOL ATA if it doesn't exist
  const ataInfo = await connection.getAccountInfo(userTokenAccount);
  if (!ataInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        bettorWallet,
        userTokenAccount,
        bettorWallet,
        WSOL_MINT
      )
    );
  }

  // Wrap SOL (amount + 0.005 SOL for the rebate contribution)
  const wrapAmount = amountLamports;
  tx.add(
    SystemProgram.transfer({
      fromPubkey: bettorWallet,
      toPubkey: userTokenAccount,
      lamports: wrapAmount,
    })
  );
  tx.add(createSyncNativeInstruction(userTokenAccount));

  const betInstruction = await program.methods
    .placePropBet(side, new anchor.BN(amountLamports))
    .accounts({
      market: marketAddress,
      userPosition: positionAddress,
      bettor: bettorWallet,
      userTokenAccount: userTokenAccount,
      vaultTokenAccount: vaultAddress,
    } as any)
    .instruction();

  tx.add(betInstruction);

  const latestBlockhash = await connection.getLatestBlockhash();
  tx.recentBlockhash = latestBlockhash.blockhash;
  tx.feePayer = bettorWallet;

  const signedTx = await walletSignTransaction(tx);
  const txSig = await connection.sendRawTransaction(signedTx.serialize());
  await connection.confirmTransaction(txSig, 'confirmed');

  return txSig;
}

export async function claimPropPayout(
  connection: Connection,
  program: any,
  bettorWallet: PublicKey,
  marketAddress: PublicKey,
  walletSignTransaction: (tx: Transaction) => Promise<Transaction>
): Promise<string> {
  const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

  const [positionAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from('prop_position'), marketAddress.toBuffer(), bettorWallet.toBuffer()],
    PROGRAM_ID
  );

  const [vaultAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from('prop_vault'), marketAddress.toBuffer()],
    PROGRAM_ID
  );

  const userTokenAccount = await getAssociatedTokenAddress(WSOL_MINT, bettorWallet);

  const tx = new Transaction();

  // Create user's WSOL ATA if it doesn't exist
  const ataInfo = await connection.getAccountInfo(userTokenAccount);
  if (!ataInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        bettorWallet,
        userTokenAccount,
        bettorWallet,
        WSOL_MINT
      )
    );
  }

  const claimInstruction = await program.methods
    .claimPropPosition()
    .accounts({
      market: marketAddress,
      userPosition: positionAddress,
      bettor: bettorWallet,
      vaultTokenAccount: vaultAddress,
      userTokenAccount: userTokenAccount,
    } as any)
    .instruction();

  tx.add(claimInstruction);

  const latestBlockhash = await connection.getLatestBlockhash();
  tx.recentBlockhash = latestBlockhash.blockhash;
  tx.feePayer = bettorWallet;

  const signedTx = await walletSignTransaction(tx);
  const txSig = await connection.sendRawTransaction(signedTx.serialize());
  await connection.confirmTransaction(txSig, 'confirmed');

  return txSig;
}

