import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createSyncNativeInstruction } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const PROGRAM_ID = new PublicKey('2Syq46YQQ4iGbCouFYxjeHEcABScMd669NAK5XrxZFWG');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

async function run() {
  console.log("=== DEVNET PROP MARKET RESET & PLACE BET TEST ===");

  // Load IDL
  const idlPath = path.resolve(process.cwd(), 'apps/web/src/types/veribet.json');
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
    throw new Error("No future World Cup fixture found!");
  }
  console.log(`[TxLINE] Selected future fixture: ${futureFixture.Participant1} vs ${futureFixture.Participant2}`);
  console.log(`         Fixture ID: ${futureFixture.FixtureId}`);

  // 4. Initialize Solana Devnet connection and Authority Wallet
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const authorityKeypath = path.resolve(process.cwd(), "authority-keypair.json");
  const rawKey = fs.readFileSync(authorityKeypath, 'utf8');
  const authorityKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(rawKey)));
  console.log(`[Solana] Loaded authority pubkey: ${authorityKeypair.publicKey.toBase58()}`);

  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(authorityKeypair), { commitment: 'confirmed' });
  const program = new anchor.Program(idlJson as any, provider) as any;

  // 5. Generate random market ID and derive PDAs
  const marketIdBytes = crypto.randomBytes(32);
  const matchIdBytes = Buffer.alloc(32);
  Buffer.from(String(futureFixture.FixtureId)).copy(matchIdBytes);

  const eventType = 1; // Red Cards
  const team = 1;      // Team B / Away
  const comparator = 0; // CountGte
  const threshold = 2; // threshold of 2
  const window = 1;     // Window 1
  const displayTitle = "Red Cards (Away) >= 2";
  const bettingClosesAtSecs = Math.floor(futureFixture.StartTime / 1000);

  const thresholdBuffer = Buffer.alloc(2);
  thresholdBuffer.writeUInt16LE(threshold);

  const [marketAddress] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('prop_market'),
      matchIdBytes,
      Buffer.from([eventType]),
      Buffer.from([team]),
      thresholdBuffer
    ],
    PROGRAM_ID
  );

  const [vaultAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), marketAddress.toBuffer()],
    PROGRAM_ID
  );

  console.log(`[Solana] Derived Prop Market PDA: ${marketAddress.toBase58()}`);
  console.log(`[Solana] Derived Vault PDA: ${vaultAddress.toBase58()}`);

  console.log("=== TS DERIVATION SEEDS ===");
  console.log("matchIdBytes:", Array.from(matchIdBytes));
  console.log("eventType:", eventType);
  console.log("team:", team);
  console.log("thresholdBuffer:", Array.from(thresholdBuffer));

  // 6. Execute create_prop_market
  console.log("[Solana] Sending create_prop_market transaction...");
  const createTx = await program.methods
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
      creator: authorityKeypair.publicKey,
      vaultTokenAccount: vaultAddress,
      vaultMint: WSOL_MINT,
      oracleAuthority: authorityKeypair.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  
  console.log(`[Solana] Prop Market created! Signature: ${createTx}`);

  // Wait for confirmation
  console.log("[Solana] Waiting for market creation transaction confirmation...");
  await connection.confirmTransaction(createTx, "confirmed");

  // 7. Generate a new temporary user keypair to place a bet
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

  // 8. Place prop bet
  const [positionAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from('prop_position'), marketAddress.toBuffer(), userKeypair.publicKey.toBuffer()],
    PROGRAM_ID
  );

  const userTokenAccount = await getAssociatedTokenAddress(WSOL_MINT, userKeypair.publicKey);
  const amountLamports = 50_000_000; // 0.05 SOL

  const betInstruction = await program.methods
    .placePropBet(true, new anchor.BN(amountLamports))
    .accounts({
      market: marketAddress,
      userPosition: positionAddress,
      bettor: userKeypair.publicKey,
      userTokenAccount: userTokenAccount,
      vaultTokenAccount: vaultAddress,
    })
    .instruction();

  const tx = new Transaction();
  tx.add(
    createAssociatedTokenAccountInstruction(
      userKeypair.publicKey,
      userTokenAccount,
      userKeypair.publicKey,
      WSOL_MINT
    )
  );

  tx.add(
    SystemProgram.transfer({
      fromPubkey: userKeypair.publicKey,
      toPubkey: userTokenAccount,
      lamports: amountLamports,
    })
  );
  tx.add(createSyncNativeInstruction(userTokenAccount));

  tx.add(betInstruction);

  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = userKeypair.publicKey;

  tx.sign(userKeypair);

  console.log("[Solana] Sending place_prop_bet transaction...");
  try {
    const placeSig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    });
    console.log(`[Solana] Place Prop Bet transaction successful! Signature: ${placeSig}`);
    
    console.log("[Solana] Waiting for position transaction confirmation...");
    await connection.confirmTransaction(placeSig, "confirmed");
    
    // Fetch and check position state
    const propPosAccount = await program.account.propPosition.fetch(positionAddress);
    console.log("[Solana] Successfully fetched PropPosition state from on-chain:");
    console.log(`         Bettor: ${propPosAccount.bettor.toBase58()}`);
    console.log(`         Market PDA: ${propPosAccount.market.toBase58()}`);
    console.log(`         Amount: ${propPosAccount.amount.toNumber() / 1e9} SOL`);
    console.log(`         Side: ${propPosAccount.side}`);
    console.log("=== DEVNET PROP MARKET RESET & PLACE BET TEST COMPLETE ===");
  } catch (err: any) {
    console.error("[Solana] place_prop_bet failed:", err);
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
