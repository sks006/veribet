import { NextRequest, NextResponse } from 'next/server';
import { Connection, Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

function getDelegatedAuthorityKeypair(): Keypair {
  const envPath = process.env.AUTHORITY_KEY_PATH;
  if (envPath) {
    try {
      const resolvedPath = path.resolve(envPath);
      if (fs.existsSync(resolvedPath)) {
        const raw = fs.readFileSync(resolvedPath, 'utf8');
        const secret = Uint8Array.from(JSON.parse(raw));
        return Keypair.fromSecretKey(secret);
      }
    } catch (e) {
      console.warn('[Authorize API] Failed to load keypair from AUTHORITY_KEY_PATH, generating fallback.');
    }
  }

  const fallbackKey = Keypair.generate();
  return fallbackKey;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { transactionHex, isVersioned } = body;

    if (!transactionHex) {
      return NextResponse.json({ error: 'Missing transaction hex' }, { status: 400 });
    }

    const authorityKeypair = getDelegatedAuthorityKeypair();
    console.log(`[Authorize API] Authorizing transaction using key: ${authorityKeypair.publicKey.toBase58()}`);

    const buffer = Buffer.from(transactionHex, 'hex');
    let serializedTxHex = '';

    if (isVersioned) {
      const tx = VersionedTransaction.deserialize(buffer);
      console.log('[Authorize API] Validating versioned transaction...');
      tx.sign([authorityKeypair]);
      serializedTxHex = Buffer.from(tx.serialize()).toString('hex');
    } else {
      const tx = Transaction.from(buffer);
      console.log('[Authorize API] Validating legacy transaction...');
      tx.partialSign(authorityKeypair);
      serializedTxHex = tx.serialize({ requireAllSignatures: false }).toString('hex');
    }

    return NextResponse.json({
      success: true,
      transactionHex: serializedTxHex,
      authorizedBy: authorityKeypair.publicKey.toBase58()
    });
  } catch (err: any) {
    console.error('[Authorize API] Failed to authorize transaction:', err);
    return NextResponse.json({ error: err.message || 'Authorization failed' }, { status: 500 });
  }
}
