-- Product photos are normalized to JPEG by the client before upload. Keep the
-- bucket private and reject direct oversized or unexpected upload types.
update storage.buckets
set public = false,
    file_size_limit = 3145728,
    allowed_mime_types = array['image/jpeg']::text[]
where id = 'product-images';

-- Content-addressed product objects are immutable. A replacement always gets a
-- new hash path; cleanup uses DELETE only after application-level reference checks.
drop policy if exists "Users can update their own product images" on storage.objects;
