-- =====================================================
-- KIDCRAFT CLEANUP SCRIPT
-- Removes all additions from v50-v52
-- Run this to reset database to pre-update state
-- =====================================================

-- === REMOVE MOB SYSTEM ===
DROP FUNCTION IF EXISTS rpc_ensure_mobs(uuid);
DROP FUNCTION IF EXISTS rpc_mob_tick(uuid);

-- Remove mob policies
DROP POLICY IF EXISTS "Anyone can view mobs" ON mobs;
DROP POLICY IF EXISTS "System can manage mobs" ON mobs;

-- Remove mob indexes
DROP INDEX IF EXISTS idx_mobs_world;
DROP INDEX IF EXISTS idx_mobs_updated;

-- Remove mobs from realtime (optional - only if you want to disable realtime)
-- ALTER PUBLICATION supabase_realtime DROP TABLE mobs;

-- Note: We don't drop the mobs table itself as it may have existing data
-- If you want to drop it: DROP TABLE IF EXISTS mobs CASCADE;

-- === REMOVE MATERIAL VISUAL PROPERTIES ===
-- Remove visual props from all materials
UPDATE materials 
SET props = props - 'visual'
WHERE props ? 'visual';

-- === REMOVE ADDED MATERIALS ===
-- Remove dirt_path if it was added by our scripts
DELETE FROM materials WHERE code = 'dirt_path' AND created_at > '2025-12-16'::date;

-- === VERIFICATION ===
-- Check what's left
SELECT 
  'Mob functions' AS item, 
  COUNT(*) AS count 
FROM pg_proc 
WHERE proname IN ('rpc_ensure_mobs', 'rpc_mob_tick')

UNION ALL

SELECT 
  'Materials with visual props' AS item,
  COUNT(*) AS count
FROM materials 
WHERE props ? 'visual'

UNION ALL

SELECT 
  'Total mobs in database' AS item,
  COUNT(*) AS count
FROM mobs;

-- Done! Database cleaned up.
