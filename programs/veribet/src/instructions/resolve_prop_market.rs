use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::{BinaryPropMarket, PropPosition};
use crate::errors::VeriBetError;

#[derive(Accounts)]
pub struct ResolvePropMarket<'info> {
    #[account(
        mut,
        constraint = market.oracle_authority == oracle_authority.key() @ VeriBetError::Unauthorized,
        constraint = !market.resolved @ VeriBetError::MarketAlreadyResolved,
        constraint = market.vault_token_account == vault_token_account.key() @ VeriBetError::InvalidVault
    )]
    pub market: Account<'info, BinaryPropMarket>,

    pub oracle_authority: Signer<'info>,

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub creator_token_account: Account<'info, TokenAccount>,

    /// CHECK: The crank wallet that will receive the gas rebate
    #[account(mut)]
    pub crank: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimPropPosition<'info> {
    #[account(
        constraint = market.resolved @ VeriBetError::MarketNotResolved,
        constraint = market.vault_token_account == vault_token_account.key() @ VeriBetError::InvalidVault
    )]
    pub market: Account<'info, BinaryPropMarket>,

    #[account(
        mut,
        seeds = [
            b"prop_position",
            market.key().as_ref(),
            user_position.bettor.as_ref()
        ],
        bump = user_position.bump,
        constraint = !user_position.claimed @ VeriBetError::AlreadyClaimed
    )]
    pub user_position: Account<'info, PropPosition>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        constraint = authority.key() == user_position.bettor @ VeriBetError::Unauthorized
    )]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_resolve_prop_market(
    ctx: Context<ResolvePropMarket>,
    resolved_value: bool,
    proof_hash: [u8; 32],
) -> Result<()> {
    let market = &mut ctx.accounts.market;

    market.resolved = true;
    market.resolved_value = Some(resolved_value);
    market.proof_hash = proof_hash;

    // Calculate total pool and fees
    let total_pool = market.pool_yes
        .checked_add(market.pool_no)
        .ok_or(VeriBetError::MathOverflow)?;

    if total_pool > 0 {
        // 2.5% protocol fee to creator: total_pool * 25 / 1000
        let fee = total_pool
            .checked_mul(25)
            .ok_or(VeriBetError::MathOverflow)?
            .checked_div(1000)
            .ok_or(VeriBetError::MathOverflow)?;

        if fee > 0 {
            // Sign the fee transfer with market seeds
            let seeds = &[
                b"prop_market",
                market.match_id.as_ref(),
                &[market.event_type],
                &[market.team],
                &market.threshold.to_le_bytes(),
                &[market.bump],
            ];
            let signer_seeds = &[&seeds[..]];

            let cpi_accounts = Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.creator_token_account.to_account_info(),
                authority: market.to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            );
            token::transfer(cpi_ctx, fee)?;
        }
    }

    // Process gas rebate transfer to the crank address
    let rebate_amount = market.crank_gas_rebate_pool;
    if rebate_amount > 0 {
        let market_info = market.to_account_info();
        if market_info.lamports() >= rebate_amount {
            market.crank_gas_rebate_pool = 0;

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

pub fn handle_claim_prop_position(ctx: Context<ClaimPropPosition>) -> Result<()> {
    let market = &ctx.accounts.market;
    let user_position = &mut ctx.accounts.user_position;

    let total_pool = market.pool_yes
        .checked_add(market.pool_no)
        .ok_or(VeriBetError::MathOverflow)?;

    let winning_side = market.resolved_value.ok_or(VeriBetError::MarketNotResolved)?;

    // Calculate payout
    let payout_amount = if winning_side && market.pool_yes == 0 {
        // Nobody bet YES, refund stake
        user_position.amount
    } else if !winning_side && market.pool_no == 0 {
        // Nobody bet NO, refund stake
        user_position.amount
    } else {
        // Parimutuel distribution
        if user_position.side == winning_side {
            // Deduct 2.5% creator fee first: total_pool * 25 / 1000
            let fee = total_pool
                .checked_mul(25)
                .ok_or(VeriBetError::MathOverflow)?
                .checked_div(1000)
                .ok_or(VeriBetError::MathOverflow)?;
            
            let total_pool_after_fee = total_pool
                .checked_sub(fee)
                .ok_or(VeriBetError::MathOverflow)?;

            let winning_pool = if winning_side { market.pool_yes } else { market.pool_no };

            // user_share = (user_amount * total_pool_after_fee) / winning_pool
            let numerator = (user_position.amount as u128)
                .checked_mul(total_pool_after_fee as u128)
                .ok_or(VeriBetError::MathOverflow)?;
            
            let share = numerator
                .checked_div(winning_pool as u128)
                .ok_or(VeriBetError::MathOverflow)?;
            
            share as u64
        } else {
            0
        }
    };

    if payout_amount > 0 {
        // Transfer payout from vault to user
        let seeds = &[
            b"prop_market",
            market.match_id.as_ref(),
            &[market.event_type],
            &[market.team],
            &market.threshold.to_le_bytes(),
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
