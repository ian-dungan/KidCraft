# KidCraft – All Systems Build

Included:
- Multiplayer + shared edits + chat
- /commands: /help, /whoami, /mute, /admin promote/demote
- Permissions: player/mod/admin + muted_until
- Crafting system (recipes + ingredients + rpc_craft)
- Multiple worlds: overworld, nether, creative (world selector)
- Mob AI (low-frequency server tick) with rpc_ensure_mobs + rpc_mob_tick
- Mobile roll fix + invisible controls
- Free-tier realtime optimizations

Setup:
1) Supabase SQL Editor: run `supabase/kidcraft_full.sql` once (idempotent seeds + policies + RPCs).
2) Supabase Auth: Sign In / Providers:
   - Allow new users to sign up: ON
   - Allow anonymous sign-ins: ON
   - Confirm email: OFF
3) In `main.js`, set SUPABASE_URL and SUPABASE_KEY.
4) Deploy to GitHub Pages and hard refresh.

Notes:
- Mob ticking is performed by mods/admins only (1 tick/sec). Promote yourself to admin in DB once:
  update public.player_profiles set role='admin' where user_id = '<your-uuid>';
- Guests remain read-only for block edits, but can chat.
