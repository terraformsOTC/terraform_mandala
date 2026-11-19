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
  constructor(message, { migrateTo = null, needsDream = false, showRenderer = null } = {}) {
    super(message);
    // The commit check stopped only because the parcel renders with another renderer
    // than the preview, or is already terraformed and the connected wallet owns it;
    // the panel offers the switch of renderer (`migrateTo`: 'v2', or 'v0' since
    // 2026-11-17) / the preview in the parcel's renderer (`showRenderer`, 'v0' | 'v2')
    // / the return to daydream instead of a dead end.
    this.migrateTo = migrateTo;
    this.needsDream = needsDream;
    this.showRenderer = showRenderer;
  }

  // The offer of the migration to v2, as read before the switch back to v0 existed.
  get needsV2() {
    return this.migrateTo === 'v2';
  }
}
