use anchor_lang::prelude::*;

#[error_code]
pub enum VeriBetError {
    #[msg("The prediction window for this market has closed (kickoff reached).")]
    PredictionWindowClosed,

    #[msg("This market has already been resolved.")]
    MarketAlreadyResolved,

    #[msg("This market has not been resolved yet.")]
    MarketNotResolved,

    #[msg("The provided prediction vector is invalid (must be 0, 1, or 2).")]
    InvalidPredictionVector,

    #[msg("The cryptographic proof provided is invalid.")]
    InvalidProof,

    #[msg("You are not authorized to perform this action.")]
    Unauthorized,

    #[msg("Rewards for this position have already been claimed.")]
    AlreadyClaimed,

    #[msg("Invalid authority provided.")]
    InvalidAuthority,

    #[msg("Invalid token vault provided.")]
    InvalidVault,

    #[msg("An arithmetic overflow or division by zero occurred.")]
    MathOverflow,

    #[msg("Emergency unlock time has not been reached yet.")]
    EmergencyUnlockNotReached,

    #[msg("Market has been emergency unlocked.")]
    MarketEmergencyUnlocked,

    #[msg("Invalid kickoff or emergency unlock timestamp settings.")]
    InvalidMarketTimestamps,

    #[msg("Cannot place position with zero collateral.")]
    ZeroCollateral,
}
