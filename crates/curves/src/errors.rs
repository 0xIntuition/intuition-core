use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum CurveError {
    #[error("invalid slope: expected a non-zero even wad")]
    InvalidSlope,
    #[error("assets exceed total assets")]
    AssetsExceedTotalAssets,
    #[error("shares exceed total shares")]
    SharesExceedTotalShares,
    #[error("assets overflow max assets")]
    AssetsOverflowMax,
    #[error("shares overflow max shares")]
    SharesOverflowMax,
    #[error("curve domain exceeded")]
    DomainExceeded,
    #[error("division by zero")]
    DivisionByZero,
    #[error("math overflow")]
    MathOverflow,
    #[error("math underflow")]
    MathUnderflow,
}
