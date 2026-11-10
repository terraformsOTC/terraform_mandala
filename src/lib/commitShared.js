// The parts of commit.js the commit panel needs before the user starts a
// commit. They live here, free of ethers, so the panel renders without loading
// commit.js; the panel imports commit.js (and ethers with it) on the first click.

export const STATUS_NAMES = ['Terrain', 'Daydream', 'Terraformed', 'Origin Daydream', 'Origin Terraformed'];

// The contract's gate: commitDreamToCanvas requires status % 2 == 1.
export const isDreamingStatus = (status) => Number(status) % 2 === 1;

// Terraformed (2) and Origin Terraformed (4): already committed. enterDream takes
// them back to Daydream (1) / Origin Daydream (3). Terrain (0) is deliberately not
// here: for a Terrain parcel enterDream is a permanent change the site never offers.
export const isTerraformedStatus = (status) => Number(status) === 2 || Number(status) === 4;

export class CommitError extends Error {
  constructor(message, { needsV2 = false, needsDream = false } = {}) {
    super(message);
    // The commit check stopped only because the parcel is not on v2 yet, or is
    // already terraformed and the connected wallet owns it; the panel offers the
    // migration / the return to daydream instead of a dead end.
    this.needsV2 = needsV2;
    this.needsDream = needsDream;
  }
}
