-- 0003_listing_images_bucket.sql
--
-- Public Supabase Storage bucket that Phase-3 image mirroring uploads into
-- (runners/imageMirrorStep.ts -> db/storage.ts).
--
-- Public buckets serve objects via /storage/v1/object/public/<bucket>/<path>
-- WITHOUT any RLS check; writes happen with the service-role key (the pipeline
-- is server-side only), so no storage.objects policies are required here.
--
-- Idempotent: safe to re-run against any environment. NOTE: a misnamed bucket
-- `lisitng_images` was created manually in the live project before this file
-- existed; it is intentionally left alone and can be dropped by hand once the
-- correctly named bucket holds the mirrored photos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'listing-images',
  'listing-images',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/heic']
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
