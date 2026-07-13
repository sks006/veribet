use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::{ParametricMarket, UserPosition};
use crate::constants::{POSITION_SEED, MARKET_SEED};
use crate::errors::VeriBetError;

#[derive(Accounts)]
pub struct InitializePosition<'info> {
    #[account(
        mut,
        seeds = [MARKET_SEED, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = !market.is_resolved @ VeriBetError::MarketAlreadyResolved,
        constraint = market.vault_token_account == vault_token_account.key() @ VeriBetError::InvalidVault
    )]
    pub market: Account<'info, ParametricMarket>,

    #[account(
        init,
        payer = user,
        space = UserPosition::LEN,
        seeds = [POSITION_SEED, market.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_position: Account<'info, UserPosition>,

    #[account(mut)]
    pub user: Signer<'info>,

    /// CHECK: The delegated authority for off-chain execution tracking
    pub delegated_authority: AccountInfo<'info>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct IncreasePositionCollateral<'info> {
    #[account(
        mut,
        seeds = [MARKET_SEED, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = !market.is_resolved @ VeriBetError::MarketAlreadyResolved,
        constraint = market.vault_token_account == vault_token_account.key() @ VeriBetError::InvalidVault
    )]
    pub market: Account<'info, ParametricMarket>,

    #[account(
        mut,
        seeds = [POSITION_SEED, market.key().as_ref(), user.key().as_ref()],
        bump = user_position.position_bump
    )]
    pub user_position: Account<'info, UserPosition>,

    #[account(mut)]
    pub user: Signer<'info>,

    /// CHECK: The delegated authority for off-chain execution tracking
    pub delegated_authority: AccountInfo<'info>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_position(
    ctx: Context<InitializePosition>,
    prediction_vector: u8,
    collateral_amount: u64,
    tier_level: u8,
    reference_nonce: u32,
) -> Result<()> {
    let clock = Clock::get()?;

    // 1. Check kickoff timestamp
    if clock.unix_timestamp >= ctx.accounts.market.kickoff_timestamp {
        return err!(VeriBetError::PredictionWindowClosed);
    }

    // 2. Check prediction vector
    if prediction_vector > 2 {
        return err!(VeriBetError::InvalidPredictionVector);
    }

    // 3. Check collateral amount
    if collateral_amount == 0 {
        return err!(VeriBetError::ZeroCollateral);
    }

    // 4. Transfer tokens to vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.vault_token_account.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    token::transfer(cpi_ctx, collateral_amount)?;

    // 4.5. Fund crank gas rebate pool with 5,000,000 lamports (0.005 SOL)
    let rebate_contribution = 5_000_000;
    let rebate_accounts = anchor_lang::system_program::Transfer {
        from: ctx.accounts.user.to_account_info(),
        to: ctx.accounts.market.to_account_info(),
    };
    let rebate_ctx = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        rebate_accounts,
    );
    anchor_lang::system_program::transfer(rebate_ctx, rebate_contribution)?;

    // 5. Update market pool sizing and gas rebate pool
    let market = &mut ctx.accounts.market;
    
    market.crank_gas_rebate_pool = market.crank_gas_rebate_pool
        .checked_add(rebate_contribution as u32)
        .ok_or(VeriBetError::MathOverflow)?;

    match prediction_vector {
        0 => {
            market.pool_side_a = market.pool_side_a
                .checked_add(collateral_amount)
                .ok_or(VeriBetError::MathOverflow)?;
        }
        1 => {
            market.pool_side_b = market.pool_side_b
                .checked_add(collateral_amount)
                .ok_or(VeriBetError::MathOverflow)?;
        }
        2 => {
            market.pool_side_draw = market.pool_side_draw
                .checked_add(collateral_amount)
                .ok_or(VeriBetError::MathOverflow)?;
        }
        _ => unreachable!(),
    }

    // 6. Set user position state
    let user_position = &mut ctx.accounts.user_position;
    user_position.user_wallet = ctx.accounts.user.key();
    user_position.delegated_authority = ctx.accounts.delegated_authority.key();
    user_position.market_address = market.key();
    user_position.collateral_amount = collateral_amount;
    user_position.prediction_vector = prediction_vector;
    user_position.claimed = false;
    user_position.position_bump = ctx.bumps.user_position;
    user_position.tier_level = tier_level;
    user_position.reference_nonce = reference_nonce;

    Ok(())
}

pub fn handle_increase_position_collateral(
    ctx: Context<IncreasePositionCollateral>,
    prediction_vector: u8,
    collateral_amount: u64,
    tier_level: u8,
    reference_nonce: u32,
) -> Result<()> {
    let clock = Clock::get()?;

    // 1. Check kickoff timestamp
    if clock.unix_timestamp >= ctx.accounts.market.kickoff_timestamp {
        return err!(VeriBetError::PredictionWindowClosed);
    }

    // 2. Check prediction vector
    if prediction_vector > 2 {
        return err!(VeriBetError::InvalidPredictionVector);
    }

    // 3. Check collateral amount
    if collateral_amount == 0 {
        return err!(VeriBetError::ZeroCollateral);
    }

    // 4. State Validation: Enforce locked prediction side matches incoming prediction side
    let user_position = &mut ctx.accounts.user_position;
    if user_position.prediction_vector != prediction_vector {
        return err!(VeriBetError::VectorMismatch);
    }

    // 5. Transfer tokens to vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.vault_token_account.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    token::transfer(cpi_ctx, collateral_amount)?;

    // 5.5. Fund crank gas rebate pool with 5,000,000 lamports (0.005 SOL)
    let rebate_contribution = 5_000_000;
    let rebate_accounts = anchor_lang::system_program::Transfer {
        from: ctx.accounts.user.to_account_info(),
        to: ctx.accounts.market.to_account_info(),
    };
    let rebate_ctx = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        rebate_accounts,
    );
    anchor_lang::system_program::transfer(rebate_ctx, rebate_contribution)?;

    // 6. Update market pool sizing and gas rebate pool
    let market = &mut ctx.accounts.market;
    
    market.crank_gas_rebate_pool = market.crank_gas_rebate_pool
        .checked_add(rebate_contribution as u32)
        .ok_or(VeriBetError::MathOverflow)?;

    match prediction_vector {
        0 => {
            market.pool_side_a = market.pool_side_a
                .checked_add(collateral_amount)
                .ok_or(VeriBetError::MathOverflow)?;
        }
        1 => {
            market.pool_side_b = market.pool_side_b
                .checked_add(collateral_amount)
                .ok_or(VeriBetError::MathOverflow)?;
        }
        2 => {
            market.pool_side_draw = market.pool_side_draw
                .checked_add(collateral_amount)
                .ok_or(VeriBetError::MathOverflow)?;
        }
        _ => unreachable!(),
    }

    // 7. Update user position state (add collateral)
    user_position.collateral_amount = user_position.collateral_amount
        .checked_add(collateral_amount)
        .ok_or(VeriBetError::MathOverflow)?;
    user_position.tier_level = tier_level;
    user_position.reference_nonce = reference_nonce;

    Ok(())
}
