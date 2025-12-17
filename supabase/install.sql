-- =====================================================
-- KIDCRAFT COMPLETE INSTALLATION SCRIPT v52
-- Sets up all features: materials, colors, mobs
-- Run this once after initial database setup
-- =====================================================

BEGIN;

-- =====================================================
-- PART 1: ADD MISSING MATERIALS
-- =====================================================

-- dirt_path is used by villages but not in base materials
INSERT INTO materials (code, display_name, category, hardness, tool_tag, tags, props)
VALUES ('dirt_path', 'Dirt Path', 'block', '0.6', 'shovel', ARRAY['solid'], 
  jsonb_build_object('visual', jsonb_build_object('color', '0x9b7653')))
ON CONFLICT (code) DO NOTHING;


-- =====================================================
-- PART 2: ADD VISUAL PROPERTIES TO MATERIALS
-- =====================================================

-- === TERRAIN BLOCKS ===
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x7f7f7f"}'::jsonb) WHERE code = 'stone';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x828282"}'::jsonb) WHERE code = 'cobblestone';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x8b7355"}'::jsonb) WHERE code = 'dirt';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x8b6f47"}'::jsonb) WHERE code = 'coarse_dirt';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x2a8f3a"}'::jsonb) WHERE code = 'grass_block';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x5c4433"}'::jsonb) WHERE code = 'podzol';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x6f6c6a"}'::jsonb) WHERE code = 'mycelium';

-- === SAND & GRAVEL ===
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xf4e4c1"}'::jsonb) WHERE code = 'sand';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xa95821"}'::jsonb) WHERE code = 'red_sand';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x8d8d8d"}'::jsonb) WHERE code = 'gravel';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xa0a0a0"}'::jsonb) WHERE code = 'clay';

-- === SNOW & ICE ===
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xffffff"}'::jsonb) WHERE code = 'snow';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xf0f0f0"}'::jsonb) WHERE code = 'snow_block';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x7dacfe", "transparent": true, "opacity": 0.7}'::jsonb) WHERE code = 'ice';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x6d9fef", "transparent": true, "opacity": 0.8}'::jsonb) WHERE code = 'packed_ice';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x5a8fd6", "transparent": true, "opacity": 0.8}'::jsonb) WHERE code = 'blue_ice';

-- === LIQUIDS ===
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x3b82f6", "transparent": true, "opacity": 0.6}'::jsonb) WHERE code = 'water';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xff6600", "transparent": true, "opacity": 0.8}'::jsonb) WHERE code = 'lava';

-- === WOOD LOGS ===
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x7a5c3e"}'::jsonb) WHERE code = 'oak_log';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x4a3a26"}'::jsonb) WHERE code = 'spruce_log';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xd7cb8d"}'::jsonb) WHERE code = 'birch_log';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x7a5c3e"}'::jsonb) WHERE code = 'jungle_log';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xa0522d"}'::jsonb) WHERE code = 'acacia_log';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x3f2a1c"}'::jsonb) WHERE code = 'dark_oak_log';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x7a5c3e"}'::jsonb) WHERE code = 'mangrove_log';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xffc0cb"}'::jsonb) WHERE code = 'cherry_log';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x6d8c3f"}'::jsonb) WHERE code = 'bamboo_block';

-- === PLANKS ===
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xa67c52"}'::jsonb) WHERE code = 'oak_planks';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x7a5c3e"}'::jsonb) WHERE code = 'spruce_planks';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xd7cb8d"}'::jsonb) WHERE code = 'birch_planks';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xa67c52"}'::jsonb) WHERE code = 'jungle_planks';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xba5d3b"}'::jsonb) WHERE code = 'acacia_planks';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x4a3a26"}'::jsonb) WHERE code = 'dark_oak_planks';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x9c5c44"}'::jsonb) WHERE code = 'mangrove_planks';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xe7b7a8"}'::jsonb) WHERE code = 'cherry_planks';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xc2a948"}'::jsonb) WHERE code = 'bamboo_planks';

-- === LEAVES ===
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x4f7942", "transparent": true, "opacity": 0.5}'::jsonb) WHERE code = 'oak_leaves';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x3d5e3d", "transparent": true, "opacity": 0.5}'::jsonb) WHERE code = 'spruce_leaves';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x6ba85a", "transparent": true, "opacity": 0.5}'::jsonb) WHERE code = 'birch_leaves';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x2d5016", "transparent": true, "opacity": 0.5}'::jsonb) WHERE code = 'jungle_leaves';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x6ba85a", "transparent": true, "opacity": 0.5}'::jsonb) WHERE code = 'acacia_leaves';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x2d5016", "transparent": true, "opacity": 0.5}'::jsonb) WHERE code = 'dark_oak_leaves';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x6ba85a", "transparent": true, "opacity": 0.5}'::jsonb) WHERE code = 'mangrove_leaves';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xffc0cb", "transparent": true, "opacity": 0.5}'::jsonb) WHERE code = 'cherry_leaves';

-- === STONE VARIANTS ===
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x8b8680"}'::jsonb) WHERE code = 'andesite';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xc0c0c0"}'::jsonb) WHERE code = 'diorite';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x9b6c5a"}'::jsonb) WHERE code = 'granite';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x7a7a7a"}'::jsonb) WHERE code = 'stone_bricks';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x6a6a6a"}'::jsonb) WHERE code = 'cracked_stone_bricks';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x6d7a5c"}'::jsonb) WHERE code = 'mossy_stone_bricks';

-- === DEEPSLATE ===
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x404040"}'::jsonb) WHERE code = 'deepslate';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x4a4a4a"}'::jsonb) WHERE code = 'cobbled_deepslate';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x3a3a3a"}'::jsonb) WHERE code = 'deepslate_bricks';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x383838"}'::jsonb) WHERE code = 'polished_deepslate';

-- === ORES ===
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x434343"}'::jsonb) WHERE code = 'coal_ore';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xd8af93"}'::jsonb) WHERE code = 'iron_ore';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xfcee4b"}'::jsonb) WHERE code = 'gold_ore';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xb86f50"}'::jsonb) WHERE code = 'copper_ore';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x1b4da1"}'::jsonb) WHERE code = 'lapis_ore';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xa01c1c"}'::jsonb) WHERE code = 'redstone_ore';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x5decf5"}'::jsonb) WHERE code = 'diamond_ore';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x17dd62"}'::jsonb) WHERE code = 'emerald_ore';

-- Deepslate ores
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x2c2c2c"}'::jsonb) WHERE code = 'deepslate_coal_ore';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xb89d8a"}'::jsonb) WHERE code = 'deepslate_iron_ore';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xdcc94a"}'::jsonb) WHERE code = 'deepslate_gold_ore';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x9a6248"}'::jsonb) WHERE code = 'deepslate_copper_ore';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x1a408f"}'::jsonb) WHERE code = 'deepslate_lapis_ore';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x8a1919"}'::jsonb) WHERE code = 'deepslate_redstone_ore';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x4dc5d0"}'::jsonb) WHERE code = 'deepslate_diamond_ore';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x16b657"}'::jsonb) WHERE code = 'deepslate_emerald_ore';

-- === MINERAL BLOCKS ===
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x1a1a1a"}'::jsonb) WHERE code = 'coal_block';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xd8d8d8"}'::jsonb) WHERE code = 'iron_block';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xfcee4b"}'::jsonb) WHERE code = 'gold_block';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xc77e65"}'::jsonb) WHERE code = 'copper_block';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x1e4ba1"}'::jsonb) WHERE code = 'lapis_block';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xc21212"}'::jsonb) WHERE code = 'redstone_block';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x5decf5"}'::jsonb) WHERE code = 'diamond_block';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x17dd62"}'::jsonb) WHERE code = 'emerald_block';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x12dcd6"}'::jsonb) WHERE code = 'netherite_block';

-- === GLASS ===
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xc0f0f0", "transparent": true, "opacity": 0.3}'::jsonb) WHERE code = 'glass';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xffffff", "transparent": true, "opacity": 0.3}'::jsonb) WHERE code = 'white_stained_glass';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xff0000", "transparent": true, "opacity": 0.3}'::jsonb) WHERE code = 'red_stained_glass';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x0000ff", "transparent": true, "opacity": 0.3}'::jsonb) WHERE code = 'blue_stained_glass';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x00ff00", "transparent": true, "opacity": 0.3}'::jsonb) WHERE code = 'green_stained_glass';

-- === WOOL ===
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xffffff"}'::jsonb) WHERE code = 'white_wool';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xff6600"}'::jsonb) WHERE code = 'orange_wool';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xff00ff"}'::jsonb) WHERE code = 'magenta_wool';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x3b82f6"}'::jsonb) WHERE code = 'light_blue_wool';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xffff00"}'::jsonb) WHERE code = 'yellow_wool';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x00ff00"}'::jsonb) WHERE code = 'lime_wool';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xffc0cb"}'::jsonb) WHERE code = 'pink_wool';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x808080"}'::jsonb) WHERE code = 'gray_wool';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xc0c0c0"}'::jsonb) WHERE code = 'light_gray_wool';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x00ffff"}'::jsonb) WHERE code = 'cyan_wool';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x800080"}'::jsonb) WHERE code = 'purple_wool';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x0000ff"}'::jsonb) WHERE code = 'blue_wool';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x8b4513"}'::jsonb) WHERE code = 'brown_wool';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x006400"}'::jsonb) WHERE code = 'green_wool';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xff0000"}'::jsonb) WHERE code = 'red_wool';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x000000"}'::jsonb) WHERE code = 'black_wool';

-- === CONCRETE ===
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xffffff"}'::jsonb) WHERE code = 'white_concrete';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xff6600"}'::jsonb) WHERE code = 'orange_concrete';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xff00ff"}'::jsonb) WHERE code = 'magenta_concrete';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x3b82f6"}'::jsonb) WHERE code = 'light_blue_concrete';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xffff00"}'::jsonb) WHERE code = 'yellow_concrete';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x00ff00"}'::jsonb) WHERE code = 'lime_concrete';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xffc0cb"}'::jsonb) WHERE code = 'pink_concrete';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x808080"}'::jsonb) WHERE code = 'gray_concrete';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xc0c0c0"}'::jsonb) WHERE code = 'light_gray_concrete';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x00ffff"}'::jsonb) WHERE code = 'cyan_concrete';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x800080"}'::jsonb) WHERE code = 'purple_concrete';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x0000ff"}'::jsonb) WHERE code = 'blue_concrete';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x8b4513"}'::jsonb) WHERE code = 'brown_concrete';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x006400"}'::jsonb) WHERE code = 'green_concrete';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xff0000"}'::jsonb) WHERE code = 'red_concrete';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x000000"}'::jsonb) WHERE code = 'black_concrete';

-- === MISC BLOCKS ===
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x1e1e1e"}'::jsonb) WHERE code = 'obsidian';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x1e1e1e"}'::jsonb) WHERE code = 'bedrock';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x7f7f7f"}'::jsonb) WHERE code = 'furnace';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x8b7355"}'::jsonb) WHERE code = 'crafting_table';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x654321"}'::jsonb) WHERE code = 'chest';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0x2d5016"}'::jsonb) WHERE code = 'cactus';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xc77e65"}'::jsonb) WHERE code = 'terracotta';
UPDATE materials SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{visual}', '{"color": "0xffe4b5"}'::jsonb) WHERE code = 'sponge';


-- =====================================================
-- PART 3: MOB SYSTEM SETUP
-- =====================================================

-- Create mobs table if it doesn't exist
CREATE TABLE IF NOT EXISTS mobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  type text NOT NULL,
  x numeric NOT NULL,
  y numeric NOT NULL,
  z numeric NOT NULL,
  yaw numeric DEFAULT 0,
  hp numeric DEFAULT 20,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_mobs_world ON mobs(world_id);
CREATE INDEX IF NOT EXISTS idx_mobs_updated ON mobs(updated_at);

-- Enable RLS
ALTER TABLE mobs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Anyone can view mobs" ON mobs;
DROP POLICY IF EXISTS "System can manage mobs" ON mobs;

-- RLS Policy: Anyone can read mobs
CREATE POLICY "Anyone can view mobs" ON mobs
  FOR SELECT
  USING (true);

-- RLS Policy: Authenticated users can manage mobs
CREATE POLICY "System can manage mobs" ON mobs
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Add to realtime publication
DO $$
BEGIN
  -- Check if mobs table is already in publication
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND tablename = 'mobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE mobs;
  END IF;
END $$;

-- Function: Ensure mobs exist in world
CREATE OR REPLACE FUNCTION rpc_ensure_mobs(in_world_id uuid)
RETURNS void AS $$
DECLARE
  current_count integer;
  spawn_count integer;
BEGIN
  -- Count existing mobs
  SELECT COUNT(*) INTO current_count FROM mobs WHERE world_id = in_world_id;
  
  -- Spawn up to 20 mobs total
  spawn_count := GREATEST(0, 20 - current_count);
  
  IF spawn_count > 0 THEN
    INSERT INTO mobs (world_id, type, x, y, z, hp, yaw)
    SELECT 
      in_world_id,
      (ARRAY['zombie','skeleton','spider','creeper'])[floor(random()*4)::int + 1],
      (random()*200-100)::numeric,
      35::numeric,
      (random()*200-100)::numeric,
      20::numeric,
      (random()*6.28)::numeric
    FROM generate_series(1, spawn_count);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Tick mob AI
CREATE OR REPLACE FUNCTION rpc_mob_tick(in_world_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE mobs
  SET 
    x = x + (random()*2-1)*0.3,
    z = z + (random()*2-1)*0.3,
    yaw = CASE 
      WHEN random() < 0.1 THEN random()*6.28
      ELSE yaw
    END,
    updated_at = NOW()
  WHERE world_id = in_world_id
    AND hp > 0;
    
  -- Remove mobs in void
  DELETE FROM mobs 
  WHERE world_id = in_world_id 
    AND y < -50;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION rpc_ensure_mobs(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_mob_tick(uuid) TO authenticated;


-- =====================================================
-- PART 4: VERIFICATION
-- =====================================================

-- Count materials with visual props
SELECT 
  'Materials with visual properties' AS status,
  COUNT(*) AS count
FROM materials 
WHERE props ? 'visual';

-- Verify mob functions exist
SELECT 
  'Mob functions created' AS status,
  COUNT(*) AS count
FROM pg_proc 
WHERE proname IN ('rpc_ensure_mobs', 'rpc_mob_tick');

COMMIT;

-- =====================================================
-- INSTALLATION COMPLETE!
-- Next steps:
-- 1. Upload main.js (v=MP52)
-- 2. Upload index.html (v=MP52)
-- 3. Hard refresh browser (Ctrl+Shift+R)
-- 4. Join your world and enjoy!
-- =====================================================
