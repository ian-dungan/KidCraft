-- ============================================================
-- KidCraft 01_cleanup.sql
-- Safe cleanup for re-running installs on Supabase.
-- Drops policies, triggers (if any), and RPCs created by KidCraft.
-- ============================================================

-- Drop policies (ignore missing tables)
do $$ begin
  -- Core gameplay tables
  begin execute 'drop policy if exists "World Blocks Insert NonGuest" on public.world_blocks'; exception when undefined_table then null; end;
  begin execute 'drop policy if exists "World Blocks Update NonGuest" on public.world_blocks'; exception when undefined_table then null; end;
  begin execute 'drop policy if exists "World Blocks Select Auth" on public.world_blocks'; exception when undefined_table then null; end;
  begin execute 'drop policy if exists "World Blocks Mutate Auth" on public.world_blocks'; exception when undefined_table then null; end;

  begin execute 'drop policy if exists "Block Updates Insert Own" on public.block_updates'; exception when undefined_table then null; end;
  begin execute 'drop policy if exists "Block Updates Select Auth" on public.block_updates'; exception when undefined_table then null; end;

  begin execute 'drop policy if exists "State Insert Own" on public.player_state'; exception when undefined_table then null; end;
  begin execute 'drop policy if exists "State Select Auth" on public.player_state'; exception when undefined_table then null; end;
  begin execute 'drop policy if exists "State Update Own" on public.player_state'; exception when undefined_table then null; end;

  begin execute 'drop policy if exists "Profiles Select Own" on public.player_profiles'; exception when undefined_table then null; end;
  begin execute 'drop policy if exists "Profiles Select Auth" on public.player_profiles'; exception when undefined_table then null; end;
  begin execute 'drop policy if exists "Profiles Insert Own" on public.player_profiles'; exception when undefined_table then null; end;
  begin execute 'drop policy if exists "Profiles Update Own" on public.player_profiles'; exception when undefined_table then null; end;

  begin execute 'drop policy if exists "Inv Select Own" on public.player_inventories'; exception when undefined_table then null; end;
  begin execute 'drop policy if exists "Inv Insert Own" on public.player_inventories'; exception when undefined_table then null; end;
  begin execute 'drop policy if exists "Inv Update Own" on public.player_inventories'; exception when undefined_table then null; end;
  begin execute 'drop policy if exists "Inv Delete Own" on public.player_inventories'; exception when undefined_table then null; end;

  begin execute 'drop policy if exists "Slots Own" on public.inventory_slots'; exception when undefined_table then null; end;
  begin execute 'drop policy if exists "Slots Insert Own" on public.inventory_slots'; exception when undefined_table then null; end;
  begin execute 'drop policy if exists "Slots Update Own" on public.inventory_slots'; exception when undefined_table then null; end;
  begin execute 'drop policy if exists "Slots Delete Own" on public.inventory_slots'; exception when undefined_table then null; end;

  begin execute 'drop policy if exists "Stats Own" on public.player_stats'; exception when undefined_table then null; end;
  begin execute 'drop policy if exists "Stats Select Own" on public.player_stats'; exception when undefined_table then null; end;
  begin execute 'drop policy if exists "Stats Insert Own" on public.player_stats'; exception when undefined_table then null; end;
  begin execute 'drop policy if exists "Stats Update Own" on public.player_stats'; exception when undefined_table then null; end;
  begin execute 'drop policy if exists "Stats Delete Own" on public.player_stats'; exception when undefined_table then null; end;

  begin execute 'drop policy if exists "Materials Select Auth" on public.materials'; exception when undefined_table then null; end;
  begin execute 'drop policy if exists "Worlds Select Auth" on public.worlds'; exception when undefined_table then null; end;

  -- Chat / crafting / mobs (optional tables)
  begin execute 'drop policy if exists "chat_select_world" on public.chat_messages'; exception when undefined_table then null; end;
  begin execute 'drop policy if exists "chat_insert_self" on public.chat_messages'; exception when undefined_table then null; end;

  begin execute 'drop policy if exists "recipes_select" on public.recipes'; exception when undefined_table then null; end;
  begin execute 'drop policy if exists "recipe_ingredients_select" on public.recipe_ingredients'; exception when undefined_table then null; end;
  begin execute 'drop policy if exists "mobs_select" on public.mobs'; exception when undefined_table then null; end;
end $$;

-- Drop functions/RPCs (ignore if missing)
drop function if exists public.is_non_guest();
drop function if exists public.in_spawn_protection(integer, integer);
drop function if exists public.get_profile_role(uuid);
drop function if exists public.rpc_set_role(text, text);
drop function if exists public.rpc_mute_user(text, integer, text);
drop function if exists public.rpc_craft(text, integer, uuid);
drop function if exists public.rpc_ensure_mobs(uuid);
drop function if exists public.rpc_mob_tick(uuid);
