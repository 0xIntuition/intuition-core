-- Reduce leaderboard cache refresh frequency from 60s to 10 minutes.
--
-- The refresh_period_leaderboard_cache() function takes ~10s per run,
-- consuming ~17% sustained CPU at 60s intervals. Since the Rust-side
-- dirty-set refresh (LEADERBOARD_REFRESH_INTERVAL_SECS) is also set to
-- 10 minutes, there's no benefit to recomputing the cache more often
-- than the underlying account_pnl_state data changes.

DO $$
DECLARE
    v_job_id INTEGER;
BEGIN
    SELECT job_id INTO v_job_id
    FROM timescaledb_information.jobs
    WHERE application_name LIKE 'User-Defined Action%'
      AND schedule_interval = INTERVAL '1 minute';

    IF v_job_id IS NOT NULL THEN
        PERFORM alter_job(v_job_id, schedule_interval => INTERVAL '10 minutes');
        RAISE NOTICE 'Updated job % to 10-minute interval', v_job_id;
    END IF;
END;
$$;
