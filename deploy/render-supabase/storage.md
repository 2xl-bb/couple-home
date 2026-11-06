# Private photo storage for the Render + Supabase variant

Create a Supabase Storage bucket named `couple-photos` with **Public bucket off**.
Restrict uploads to `image/jpeg` and set a 5 MB bucket file limit. The existing
Couple Home upload route accepts JPEG files up to 4 MB. Do not place a Supabase
secret key in browser code or Git.

`server/supabase/storage.mjs` exports
`createSupabaseBucket({ url, serviceKey, bucket = 'couple-photos' })`. Its
`put`, `get`, and `delete` methods have the same shape as `localBucket`. The
service must first verify the Couple Home member session and photo ownership in
its own API routes. Each member sees only rows whose `photos.user_id` matches
the authenticated Session. The adapter uses a
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
the direct PostgreSQL connection and application ownership checks are the only
data path.

The adapter uses the authenticated Storage object endpoint for reads, the
Storage API for uploads and deletes, and avoids replacing an existing object.
An identical retry succeeds; a different object at the same key fails. Upload
metadata and database rows still need to be kept consistent by the caller.
Deleting an object through the Storage API removes its stored bytes; deleting
only the `storage.objects` database row does not.

Local isolated check, without a Supabase account or real photo:

```sh
node --test tests/supabase-storage.test.mjs
```

References: [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys),
[Storage API](https://supabase.com/docs/reference/self-hosting-storage),
[private bucket access](https://supabase.com/docs/guides/storage/serving/downloads),
[delete objects](https://supabase.com/docs/guides/storage/management/delete-objects).
