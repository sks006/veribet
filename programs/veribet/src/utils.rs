use anchor_lang::prelude::*;
use crate::errors::VeriBetError;

/// Validates that the kickoff timestamp is in the future and emergency unlock is after kickoff.
pub fn validate_market_timestamps(kickoff: i64, emergency_unlock: i64, now: i64) -> Result<()> {
    if kickoff <= now {
        return err!(VeriBetError::InvalidMarketTimestamps);
    }
    if emergency_unlock <= kickoff {
        return err!(VeriBetError::InvalidMarketTimestamps);
    }
    Ok(())
}

/// Calculates the protocol fee and the remaining amount.
pub fn calculate_fees(amount: u64, fee_bps: u64) -> Result<(u64, u64)> {
    let fee = amount
        .checked_mul(fee_bps)
        .ok_or(VeriBetError::MathOverflow)?
        .checked_div(10000)
        .ok_or(VeriBetError::MathOverflow)?;
    
    let remaining = amount
        .checked_sub(fee)
        .ok_or(VeriBetError::MathOverflow)?;
        
    Ok((fee, remaining))
}
