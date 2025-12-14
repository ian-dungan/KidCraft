# KidCraft (Updated)

Included:
- Username-only signup (no manual users). Game creates/updates player_profiles automatically.
- Guest users supported (requires Supabase: Allow anonymous sign-ins). Guests are READ-ONLY (no block edits).
- Player name tags above heads (from player_profiles.username).
- Spawn protection:
  - No edits within 10 blocks of spawn (0,0).
  - Extra protection for 20 seconds after login.
  - Safe spawn placement on join.
- Realtime optimizations (Free tier friendly):
  - player_state updates throttled to ~4/sec and only when moved/turned.
  - subscriptions filtered by world_id for block_updates and player_state.

Setup:
1) Run `supabase/kidcraft_full.sql` once in Supabase SQL Editor.
2) In `main.js`, set SUPABASE_URL and SUPABASE_KEY to your project values.
3) In Supabase: Authentication -> Sign In / Providers:
   - Allow new users to sign up: ON
   - Allow anonymous sign-ins: ON (for Guest)
   - Confirm email: OFF (recommended)
4) Deploy to GitHub Pages and hard refresh once.
