CREATE TABLE replay_assessments_v2 (
 source_chain TEXT NOT NULL,
 txid TEXT NOT NULL,
 state TEXT NOT NULL,
 detail TEXT NOT NULL,
 checked INTEGER NOT NULL,
 next_attempt INTEGER NOT NULL,
 PRIMARY KEY(source_chain,txid)
);
INSERT INTO replay_assessments_v2(source_chain,txid,state,detail,checked,next_attempt)
 SELECT 'btc',txid,state,detail,checked,next_attempt FROM replay_assessments;
DROP TABLE replay_assessments;
ALTER TABLE replay_assessments_v2 RENAME TO replay_assessments;
CREATE INDEX replay_due ON replay_assessments(next_attempt,checked);
