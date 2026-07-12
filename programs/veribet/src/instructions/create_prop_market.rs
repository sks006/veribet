use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::state::BinaryPropMarket;
use crate::errors::VeriBetError;

#[derive(Accounts)]
#[instruction(
    match_id: [u8; 32],
    event_type: u8,
    team: u8,
    threshold: u16,
)]
pub struct CreatePropMarket<'info> {
    #[account(
        init,
        payer = creator,
        space = BinaryPropMarket::LEN,
        seeds = [
            b"prop_market",
            match_id.as_ref(),
            &[event_type],
            &[team],
            &threshold.to_le_bytes()
        ],
        bump
    )]
    pub market: Account<'info, BinaryPropMarket>,

    #[account(
        init,
        payer = creator,
        token::mint = vault_mint,
        token::authority = market,
        seeds = [b"vault", market.key().as_ref()],
        bump
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub vault_mint: Account<'info, Mint>,

    #[account(mut)]
    pub creator: Signer<'info>,

    /// CHECK: The designated crank/oracle authority that will resolve this market
    pub oracle_authority: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct CloseBettingEarly<'info> {
    #[account(
        mut,
        constraint = market.oracle_authority == oracle_authority.key() @ VeriBetError::Unauthorized,
        constraint = !market.resolved @ VeriBetError::MarketAlreadyResolved,
        constraint = market.bettable @ VeriBetError::MarketClosed,
    )]
    pub market: Account<'info, BinaryPropMarket>,

    pub oracle_authority: Signer<'info>,
}

pub fn handle_create_prop_market(
    ctx: Context<CreatePropMarket>,
    market_id: [u8; 32],
    match_id: [u8; 32],
    event_type: u8,
    team: u8,
    comparator: u8,
    threshold: u16,
    window: u8,
    display_title: String,
    betting_closes_at: i64,
) -> Result<()> {
    // Basic validation
    if threshold == 0 {
        return err!(VeriBetError::InvalidThreshold);
    }
    if window > 2 {
        return err!(VeriBetError::InvalidWindow);
    }

    let clock = Clock::get()?;
    if betting_closes_at <= clock.unix_timestamp {
        return err!(VeriBetError::InvalidMarketTimestamps);
    }

    let market = &mut ctx.accounts.market;
    market.market_id = market_id;
    market.match_id = match_id;
    market.event_type = event_type;
    market.team = team;
    market.comparator = comparator;
    market.threshold = threshold;
    market.window = window;
    
    // Ensure display title does not overflow bounds
    let truncated_title = if display_title.len() > 96 {
        display_title[..96].to_string()
    } else {
        display_title
    };
    market.display_title = truncated_title;

    market.creator = ctx.accounts.creator.key();
    market.oracle_authority = ctx.accounts.oracle_authority.key();
    market.betting_closes_at = betting_closes_at;
    market.bettable = true;
    market.pool_yes = 0;
    market.pool_no = 0;
    market.vault_token_account = ctx.accounts.vault_token_account.key();
    market.resolved = false;
    market.resolved_value = None;
    market.proof_hash = [0u8; 32];
    
    // Set emergency unlock timestamp to 3 hours after betting closes
    market.emergency_unlock_timestamp = betting_closes_at
        .checked_add(3 * 3600)
        .ok_or(VeriBetError::MathOverflow)?;

    market.bump = ctx.bumps.market;

    Ok(())
}

pub fn handle_close_betting_early(ctx: Context<CloseBettingEarly>) -> Result<()> {
    let market = &mut ctx.accounts.market;
    market.bettable = false;
    Ok(())
}
