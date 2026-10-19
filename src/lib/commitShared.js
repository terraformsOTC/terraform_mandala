// The parts of commit.js the commit panel needs before the user starts a
// commit. They live here, free of ethers, so the panel renders without loading
// commit.js; the panel imports commit.js (and ethers with it) on the first click.

export const STATUS_NAMES = ['Terrain', 'Daydream', 'Terraformed', 'Origin Daydream', 'Origin Terraformed'];

// The contract's gate: commitDreamToCanvas requires status % 2 == 1.
export const isDreamingStatus = (status) => Number(status) % 2 === 1;

export class CommitError extends Error {
  constructor(message, { needsV2 = false } = {}) {
    super(message);
    // The commit check stopped only because the parcel is not on v2 yet; the
    // panel offers the migration instead of a dead end.
    this.needsV2 = needsV2;
  }
}
