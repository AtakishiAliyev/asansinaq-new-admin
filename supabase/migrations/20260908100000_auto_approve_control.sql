-- Auto-approve, moved to where the worker can read it.
--
-- The switch existed in the UI and did nothing. It wrote to a browser-local
-- store that was read by one function, and that function lost its last caller
-- when structuring moved off the browser and into the worker — so from that
-- refactor onward the toggle was a control with nothing on the other end, and
-- not one row was ever auto-approved.
--
-- It belongs beside `desired_state` and `express` for the same reason those do:
-- the worker is a daemon on another process, and a setting it cannot read is a
-- setting that does not exist. Both default to the careful behaviour, so an
-- operator who never opens the dialog gets a pipeline that approves nothing by
-- itself.
alter table public.worker_control
  add column if not exists auto_approve boolean not null default false;

alter table public.worker_control
  add column if not exists auto_approve_needs_answer boolean not null default true;

comment on column public.worker_control.auto_approve is
  'Approve, without a reviewer, questions that cleared every automatic check: '
  'the verification wave called them a match, no deterministic guard objection '
  'stands, and the lint raised no error. Off by default.';

comment on column public.worker_control.auto_approve_needs_answer is
  'While auto-approving, pass only questions that already have an answer from '
  'the printed key. A question with no answer is not usable in an exam, so the '
  'default is to hold it for a person.';
