import * as fs from 'fs';
import * as path from 'path';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import nacl from 'tweetnacl';
import * as anchor from '@coral-xyz/anchor';
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import txoracleIdl from '../../../apps/web/src/lib/txoracle.json';

const TXLINE_DEVNET_PROGRAM_ID = new PublicKey('6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J');
const TXLINE_DEVNET_MINT = new PublicKey('4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

async function main() {
  const rpcUrl = process.env.RPC_URL || 'https://api.devnet.solana.com';
  console.log(`[Activation] Connecting to Solana cluster at: ${rpcUrl}`);
  const connection = new Connection(rpcUrl, 'confirmed');

  // Load keypair from root workspace authority-keypair.json
  const keypairPath = path.resolve(__dirname, '../../../authority-keypair.json');
  if (!fs.existsSync(keypairPath)) {
    throw new Error(`Authority keypair not found at: ${keypairPath}`);
  }

  const rawKeypair = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
  const authorityKeypair = Keypair.fromSecretKey(Uint8Array.from(rawKeypair));
  console.log(`[Activation] Loaded authority public key: ${authorityKeypair.publicKey.toBase58()}`);

  // Step 1: Start guest session and retrieve guest JWT
  console.log('[Activation] Step 1: Requesting guest JWT...');
  const startRes = await fetch('https://txline-dev.txodds.com/auth/guest/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!startRes.ok) {
    throw new Error(`Failed to start guest session: ${startRes.statusText}`);
  }
  const startData = await startRes.json();
  const jwt = startData.token || startData.jwt;
  if (!jwt) {
    throw new Error(`No JWT returned: ${JSON.stringify(startData)}`);
  }
  console.log('[Activation] Obtained Guest JWT.');

  // Step 2: Execute/Retrieve on-chain subscription
  const serviceLevel = 1; // Service Level 1: World Cup & International Friendlies
  const weeks = 4;

  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_treasury_v2')],
    TXLINE_DEVNET_PROGRAM_ID
  );
  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('pricing_matrix')],
    TXLINE_DEVNET_PROGRAM_ID
  );

  const tokenTreasuryVault = await getAssociatedTokenAddress(
    TXLINE_DEVNET_MINT,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const userTokenAccount = await getAssociatedTokenAddress(
    TXLINE_DEVNET_MINT,
    authorityKeypair.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const wallet = new anchor.Wallet(authorityKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const txProgram = new anchor.Program(txoracleIdl as any, provider) as any;

  let txSig = '';
  try {
    // Check if ATA needs to be created
    const ataInfo = await connection.getAccountInfo(userTokenAccount);
    if (!ataInfo) {
      console.log('[Activation] Creating user Associated Token Account (ATA)...');
      const ataTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          authorityKeypair.publicKey,
          userTokenAccount,
          authorityKeypair.publicKey,
          TXLINE_DEVNET_MINT,
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
      const ataSig = await provider.sendAndConfirm(ataTx);
      console.log(`[Activation] ATA created. Tx: ${ataSig}`);
    }

    console.log('[Activation] Step 2: Submitting on-chain subscription...');
    txSig = await txProgram.methods
      .subscribe(serviceLevel, weeks)
      .accounts({
        user: authorityKeypair.publicKey,
        pricingMatrix: pricingMatrixPda,
        tokenMint: TXLINE_DEVNET_MINT,
        userTokenAccount,
        tokenTreasuryVault,
        tokenTreasuryPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .rpc();
    console.log(`[Activation] On-chain subscription transaction confirmed. Tx: ${txSig}`);
  } catch (err: any) {
    console.log(`[Activation] Subscription failed or already exists: ${err.message}`);
    console.log('[Activation] Scanning transaction history to retrieve existing subscription...');
    const signatures = await connection.getSignaturesForAddress(authorityKeypair.publicKey, { limit: 20 });
    for (const sigInfo of signatures) {
      const txDetails = await connection.getParsedTransaction(sigInfo.signature, {
        maxSupportedTransactionVersion: 0,
      });
      if (txDetails && txDetails.transaction.message.accountKeys.some(key => key.pubkey.equals(TXLINE_DEVNET_PROGRAM_ID))) {
        txSig = sigInfo.signature;
        console.log(`[Activation] Found existing subscription signature: ${txSig}`);
        break;
      }
    }
    if (!txSig) {
      throw new Error('No subscription transaction signature found. Please verify the authority wallet is funded and has subscribed.');
    }
  }

  // Step 3: Sign Message & Activate API Token
  console.log('[Activation] Step 3: Signing handshake message...');
  const messageString = `${txSig}::${jwt}`;
  const encodedMessage = new TextEncoder().encode(messageString);
  const signatureBytes = nacl.sign.detached(encodedMessage, authorityKeypair.secretKey);
  const walletSignature = Buffer.from(signatureBytes).toString('base64');

  console.log('[Activation] Requesting API Token activation...');
  const activateRes = await fetch('https://txline-dev.txodds.com/api/token/activate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      txSig,
      walletSignature,
    }),
  });

  if (!activateRes.ok) {
    const errorText = await activateRes.text();
    throw new Error(`Activation request failed: ${activateRes.statusText} (${errorText})`);
  }

  let apiToken = '';
  const contentType = activateRes.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    const activateData = await activateRes.json();
    apiToken = activateData.apiToken || activateData.token || activateData.apiKey;
  } else {
    apiToken = await activateRes.text();
  }
  
  apiToken = apiToken.replace(/^["']|["']$/g, '').trim();
  
  if (!apiToken) {
    throw new Error('No API token returned from activation response.');
  }
  console.log(`[Activation] API Token successfully activated: ${apiToken}`);

  // Step 4: Save API Token to txline-config.json
  const configPath = path.resolve(__dirname, '../../../txline-config.json');
  const config = {
    apiToken,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  console.log(`[Activation] Successfully written configuration to: ${configPath}`);
}

main().catch((err) => {
  console.error('[Activation] Error executing activation handshake:', err);
  process.exit(1);
});
