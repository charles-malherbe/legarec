-- The priorities of the dashboard are computed from the cases; what each person marked done is theirs only.

CREATE TABLE task_marks (
  user_id uuid NOT NULL REFERENCES users (id),
  key text NOT NULL CHECK (key ~ '^[a-z-]{1,32}:[0-9a-f-]{36}$'),
  done_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CALL app.secure('task_marks');
CREATE POLICY own ON task_marks TO legarec_staff USING (user_id = (SELECT app.user_id())) WITH CHECK (user_id = (SELECT app.user_id()));
CREATE POLICY retention_purge ON task_marks FOR DELETE TO legarec_retention USING (done_at < now() - interval '2 years');
CREATE POLICY retention_read ON task_marks FOR SELECT TO legarec_retention USING (true);
GRANT SELECT (user_id, key, done_at), INSERT (user_id, key), DELETE ON task_marks TO legarec_staff;
GRANT SELECT (done_at), DELETE ON task_marks TO legarec_retention;
