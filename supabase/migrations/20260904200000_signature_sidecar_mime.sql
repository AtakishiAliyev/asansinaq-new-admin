-- Let the crops bucket hold a drawing's thought signature.
--
-- A corrective edit can be sent as a continuation of the turn that drew the
-- figure, which means passing back the `thought_signature` the model returned
-- on the image part. It is kept as a sidecar object beside the drawing it
-- belongs to, so that replacing the drawing replaces the signature for free.
--
-- The bucket's allowed-mime list was images only, so every signature upload was
-- refused — silently, since storing one is best-effort by design. The lane then
-- read nothing back and fell through to its older shape, which is a defensible
-- outcome reached for an undefensible reason: nobody chose it, a mime list did.
--
-- `application/json` rather than `text/plain` because the signature is an
-- opaque provider token, and a bucket that serves images should not start
-- serving anything a browser will render as a page.
update storage.buckets
   set allowed_mime_types = array['image/png', 'image/jpeg', 'application/json']
 where id = 'question-crops';
