use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::{BinaryPropMarket, PropPosition};
use crate::errors::VeriBetError;

#[derive(Accounts)]
pub struct PlacePropBet<'info> {
    #[account(
        mut,
        constraint = !market.resolved @ VeriBetError::MarketAlreadyResolved,
        constraint = market.vault_token_account == vault_token_account.key() @ VeriBetError::InvalidVault
    )]
    pub market: Account<'info, BinaryPropMarket>,

    #[account(
        init_if_needed,
        payer = bettor,
        space = PropPosition::LEN,
        seeds = [
            b"prop_position",
            market.key().as_ref(),
            bettor.key().as_ref()
        ],
        bump
    )]
    pub user_position: Account<'info, PropPosition>,

    #[account(mut)]
    pub bettor: Signer<'info>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle_place_prop_bet(
    ctx: Context<PlacePropBet>,
    side: bool,
    amount: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let market = &mut ctx.accounts.market;

    // 1. Enforce betting deadline
    if clock.unix_timestamp >= market.betting_closes_at || !market.bettable {
        return err!(VeriBetError::MarketClosed);
    }

    if amount == 0 {
        return err!(VeriBetError::ZeroCollateral);
    }

    // 2. Transfer SPL tokens to vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.vault_token_account.to_account_info(),
        authority: ctx.accounts.bettor.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    token::transfer(cpi_ctx, amount)?;

    // 3. Fund crank gas rebate pool with 5,000,000 lamports (0.005 SOL)
    let rebate_contribution = 5_000_000;
    let rebate_accounts = anchor_lang::system_program::Transfer {
        from: ctx.accounts.bettor.to_account_info(),
        to: market.to_account_info(),
    };
    let rebate_ctx = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        rebate_accounts,
    );
    anchor_lang::system_program::transfer(rebate_ctx, rebate_contribution)?;

    // 4. Update market pool sizing and gas rebate pool
    market.crank_gas_rebate_pool = market.crank_gas_rebate_pool
        .checked_add(rebate_contribution)
        .ok_or(VeriBetError::MathOverflow)?;

    if side {
        market.pool_yes = market.pool_yes
            .checked_add(amount)
            .ok_or(VeriBetError::MathOverflow)?;
    } else {
        market.pool_no = market.pool_no
            .checked_add(amount)
            .ok_or(VeriBetError::MathOverflow)?;
    }

    // 5. Update user position
    let user_position = &mut ctx.accounts.user_position;
    if user_position.amount == 0 {
        // Brand new position
        user_position.market = market.key();
        user_position.bettor = ctx.accounts.bettor.key();
        user_position.side = side;
        user_position.amount = amount;
        user_position.claimed = false;
        user_position.placed_at = clock.unix_timestamp;
        user_position.bump = ctx.bumps.user_position;
    } else {
        // Existing position
        require!(user_position.side == side, VeriBetError::CannotChangeBetSide);
        user_position.amount = user_position.amount
            .checked_add(amount)
            .ok_or(VeriBetError::MathOverflow)?;
    }

    Ok(())
}
