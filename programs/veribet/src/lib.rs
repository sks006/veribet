pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;
pub mod utils;

use anchor_lang::prelude::*;

pub use constants::*;
pub use errors::*;
pub use instructions::*;
pub use state::*;
pub use utils::*;

declare_id!("2Syq46YQQ4iGbCouFYxjeHEcABScMd669NAK5XrxZFWG");

#[program]
pub mod veribet {
    use super::*;

    pub fn create_market(
        ctx: Context<CreateMarket>,
        market_id: u64,
        sequence: u64,
        match_id_bytes: [u8; 16],
        target_value: u32,
        kickoff_timestamp: i64,
        emergency_unlock_timestamp: i64,
        market_type: u8,
    ) -> Result<()> {
        create_market::handle_create_market(
            ctx,
            market_id,
            sequence,
            match_id_bytes,
            target_value,
            kickoff_timestamp,
            emergency_unlock_timestamp,
            market_type,
        )
    }

    pub fn place_position(
        ctx: Context<PlacePosition>,
        prediction_vector: u8,
        collateral_amount: u64,
        tier_level: u8,
        reference_nonce: u32,
    ) -> Result<()> {
        place_position::handle_place_position(
            ctx,
            prediction_vector,
            collateral_amount,
            tier_level,
            reference_nonce,
        )
    }

    pub fn resolve_market(
        ctx: Context<ResolveMarket>,
        resolved_value: u32,
        proof_hash: [u8; 32],
    ) -> Result<()> {
        resolve_market::handle_resolve_market(ctx, resolved_value, proof_hash)
    }

    pub fn claim_position(ctx: Context<ClaimPosition>) -> Result<()> {
        resolve_market::handle_claim_position(ctx)
    }

    pub fn create_prop_market(
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
        create_prop_market::handle_create_prop_market(
            ctx,
            market_id,
            match_id,
            event_type,
            team,
            comparator,
            threshold,
            window,
            display_title,
            betting_closes_at,
        )
    }

    pub fn close_betting_early(ctx: Context<CloseBettingEarly>) -> Result<()> {
        create_prop_market::handle_close_betting_early(ctx)
    }

    pub fn place_prop_bet(
        ctx: Context<PlacePropBet>,
        side: bool,
        amount: u64,
    ) -> Result<()> {
        place_prop_bet::handle_place_prop_bet(ctx, side, amount)
    }

    pub fn resolve_prop_market(
        ctx: Context<ResolvePropMarket>,
        resolved_value: bool,
        proof_hash: [u8; 32],
    ) -> Result<()> {
        resolve_prop_market::handle_resolve_prop_market(ctx, resolved_value, proof_hash)
    }

    pub fn claim_prop_position(ctx: Context<ClaimPropPosition>) -> Result<()> {
        resolve_prop_market::handle_claim_prop_position(ctx)
    }
}
