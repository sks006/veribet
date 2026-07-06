use anchor_lang::prelude::*;

#[account]
#[repr(C)]
#[derive(Copy)]
pub struct ParametricMarket {
    // --- 8-Byte Aligned Primitive Blocks (64 Bytes) ---
    pub market_id: u64,
    pub sequence: u64,                  // Acts as the definitive persistent database on restart
    pub pool_side_a: u64,               // Home / Over / Yes pools
    pub pool_side_b: u64,               // Away / Under / No pools
    pub pool_side_draw: u64,            // Draw pool
    pub total_fees_collected: u64,      // Protocol treasury revenue tracking
    pub kickoff_timestamp: i64,          // Hard clock front-run protection
    pub emergency_unlock_timestamp: i64, // Liveness failure escape hatch
    
    // --- Cryptographic Public Keys & Hashes (96 Bytes) ---
    pub vault_token_account: Pubkey,    // Token escrow account
    pub authority: Pubkey,              // Market creator/admin authority
    pub proof_hash: [u8; 32],           // Root validation log record
    
    // --- Fixed-Size Array Blocks (16 Bytes) ---
    pub match_id_bytes: [u8; 16],       // Fixed-byte TxLINE match tracking identifier
    
    // --- 4-Byte Aligned Primitive Blocks (12 Bytes) ---
    pub target_value: u32,              // Target parametric condition metric
    pub resolved_value: u32,            // Final integer score/stat populated on-chain
    pub crank_gas_rebate_pool: u32,     // Replaces raw padding. Accumulates lamports to pay back cranks.

    // --- 1-Byte Primitive Blocks (4 Bytes) ---
    pub market_type: u8,                // Market type enum mapping
    pub market_status: u8,              // State control enum tracking
    pub is_resolved: bool,              // Explicit resolution sentinel flag
    pub bump: u8,                       // Canonical nonce for PDA verification
}

impl ParametricMarket {
    pub const LEN: usize = 8 + // Anchor discriminator
        64 + // 8-Byte Aligned primitives
        96 + // Pubkeys and Hashes
        16 + // Match ID bytes
        12 + // 4-Byte Aligned primitives
        4;   // 1-Byte primitives (200 bytes total)
}

#[account]
#[repr(C)]
#[derive(Copy)]
pub struct UserPosition {
    // --- Cryptographic Public Keys (96 Bytes) ---
    pub user_wallet: Pubkey,
    pub delegated_authority: Pubkey,     // Backend authority for atomic execution
    pub market_address: Pubkey,
    
    // --- 8-Byte Aligned Block (8 Bytes) ---
    pub collateral_amount: u64,
    
    // --- 1-Byte Primitive Blocks (4 Bytes) ---
    pub prediction_vector: u8,           // 0 = A, 1 = B, 2 = Draw
    pub claimed: bool,
    pub position_bump: u8,
    pub tier_level: u8,                  // Replaces 1 byte of padding for loyalty tiering

    // --- 4-Byte Block to finalize alignment (4 Bytes) ---
    pub reference_nonce: u32,            // Replaces remaining padding. Maps to off-chain ticket IDs.
}

impl UserPosition {
    pub const LEN: usize = 8 + // Anchor discriminator
        96 + // Pubkeys
        8 +  // Collateral amount
        4 +  // 1-Byte primitives
        4;   // Reference nonce (120 bytes total)
}
