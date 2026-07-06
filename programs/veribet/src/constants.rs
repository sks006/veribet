use anchor_lang::prelude::*;

#[constant]
pub const MARKET_SEED: &[u8] = b"market";

#[constant]
pub const POSITION_SEED: &[u8] = b"position";

// Protocol fee in basis points (e.g., 250 bps = 2.5%)
pub const PROTOCOL_FEE_BPS: u64 = 250;
