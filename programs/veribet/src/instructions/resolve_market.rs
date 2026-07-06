use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::{ParametricMarket, UserPosition};
use crate::constants::{MARKET_SEED, POSITION_SEED, PROTOCOL_FEE_BPS};
use crate::errors::VeriBetError;
use crate::utils::calculate_fees;

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    #[account(
        mut,
        seeds = [MARKET_SEED, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = market.authority == authority.key() @ VeriBetError::Unauthorized,
        constraint = !market.is_resolved @ VeriBetError::MarketAlreadyResolved,
        constraint = market.vault_token_account == vault_token_account.key() @ VeriBetError::InvalidVault
    )]
    pub market: Account<'info, ParametricMarket>,

    pub authority: Signer<'info>,

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority_token_account: Account<'info, TokenAccount>,

    /// CHECK: The crank wallet that submitted the transaction and will receive the gas rebate
    #[account(mut)]
    pub crank: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimPosition<'info> {
    #[account(
        seeds = [MARKET_SEED, market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = market.is_resolved @ VeriBetError::MarketNotResolved,
        constraint = market.vault_token_account == vault_token_account.key() @ VeriBetError::InvalidVault
    )]
    pub market: Account<'info, ParametricMarket>,

    #[account(
        mut,
        seeds = [POSITION_SEED, market.key().as_ref(), user_position.user_wallet.as_ref()],
        bump = user_position.position_bump,
        constraint = !user_position.claimed @ VeriBetError::AlreadyClaimed
    )]
    pub user_position: Account<'info, UserPosition>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        constraint = authority.key() == user_position.user_wallet || authority.key() == user_position.delegated_authority @ VeriBetError::Unauthorized
    )]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_resolve_market(
    ctx: Context<ResolveMarket>,
    resolved_value: u32,
    proof_hash: [u8; 32],
) -> Result<()> {
    let market = &mut ctx.accounts.market;

    market.resolved_value = resolved_value;
    market.proof_hash = proof_hash;
    market.is_resolved = true;
    market.market_status = 1; // 1 = Resolved

    // Calculate total pool
    let total_pool = market.pool_side_a
        .checked_add(market.pool_side_b)
        .ok_or(VeriBetError::MathOverflow)?
        .checked_add(market.pool_side_draw)
        .ok_or(VeriBetError::MathOverflow)?;

    if total_pool > 0 {
        // Calculate fees
        let (protocol_fee, _) = calculate_fees(total_pool, PROTOCOL_FEE_BPS)?;
        market.total_fees_collected = protocol_fee;

        if protocol_fee > 0 {
            // Transfer protocol fee to authority
            let market_id = market.market_id;
            let market_id_bytes = market_id.to_le_bytes();
            let seeds = &[
                MARKET_SEED,
                market_id_bytes.as_ref(),
                &[market.bump],
            ];
            let signer_seeds = &[&seeds[..]];

            let cpi_accounts = Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.authority_token_account.to_account_info(),
                authority: market.to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            );
            token::transfer(cpi_ctx, protocol_fee)?;
        }
    }

    // Process crank gas rebate (if any lamports accumulated)
    let rebate_amount = market.crank_gas_rebate_pool as u64;
    if rebate_amount > 0 {
        let market_info = market.to_account_info();
        if market_info.lamports() >= rebate_amount {
            market.crank_gas_rebate_pool = 0;
            
            // Transfer lamports from market account to crank account
            **market_info.try_borrow_mut_lamports()? = market_info
                .lamports()
                .checked_sub(rebate_amount)
                .ok_or(VeriBetError::MathOverflow)?;
            
            let crank_info = ctx.accounts.crank.to_account_info();
            **crank_info.try_borrow_mut_lamports()? = crank_info
                .lamports()
                .checked_add(rebate_amount)
                .ok_or(VeriBetError::MathOverflow)?;
        }
    }

    Ok(())
}

pub fn handle_claim_position(ctx: Context<ClaimPosition>) -> Result<()> {
    let market = &ctx.accounts.market;
    let user_position = &mut ctx.accounts.user_position;

    // Determine the winning vector
    let winning_vector = get_winning_vector(market.market_type, market.target_value, market.resolved_value);

    // Calculate total pool and winning pool
    let total_pool = market.pool_side_a
        .checked_add(market.pool_side_b)
        .ok_or(VeriBetError::MathOverflow)?
        .checked_add(market.pool_side_draw)
        .ok_or(VeriBetError::MathOverflow)?;

    let winning_pool = match winning_vector {
        0 => market.pool_side_a,
        1 => market.pool_side_b,
        2 => market.pool_side_draw,
        _ => 0,
    };

    let payout_amount = if winning_pool > 0 {
        // If the user predicted correctly, they get their share of the pool after protocol fees
        if user_position.prediction_vector == winning_vector {
            let (protocol_fee, _) = calculate_fees(total_pool, PROTOCOL_FEE_BPS)?;
            let total_pool_after_fees = total_pool
                .checked_sub(protocol_fee)
                .ok_or(VeriBetError::MathOverflow)?;

            // user_share = (user_collateral * total_pool_after_fees) / winning_pool
            let numerator = (user_position.collateral_amount as u128)
                .checked_mul(total_pool_after_fees as u128)
                .ok_or(VeriBetError::MathOverflow)?;
            
            let user_share = numerator
                .checked_div(winning_pool as u128)
                .ok_or(VeriBetError::MathOverflow)?;

            user_share as u64
        } else {
            0
        }
    } else {
        // If no one bet on the winning side, refund the original collateral amount to everyone
        user_position.collateral_amount
    };

    if payout_amount > 0 {
        // Transfer payout from vault to user
        let market_id = market.market_id;
        let market_id_bytes = market_id.to_le_bytes();
        let seeds = &[
            MARKET_SEED,
            market_id_bytes.as_ref(),
            &[market.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.market.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, payout_amount)?;
    }

    user_position.claimed = true;

    Ok(())
}

/// Helper function to determine the winning prediction vector.
fn get_winning_vector(market_type: u8, target_value: u32, resolved_value: u32) -> u8 {
    match market_type {
        0 => {
            // Over / Under / Draw
            if resolved_value > target_value {
                0 // Side A (Over)
            } else if resolved_value < target_value {
                1 // Side B (Under)
            } else {
                2 // Draw
            }
        }
        1 => {
            // Yes / No
            if resolved_value >= target_value {
                0 // Side A (Yes)
            } else {
                1 // Side B (No)
            }
        }
        _ => 0,
    }
}
