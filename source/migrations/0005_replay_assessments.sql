CREATE TABLE replay_assessments (
 txid TEXT PRIMARY KEY NOT NULL,
 state TEXT NOT NULL,
 detail TEXT NOT NULL,
 checked INTEGER NOT NULL,
 next_attempt INTEGER NOT NULL
);
CREATE INDEX replay_due ON replay_assessments(next_attempt,checked);
