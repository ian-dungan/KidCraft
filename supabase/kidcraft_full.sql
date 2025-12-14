-- =========================================================
-- GroveCraft Full Database Build + Expanded Minecraft-like Materials
-- Single-file Supabase SQL
-- =========================================================

-- ---------- Extensions ----------
create extension if not exists "pgcrypto";

-- =========================================================
-- TABLES
-- =========================================================

create table if not exists public.worlds (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique not null,
  name       text not null,
  seed       bigint not null,
  settings   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.materials (
  id            serial primary key,
  code          text unique not null,
  display_name  text not null,
  category      text not null check (category in ('block','item','entity')),
  hardness      real default 1.0,
  tool_tag      text,
  tags          text[] not null default '{}',
  props         jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists materials_category_idx on public.materials (category);

create table if not exists public.player_profiles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid unique not null references auth.users (id) on delete cascade,
  username   text unique,
  settings   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.player_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  world_id   uuid not null references public.worlds (id) on delete cascade,
  pos_x      real not null default 0,
  pos_y      real not null default 0,
  pos_z      real not null default 0,
  rot_y      real not null default 0,
  health     real not null default 20,
  hunger     real not null default 20,
  game_mode  text not null default 'survival'
             check (game_mode in ('survival','creative','spectator')),
  updated_at timestamptz not null default now()
);

create index if not exists player_state_world_idx
  on public.player_state (world_id);

create table if not exists public.player_inventories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  world_id   uuid not null references public.worlds (id) on delete cascade,
  type       text not null check (type in ('main','ender_chest','armor','offhand')),
  created_at timestamptz not null default now(),
  unique (user_id, world_id, type)
);

create table if not exists public.inventory_slots (
  inventory_id uuid not null references public.player_inventories (id) on delete cascade,
  slot_index   int  not null,
  material_id  int  not null references public.materials (id),
  quantity     int  not null check (quantity > 0),
  meta         jsonb not null default '{}'::jsonb,
  primary key (inventory_id, slot_index)
);

create table if not exists public.player_stats (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  blocks_placed  bigint not null default 0,
  blocks_broken  bigint not null default 0,
  deaths         bigint not null default 0,
  mobs_killed    bigint not null default 0,
  play_time_secs bigint not null default 0,
  extra          jsonb not null default '{}'::jsonb
);

create table if not exists public.world_blocks (
  world_id    uuid not null references public.worlds (id) on delete cascade,
  x           int  not null,
  y           int  not null,
  z           int  not null,
  material_id int references public.materials (id),
  updated_at  timestamptz not null default now(),
  primary key (world_id, x, y, z)
);

create index if not exists world_blocks_world_idx
  on public.world_blocks (world_id, x, z);

create table if not exists public.block_updates (
  id         bigserial primary key,
  world_id   uuid not null references public.worlds (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  x          int not null,
  y          int not null,
  z          int not null,
  action     text not null check (action in ('place','break','change')),
  block_type text,
  created_at timestamptz not null default now()
);

create index if not exists block_updates_world_time_idx
  on public.block_updates (world_id, created_at desc);

create index if not exists block_updates_world_coord_idx
  on public.block_updates (world_id, x, z, created_at desc);

-- =========================================================
-- DEFAULT WORLD SEED
-- =========================================================

insert into public.worlds (slug, name, seed, settings)
values (
  'overworld',
  'Overworld',
  123456789,
  jsonb_build_object('sea_level', 62, 'max_height', 128, 'noise_scale', 0.05)
)
on conflict (slug) do nothing;

-- =========================================================
-- MATERIALS SEED - EXPANDED MINECRAFT-LIKE SET
-- This is a large but not literally exhaustive copy of Mojang's registry.
-- It covers most practical gameplay blocks/items in families.
-- =========================================================

-- ---------- Core terrain blocks ----------
insert into public.materials (code, display_name, category, hardness, tool_tag, tags) values
('air','Air','block',0,null,ARRAY['non_solid','invisible']),
('stone','Stone','block',1.5,'pickaxe',ARRAY['solid','natural']),
('cobblestone','Cobblestone','block',2.0,'pickaxe',ARRAY['solid','natural']),
('dirt','Dirt','block',0.5,'shovel',ARRAY['solid','natural']),
('coarse_dirt','Coarse Dirt','block',0.6,'shovel',ARRAY['solid','natural']),
('grass_block','Grass Block','block',0.6,'shovel',ARRAY['solid','natural','grass']),
('podzol','Podzol','block',0.6,'shovel',ARRAY['solid','natural']),
('mycelium','Mycelium','block',0.6,'shovel',ARRAY['solid','natural']),
('sand','Sand','block',0.5,'shovel',ARRAY['solid','gravity']),
('red_sand','Red Sand','block',0.5,'shovel',ARRAY['solid','gravity']),
('gravel','Gravel','block',0.6,'shovel',ARRAY['solid','gravity']),
('clay','Clay','block',0.6,'shovel',ARRAY['solid']),
('snow','Snow','block',0.2,'shovel',ARRAY['soft']),
('snow_block','Snow Block','block',0.5,'shovel',ARRAY['soft']),
('ice','Ice','block',0.5,null,ARRAY['transparent']),
('packed_ice','Packed Ice','block',0.5,null,ARRAY['transparent']),
('blue_ice','Blue Ice','block',0.5,null,ARRAY['transparent']),
('water','Water','block',100.0,null,ARRAY['fluid']),
('lava','Lava','block',100.0,null,ARRAY['fluid','hot']);

-- ---------- Wood families (overworld woods + bamboo + cherry + mangrove) ----------
insert into public.materials (code, display_name, category, hardness, tool_tag, tags)
values
-- Logs
('oak_log','Oak Log','block',2.0,'axe',ARRAY['solid','wood']),
('spruce_log','Spruce Log','block',2.0,'axe',ARRAY['solid','wood']),
('birch_log','Birch Log','block',2.0,'axe',ARRAY['solid','wood']),
('jungle_log','Jungle Log','block',2.0,'axe',ARRAY['solid','wood']),
('acacia_log','Acacia Log','block',2.0,'axe',ARRAY['solid','wood']),
('dark_oak_log','Dark Oak Log','block',2.0,'axe',ARRAY['solid','wood']),
('mangrove_log','Mangrove Log','block',2.0,'axe',ARRAY['solid','wood']),
('cherry_log','Cherry Log','block',2.0,'axe',ARRAY['solid','wood']),
('bamboo_block','Block of Bamboo','block',2.0,'axe',ARRAY['solid','wood']),

-- Planks
('oak_planks','Oak Planks','block',2.0,'axe',ARRAY['solid','wood']),
('spruce_planks','Spruce Planks','block',2.0,'axe',ARRAY['solid','wood']),
('birch_planks','Birch Planks','block',2.0,'axe',ARRAY['solid','wood']),
('jungle_planks','Jungle Planks','block',2.0,'axe',ARRAY['solid','wood']),
('acacia_planks','Acacia Planks','block',2.0,'axe',ARRAY['solid','wood']),
('dark_oak_planks','Dark Oak Planks','block',2.0,'axe',ARRAY['solid','wood']),
('mangrove_planks','Mangrove Planks','block',2.0,'axe',ARRAY['solid','wood']),
('cherry_planks','Cherry Planks','block',2.0,'axe',ARRAY['solid','wood']),
('bamboo_planks','Bamboo Planks','block',2.0,'axe',ARRAY['solid','wood']),

-- Leaves
('oak_leaves','Oak Leaves','block',0.2,null,ARRAY['leaf','transparent']),
('spruce_leaves','Spruce Leaves','block',0.2,null,ARRAY['leaf','transparent']),
('birch_leaves','Birch Leaves','block',0.2,null,ARRAY['leaf','transparent']),
('jungle_leaves','Jungle Leaves','block',0.2,null,ARRAY['leaf','transparent']),
('acacia_leaves','Acacia Leaves','block',0.2,null,ARRAY['leaf','transparent']),
('dark_oak_leaves','Dark Oak Leaves','block',0.2,null,ARRAY['leaf','transparent']),
('mangrove_leaves','Mangrove Leaves','block',0.2,null,ARRAY['leaf','transparent']),
('cherry_leaves','Cherry Leaves','block',0.2,null,ARRAY['leaf','transparent']);

-- ---------- Stone / Deepslate families ----------
insert into public.materials (code, display_name, category, hardness, tool_tag, tags)
values
('andesite','Andesite','block',1.5,'pickaxe',ARRAY['solid','natural']),
('diorite','Diorite','block',1.5,'pickaxe',ARRAY['solid','natural']),
('granite','Granite','block',1.5,'pickaxe',ARRAY['solid','natural']),
('stone_bricks','Stone Bricks','block',1.5,'pickaxe',ARRAY['solid']),
('cracked_stone_bricks','Cracked Stone Bricks','block',1.5,'pickaxe',ARRAY['solid']),
('mossy_stone_bricks','Mossy Stone Bricks','block',1.5,'pickaxe',ARRAY['solid']),
('deepslate','Deepslate','block',3.0,'pickaxe',ARRAY['solid','natural']),
('cobbled_deepslate','Cobbled Deepslate','block',3.5,'pickaxe',ARRAY['solid']),
('deepslate_bricks','Deepslate Bricks','block',3.5,'pickaxe',ARRAY['solid']),
('polished_deepslate','Polished Deepslate','block',3.5,'pickaxe',ARRAY['solid']);

-- ---------- Ores (stone & deepslate) ----------
insert into public.materials (code, display_name, category, hardness, tool_tag, tags)
values
('coal_ore','Coal Ore','block',3.0,'pickaxe',ARRAY['solid','ore']),
('iron_ore','Iron Ore','block',3.0,'pickaxe',ARRAY['solid','ore']),
('gold_ore','Gold Ore','block',3.0,'pickaxe',ARRAY['solid','ore']),
('copper_ore','Copper Ore','block',3.0,'pickaxe',ARRAY['solid','ore']),
('lapis_ore','Lapis Lazuli Ore','block',3.0,'pickaxe',ARRAY['solid','ore']),
('redstone_ore','Redstone Ore','block',3.0,'pickaxe',ARRAY['solid','ore']),
('diamond_ore','Diamond Ore','block',3.0,'pickaxe',ARRAY['solid','ore']),
('emerald_ore','Emerald Ore','block',3.0,'pickaxe',ARRAY['solid','ore']),
('deepslate_coal_ore','Deepslate Coal Ore','block',4.5,'pickaxe',ARRAY['solid','ore']),
('deepslate_iron_ore','Deepslate Iron Ore','block',4.5,'pickaxe',ARRAY['solid','ore']),
('deepslate_gold_ore','Deepslate Gold Ore','block',4.5,'pickaxe',ARRAY['solid','ore']),
('deepslate_copper_ore','Deepslate Copper Ore','block',4.5,'pickaxe',ARRAY['solid','ore']),
('deepslate_lapis_ore','Deepslate Lapis Ore','block',4.5,'pickaxe',ARRAY['solid','ore']),
('deepslate_redstone_ore','Deepslate Redstone Ore','block',4.5,'pickaxe',ARRAY['solid','ore']),
('deepslate_diamond_ore','Deepslate Diamond Ore','block',4.5,'pickaxe',ARRAY['solid','ore']),
('deepslate_emerald_ore','Deepslate Emerald Ore','block',4.5,'pickaxe',ARRAY['solid','ore']);

-- ---------- Utility blocks (crafting, storage, redstone basics) ----------
insert into public.materials (code, display_name, category, hardness, tool_tag, tags)
values
('crafting_table','Crafting Table','block',2.5,'axe',ARRAY['solid','utility']),
('furnace','Furnace','block',3.5,'pickaxe',ARRAY['solid','utility']),
('blast_furnace','Blast Furnace','block',3.5,'pickaxe',ARRAY['solid','utility']),
('smoker','Smoker','block',3.5,'pickaxe',ARRAY['solid','utility']),
('anvil','Anvil','block',5.0,'pickaxe',ARRAY['solid','utility']),
('chest','Chest','block',2.5,'axe',ARRAY['solid','storage']),
('trapped_chest','Trapped Chest','block',2.5,'axe',ARRAY['solid','storage','redstone']),
('ender_chest','Ender Chest','block',22.5,'pickaxe',ARRAY['solid','storage']),
('barrel','Barrel','block',2.5,'axe',ARRAY['solid','storage']),
('jukebox','Jukebox','block',2.0,'axe',ARRAY['solid','utility']),
('enchanting_table','Enchanting Table','block',5.0,'pickaxe',ARRAY['solid','utility']),
('brewing_stand','Brewing Stand','block',0.5,'pickaxe',ARRAY['solid','utility']),
('ladder','Ladder','block',0.4,'axe',ARRAY['climbable']),
('bed','Bed','block',0.2,'axe',ARRAY['soft']),
('bookshelf','Bookshelf','block',1.5,'axe',ARRAY['solid']),
('tnt','TNT','block',0.0,null,ARRAY['explosive']),
('lever','Lever','block',0.5,'pickaxe',ARRAY['redstone']),
('stone_button','Stone Button','block',0.5,'pickaxe',ARRAY['redstone']),
('oak_button','Oak Button','block',0.5,'axe',ARRAY['redstone']),
('pressure_plate','Stone Pressure Plate','block',0.5,'pickaxe',ARRAY['redstone']),
('oak_pressure_plate','Oak Pressure Plate','block',0.5,'axe',ARRAY['redstone']),
('redstone_torch','Redstone Torch','block',0.0,null,ARRAY['redstone','light']),
('redstone_lamp','Redstone Lamp','block',0.3,'pickaxe',ARRAY['redstone','light']),
('noteblock','Note Block','block',0.8,'axe',ARRAY['redstone']);

-- ---------- Glass & lighting ----------
insert into public.materials (code, display_name, category, hardness, tool_tag, tags)
values
('glass','Glass','block',0.3,null,ARRAY['transparent']),
('glass_pane','Glass Pane','block',0.3,null,ARRAY['transparent']),
('sea_lantern','Sea Lantern','block',0.3,'pickaxe',ARRAY['light']),
('glowstone','Glowstone','block',0.3,'pickaxe',ARRAY['light']),
('jack_o_lantern','Jack o''Lantern','block',1.0,'axe',ARRAY['light']);

-- ---------- Color variants via SQL templates ----------
with colors(name, code) as (
  values
  ('White','white'),('Orange','orange'),('Magenta','magenta'),
  ('Light Blue','light_blue'),('Yellow','yellow'),('Lime','lime'),
  ('Pink','pink'),('Gray','gray'),('Light Gray','light_gray'),
  ('Cyan','cyan'),('Purple','purple'),('Blue','blue'),
  ('Brown','brown'),('Green','green'),('Red','red'),('Black','black')
)
insert into public.materials (code, display_name, category, hardness, tags)
select concat(code,'_wool'), concat(name,' Wool'), 'block', 0.8, ARRAY['soft','colored']
from colors
on conflict (code) do nothing;

with colors(name, code) as (
  values
  ('White','white'),('Orange','orange'),('Magenta','magenta'),
  ('Light Blue','light_blue'),('Yellow','yellow'),('Lime','lime'),
  ('Pink','pink'),('Gray','gray'),('Light Gray','light_gray'),
  ('Cyan','cyan'),('Purple','purple'),('Blue','blue'),
  ('Brown','brown'),('Green','green'),('Red','red'),('Black','black')
)
insert into public.materials (code, display_name, category, hardness, tags)
select concat(code,'_terracotta'), concat(name,' Terracotta'), 'block', 1.25, ARRAY['solid','colored']
from colors
on conflict (code) do nothing;

with colors(name, code) as (
  values
  ('White','white'),('Orange','orange'),('Magenta','magenta'),
  ('Light Blue','light_blue'),('Yellow','yellow'),('Lime','lime'),
  ('Pink','pink'),('Gray','gray'),('Light Gray','light_gray'),
  ('Cyan','cyan'),('Purple','purple'),('Blue','blue'),
  ('Brown','brown'),('Green','green'),('Red','red'),('Black','black')
)
insert into public.materials (code, display_name, category, hardness, tags)
select concat(code,'_stained_glass'), concat(name,' Stained Glass'), 'block', 0.3, ARRAY['transparent','colored']
from colors
on conflict (code) do nothing;

with colors(name, code) as (
  values
  ('White','white'),('Orange','orange'),('Magenta','magenta'),
  ('Light Blue','light_blue'),('Yellow','yellow'),('Lime','lime'),
  ('Pink','pink'),('Gray','gray'),('Light Gray','light_gray'),
  ('Cyan','cyan'),('Purple','purple'),('Blue','blue'),
  ('Brown','brown'),('Green','green'),('Red','red'),('Black','black')
)
insert into public.materials (code, display_name, category, hardness, tags)
select concat(code,'_concrete'), concat(name,' Concrete'), 'block', 1.8, ARRAY['solid','colored']
from colors
on conflict (code) do nothing;

with colors(name, code) as (
  values
  ('White','white'),('Orange','orange'),('Magenta','magenta'),
  ('Light Blue','light_blue'),('Yellow','yellow'),('Lime','lime'),
  ('Pink','pink'),('Gray','gray'),('Light Gray','light_gray'),
  ('Cyan','cyan'),('Purple','purple'),('Blue','blue'),
  ('Brown','brown'),('Green','green'),('Red','red'),('Black','black')
)
insert into public.materials (code, display_name, category, hardness, tags)
select concat(code,'_concrete_powder'), concat(name,' Concrete Powder'), 'block', 0.5, ARRAY['gravity','colored']
from colors
on conflict (code) do nothing;

-- ---------- Basic resource items & food ----------
insert into public.materials (code, display_name, category, hardness, tool_tag, tags, props)
values
('stick','Stick','item',0,null,ARRAY['crafting'],'{}'),
('string','String','item',0,null,ARRAY['crafting'],'{}'),
('feather','Feather','item',0,null,ARRAY['resource'],'{}'),
('flint','Flint','item',0,null,ARRAY['resource'],'{}'),
('coal','Coal','item',0,null,ARRAY['resource','fuel'],'{}'),
('iron_ingot','Iron Ingot','item',0,null,ARRAY['resource'],'{}'),
('gold_ingot','Gold Ingot','item',0,null,ARRAY['resource'],'{}'),
('copper_ingot','Copper Ingot','item',0,null,ARRAY['resource'],'{}'),
('diamond','Diamond','item',0,null,ARRAY['resource','gem'],'{}'),
('emerald','Emerald','item',0,null,ARRAY['resource','gem'],'{}'),
('lapis_lazuli','Lapis Lazuli','item',0,null,ARRAY['resource'],'{}'),
('redstone','Redstone Dust','item',0,null,ARRAY['resource'],'{}'),
('apple','Apple','item',0,null,ARRAY['food'],jsonb_build_object('hunger',4)),
('bread','Bread','item',0,null,ARRAY['food'],jsonb_build_object('hunger',5)),
('cooked_beef','Cooked Beef','item',0,null,ARRAY['food'],jsonb_build_object('hunger',8)),
('cooked_porkchop','Cooked Porkchop','item',0,null,ARRAY['food'],jsonb_build_object('hunger',8)),
('cooked_chicken','Cooked Chicken','item',0,null,ARRAY['food'],jsonb_build_object('hunger',6)),
('carrot','Carrot','item',0,null,ARRAY['food'],jsonb_build_object('hunger',3)),
('potato','Potato','item',0,null,ARRAY['food'],jsonb_build_object('hunger',1)),
('baked_potato','Baked Potato','item',0,null,ARRAY['food'],jsonb_build_object('hunger',5)),
('melon_slice','Melon Slice','item',0,null,ARRAY['food'],jsonb_build_object('hunger',2)),
('pumpkin_pie','Pumpkin Pie','item',0,null,ARRAY['food'],jsonb_build_object('hunger',8));

-- ---------- Tools, weapons, armor families ----------
with tiers as (
  select * from (values
    ('wooden', 1),
    ('stone', 2),
    ('iron', 3),
    ('golden', 2),
    ('diamond', 4),
    ('netherite', 5)
  ) t(tier, mining_level)
)
insert into public.materials (code, display_name, category, hardness, tool_tag, tags, props)
select concat(t.tier, '_pickaxe'),
       initcap(t.tier) || ' Pickaxe',
       'item', 0, 'pickaxe',
       ARRAY['tool'],
       jsonb_build_object('mining_level', t.mining_level)
from tiers t
on conflict (code) do nothing;

with tiers as (
  select * from (values
    ('wooden', 1),
    ('stone', 2),
    ('iron', 3),
    ('golden', 2),
    ('diamond', 4),
    ('netherite', 5)
  ) t(tier, mining_level)
)
insert into public.materials (code, display_name, category, hardness, tool_tag, tags)
select concat(t.tier, '_axe'),
       initcap(t.tier) || ' Axe',
       'item', 0, 'axe',
       ARRAY['tool']
from tiers t
on conflict (code) do nothing;

with tiers as (
  select * from (values
    ('wooden', 1),
    ('stone', 2),
    ('iron', 3),
    ('golden', 2),
    ('diamond', 4),
    ('netherite', 5)
  ) t(tier, mining_level)
)
insert into public.materials (code, display_name, category, hardness, tool_tag, tags)
select concat(t.tier, '_shovel'),
       initcap(t.tier) || ' Shovel',
       'item', 0, 'shovel',
       ARRAY['tool']
from tiers t
on conflict (code) do nothing;

with tiers as (
  select * from (values
    ('wooden', 1),
    ('stone', 2),
    ('iron', 3),
    ('golden', 2),
    ('diamond', 4),
    ('netherite', 5)
  ) t(tier, mining_level)
)
insert into public.materials (code, display_name, category, hardness, tool_tag, tags)
select concat(t.tier, '_sword'),
       initcap(t.tier) || ' Sword',
       'item', 0, 'sword',
       ARRAY['weapon']
from tiers t
on conflict (code) do nothing;

with tiers as (
  select * from (values
    ('leather', 0),
    ('chainmail', 1),
    ('iron', 2),
    ('golden', 1),
    ('diamond', 3),
    ('netherite', 4)
  ) t(tier, protection)
)
insert into public.materials (code, display_name, category, hardness, tool_tag, tags, props)
select concat(t.tier, '_', part.code),
       initcap(t.tier) || ' ' || part.name,
       'item', 0, null,
       ARRAY['armor'],
       jsonb_build_object('slot', part.code, 'protection', t.protection)
from tiers t
cross join (values
  ('helmet','Helmet'),
  ('chestplate','Chestplate'),
  ('leggings','Leggings'),
  ('boots','Boots')
) part(code, name)
on conflict (code) do nothing;

-- ---------- Entity definitions ----------
insert into public.materials (code, display_name, category, hardness, tool_tag, tags)
values
('player','Player','entity',0,null,ARRAY['living','player']),
('zombie','Zombie','entity',0,null,ARRAY['living','hostile']),
('skeleton','Skeleton','entity',0,null,ARRAY['living','hostile']),
('creeper','Creeper','entity',0,null,ARRAY['living','hostile']),
('spider','Spider','entity',0,null,ARRAY['living','hostile']),
('enderman','Enderman','entity',0,null,ARRAY['living','hostile']),
('cow','Cow','entity',0,null,ARRAY['living','passive']),
('pig','Pig','entity',0,null,ARRAY['living','passive']),
('sheep','Sheep','entity',0,null,ARRAY['living','passive']),
('chicken','Chicken','entity',0,null,ARRAY['living','passive']),
('villager','Villager','entity',0,null,ARRAY['living','neutral']),
('iron_golem','Iron Golem','entity',0,null,ARRAY['living','neutral']);

-- =========================================================
-- ROW LEVEL SECURITY & POLICIES
-- =========================================================

alter table public.worlds            enable row level security;
alter table public.materials         enable row level security;
alter table public.player_profiles   enable row level security;
alter table public.player_state      enable row level security;
alter table public.player_inventories enable row level security;
alter table public.inventory_slots   enable row level security;
alter table public.player_stats      enable row level security;
alter table public.world_blocks      enable row level security;
alter table public.block_updates     enable row level security;

-- Worlds readable by any authenticated user
drop policy if exists "Worlds Select Auth" on public.worlds;
create policy "Worlds Select Auth"
  on public.worlds
  for select
  using (auth.role() = 'authenticated');

-- Materials read-only to authenticated users
drop policy if exists "Materials Select Auth" on public.materials;
create policy "Materials Select Auth"
  on public.materials
  for select
  using (auth.role() = 'authenticated');

-- Player profiles
drop policy if exists "Profiles Select Own" on public.player_profiles;

drop policy if exists "Profiles Insert Own" on public.player_profiles;
create policy "Profiles Insert Own"
  on public.player_profiles
  for insert
  with check (user_id = auth.uid());

drop policy if exists "Profiles Update Own" on public.player_profiles;
create policy "Profiles Update Own"
  on public.player_profiles
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Player state
drop policy if exists "State Select Auth" on public.player_state;
create policy "State Select Auth"
  on public.player_state
  for select
  using (auth.role() = 'authenticated');

drop policy if exists "State Insert Own" on public.player_state;
create policy "State Insert Own"
  on public.player_state
  for insert
  with check (user_id = auth.uid());

drop policy if exists "State Update Own" on public.player_state;
create policy "State Update Own"
  on public.player_state
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Player inventories
drop policy if exists "Inv Select Own" on public.player_inventories;
create policy "Inv Select Own"
  on public.player_inventories
  for select
  using (user_id = auth.uid());

drop policy if exists "Inv Insert Own" on public.player_inventories;
create policy "Inv Insert Own"
  on public.player_inventories
  for insert
  with check (user_id = auth.uid());

drop policy if exists "Inv Update Own" on public.player_inventories;
create policy "Inv Update Own"
  on public.player_inventories
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Inv Delete Own" on public.player_inventories;
create policy "Inv Delete Own"
  on public.player_inventories
  for delete
  using (user_id = auth.uid());

-- Inventory slots follow inventory ownership
drop policy if exists "Slots Own" on public.inventory_slots;
create policy "Slots Own"
  on public.inventory_slots
  for all
  using (
    exists (
      select 1 from public.player_inventories inv
      where inv.id = inventory_id
        and inv.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.player_inventories inv
      where inv.id = inventory_id
        and inv.user_id = auth.uid()
    )
  );

-- Player stats
drop policy if exists "Stats Own" on public.player_stats;
create policy "Stats Own"
  on public.player_stats
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- World blocks
drop policy if exists "World Blocks Select Auth" on public.world_blocks;
create policy "World Blocks Select Auth"
  on public.world_blocks
  for select
  using (auth.role() = 'authenticated');

drop policy if exists "World Blocks Mutate Auth" on public.world_blocks;
create policy "World Blocks Mutate Auth"
  on public.world_blocks
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Block updates
drop policy if exists "Block Updates Select Auth" on public.block_updates;
create policy "Block Updates Select Auth"
  on public.block_updates
  for select
  using (auth.role() = 'authenticated');

drop policy if exists "Block Updates Insert Own" on public.block_updates;
create policy "Block Updates Insert Own"
  on public.block_updates
  for insert
  with check (user_id = auth.uid());

-- =========================================================
-- REALTIME PUBLICATION REGISTRATION
-- =========================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.player_state;
    exception when duplicate_object then null; end;

    begin
      alter publication supabase_realtime add table public.block_updates;
    exception when duplicate_object then null; end;

    begin
      alter publication supabase_realtime add table public.world_blocks;
    exception when duplicate_object then null; end;
  end if;
end $$;

-- =========================================================
-- END OF SCRIPT
-- =========================================================


-- =======================
-- KidCraft Chat
-- =======================
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references public.worlds(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 200),
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_world_created_idx
  on public.chat_messages (world_id, created_at);

-- =====================================================================
-- KidCraft: Canonical RLS Policies (Idempotent)
-- This section DROPS and RE-CREATES policies to match KidCraft rules:
-- - Everyone signed-in (including anonymous sign-ins) can READ shared data
-- - Users can only write rows that belong to themselves (auth.uid() = user_id)
-- - Guests (provider=anonymous) are READ-ONLY for block edits (world_blocks + block_updates)
-- - Event logs are INSERT-only (no UPDATE/DELETE policies)
-- =====================================================================

-- Helper predicate: true if this session is NOT an anonymous (guest) sign-in.
-- Supabase anonymous sign-ins typically have app_metadata.provider = 'anonymous'.
-- If the claim isn't present, we treat it as non-guest.
create or replace function public.is_non_guest()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') <> 'anonymous';
$$;

-- Helper: protect spawn region (0,0) with radius 10 (optional backstop).
create or replace function public.in_spawn_protection(x integer, z integer)
returns boolean
language sql
immutable
as $$
  select ((x - 0)*(x - 0) + (z - 0)*(z - 0)) <= (10*10);
$$;

-- ---------------------------
-- Enable RLS (safety)
-- ---------------------------
alter table if exists public.block_updates      enable row level security;
alter table if exists public.world_blocks       enable row level security;
alter table if exists public.player_state       enable row level security;
alter table if exists public.player_profiles    enable row level security;
alter table if exists public.player_inventories enable row level security;
alter table if exists public.inventory_slots    enable row level security;
alter table if exists public.player_stats       enable row level security;
alter table if exists public.materials          enable row level security;
alter table if exists public.worlds             enable row level security;
alter table if exists public.chat_messages      enable row level security;

-- ---------------------------
-- Drop existing policies (idempotent)
-- ---------------------------
do $$ begin
  -- block_updates
  execute 'drop policy if exists "Block Updates Insert Own" on public.block_updates';
  execute 'drop policy if exists "Block Updates Select Auth" on public.block_updates';

  -- world_blocks
  execute 'drop policy if exists "World Blocks Mutate Auth" on public.world_blocks';
  execute 'drop policy if exists "World Blocks Select Auth" on public.world_blocks';

  -- player_state
  execute 'drop policy if exists "State Insert Own" on public.player_state';
  execute 'drop policy if exists "State Select Auth" on public.player_state';
  execute 'drop policy if exists "State Update Own" on public.player_state';

  -- player_profiles
  execute 'drop policy if exists "Profiles Insert Own" on public.player_profiles';
  execute 'drop policy if exists "Profiles Select Own" on public.player_profiles';
  execute 'drop policy if exists "Profiles Update Own" on public.player_profiles';

  -- player_inventories
  execute 'drop policy if exists "Inv Delete Own" on public.player_inventories';
  execute 'drop policy if exists "Inv Insert Own" on public.player_inventories';
  execute 'drop policy if exists "Inv Select Own" on public.player_inventories';
  execute 'drop policy if exists "Inv Update Own" on public.player_inventories';

  -- inventory_slots / player_stats
  execute 'drop policy if exists "Slots Own" on public.inventory_slots';
  execute 'drop policy if exists "Stats Own" on public.player_stats';

  -- materials / worlds
  execute 'drop policy if exists "Materials Select Auth" on public.materials';
  execute 'drop policy if exists "Worlds Select Auth" on public.worlds';

  -- chat_messages (if present)
  execute 'drop policy if exists "chat_select_world" on public.chat_messages';
  execute 'drop policy if exists "chat_insert_self" on public.chat_messages';
exception when undefined_table then
  -- chat_messages might not exist in older schema; ignore.
  null;
end $$;

-- ---------------------------
-- materials (read-only)
-- ---------------------------
create policy "Materials Select Auth"
on public.materials
for select
to authenticated
using (true);

-- ---------------------------
-- worlds (read-only list)
-- ---------------------------
create policy "Worlds Select Auth"
on public.worlds
for select
to authenticated
using (true);

-- ---------------------------
-- player_profiles (public read, self write)
-- ---------------------------

create policy "Profiles Insert Own"
on public.player_profiles
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Profiles Update Own"
on public.player_profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- ---------------------------
-- player_state (self write, everyone can read)
-- ---------------------------
create policy "State Select Auth"
on public.player_state
for select
to authenticated
using (true);

create policy "State Insert Own"
on public.player_state
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "State Update Own"
on public.player_state
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- ---------------------------
-- block_updates (event log)
-- Guests are READ-ONLY (no inserts) to match client rules.
-- ---------------------------
create policy "Block Updates Select Auth"
on public.block_updates
for select
to authenticated
using (true);

create policy "Block Updates Insert Own"
on public.block_updates
for insert
to authenticated
with check (
  auth.uid() = user_id
  and public.is_non_guest()
  -- optional backstop: disallow edits in spawn region by DB, too
  and not public.in_spawn_protection(x, z)
);

-- NOTE: intentionally NO update/delete policies on block_updates.

-- ---------------------------
-- world_blocks (authoritative persistence)
-- Guests are READ-ONLY.
-- We allow INSERT/UPDATE for non-guest authenticated users only.
-- ---------------------------
create policy "World Blocks Select Auth"
on public.world_blocks
for select
to authenticated
using (true);

create policy "World Blocks Insert NonGuest"
on public.world_blocks
for insert
to authenticated
with check (
  public.is_non_guest()
  and not public.in_spawn_protection(x, z)
);

create policy "World Blocks Update NonGuest"
on public.world_blocks
for update
to authenticated
using (public.is_non_guest())
with check (
  public.is_non_guest()
  and not public.in_spawn_protection(x, z)
);

-- NOTE: intentionally NO delete policy on world_blocks (prevents grief wipes).

-- ---------------------------
-- player_inventories (self-owned)
-- ---------------------------
create policy "Inv Select Own"
on public.player_inventories
for select
to authenticated
using (auth.uid() = user_id);

create policy "Inv Insert Own"
on public.player_inventories
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Inv Update Own"
on public.player_inventories
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Inv Delete Own"
on public.player_inventories
for delete
to authenticated
using (auth.uid() = user_id);

-- ---------------------------
-- inventory_slots (self-owned via inventory -> user_id)
-- Assumes inventory_slots has inventory_id referencing player_inventories(id)
-- ---------------------------
create policy "Slots Own"
on public.inventory_slots
for select
to authenticated
using (
  exists (
    select 1 from public.player_inventories i
    where i.id = inventory_slots.inventory_id
      and i.user_id = auth.uid()
  )
);

create policy "Slots Insert Own"
on public.inventory_slots
for insert
to authenticated
with check (
  exists (
    select 1 from public.player_inventories i
    where i.id = inventory_slots.inventory_id
      and i.user_id = auth.uid()
  )
);

create policy "Slots Update Own"
on public.inventory_slots
for update
to authenticated
using (
  exists (
    select 1 from public.player_inventories i
    where i.id = inventory_slots.inventory_id
      and i.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.player_inventories i
    where i.id = inventory_slots.inventory_id
      and i.user_id = auth.uid()
  )
);

create policy "Slots Delete Own"
on public.inventory_slots
for delete
to authenticated
using (
  exists (
    select 1 from public.player_inventories i
    where i.id = inventory_slots.inventory_id
      and i.user_id = auth.uid()
  )
);

-- ---------------------------
-- player_stats (self-owned)
-- ---------------------------
create policy "Stats Select Own"
on public.player_stats
for select
to authenticated
using (auth.uid() = user_id);

create policy "Stats Insert Own"
on public.player_stats
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Stats Update Own"
on public.player_stats
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Stats Delete Own"
on public.player_stats
for delete
to authenticated
using (auth.uid() = user_id);

-- ---------------------------
-- chat_messages (if table exists)
-- Everyone authenticated (including guests) can read + send as themselves.
-- ---------------------------
do $$ begin
  create policy "chat_select_world"
  on public.chat_messages
  for select
  to authenticated
  using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "chat_insert_self"
  on public.chat_messages
  for insert
  to authenticated
  with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- NOTE: If you want guests read-only for chat too, add `and public.is_non_guest()`
-- to chat_insert_self.


-- Roles / moderation
alter table public.player_profiles
  add column if not exists role text not null default 'player' check (role in ('player','mod','admin'));

alter table public.player_profiles
  add column if not exists muted_until timestamptz;

alter table public.player_profiles
  add column if not exists mute_reason text;


do $$ begin
  execute 'drop policy if exists "Profiles Select Own" on public.player_profiles';
  execute 'drop policy if exists "Profiles Select Auth" on public.player_profiles';
  create policy "Profiles Select Auth" on public.player_profiles for select to authenticated using (true);
exception when undefined_table then null; end $$;


-- Crafting
create table if not exists public.recipes (
  code text primary key,
  name text not null,
  output_material_code text not null references public.materials(code),
  output_qty int not null check (output_qty > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.recipe_ingredients (
  recipe_code text not null references public.recipes(code) on delete cascade,
  material_code text not null references public.materials(code),
  qty int not null check (qty > 0),
  primary key (recipe_code, material_code)
);

alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;

do $$ begin
  create policy "recipes_select" on public.recipes for select to authenticated using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "recipe_ingredients_select" on public.recipe_ingredients for select to authenticated using (true);
exception when duplicate_object then null; end $$;


insert into public.recipes (code, name, output_material_code, output_qty) values
  ('planks_from_log', 'Planks (from Log)', 'oak_planks', 4),
  ('sticks_from_planks', 'Sticks', 'stick', 4),
  ('crafting_table', 'Crafting Table', 'crafting_table', 1)
on conflict (code) do nothing;

insert into public.recipe_ingredients (recipe_code, material_code, qty) values
  ('planks_from_log', 'oak_log', 1),
  ('sticks_from_planks', 'oak_planks', 2),
  ('crafting_table', 'oak_planks', 4)
on conflict (recipe_code, material_code) do nothing;


-- Mobs
create table if not exists public.mobs (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references public.worlds(id) on delete cascade,
  type text not null,
  x real not null,
  y real not null,
  z real not null,
  yaw real not null default 0,
  hp int not null default 10,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists mobs_world_idx on public.mobs(world_id);
alter table public.mobs enable row level security;

do $$ begin
  create policy "mobs_select" on public.mobs for select to authenticated using (true);
exception when duplicate_object then null; end $$;

-- Only mods/admins can update mobs via SECURITY DEFINER RPC (no direct policies)


-- Role helpers
create or replace function public.get_profile_role(uid uuid)
returns text
language sql
stable
as $$
  select coalesce((select role from public.player_profiles where user_id = uid), 'player');
$$;

create or replace function public.rpc_set_role(target_username text, new_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
begin
  caller_role := public.get_profile_role(auth.uid());
  if caller_role <> 'admin' then
    raise exception 'admin only';
  end if;
  if new_role not in ('player','mod','admin') then
    raise exception 'invalid role';
  end if;
  update public.player_profiles
    set role = new_role
  where username = target_username;
  if not found then
    raise exception 'user not found';
  end if;
  return jsonb_build_object('ok', true, 'message', format('Set %s role to %s', target_username, new_role));
end $$;

create or replace function public.rpc_mute_user(target_username text, minutes int, reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  until_ts timestamptz;
begin
  caller_role := public.get_profile_role(auth.uid());
  if caller_role not in ('mod','admin') then
    raise exception 'mod/admin only';
  end if;
  if minutes <= 0 then
    raise exception 'minutes must be > 0';
  end if;
  until_ts := now() + make_interval(mins => minutes);
  update public.player_profiles
    set muted_until = until_ts,
        mute_reason = reason
  where username = target_username;
  if not found then
    raise exception 'user not found';
  end if;
  return jsonb_build_object('ok', true, 'message', format('Muted %s for %s minutes', target_username, minutes));
end $$;

-- Crafting RPC: consumes ingredients from main inventory and grants output.
create or replace function public.rpc_craft(recipe_code text, craft_qty int, in_world_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv_id uuid;
  out_code text;
  out_qty int;
  need record;
  have_qty int;
  out_mat_id int;
  max_slots int := 36;
  slot_i int;
  existing record;
  add_left int;
  stack_max int := 64;
begin
  if craft_qty is null or craft_qty < 1 then craft_qty := 1; end if;

  -- Ensure inventory exists for this world
  insert into public.player_inventories(user_id, world_id, type)
  values (auth.uid(), in_world_id, 'main')
  on conflict (user_id, world_id, type) do nothing;

  select id into inv_id
  from public.player_inventories
  where user_id = auth.uid() and world_id = in_world_id and type='main';

  if inv_id is null then
    raise exception 'inventory missing';
  end if;

  select r.output_material_code, r.output_qty
    into out_code, out_qty
  from public.recipes r
  where r.code = recipe_code;

  if out_code is null then
    raise exception 'recipe not found';
  end if;

  -- Check ingredients
  for need in
    select material_code, qty from public.recipe_ingredients where recipe_code = recipe_code
  loop
    select coalesce(sum(s.quantity),0) into have_qty
    from public.inventory_slots s
    join public.materials m on m.id = s.material_id
    where s.inventory_id = inv_id and m.code = need.material_code;

    if have_qty < (need.qty * craft_qty) then
      raise exception 'missing % (%)', need.material_code, (need.qty * craft_qty - have_qty);
    end if;
  end loop;

  -- Consume ingredients across slots
  for need in
    select material_code, qty from public.recipe_ingredients where recipe_code = recipe_code
  loop
    have_qty := need.qty * craft_qty;

    for existing in
      select s.slot_index, s.quantity, s.material_id
      from public.inventory_slots s
      join public.materials m on m.id = s.material_id
      where s.inventory_id = inv_id and m.code = need.material_code
      order by s.slot_index
    loop
      exit when have_qty <= 0;
      if existing.quantity <= have_qty then
        have_qty := have_qty - existing.quantity;
        delete from public.inventory_slots where inventory_id = inv_id and slot_index = existing.slot_index;
      else
        update public.inventory_slots
          set quantity = quantity - have_qty
        where inventory_id = inv_id and slot_index = existing.slot_index;
        have_qty := 0;
      end if;
    end loop;
  end loop;

  -- Grant output
  select id into out_mat_id from public.materials where code = out_code;
  add_left := out_qty * craft_qty;

  -- Fill existing stacks first
  for existing in
    select slot_index, quantity from public.inventory_slots
    where inventory_id = inv_id and material_id = out_mat_id
    order by slot_index
  loop
    exit when add_left <= 0;
    if existing.quantity < stack_max then
      update public.inventory_slots
        set quantity = least(stack_max, quantity + add_left)
      where inventory_id = inv_id and slot_index = existing.slot_index;
      add_left := greatest(0, add_left - (stack_max - existing.quantity));
    end if;
  end loop;

  -- Find empty slots for remaining
  slot_i := 0;
  while add_left > 0 and slot_i < max_slots loop
    perform 1 from public.inventory_slots where inventory_id = inv_id and slot_index = slot_i;
    if not found then
      insert into public.inventory_slots(inventory_id, slot_index, material_id, quantity)
      values (inv_id, slot_i, out_mat_id, least(stack_max, add_left));
      add_left := greatest(0, add_left - stack_max);
    end if;
    slot_i := slot_i + 1;
  end loop;

  if add_left > 0 then
    raise exception 'inventory full';
  end if;

  return jsonb_build_object('ok', true, 'message', format('Crafted %sx%s', out_code, out_qty*craft_qty));
end $$;

-- Ensure a few mobs exist in a world (idempotent)
create or replace function public.rpc_ensure_mobs(in_world_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare c int;
begin
  select count(*) into c from public.mobs where world_id = in_world_id;
  if c = 0 then
    insert into public.mobs(world_id, type, x,y,z,yaw,hp)
    values
      (in_world_id, 'slime', 4, 3, 4, 0, 10),
      (in_world_id, 'zombie', -4, 3, -4, 0, 20);
  end if;
end $$;

-- Low-frequency mob tick: random wander (mods/admins only)
create or replace function public.rpc_mob_tick(in_world_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare caller_role text;
begin
  caller_role := public.get_profile_role(auth.uid());
  if caller_role not in ('mod','admin') then
    return;
  end if;
  update public.mobs
    set x = x + (random() - 0.5) * 0.6,
        z = z + (random() - 0.5) * 0.6,
        yaw = yaw + (random() - 0.5) * 0.4,
        updated_at = now()
  where world_id = in_world_id;
end $$;


-- Multiple worlds (idempotent)
insert into public.worlds (slug, name, seed, settings) values
  ('overworld', 'Overworld', 123456789, jsonb_build_object('type','overworld','mode','survival')),
  ('nether', 'Nether', 987654321, jsonb_build_object('type','nether','mode','survival')),
  ('creative', 'Creative', 555555555, jsonb_build_object('type','overworld','mode','creative'))
on conflict (slug) do nothing;
