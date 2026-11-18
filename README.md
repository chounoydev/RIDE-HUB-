# RideHub

RideHub is an Android-first motorcycle community app built with Vue 3, Ionic Vue, Capacitor, and TypeScript. It is being delivered in verified phases; do not treat unimplemented services as available.

## Implemented

- Ionic Vue mobile shell with Home, Live Map, Groups, Messages, and Profile tabs.
- Responsive RideHub marketing site with purpose/feature information and account entry points.
- Website-only Neon Managed Auth signup, plus shared email/password sign-in and emailed-code password recovery on web and mobile, with mandatory email verification and password visibility controls.
- Admin-only account portal backed by Neon’s authenticated Admin API; users cannot self-promote.
- The website includes a direct download link and QR code for the signed Android APK; the iOS card remains unavailable until an official link is configured.
- Foreground GPS lookup and explicit live trip tracking after a user action; the last GPS fix is saved on-device per signed-in account and cleared at sign-out. Tracking stops when the map is left or the app is backgrounded. No location sharing or background GPS.
- Live Map destination search or map-pin selection, with the selected destination saved on-device across refreshes; Mapbox provides driving-route geometry, distance, estimated duration, and route steps. The active route is drawn with a high-contrast outline above 3D buildings and remains visible as the map follows the rider.
- Motorcycle-only rider marker labeled with the authenticated rider's name; the marker follows actual foreground GPS updates during an explicitly started trip and has no colored badge background.
- 3D terrain/building map presentation with a 2D toggle. Motorcycle trips can request a Mapbox driving estimate; cross-user location sharing is not implemented.
- Weather near the last Live Map location using a backend proxy to WeatherAPI.com; the forecast is cached on-device per signed-in account and refreshed when due or when the rider moves.
- Private profile photo uploads for signed-in riders, stored in the branch's Neon Object Storage bucket.
- Community prototype with group creation, device-local group chat and image sharing, admin branding and moderation controls (kick, ban, mute), and admin-only meeting-location UI. Community data is currently local to the browser/device and is not server-enforced or synchronized between riders.
- Official government warning feed (when available from the provider) and clearly labeled forecast-derived rain, thunderstorm, wind, and heat advisories.
- In-app alert cards and pop-up toast, expiry filtering, duplicate/update suppression, and device-local category preferences/history.
- Prisma schema and migration definitions for weather preferences, watched locations, alert history and delivery logs, plus emergency data tables.
- SOS is deliberately disabled in the app. No emergency incident is created and no contacts are notified.

## Weather setup and local development

Requirements: Node.js 22.22.2+ or 24.15.0+, npm, and an API key from [WeatherAPI.com](https://www.weatherapi.com/). Its Alerts API relays government-issued warnings where available; coverage and warning availability vary by location.

From `RideHUB/`:

```powershell
npm install
Copy-Item .env.example .env
```

Set `WEATHER_API_KEY` in `.env.local` or `.env` (backend only; `.env.local` takes precedence). The API loads both files, so the existing local `.env.local` setup works. Set `VITE_MAPBOX_TOKEN` to a Mapbox public access token with access to the configured map style, Geocoding API, and Directions API. The token is included in client requests and must be a public token; never put secret Mapbox tokens or other provider credentials in `VITE_` variables. Start the API and app in separate terminals:

```powershell
npm run server:dev
npm run dev
```

The Vite development server proxies `/api` to `http://localhost:3000`. For a physical Android device, use a reachable HTTPS development endpoint in `VITE_API_BASE_URL`; a loopback address on the phone points to the phone itself. Do not enable cleartext HTTP for a production build.

## GitHub and Vercel deployment

The project includes a GitHub Actions workflow that runs the server tests and production build on pushes and pull requests. In Vercel, use the directory containing this `package.json` as the project root; the Vite build produces `dist`, and `vercel.json` routes `/api/*` to the Express function while sending app routes to the SPA.

Set these Vercel environment variables before deploying:

- Build/client: `VITE_MAPBOX_TOKEN` and `VITE_NEON_AUTH_URL`. Set the Auth URL to the Neon branch used by the deployment. `VITE_ANDROID_DOWNLOAD_URL` and `VITE_IOS_DOWNLOAD_URL` are optional.
- Server/runtime: `WEATHER_API_KEY`, `NEON_AUTH_BASE_URL`, and `NEON_AUTH_JWKS_URL`. Add `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, and `AWS_REGION` only when enabling profile photo uploads.
- Do not add secrets to `VITE_` variables. `DATABASE_URL` and `DATABASE_URL_UNPOOLED` are not required by the deployed API; use them only for database tooling/migrations.

The API allows same-origin web requests and the local/Capacitor origins; add any separate trusted web clients to `WEB_ORIGINS` as comma-separated origins. Vercel Functions limit request bodies to 4.5 MB, so profile photo uploads are capped at 4 MB. A deployment is only fully functional after its required provider credentials are configured. Rotate any credentials that have been shared in chat before adding replacement values to Vercel.

## Web accounts and the admin portal

The public RideHub website is served by the same Vue application as the mobile tabs:

- `/` explains the RideHub purpose, current capabilities, and limitations.
- `/auth?mode=register` creates a Neon Managed Auth account.
- `/auth?mode=login` signs in to the shared RideHub account.
- The Android/iOS app is sign-in only. Create and verify an account on the website, then sign in to the app with the same email and password. Both clients use the same Neon Auth project/branch and user records; users still sign in separately on each device.
- **Forgot password?** on the login form sends a Neon Auth recovery code; enter it with a new password to restore account access.
- `/verify-email` checks the emailed verification code. An email address is accepted only after the account owner can access its inbox; this confirms mailbox access, not legal identity.
- `/admin` is restricted to users whose Neon Auth role is `admin`. The portal reads account records through Neon’s protected Admin API and does not provide role promotion.

For local development, the Vite config uses `VITE_NEON_AUTH_URL` when present and otherwise reads the branch’s `NEON_AUTH_BASE_URL` from `.env.local`. Both point at the Neon Auth service; the Auth URL is public client configuration, unlike `DATABASE_URL`, which must remain backend-only. Build the website and APK with the same `VITE_NEON_AUTH_URL` (and Neon branch) so they authenticate against the same user records. For another checkout, deploy target, or production hosting, provide `VITE_NEON_AUTH_URL` as a build-time environment variable. Do not put database credentials or Neon API keys in any `VITE_` variable.

Neon pre-approves local `localhost` origins, but `127.0.0.1` is a different origin. The linked development branch explicitly allows `http://127.0.0.1:5173` for local browser testing. If you use another local host or port, use `http://localhost:5173` or add that exact origin to the development branch with `neon neon-auth domain add http://<host>:<port>`. Never allow an untrusted production origin.

Email verification is enabled on the linked `ridehub-dev` branch. Test signup using an inbox you control and enter the code actually delivered by Neon Auth. The shared development mail provider is not a production mail-delivery guarantee; configure a dedicated SMTP provider and trusted production domain in Neon before launch. Users must not be assigned admin access by the signup flow. Provision administrators through Neon Console (Auth → Users → Make admin) and protect access to the console.

The Android download card points to `/downloads/ridehub-android.apk` and downloads the signed APK bundled in `public/downloads`. `VITE_ANDROID_DOWNLOAD_URL` can override it with an HTTPS release URL. The iOS card remains “Coming soon” until a valid HTTPS URL is supplied with `VITE_IOS_DOWNLOAD_URL`. QR codes use the active download URL.

The admin portal currently supports **Neon admins only**. Neon Managed Auth on this branch does not expose a distinct least-privilege staff role, so do not grant full admin privileges to staff accounts unless they are meant to have all Managed Auth admin capabilities.

## Neon database

The project is linked to the Neon **RIDE HUB** project on the `ridehub-dev` branch. Neon CLI stores the pooled `DATABASE_URL` and direct migration-only `DATABASE_URL_UNPOOLED` in the ignored `.env.local` file. Do not commit that file. Prisma loads `.env.local` and falls back to `.env`.

To connect another checkout, install/authenticate the Neon CLI, then link the existing project and use the development branch:

```powershell
neon link --project-id plain-boat-55001755 --no-env-pull -y
neon checkout ridehub-dev
```

Apply the project migrations to the selected development branch:

```powershell
npm run prisma:generate
npm run prisma:migrate:deploy
```

Migrations use `DATABASE_URL_UNPOOLED`; application queries should use the pooled `DATABASE_URL`. Do not switch to `production` or apply schema changes there without first testing them on a separate branch.

Home and Live Map use the last GPS fix to show nearby weather and refresh automatically while either view is open, about every 10 minutes or after a significant location change. To start, locate once in Live Map; no manual weather refresh button is needed. The last fix and forecast are stored only on-device, scoped to the signed-in account, and cleared at sign-out; the API does not persist coordinates. GPS is not sampled in the background, and trip tracking stops when the map is left or the app is backgrounded.

API endpoints:

- `GET /api/health` — reports whether the provider is configured and whether background monitoring/push are active.
- `GET /api/weather/forecast?lat=<latitude>&lon=<longitude>` — returns current conditions, the next 24 forecast hours, provider-issued warnings, and measured forecast advisories. Calls are rate-limited.

WeatherAPI's government-issued alerts are marked **Official warning**. Weather advisories derived from provider forecast measurements are marked **Forecast** and are not represented as government warnings. Flood and lightning alerts are shown only when the provider supplies an official alert with that hazard. Thresholds for forecast advisories are implemented in `server/weather.ts`.

## Current weather limitations

- There is no scheduled monitoring worker. The API health endpoint reports background monitoring as inactive; automatic forecast checks run only while Home or Live Map is open.
- FCM push delivery, persistent server-side alert history/preferences and saved locations, route checks, scheduled/group ride checks, and server-side notification deduplication are not yet wired to authenticated users.
- Weather preferences/history, the last GPS fix, and the latest forecast are local to the current app installation; reinstalling or clearing app data removes them.
- Firebase project credentials have not been provided. The Prisma migrations are intended for the linked Neon development branch:

```powershell
npm run prisma:generate
npm run prisma:migrate:deploy
```

For a non-Neon PostgreSQL database, set both values to the appropriate connection string. Never apply migrations to production until they have been tested on a separate branch/database.

## Validation

```powershell
npm run test:server
npm run build
```

Map search and routing require a working internet connection and Mapbox token with the required public API scopes. Route distance, duration, and steps come from Mapbox's driving profile; they are estimates, not motorcycle-specific navigation or guaranteed turn-by-turn guidance. The map can be switched between pitched 3D terrain/buildings and 2D. The GPS marker displays the signed-in user's name; it does not display other riders because cross-user location sharing is not implemented.

The current API accepts only explicit latitude/longitude forecast requests. It does not expose a weather route planner or claim to monitor background conditions. Group membership, messages, logos, moderation, and meeting details are currently browser/device-local prototypes; server persistence, cross-device synchronization, and server-enforced admin authorization are not implemented. Community admins can optimize and update logos, set a chat theme color, and send voice messages up to one minute; voice recordings and other community content are stored on the current device only. Destinations and live trip locations remain on the device and are not shared with a group.

## Profile picture storage

Signed-in users can choose a JPEG, PNG, or WebP profile picture up to 5 MB on the Profile page. Uploads are verified by the backend, scoped to the authenticated user, stored privately in the Neon `profile-avatars` bucket, and served through short-lived signed URLs. The user profile stores only the object key.

The project declares the bucket in `neon.ts`. On the intended development branch, review the infrastructure change and provision it with:

```powershell
neon config plan
neon deploy
```

The Neon CLI writes branch-scoped storage credentials to the ignored `.env.local`. The backend also needs `NEON_AUTH_BASE_URL` and `NEON_AUTH_JWKS_URL` there to verify sessions. Do not copy AWS storage credentials or other server-only secrets into `VITE_` variables or commit them. `/api/health` reports whether avatar uploads are configured.

## Emergency assistance status

The profile displays SOS as unavailable, and the button is disabled by design. The database schema is only groundwork; there are no SOS endpoints, confirmation/countdown, emergency-contact notifications, location sharing, or public emergency-service calls. Do not rely on RideHub for emergency response. Contact local emergency services directly using your phone and network.

## Android and iOS

Android requires Android Studio, Android SDK, and JDK 17 or newer:

```powershell
npm run build
npm run android:add
npm run cap:sync
npm run android:open
```

To build a debug APK after opening/configuring the native project:

```powershell
Set-Location .\android
.\gradlew.bat assembleDebug
```

The APK is written to `android\app\build\outputs\apk\debug\app-debug.apk`. iOS builds require macOS and Xcode. Background location, notification delivery, and their platform permission declarations are not configured.

The website's Android download is a release APK. Release builds use the `ridehubReleaseSigning*` values in your **user-level** Gradle properties, not files committed to this repository. Keep the release keystore and its passwords backed up securely; losing them prevents signing compatible app updates. Run `.\gradlew.bat publishReleaseApk` from `android\` to build and copy the signed APK to `public\downloads\ridehub-android.apk`, then run `npm run build` so Vite includes it in `dist`. Do not distribute an unsigned or debug APK as the public release.
