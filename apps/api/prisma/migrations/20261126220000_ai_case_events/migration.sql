-- The summary of a case made again when something new has happened on it (docs/ia.md): the application looks, every few
-- minutes, for the cases whose last event is recent but already a few minutes old, and queues one summary for each.

-- The recent events, whatever the case.
CREATE INDEX case_events_recent ON case_events (occurred_at);
-- The summary already queued for a case in the same state (its number of events).
CREATE INDEX outbox_ai_case_event ON outbox ((payload ->> 'case')) WHERE queue = 'ai' AND name = 'case-summary-event';
