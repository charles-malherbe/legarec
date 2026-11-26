-- A draft of credit note is its author's alone (question 172, 26/11/2026): only whoever typed it reads it, changes it, deletes
-- it or issues from it; it is deleted at the issuance. The functions of the definer (app.credit_notes, the draft ones,
-- app.issue_credit_note) see the drafts of the caller only: a draft of someone else is as one that does not exist.
DROP POLICY definer_all ON credit_note_drafts;
CREATE POLICY definer_own ON credit_note_drafts TO legarec_definer
  USING (created_by = (SELECT app.user_id())) WITH CHECK (created_by = (SELECT app.user_id()));
