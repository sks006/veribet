import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import { TxLineEvent } from './types';
import { ProofHandler } from './proof-handler';
import idlJson from '../../../target/idl/veribet.json';

export class CrankSubmitter {
  private connection: Connection;
  private program: any;
  private authorityKeypair: Keypair;

  constructor(rpcUrl: string, programIdStr: string, authorityKeypair: Keypair) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    const programId = new PublicKey(programIdStr);
    
    const wallet = new anchor.Wallet(authorityKeypair);
    const provider = new anchor.AnchorProvider(this.connection, wallet, {
      commitment: 'confirmed',
    });
    
    this.program = new anchor.Program(idlJson as any, provider);
    this.authorityKeypair = authorityKeypair;
  }

  public async submitResolution(event: TxLineEvent, marketId: number): Promise<string | null> {
    try {
      console.log(`[Crank Submitter] Resolving market ${marketId} for match ${event.matchId}`);

      const [marketAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from('market'), new anchor.BN(marketId).toArrayLike(Buffer, 'le', 8)],
        this.program.programId
      );

      let marketAccount;
      try {
        marketAccount = await this.program.account.parametricMarket.fetch(marketAddress);
      } catch (err) {
        console.error(`[Crank Submitter] Market ${marketId} not found on-chain.`);
        return null;
      }

      if (marketAccount.isResolved) {
        console.log(`[Crank Submitter] Market ${marketId} is already resolved. Skipping.`);
        return null;
      }

      const vaultAddress = marketAccount.vaultTokenAccount;
      const vaultTokenInfo = await getAccount(this.connection, vaultAddress);
      const vaultMint = vaultTokenInfo.mint;

      const authorityTokenAccount = await getAssociatedTokenAddress(
        vaultMint,
        marketAccount.authority
      );

      const proofHash = ProofHandler.generateProofHash(event);
      
      let resolvedValue = 0;
      if (marketAccount.marketType === 0) {
        resolvedValue = event.totalStats;
      } else {
        resolvedValue = event.totalStats >= marketAccount.targetValue ? 1 : 0;
      }

      console.log(`[Crank Submitter] Submitting resolve_market tx. Resolved value: ${resolvedValue}`);

      const txSig = await this.program.methods
        .resolveMarket(resolvedValue, proofHash)
        .accounts({
          market: marketAddress,
          authority: this.authorityKeypair.publicKey,
          vaultTokenAccount: vaultAddress,
          authorityTokenAccount: authorityTokenAccount,
          crank: this.authorityKeypair.publicKey,
        } as any)
        .signers([this.authorityKeypair])
        .rpc();

      console.log(`[Crank Submitter] Market ${marketId} resolved successfully. Tx Sig: ${txSig}`);
      return txSig;
    } catch (err: any) {
      console.error(`[Crank Submitter] Resolution transaction failed: ${err.message}`);
      return null;
    }
  }
}
