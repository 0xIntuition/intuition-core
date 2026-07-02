use crate::{fee_on_raw, Curve, CurveError, CurveState, U256};

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/// Fee schedule matching `VaultFees` + MultiVault config.
///
/// All percentage-based fees use `mulDivUp(amount, fee, denominator)`,
/// identical to `MultiVault._feeOnRaw()`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FeeSchedule {
    pub denominator: U256,
    pub protocol_fee: U256,
    pub entry_fee: U256,
    pub exit_fee: U256,
}

/// Atom-specific fees from `AtomConfig`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AtomFees {
    /// `atomWalletDepositFee` — percentage of deposit for the atom wallet.
    pub atom_wallet_deposit_fee: U256,
}

/// Triple-specific fees from `TripleConfig`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TripleFees {
    /// `atomDepositFractionForTriple` — percentage split among 3 underlying atoms.
    pub atom_deposit_fraction: U256,
}

/// Breakdown of individual fee components.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct FeeBreakdown {
    pub protocol_fee: U256,
    pub entry_fee: U256,
    pub exit_fee: U256,
    pub atom_wallet_fee: U256,
    pub atom_deposit_fraction: U256,
}

impl FeeBreakdown {
    pub fn total(&self) -> Result<U256, CurveError> {
        let a = self
            .protocol_fee
            .checked_add(self.entry_fee)
            .ok_or(CurveError::MathOverflow)?;
        let b = a
            .checked_add(self.exit_fee)
            .ok_or(CurveError::MathOverflow)?;
        let c = b
            .checked_add(self.atom_wallet_fee)
            .ok_or(CurveError::MathOverflow)?;
        c.checked_add(self.atom_deposit_fraction)
            .ok_or(CurveError::MathOverflow)
    }
}

// ---------------------------------------------------------------------------
// Quote types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DepositQuote {
    pub shares: U256,
    pub assets_before_fees: U256,
    pub assets_after_fees: U256,
    pub fees: FeeBreakdown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RedeemQuote {
    pub shares: U256,
    pub assets_before_fees: U256,
    pub assets_after_fees: U256,
    pub fees: FeeBreakdown,
}

// ---------------------------------------------------------------------------
// Basic deposit / redeem (protocol + entry/exit only)
// ---------------------------------------------------------------------------

/// Simulates `_calculateAtomDeposit` / `_calculateTripleDeposit` fee logic
/// with only the base vault fees (protocol + optional entry).
pub fn preview_deposit_with_fees<C: Curve>(
    curve: &C,
    assets_before_fees: U256,
    state: CurveState,
    fees: FeeSchedule,
    charge_entry_fee: bool,
) -> Result<DepositQuote, CurveError> {
    let protocol_fee = fee_on_raw(assets_before_fees, fees.protocol_fee, fees.denominator)?;
    let entry_fee = if charge_entry_fee {
        fee_on_raw(assets_before_fees, fees.entry_fee, fees.denominator)?
    } else {
        U256::ZERO
    };
    let total_fees = protocol_fee
        .checked_add(entry_fee)
        .ok_or(CurveError::MathOverflow)?;
    let assets_after_fees = assets_before_fees
        .checked_sub(total_fees)
        .ok_or(CurveError::MathUnderflow)?;
    let shares = curve.preview_deposit(assets_after_fees, state)?;

    Ok(DepositQuote {
        shares,
        assets_before_fees,
        assets_after_fees,
        fees: FeeBreakdown {
            protocol_fee,
            entry_fee,
            ..Default::default()
        },
    })
}

/// Simulates `_calculateRedeem` fee logic (protocol + optional exit).
pub fn preview_redeem_with_fees<C: Curve>(
    curve: &C,
    shares: U256,
    state: CurveState,
    fees: FeeSchedule,
    charge_exit_fee: bool,
) -> Result<RedeemQuote, CurveError> {
    let assets_before_fees = curve.preview_redeem(shares, state)?;
    let protocol_fee = fee_on_raw(assets_before_fees, fees.protocol_fee, fees.denominator)?;
    let exit_fee = if charge_exit_fee {
        fee_on_raw(assets_before_fees, fees.exit_fee, fees.denominator)?
    } else {
        U256::ZERO
    };
    let total_fees = protocol_fee
        .checked_add(exit_fee)
        .ok_or(CurveError::MathOverflow)?;
    let assets_after_fees = assets_before_fees
        .checked_sub(total_fees)
        .ok_or(CurveError::MathUnderflow)?;

    Ok(RedeemQuote {
        shares,
        assets_before_fees,
        assets_after_fees,
        fees: FeeBreakdown {
            protocol_fee,
            exit_fee,
            ..Default::default()
        },
    })
}

// ---------------------------------------------------------------------------
// Atom deposit (protocol + entry + atom wallet fee)
// ---------------------------------------------------------------------------

/// Mirrors `MultiVault._calculateAtomDeposit` fee deduction:
///   1. protocolFee  = feeOnRaw(assets, protocolFee)
///   2. entryFee     = feeOnRaw(assets, entryFee)  (if charged)
///   3. walletFee    = feeOnRaw(assets, atomWalletDepositFee)
///   4. assetsAfterFees = assets - all fees
///   5. shares       = curve.previewDeposit(assetsAfterFees, state)
pub fn preview_atom_deposit<C: Curve>(
    curve: &C,
    assets: U256,
    state: CurveState,
    fees: FeeSchedule,
    atom_fees: AtomFees,
    charge_entry_fee: bool,
) -> Result<DepositQuote, CurveError> {
    let protocol_fee = fee_on_raw(assets, fees.protocol_fee, fees.denominator)?;
    let entry_fee = if charge_entry_fee {
        fee_on_raw(assets, fees.entry_fee, fees.denominator)?
    } else {
        U256::ZERO
    };
    let atom_wallet_fee = fee_on_raw(assets, atom_fees.atom_wallet_deposit_fee, fees.denominator)?;

    let total = protocol_fee
        .checked_add(entry_fee)
        .ok_or(CurveError::MathOverflow)?
        .checked_add(atom_wallet_fee)
        .ok_or(CurveError::MathOverflow)?;
    let assets_after_fees = assets.checked_sub(total).ok_or(CurveError::MathUnderflow)?;
    let shares = curve.preview_deposit(assets_after_fees, state)?;

    Ok(DepositQuote {
        shares,
        assets_before_fees: assets,
        assets_after_fees,
        fees: FeeBreakdown {
            protocol_fee,
            entry_fee,
            atom_wallet_fee,
            ..Default::default()
        },
    })
}

// ---------------------------------------------------------------------------
// Triple deposit (protocol + entry + atom deposit fraction)
// ---------------------------------------------------------------------------

/// Mirrors `MultiVault._calculateTripleDeposit` fee deduction:
///   1. protocolFee        = feeOnRaw(assets, protocolFee)
///   2. entryFee           = feeOnRaw(assets, entryFee)  (if charged)
///   3. atomDepositFraction= feeOnRaw(assets, atomDepositFractionForTriple) (if charged)
///   4. assetsAfterFees    = assets - all fees
///   5. shares             = curve.previewDeposit(assetsAfterFees, state)
pub fn preview_triple_deposit<C: Curve>(
    curve: &C,
    assets: U256,
    state: CurveState,
    fees: FeeSchedule,
    triple_fees: TripleFees,
    charge_entry_fee: bool,
    charge_atom_deposit_fraction: bool,
) -> Result<DepositQuote, CurveError> {
    let protocol_fee = fee_on_raw(assets, fees.protocol_fee, fees.denominator)?;
    let entry_fee = if charge_entry_fee {
        fee_on_raw(assets, fees.entry_fee, fees.denominator)?
    } else {
        U256::ZERO
    };
    let atom_deposit_fraction = if charge_atom_deposit_fraction {
        fee_on_raw(assets, triple_fees.atom_deposit_fraction, fees.denominator)?
    } else {
        U256::ZERO
    };

    let total = protocol_fee
        .checked_add(entry_fee)
        .ok_or(CurveError::MathOverflow)?
        .checked_add(atom_deposit_fraction)
        .ok_or(CurveError::MathOverflow)?;
    let assets_after_fees = assets.checked_sub(total).ok_or(CurveError::MathUnderflow)?;
    let shares = curve.preview_deposit(assets_after_fees, state)?;

    Ok(DepositQuote {
        shares,
        assets_before_fees: assets,
        assets_after_fees,
        fees: FeeBreakdown {
            protocol_fee,
            entry_fee,
            atom_deposit_fraction,
            ..Default::default()
        },
    })
}
