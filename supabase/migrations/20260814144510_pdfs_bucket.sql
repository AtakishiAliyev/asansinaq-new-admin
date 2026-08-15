-- Private bucket for uploaded question-bank PDFs. The originals are archival:
-- segmentation runs on the admin's local copy in the browser, the upload is a
-- parallel keep-the-source step. Crops are NOT stored in this phase.
--
-- Private on purpose: these are commercial books. Access only through
-- authenticated admin requests (signed URLs / direct download), never public.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pdfs', 'pdfs', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

-- Storage RLS lives on storage.objects. Same predicate as every table: the
-- caller must be an allowlisted admin.
create policy pdfs_select on storage.objects
  for select to authenticated
  using (bucket_id = 'pdfs' and (select public.is_admin()));

create policy pdfs_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'pdfs' and (select public.is_admin()));

create policy pdfs_update on storage.objects
  for update to authenticated
  using (bucket_id = 'pdfs' and (select public.is_admin()))
  with check (bucket_id = 'pdfs' and (select public.is_admin()));

create policy pdfs_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'pdfs' and (select public.is_admin()));
