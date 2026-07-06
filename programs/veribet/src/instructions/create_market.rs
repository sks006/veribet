use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::state::ParametricMarket;
use crate::constants::MARKET_SEED;
use crate::utils::validate_market_timestamps;

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct CreateMarket<'info> {
    #[account(
        init,
        payer = authority,
        space = ParametricMarket::LEN,
        seeds = [MARKET_SEED, market_id.to_le_bytes().as_ref()],
        bump
    )]
    pub market: Account<'info, ParametricMarket>,

    #[account(
        init,
        payer = authority,
        token::mint = vault_mint,
        token::authority = market,
        seeds = [b"vault", market.key().as_ref()],
        bump
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub vault_mint: Account<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle_create_market(
    ctx: Context<CreateMarket>,
    market_id: u64,
    sequence: u64,
    match_id_bytes: [u8; 16],
    target_value: u32,
    kickoff_timestamp: i64,
    emergency_unlock_timestamp: i64,
    market_type: u8,
) -> Result<()> {
    let clock = Clock::get()?;
    validate_market_timestamps(kickoff_timestamp, emergency_unlock_timestamp, clock.unix_timestamp)?;

    let market = &mut ctx.accounts.market;
    market.market_id = market_id;
    market.sequence = sequence;
    market.pool_side_a = 0;
    market.pool_side_b = 0;
    market.pool_side_draw = 0;
    market.total_fees_collected = 0;
    market.kickoff_timestamp = kickoff_timestamp;
    market.emergency_unlock_timestamp = emergency_unlock_timestamp;
    market.vault_token_account = ctx.accounts.vault_token_account.key();
    market.authority = ctx.accounts.authority.key();
    market.proof_hash = [0u8; 32];
    market.match_id_bytes = match_id_bytes;
    market.target_value = target_value;
    market.resolved_value = 0;
    market.crank_gas_rebate_pool = 0;
    market.market_type = market_type;
    market.market_status = 0; // 0 = Active/Open
    market.is_resolved = false;
    market.bump = ctx.bumps.market;

    Ok(())
}
