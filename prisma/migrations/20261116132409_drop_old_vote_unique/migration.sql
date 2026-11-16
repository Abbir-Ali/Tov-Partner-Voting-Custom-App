-- Drop the old single-vote-per-item index left behind by the init migration.
-- The new constraint is votes_boardItemId_voterId_key (one vote per item per voter).
DROP INDEX IF EXISTS "votes_boardItemId_key";
