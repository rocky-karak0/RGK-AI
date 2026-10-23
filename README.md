# RGK — Connect Beyond Conversations.

Real-time messaging web app: Next.js (App Router) + TypeScript + Tailwind + Supabase (Auth, Postgres, Realtime, Storage) + WebRTC. Deploys to Vercel.

## 1. What is verified and what is not

"Verified" means I actually ran it. Everything involving a live Supabase project, a second browser/device, or a TURN server has **not** been run by me; it is code written to spec that you must test.

| Check | Result |
|---|---|
| `npx tsc --noEmit` (strict) | passes |
| `npx next lint` | passes |
| `npx next build` (dummy env values) | passes |
| `npm test` (unit tests, `tests/unit`) | passes |
| SQL migrations 0001/0002 applied to a real Postgres | **NOT run** (no database access) |
| `npm run test:rls` (database authorization tests) | **NOT run**, needs a test Supabase project |
| `npm run test:e2e` (Playwright two-user flow) | **NOT run**, needs a running app + test project |
| Login, Google OAuth, email verification, password reset | **untested** |
| Realtime chat, reactions, receipts, typing, unread, presence | **untested** |
| Voice notes (MediaRecorder), file upload/download, signed URLs | **untested** |
| Audio/video calls (WebRTC) between two real browsers | **untested**, TURN not configured |
| Push notifications (service worker + `/api/push/send`) | **untested** |
| Mobile layouts at the viewport widths in the brief, accessibility audit | **untested** (written responsively with safe-area handling; not measured) |

### Implemented (code exists)
Auth (signup/login/Google/callback/logout, protected routes) · profile editing + avatar upload · settings (privacy, notifications, theme, password change, blocked users, account deletion) · 1-to-1 chat with realtime, history pagination, optimistic send + retry, duplicate-safe `client_id`, edit/delete own, reply, copy, reactions, read receipts, unread badges, typing indicator, last-seen/online with privacy settings · user search (public fields only) · block/unblock · report user/message · groups (create, add/remove, admin promote/demote, leave) · attachments (image/video/audio/PDF/files, private bucket, signed URLs, type + size validation) · voice notes · WebRTC audio + video calls with private signaling channel, mute, camera toggle/switch, full screen, duration, missed/rejected status · browser notifications + Web Push plumbing · PWA (manifest, icons, service worker, offline page) · admin dashboard (server-checked, aggregates + reports + suspend) · RLS on every table, storage policies, column-level update grants.

### NOT implemented (be aware)
Delivered ("double tick") state (only sent/read) · delete conversation from personal view · message search · group invitations flow (admins add members directly) · group photo/description editing UI · right-hand contact panel · contacts list UI (table exists) · call history screen (rows are stored in `call_sessions`) · upload progress bars · search rate limiting · notification-center table/UI · "view system health" in admin · end-to-end encryption (**RGK does not provide E2EE**; data is protected by TLS in transit and by Postgres RLS on the server — Supabase can technically read stored messages).

## 2. Local setup
```bash
npm install
cp .env.example .env.local     # fill in values (section 3)
npm run dev                    # http://localhost:3000
```
Use two different browsers (or one normal + one private window) to test two accounts.

## 3. Supabase configuration
1. Create a project at supabase.com.
2. **Project Settings → API**: copy *Project URL* → `NEXT_PUBLIC_SUPABASE_URL`, *anon/publishable key* → `NEXT_PUBLIC_SUPABASE_ANON_KEY`, *service_role key* → `SUPABASE_SERVICE_ROLE_KEY` (server only; never in client code, never commit it).
3. **Authentication → URL Configuration**: Site URL = your app URL; add Redirect URLs: `http://localhost:3000/auth/callback` and `https://YOUR-DOMAIN/auth/callback`.
4. **Authentication → Providers → Email**: keep "Confirm email" ON for production. For the Playwright test project turn it OFF.
5. **Realtime**: private channels are used for calls and typing. In **Realtime → Settings**, make sure "Allow public access" is **disabled** (so the channel policies in migration 0002 are enforced).

## 4. Database migrations
In order, paste each file into **SQL Editor → New query → Run** (or use the Supabase CLI `supabase db push`):
1. `supabase/migrations/0001_core.sql`
2. `supabase/migrations/0002_features.sql`

0002 creates the remaining tables, RPC functions, RLS policies, realtime channel policies, the `attachments` (private, 25 MB) and `avatars` (public, 2 MB) buckets, and their storage policies. If a statement fails, stop and send me the exact error. Do not skip it.

**First admin:** sign up normally, then in SQL Editor run:
`update public.profiles set is_admin = true where username = 'your_username';`
Then open `/admin`.

## 5. Google OAuth
1. Google Cloud Console → APIs & Services → Credentials → *Create OAuth client ID* (Web application).
2. Authorized redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback` (shown in Supabase → Authentication → Providers → Google).
3. Paste the Client ID and Secret into that Supabase provider screen and enable it.
Note: a Google signup has no `username` metadata, so the profile gets an automatic `user_xxxxxxxx` username; change it in Settings.

## 6. WebRTC configuration
- Signaling uses Supabase Realtime **private broadcast channels** (`call:<id>`), authorized by the `can_use_topic()` policy so only the caller and callee can join.
- STUN works out of the box (`NEXT_PUBLIC_STUN_URLS`). STUN alone fails on many mobile/corporate networks.
- For reliable calls set up TURN and fill `NEXT_PUBLIC_TURN_URL` (e.g. `turn:turn.example.com:3478,turns:turn.example.com:5349`), `NEXT_PUBLIC_TURN_USERNAME`, `NEXT_PUBLIC_TURN_CREDENTIAL`. Options: a managed provider (Cloudflare, Twilio, Metered) or your own coturn server. Static TURN credentials reach the browser; prefer short-lived credentials from a provider if you scale.
- Browsers only allow camera/mic on HTTPS or `localhost`.
- Do not claim internet-wide calling works until you have tested on two different networks (e.g. Wi-Fi vs mobile data) **with TURN enabled**.

## 7. Web Push (optional)
1. `npx web-push generate-vapid-keys` → set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
2. Set `PUSH_WEBHOOK_SECRET` to a long random string.
3. Supabase → Database → Webhooks → create a webhook on `public.messages` **INSERT** → HTTP POST to `https://YOUR-DOMAIN/api/push/send` with header `x-webhook-secret: <your secret>`.
4. Each user clicks *Enable push on this device* in Settings. iOS requires the app to be installed to the Home Screen first.

## 8. Testing
```bash
npm test            # unit tests (no network needed)
npm run typecheck && npm run lint && npm run build
```
**Database authorization tests** (`tests/rls`): create a *separate, throwaway* Supabase project, apply both migrations, put its three keys in `.env.test.local` (same variable names as `.env.example`), then `npm run test:rls`. They create three users and check: outsiders can't read/post, no spoofing, no editing others' messages/profiles, no self-promotion to admin, reactions, group admin rules, blocking both ways, private file access, call-session privacy.

**End-to-end** (`tests/e2e`): with the test project's "Confirm email" OFF, run `npm run dev`, then `npx playwright install chromium` once and `npm run test:e2e` (signup ×2, search, message, reply, reload, history persists).

**Manual checklist** (nothing here is automated): audio call; video call; deny camera/mic permission; no-camera device; switch camera on a phone; push notification with tab closed; mobile layout at 320/360/375/390/414/430/768/1024/1280/1440/1920 px and landscape; turn Wi-Fi off/on while chatting (offline banner, failed message → retry, history refetch after reconnect); install as PWA.

## 9. Vercel deployment
1. Push the repo to GitHub, then Vercel → *Add New → Project* → import it (framework auto-detected: Next.js).
2. Add every variable from `.env.example` under *Settings → Environment Variables* (Production + Preview). `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_KEY`, `PUSH_WEBHOOK_SECRET` must **not** have a `NEXT_PUBLIC_` prefix.
3. Set `NEXT_PUBLIC_APP_URL` to the production URL. Deploy.
4. Back in Supabase, set Site URL + Redirect URLs to the production domain (section 3.3) and update the Google OAuth redirect if needed.
5. Custom domain: Vercel → Settings → Domains → add it and create the DNS records Vercel shows; then update step 4 URLs.
6. Production checklist: sign up with a real email and verify it · log in · Google login · two-user chat across two devices · refresh keeps history · upload a file and open it from the other user · confirm a third account cannot see the conversation (`npm run test:rls` against a test project) · call test on two networks with TURN · `/admin` returns 404 for non-admins.

## 10. Security notes (accurate guarantees)
- Postgres RLS protects every table; sensitive operations (create chats/groups, mark read, admin) go through `SECURITY DEFINER` functions that check `auth.uid()`.
- Column-level grants stop clients from changing `is_admin`, `suspended_at`, `sender_id`, `conversation_id`, call participants.
- Attachments are in a private bucket; access is via 5-minute signed URLs and membership-checked storage policies.
- Blocking and suspension are enforced by database policies, not just by the UI.
- Admins see aggregates and report text only, not private conversations.
- No end-to-end encryption. Transport is TLS.
- The service-role key is only used in `src/lib/supabase/admin.ts` (marked `server-only`) by `/api/account` and `/api/push/send`.
