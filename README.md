# KidCraft – Full Final Release

## Included
- Username-only auth (no manual users)
- Guest mode (anonymous sign-in)
- Guests are READ-ONLY (DB + client enforced)
- Multiplayer with realtime sync
- Chunked world + shared block edits
- World chat (Supabase Realtime)
- Player name tags
- Spawn protection (client + DB backstop)
- Mobile controls (invisible)
- Mobile camera roll fix
- Realtime optimizations (free-tier safe)

## Setup (once)
1. Supabase → SQL Editor → run `supabase/kidcraft_full.sql`
2. Supabase → Auth → Sign In / Providers:
   - Allow new users to sign up: ON
   - Allow anonymous sign-ins: ON
   - Confirm email: OFF
3. In `main.js`, set SUPABASE_URL and SUPABASE_KEY

## Deploy
- Commit files to repo root
- Enable GitHub Pages (root)
- Hard refresh

Enjoy building KidCraft 🎮
