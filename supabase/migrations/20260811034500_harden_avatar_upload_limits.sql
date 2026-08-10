-- Avatars remain public profile media, but direct API uploads must stay small
-- and raster-only. The client normalizes accepted input to JPEG before upload.
update storage.buckets
set public = true,
    file_size_limit = 1048576,
    allowed_mime_types = array['image/jpeg']::text[]
where id = 'avatars';

-- Immutable hash-addressed avatars do not need UPDATE permission. Replacements
-- are INSERTs at new paths; old objects are deleted only after profile commit.
drop policy if exists "Users can update their own avatars" on storage.objects;
drop policy if exists "Authenticated users can upload avatars" on storage.objects;
