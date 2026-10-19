// Contract addresses, kept free of any ethers import so client components can
// show them without pulling ethers into the page's first-load bundle.

export const TERRAFORMS_ADDRESS = '0x4E1f41613c9084FdB9E34E11fAE9412427480e56';

// v2 renderer contract — called directly to get v2 HTML for any token regardless
// of which renderer index it currently points to on the main contract.
// Address confirmed by reading tokenURIAddresses(2) from the main contract.
export const V2_RENDERER_ADDRESS = '0x8aF860C8F157F4E3B6A54913BFA6Bb96ab2605C2';

// v0 (canonical / legacy) renderer contract. Address from tokenURIAddresses(0)
// — verified via scripts/discover-v0.mjs. Shares the same tokenHTML(status,
// placement, seed, yearsOfDecay, canvasData) ABI as v2.
export const V0_RENDERER_ADDRESS = '0xA5aFC9fE76a28fB12C60954Ed6e2e5f8ceF64Ff2';
