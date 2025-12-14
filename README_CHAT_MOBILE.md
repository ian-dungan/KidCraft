# KidCraft Update: Chat + Mobile Camera Fix

Included:
- World chat (Supabase table: chat_messages + realtime subscription)
- Guests can chat (guests remain read-only for block edits)
- Mobile camera "tipping/rolling" fixed:
  - camera.rotation.order = "YXZ"
  - roll forced to 0 each frame
  - touch/gyro handlers zero roll

Setup:
1) Run `supabase/kidcraft_full.sql` (it now includes chat_messages).
2) In `main.js`, set SUPABASE_URL and SUPABASE_KEY.

Controls:
- Chat: type in the chat box and press Send/Enter.
- Mobile: Left = move, Right = look, Tap break, Double tap place (non-guests).
