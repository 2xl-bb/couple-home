# Private photo storage for the Render + Supabase variant

Create a Supabase Storage bucket named `couple-photos` with **Public bucket off**.
Restrict uploads to `image/jpeg` and set a 5 MB bucket file limit. The existing
Couple Home upload route accepts JPEG files up to 4 MB. Do not place a Supabase
secret key in browser code or Git.

`server/supabase/storage.mjs` exports
`createSupabaseBucket({ url, serviceKey, bucket = 'couple-photos' })`. Its
`put`, `get`, and `delete` methods have the same shape as `localBucket`. The
service must first verify a valid Couple Home member session in its own API
routes. This deployment represents one couple home, so either authenticated
member may read or remove every photo in that home. `photos.user_id` remains
uploader attribution and is not an authorization boundary. The adapter uses a
server-side key that bypasses Supabase RLS, so **the bucket itself cannot decide
which Couple Home member is allowed to see a photo**. Keep photo responses
behind `/api/photos/:id` with `Cache-Control: private, no-store`; never return a
Supabase public or signed URL to the browser.

Prefer the current Supabase secret key (`sb_secret_...`), supplied through a
server-only environment variable such as `SUPABASE_SECRET_KEY`. A legacy
`service_role` JWT also works. New secret keys must be sent in the `apikey`
header only; they are not JWT bearer tokens. The adapter requires an HTTPS
project root URL and rejects redirects to protect the key.

Startup calls `health()` and refuses a missing or public bucket. Supabase Data
API roles have no table grants or RLS policies for these server-owned tables;
the direct PostgreSQL connection and application Session checks are the only
data path.

The adapter uses the authenticated Storage object endpoint for reads, the
Storage API for uploads and deletes, and avoids replacing an existing object.
An identical retry succeeds; a different object at the same key fails. Upload
metadata and database rows still need to be kept consistent by the caller.
Deleting an object through the Storage API removes its stored bytes; deleting
only the `storage.objects` database row does not.

行舟记足迹照片不使用这个 Supabase 桶。它们由服务端写入同一私有 Cloudflare
R2 桶作为视频对象，通过 `/api/travel/footprints/:id/photos/:photoId` 的
成员鉴权接口读取；数据库只保存这些同源 API URL。R2 对象使用独立的
`travel/` 键空间，不会与 `videos/` 对象混淆。

Local isolated check, without a Supabase account or real photo:

```sh
node --test tests/supabase-storage.test.mjs
```

Real-account connectivity check (loads the project-root `.env` and never prints
the key):

```sh
node --use-env-proxy --env-file=.env scripts/check-supabase-storage.mjs
```

The command reports the project host, bucket name, key type, proxy state, HTTP
status, and a redacted network error chain. Keep `--env-file=.env` before the
script path so Node can read proxy variables before initializing its proxy
agent. Omit `--use-env-proxy` on machines that connect directly without
`HTTPS_PROXY`/`HTTP_PROXY`.

On Windows, `--use-env-proxy` reads proxy environment variables; it does not
automatically import the proxy configured in Internet Options. If direct TLS
connections are reset, add a local-only line such as
`HTTPS_PROXY=http://127.0.0.1:<current-port>` to the ignored `.env`. Never add a
developer-machine proxy to Render environment variables or committed source.

References: [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys),
[Storage API](https://supabase.com/docs/reference/self-hosting-storage),
[private bucket access](https://supabase.com/docs/guides/storage/serving/downloads),
[delete objects](https://supabase.com/docs/guides/storage/management/delete-objects).
