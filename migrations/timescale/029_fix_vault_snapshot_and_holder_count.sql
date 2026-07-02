-- Fix vault.total_shares and vault.holder_count which were incorrect due to
-- event types arriving out of chronological order.
--
-- total_shares: Was overwritten by Deposited/Redeemed events (which have
-- different sequence numbers than SharePriceChanged). Now only
-- SharePriceChanged sets snapshot fields, but existing rows need correction.
--
-- holder_count: Was tracked incrementally by position_tracking, which broke
-- when Redeemed events arrived before their corresponding Deposited events.
-- Now derived from active_vault_position by vault_holders_index projection.

-- 1. Fix holder_count: derive from active_vault_position (authoritative)
UPDATE vault v SET
    holder_count = COALESCE(sub.cnt, 0)
FROM (
    SELECT term_id, curve_id, COUNT(*)::int AS cnt
    FROM active_vault_position
    WHERE shares > 0
    GROUP BY term_id, curve_id
) sub
WHERE v.term_id = sub.term_id AND v.curve_id = sub.curve_id;

-- Also set holder_count = 0 for vaults with no active positions
UPDATE vault v SET holder_count = 0
WHERE NOT EXISTS (
    SELECT 1 FROM active_vault_position avp
    WHERE avp.term_id = v.term_id AND avp.curve_id = v.curve_id AND avp.shares > 0
)
AND v.holder_count <> 0;

-- 2. Fix total_shares: use the latest SharePriceChanged event's total_shares.
-- share_price_history is written only from SharePriceChanged events with
-- idempotent inserts, so its latest row per vault is the correct snapshot.
UPDATE vault v SET
    total_shares        = sub.total_shares,
    current_share_price = sub.share_price,
    total_assets        = sub.total_assets,
    market_cap          = sub.total_assets
FROM (
    SELECT DISTINCT ON (term_id, curve_id)
        term_id, curve_id, total_shares, share_price, total_assets
    FROM share_price_history
    ORDER BY term_id, curve_id, ts DESC
) sub
WHERE v.term_id = sub.term_id AND v.curve_id = sub.curve_id;
