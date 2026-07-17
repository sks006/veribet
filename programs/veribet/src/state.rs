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

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum LifecycleState {
    Active,
    OracleLocked,
    Settled,
}

#[account]
pub struct BinaryPropMarket {
    // --- Fixed-size fields first (static offsets for memcmp) ---
    pub market_id: [u8; 32],               // 8 (discriminator)
    pub match_id: [u8; 32],                // 8 + 32 = 40
    pub total_yes_pool: u64,               // 40 + 32 = 72
    pub total_no_pool: u64,                // 72 + 8 = 80
    pub lifecycle: LifecycleState,         // 80 + 8 = 88
    pub cryptographic_proof: [u8; 32],     // 88 + 1 = 89
    pub creator: Pubkey,                   // 89 + 32 = 121
    pub oracle_authority: Pubkey,          // 121 + 32 = 153
    pub vault_token_account: Pubkey,       // 153 + 32 = 185
    pub betting_closes_at: i64,            // 185 + 32 = 217
    pub emergency_unlock_timestamp: i64,   // 217 + 8 = 225
    pub crank_gas_rebate_pool: u64,        // 225 + 8 = 233
    pub threshold: u16,                    // 233 + 8 = 241
    pub event_type: u8,                    // 241 + 2 = 243
    pub team: u8,                          // 243 + 1 = 244
    pub comparator: u8,                    // 244 + 1 = 245
    pub window: u8,                        // 245 + 1 = 246
    pub bettable: bool,                    // 246 + 1 = 247
    pub bump: u8,                          // 247 + 1 = 248
    
    // --- Dynamic size fields last ---
    pub resolved_value: Option<bool>,      // 248 + 1 = 249
    pub display_title: String,             // 249 + Option<bool> payload
}

impl BinaryPropMarket {
    pub const LEN: usize = 8 + // Anchor discriminator
        32 + // market_id
        32 + // match_id
        8 +  // total_yes_pool
        8 +  // total_no_pool
        1 +  // lifecycle
        32 + // cryptographic_proof
        32 + // creator
        32 + // oracle_authority
        32 + // vault_token_account
        8 +  // betting_closes_at
        8 +  // emergency_unlock_timestamp
        8 +  // crank_gas_rebate_pool
        2 +  // threshold
        1 +  // event_type
        1 +  // team
        1 +  // comparator
        1 +  // window
        1 +  // bettable
        1 +  // bump
        2 +  // resolved_value Option<bool>
        100 + // display_title
        50;  // Safety padding/alignment allowance (360 total space fits this easily)
}

#[account]
pub struct PropPosition {
    pub market: Pubkey,
    pub bettor: Pubkey,
    pub side: bool,        // true = YES, false = NO
    pub amount: u64,
    pub claimed: bool,
    pub placed_at: i64,
    pub bump: u8,
}

impl PropPosition {
    pub const LEN: usize = 8 + // Anchor discriminator
        32 + // market
        32 + // bettor
        1 +  // side
        8 +  // amount
        1 +  // claimed
        8 +  // placed_at
        1 +  // bump
        30;  // Safety padding/alignment allowance (120 total space fits this easily)
}
