import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createSyncNativeInstruction } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

const PROGRAM_ID = new PublicKey('2Syq46YQQ4iGbCouFYxjeHEcABScMd669NAK5XrxZFWG');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// PDAs helper
function getMarketPda(marketId: number): PublicKey {
  const [marketAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), new anchor.BN(marketId).toArrayLike(Buffer, 'le', 8)],
    PROGRAM_ID
  );
  return marketAddress;
}

function getUserPositionPda(marketAddress: PublicKey, userWallet: PublicKey): PublicKey {
  const [positionAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from('position'), marketAddress.toBuffer(), userWallet.toBuffer()],
    PROGRAM_ID
  );
  return positionAddress;
}

function getVaultPda(marketAddress: PublicKey): PublicKey {
  const [vaultAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), marketAddress.toBuffer()],
    PROGRAM_ID
  );
  return vaultAddress;
}

async function run() {
  console.log("=== DEVNET ENVIRONMENT RESET & PLACE POSITION ===");

  // Load IDL
  const idlPath = path.resolve(__dirname, '../../../../target/idl/veribet.json');
  const idlJson = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
  console.log(`[Solana] Loaded IDL from ${idlPath}`);

  // 1. Fetch guest JWT
  const authRes = await fetch("https://txline-dev.txodds.com/auth/guest/start", {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  const { token } = await authRes.json() as any;
  console.log(`[TxLINE] Fetched Guest JWT: ${token.substring(0, 20)}...`);

  // 2. Fetch snapshot
  const snapshotRes = await fetch("https://txline-dev.txodds.com/api/fixtures/snapshot", {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Api-Token': 'txoracle_api_ff5766409a3e41c3be19d9583e4b2910'
    }
  });
  const snapshot = await snapshotRes.json() as any[];
  
  // 3. Find a future World Cup fixture
  const now = Date.now();
  const futureFixture = snapshot.find((f: any) => f.Competition === "World Cup" && f.StartTime > now);
  if (!futureFixture) {
    throw new Error("No future World Cup fixture found in the snapshot!");
  }
  console.log(`[TxLINE] Selected future fixture: ${futureFixture.Participant1} vs ${futureFixture.Participant2}`);
  console.log(`         Fixture ID: ${futureFixture.FixtureId}`);
  console.log(`         Start Time: ${new Date(futureFixture.StartTime).toISOString()} (in ${Math.round((futureFixture.StartTime - now) / 1000 / 60)} minutes)`);

  // 4. Initialize Solana Devnet connection and Authority Wallet
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const authorityKeypath = path.resolve(__dirname, "../../../../authority-keypair.json");
  const rawKey = fs.readFileSync(authorityKeypath, 'utf8');
  const authorityKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(rawKey)));
  console.log(`[Solana] Loaded authority pubkey: ${authorityKeypair.publicKey.toBase58()}`);

  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(authorityKeypair), { commitment: 'confirmed' });
  const program = new anchor.Program(idlJson as any, provider) as any;

  // 5. Generate random market ID and derive PDAs
  const marketId = Math.floor(Math.random() * 10000000);
  const marketPda = getMarketPda(marketId);
  const vaultPda = getVaultPda(marketPda);
  console.log(`[Solana] Derived Market PDA: ${marketPda.toBase58()}`);
  console.log(`[Solana] Derived Vault PDA: ${vaultPda.toBase58()}`);

  // Match ID bytes (16 bytes)
  const matchIdBytes = Buffer.alloc(16);
  Buffer.from(String(futureFixture.FixtureId)).copy(matchIdBytes);

  const kickoffTimestamp = Math.floor(futureFixture.StartTime / 1000);
  const emergencyUnlockTimestamp = kickoffTimestamp + 7200;

  // 6. Execute create_market
  console.log("[Solana] Sending create_market transaction...");
  const createTx = await program.methods
    .createMarket(
      new anchor.BN(marketId),
      new anchor.BN(1), // sequence
      Array.from(matchIdBytes),
      2, // targetValue (e.g. 2 goals)
      new anchor.BN(kickoffTimestamp),
      new anchor.BN(emergencyUnlockTimestamp),
      0 // Over/Under
    )
    .accounts({
      market: marketPda,
      vaultMint: WSOL_MINT,
      vaultTokenAccount: vaultPda,
      authority: authorityKeypair.publicKey,
    })
    .rpc();
  
  console.log(`[Solana] Market created! Signature: ${createTx}`);

  // Wait for confirmation
  console.log("[Solana] Waiting for market creation transaction confirmation...");
  await connection.confirmTransaction(createTx, "confirmed");

  // 7. Generate a new temporary user keypair to place a position
  const userKeypair = Keypair.generate();
  console.log(`[Solana] Generated temporary user pubkey: ${userKeypair.publicKey.toBase58()}`);

  // Transfer 0.12 SOL from authority to user for fees + WSOL wrapping + gas rebate pool
  console.log("[Solana] Transferring 0.12 SOL from authority to temporary user...");
  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: authorityKeypair.publicKey,
      toPubkey: userKeypair.publicKey,
      lamports: 120_000_000, // 0.12 SOL
    })
  );
  fundTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  fundTx.feePayer = authorityKeypair.publicKey;
  fundTx.sign(authorityKeypair);

  const fundSig = await connection.sendRawTransaction(fundTx.serialize());
  console.log(`[Solana] Funding tx signature: ${fundSig}`);
  await connection.confirmTransaction(fundSig, "confirmed");

  // 8. Place position
  const positionAddress = getUserPositionPda(marketPda, userKeypair.publicKey);
  const userTokenAccount = await getAssociatedTokenAddress(WSOL_MINT, userKeypair.publicKey);
  const collateralAmount = 50_000_000; // 0.05 SOL

  const placeIx = await program.methods
    .placePosition(
      0, // predictionVector (Home / Over)
      new anchor.BN(collateralAmount),
      1, // tierLevel
      12345 // referenceNonce
    )
    .accounts({
      market: marketPda,
      userPosition: positionAddress,
      user: userKeypair.publicKey,
      vaultTokenAccount: vaultPda,
      userTokenAccount: userTokenAccount,
      delegatedAuthority: authorityKeypair.publicKey,
    })
    .instruction();

  // Mark delegatedAuthority as signer (as intercepted by the frontend)
  for (const keyMeta of placeIx.keys) {
    if (keyMeta.pubkey.equals(authorityKeypair.publicKey)) {
      keyMeta.isSigner = true;
    }
  }

  const tx = new Transaction();
  // Add WSOL ATA creation
  tx.add(
    createAssociatedTokenAccountInstruction(
      userKeypair.publicKey,
      userTokenAccount,
      userKeypair.publicKey,
      WSOL_MINT
    )
  );

  // Transfer and Sync Native (WSOL wrap)
  tx.add(
    SystemProgram.transfer({
      fromPubkey: userKeypair.publicKey,
      toPubkey: userTokenAccount,
      lamports: collateralAmount,
    })
  );
  tx.add(createSyncNativeInstruction(userTokenAccount));

  // Add the place_position instruction
  tx.add(placeIx);

  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = userKeypair.publicKey;

  // Sign with both userKeypair and authorityKeypair
  tx.sign(userKeypair, authorityKeypair);

  console.log("[Solana] Sending place_position transaction...");
  try {
    const placeSig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    });
    console.log(`[Solana] Place Position transaction successful! Signature: ${placeSig}`);
    
    console.log("[Solana] Waiting for position transaction confirmation...");
    await connection.confirmTransaction(placeSig, "confirmed");
    
    // Fetch and check position state
    const userPosAccount = await program.account.userPosition.fetch(positionAddress);
    console.log("[Solana] Successfully fetched UserPosition state from on-chain:");
    console.log(`         User Wallet: ${userPosAccount.userWallet.toBase58()}`);
    console.log(`         Market PDA: ${userPosAccount.marketAddress.toBase58()}`);
    console.log(`         Collateral: ${userPosAccount.collateralAmount.toNumber() / 1e9} SOL`);
    console.log(`         Prediction Vector: ${userPosAccount.predictionVector}`);
    console.log(`         Tier Level: ${userPosAccount.tierLevel}`);
    console.log(`         Reference Nonce: ${userPosAccount.referenceNonce}`);
    console.log("=== DEVNET ENVIRONMENT RESET & PLACE POSITION COMPLETE ===");
  } catch (err: any) {
    console.error("[Solana] place_position failed:", err);
    if (err.logs) {
      console.error("[Solana] Transaction logs:", err.logs);
    }
    throw err;
  }
}

run().catch(err => {
  console.error("Script failed:", err);
  process.exit(1);
});
