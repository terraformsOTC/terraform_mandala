// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title Terraform grain seals: the on-chain reader for TFS1 seals hidden in a drawing's grain
/// @notice A grain seal is a message, a sealed (encrypted) message, a plain SHA-256 hash, a salted
///         commitment or a committed list,
///         hidden in which cells of a Terraforms parcel's drawing are odd and which are even. The
///         drawing stays as drawn: only cells of a glyph's grain (the random speckle of its ground)
///         were moved, by one height. This contract reads a parcel's stored drawing straight from
///         the Terraforms contract, finds the seal, opens sealed messages with their secret and checks
///         reveals of hashes, commitments and list items, as the reference decoder (seal.js) does. The format is spec(). The date of a seal
///         is its commit transaction's block. Seals written in the digits themselves are read by
///         TerraformSealReader (0xF0ecd91e78E0042C1b81945BC8FFB3E7D0E3B623).
/// @dev    Immutable by design: no owner, no admin, no proxy, no storage, nothing payable. Its only
///         external call is a read of Terraforms' canvas; SHA-256 is the precompile. Everything is
///         view or pure: reading costs nothing through eth_call. Texts are compared as the exact
///         UTF-8 bytes that were sealed (seal.js normalises to Unicode NFC with \n line ends).
interface ITerraforms {
    function tokenToCanvasData(uint256 tokenId, uint256 index) external view returns (uint256);
}

contract TerraformGrainReader {
    ITerraforms public constant TERRAFORMS = ITerraforms(0x4E1f41613c9084FdB9E34E11fAE9412427480e56);
    string public constant version = "TFS1 grain reader 1.0";

    struct Seal {
        bool found;         // false: no grain seal in this drawing
        uint256 size;       // the frame's bytes: 48, 64, 80, 96 or 112
        string kind;        // inscription | sealed | commitment | hash | list
        uint8 modeByte;     // 1 inscription, 2 sealed, 3 commitment, 4 hash, 5 list
        bool fillerIntact;  // false: the frame's filler is not the standard one
        bytes payload;      // the text, ciphertext | tag, the digest, or root | count
        string text;        // an inscription's text; empty for other kinds
    }

    /// The code's order: bit j is the parity of cell PERM[j] (two bytes per entry, big-endian),
    /// derived from SHA-256 as spec() says; the columns C_w of the trellis, 16 bits apart.
    bytes private constant PERM = hex"001003f900f202c7024203250318038e013c034b012500a9014e0324010500ef00020329015f01d303a0003301cf01c902f702c80233009500120310029101f2008700de003b01600344028e034303db01440047003c011500fa0023023001ae03bf039302060028025c0132010f00b301040397002f03ed017201fe0099022e0168015800f1005f00d603b7001a038c01470162016e03a70378014902dc03650389022d00460128036b0018005d03b2024a000400770259013f034500c102a7027f00480211001402c302a3015d001e0210019c01d5006b016c00e800d200690251023d033801b800070030002902a60207014b02cc00320288034903850017016b004903c0001901b00253032b037002af02450320030f039600010352037a03be00f502b302360139006303a9012a00c7033601010072039c02b0015e008f03ae00c5031601d10366007a02ab014d01c701bc021b01c6000f012b035001e600ba01ba02fd031a00f402bb01c3033d024f01b400bf01a40083011303e40205020c01b2000d03f001e701fc03d700970024018400d5024c0108032801a003bd0176025502460138032f01df03b80208036c0088005501be03a10323020102f40137019e00b001f50384010d039f023702e70192037e005a012201e20353020e004a025d011d027200a700ee02b602a1007c02fc02d502f1026702f302b50243015003050364017c022200d9006501c103c201f400dd037b028300c401bf02e2020903300183038703d903e202eb008a033701fd03b602c901ff03f201a6003802ce00270226008b019a026b03dc009e036700ea006a02d602f0029902860062037d01ec028f010b03690174030c03d501dd001d00b402900239000601eb0256006000c302ad03080260038100d00223031c004d001b0086033b009802e8035b006101c5022702da0009034701cb02ef00710124034e030e017b03d8012e0244031b010c03c4030703aa02a2031301480229018203e3004001a300eb03d102fa02150193000a03d301810085035a03eb03e502d403e00111015501b601ca02250103011c031703e6006402f903fb02d301090090012c030601db007002e103d000d40112004503f1013403c7014503c301e8036200fe03cf02ac036102fb00e9024101070074020202ca0059000803270025001601d4021901f30257015901b101c0019b03fa011f03ea00fc01d2034a01f9004c027003a40081002e021e03ac01f602840293035e03b001e0015702e9003d00bb02bd03e1034802d2020d00ad0171038201230399014300d3018002380079002a029803c6023f039a02a9029c03bc01a2021c01750234007d0058016602c60212006c031d013e0240036d01d8000003400321029d036000b800aa035d01ab022b02cb01350278011802c2019d02e6032601100217003a029b034d026d030b02b901670094025003570195007300a4031400b20204025a002d01cc0039035801200351039d02ee039b023e02e3012701360051033c01310221005e02950356015a03f3012d01de008002e000e0005b00820050020300c80275017000a80054026900bd008e02b80303017d0333009300f30374000302c100df01e901160076017700f903d602aa02c002a801ac01f703f603dd00a002ec01d700cb021800cc00ca033a01ad019803730247033102920279014c012f034c007b03de03c5028a021d0117012100e50052017f039e02d80053036f0276013003f5005702cd026f0042006f03a603120266031f02e500bc031503cc03b10277022f03950031017e00ec02ae0102029f01b302a400a302dd028c027a007500fb0129010e0301004f01dc018a01bb008401f800ff006e00e7026401ed01690037039800ed0036003402f201cd00e200b9032a02160371019600af00a200ab033e009d00fd03a2018903b502db0089034201b901c4035f011e027b02ed029e00c6002102d0021a02ff0339033201e4037f0178018801260214038a03ba016d0194009a038f03b90068019902bf0163000503ad03c80368016f014a004401d601aa016100cd03cb000b02d9017300e30026039203ec018f020a0249018500a5003e01d9025803fc01e1026c01bd03da01a50232035901f000110153025e00d7008d0287009b00d800ae00a60096025401a803ce03f70228039400ce037c016a013b023b026500f601c80282022a021f0142037602f5009103ee0311013a02d10067024802fe0309008c01da00c200a1003500b603c1034f018700920294001f035c000e0020030401c20151019700e400e10252024e0391038000cf01a103d400c0024b01a9007f01ee00d103a3023c0022028003a50220011a03e9011b010a0043016503ef03ff018c023102cf038800780372001c029a020b03fd00db032c022402710141030202f601330164014f02b2002c006d011902890319015c023a0346038d005c038b00b101fa01ce018d01ea00e6015b02a5025b030002de02df022c03540390009f03df0263026e02ba00be02b7026202c40015017903fe024d02f800c901e3000c017a032d033501b503cd03af01910152003f02be00b501b7009c03e801560375036303ab01540274020003860041007e02ea01af006600f7021300f8033f02b10106028103d20273033400da032e036e03c9030a002b028b00dc0322037702c50261028501f1027d014602a002e4028d01a700f0037903f402bc03a80056019f00ac03f802d7031e0235026a0355001303b3019003410100027e0383027c004b0186013d01ef036a00b701d0011403e701fb02b4004e02970140026803ca01e5025f020f03b40296018b018e030d03bb";
    uint256 private constant C1 = 1113;
    uint256 private constant C2 = 2041 | 1181 << 16;
    uint256 private constant C3 = 1579 | 1755 << 16 | 1645 << 32;

    /* ===================================================================== reading */

    /// @notice The grain seal in a parcel's stored drawing (found = false if there is none, also
    ///         for a parcel never committed, which has no stored drawing).
    function decode(uint256 tokenId) public view returns (Seal memory s) {
        (bool stored, uint256[16] memory canvas) = _canvas(tokenId);
        if (stored) s = decodeCanvas(canvas);
    }

    /// @notice A grain inscription's text.
    function textOf(uint256 tokenId) external view returns (string memory) {
        Seal memory s = decode(tokenId);
        require(s.found && s.modeByte == 1, "not an inscription");
        return s.text;
    }

    /// @notice Find a grain seal in any drawing given as its 16 numbers (for example from a
    ///         commit transaction).
    function decodeCanvas(uint256[16] memory canvas) public pure returns (Seal memory s) {
        (bool ok, uint256[4] memory cells) = _cellBits(canvas);
        if (!ok) return s;
        uint256[4] memory bits = _codeBits(cells);
        uint256[5] memory sizes = [uint256(48), 64, 80, 96, 112];
        for (uint256 n; n < 5; n++) {
            s = _parse(_frame(bits, sizes[n]));
            if (s.found) {
                s.size = sizes[n];
                return s;
            }
        }
    }

    /* ================================================================= revealing */

    /// @notice Open a parcel's grain-sealed message with its secret, as the site shows it:
    ///         43 characters of base64url. Reverts if the secret does not open this seal.
    function open(uint256 tokenId, string calldata secret) external view returns (string memory) {
        return _open(decode(tokenId), secret);
    }

    /// @notice Open the grain-sealed message in any drawing given as its 16 numbers.
    function openCanvas(uint256[16] memory canvas, string calldata secret) external pure returns (string memory) {
        return _open(decodeCanvas(canvas), secret);
    }

    function _open(Seal memory d, string calldata secret) internal pure returns (string memory) {
        bytes memory sk = _b64url(bytes(secret));
        require(sk.length == 32, "a secret is 43 base64url characters");
        require(d.found && d.modeByte == 2, "not a sealed message");
        return string(_openSealed(d.payload, bytes32(sk)));
    }

    /// Check the tag (HMAC-SHA256 over the frame's first 7 bytes and the ciphertext), then decrypt
    /// with the SHA-256 keystream and drop the zero padding. Reverts unless this secret opens it.
    function _openSealed(bytes memory p, bytes32 secret) internal pure returns (bytes memory) {
        uint256 n = p.length - 32;
        (bytes32 ke, bytes32 km) = _grainKeys(secret);
        bytes memory ct = _slice(p, 0, n);
        bytes memory head = abi.encodePacked(bytes5(0x5446530102), uint8(p.length >> 8), uint8(p.length));
        require(_hmac(km, bytes.concat(head, ct)) == bytes32(_slice(p, n, 32)), "this secret does not open this seal");
        bytes memory plain = new bytes(n);
        uint256 end;
        for (uint256 b; b * 32 < n; b++) {
            bytes32 ks = sha256(abi.encodePacked(ke, uint32(b)));
            for (uint256 j; j < 32 && b * 32 + j < n; j++) {
                bytes1 v = ct[b * 32 + j] ^ ks[j];
                plain[b * 32 + j] = v;
                if (v != 0) end = b * 32 + j + 1;
            }
        }
        return _slice(plain, 0, end);
    }

    /// HKDF-SHA256 (RFC 5869) with no salt and info "terraform-seal/grain-sealed/v1" -> 64 bytes:
    /// Ke (the keystream's key) | Km (the tag's key).
    function _grainKeys(bytes32 secret) internal pure returns (bytes32 ke, bytes32 km) {
        bytes32 prk = _hmac(bytes32(0), abi.encodePacked(secret));
        ke = _hmac(prk, abi.encodePacked("terraform-seal/grain-sealed/v1", uint8(1)));
        km = _hmac(prk, abi.encodePacked(ke, "terraform-seal/grain-sealed/v1", uint8(2)));
    }

    /// HMAC-SHA256 with a key of at most 32 bytes (zero-padded to the 64-byte block).
    function _hmac(bytes32 key, bytes memory m) internal pure returns (bytes32) {
        bytes32 ipad = 0x3636363636363636363636363636363636363636363636363636363636363636;
        bytes32 opad = 0x5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c;
        bytes32 inner = sha256(abi.encodePacked(key ^ ipad, ipad, m));
        return sha256(abi.encodePacked(key ^ opad, opad, inner));
    }

    /// @notice Does this text hash to the parcel's plain SHA-256 seal? (what sha256sum prints)
    function verifyHash(uint256 tokenId, string calldata text) external view returns (bool) {
        return verifyHashBytes(tokenId, bytes(text));
    }

    /// @notice Does this content (a file's bytes) hash to the parcel's plain SHA-256 seal?
    function verifyHashBytes(uint256 tokenId, bytes memory content) public view returns (bool) {
        Seal memory s = decode(tokenId);
        require(s.found && s.modeByte == 4, "not a plain hash seal");
        return sha256(content) == bytes32(s.payload);
    }

    /// @notice Does this text and salt (32 hex characters, as the site shows it) open the
    ///         parcel's salted commitment?
    function verifyCommitment(uint256 tokenId, string calldata text, string calldata salt) external view returns (bool) {
        bytes memory sl = _hex(bytes(salt));
        require(sl.length == 16, "a salt is 32 hex characters");
        return verifyCommitmentBytes(tokenId, bytes(text), bytes16(sl));
    }

    /// @notice Does this content and 16-byte salt open the parcel's salted commitment?
    function verifyCommitmentBytes(uint256 tokenId, bytes memory content, bytes16 salt) public view returns (bool) {
        Seal memory s = decode(tokenId);
        require(s.found && s.modeByte == 3, "not a commitment seal");
        return sha256(abi.encodePacked("terraform-seal/commit/v1", uint8(0), salt, content)) == bytes32(s.payload);
    }

    /// @notice Is this revealed item (its tfs1:… token, as the site shows it) in the parcel's
    ///         list commitment? Returns whether it is, the item's index and its text.
    function verifyListItem(uint256 tokenId, string calldata token)
        external view returns (bool ok, uint256 index, string memory text)
    {
        bytes16 salt;
        bytes memory content;
        bytes32[] memory path;
        (index, salt, content, path) = _parseToken(bytes(token));
        ok = _verifyItem(decode(tokenId), index, salt, content, path);
        text = string(content);
    }

    /// Is item `index` (its salt, content and audit path) in this list commitment?
    function _verifyItem(Seal memory s, uint256 index, bytes16 salt, bytes memory content, bytes32[] memory path)
        internal pure returns (bool)
    {
        require(s.found && s.modeByte == 5, "not a list seal");
        uint256 count = (uint256(uint8(s.payload[32])) << 8) | uint8(s.payload[33]);
        if (index >= count) return false;
        (uint256 depth, uint256 sides) = _shape(index, count);
        if (depth != path.length) return false;
        bytes32 leaf = sha256(abi.encodePacked(uint8(0), "terraform-seal/list/v1", salt, content));
        return _root(leaf, path, sides) == bytes32(_slice(s.payload, 0, 32));
    }

    /// RFC 6962 shape of item `index` among `count`: at each level the split is the largest
    /// power of two below the size. Bit d of `sides` is set when, at depth d from the top, the
    /// item is in the left part (its sibling is on the right).
    function _shape(uint256 index, uint256 count) internal pure returns (uint256 depth, uint256 sides) {
        uint256 size = count;
        while (size > 1) {
            uint256 k = 1;
            while (k * 2 < size) k *= 2;
            if (index < k) {
                sides |= (1 << depth);
                size = k;
            } else {
                index -= k;
                size -= k;
            }
            depth++;
        }
    }

    /// Hash a leaf up its audit path (path[0] is the sibling nearest the leaf).
    function _root(bytes32 h, bytes32[] memory path, uint256 sides) internal pure returns (bytes32) {
        uint256 depth = path.length;
        for (uint256 j; j < depth; j++) {
            h = (sides >> (depth - 1 - j)) & 1 == 1
                ? sha256(abi.encodePacked(uint8(1), h, path[j]))
                : sha256(abi.encodePacked(uint8(1), path[j], h));
        }
        return h;
    }

    /* ====================================================================== format */

    /// @notice The format, in full.
    function spec() external pure returns (string memory) {
        return "TFS1 grain seals, version 1. A Terraforms drawing is 1024 digits, 32 rows of 32; Terraforms stores them as 16 numbers of 64 decimal digits, two rows each, top-left first. Each cell c (row by row) gives one bit, its digit's parity (odd = 1). Bit j of the code is cell P[j]'s: P orders 0..1023 by the 64-bit big-endian numbers in bytes 8c..8c+7 of R(\"perm\") (ties by c), where R(label) = SHA-256(T | \"|\" | label | uint32 0) | SHA-256(T | \"|\" | label | uint32 1) | ... and T = \"terraform-seal/grain/v1\". For S = 48, 64, 80, 96, 112 bytes in turn: k = 10 + 8S trellis rows, w_i = floor((i+1)*1024/k) - floor(i*1024/k), state = 0; for i = 0 .. k-1: for t = 0 .. w_i - 1: if the next code bit is 1, state ^= C_w[t] & (2^min(11, k-i) - 1); then if i >= 10, frame bit i-10 = state & 1 (most significant bit of each byte first); state >>= 1. C_w[t] = (bytes 4t..4t+3 of R(\"hhat\" w), big-endian, & 2047) | 1 | 1024 for w = 1, 2, 3. The frame is a TFS1 frame: 'TFS' | 0x01 | mode (1 inscription, 2 sealed, 3 commitment, 4 hash, 5 list; no flags) | payload length (2 bytes, big-endian) | payload | check (first 4 bytes of SHA-256 of all before) | filler SHA-256(check | \"fill\" | uint32 i), i = 0, 1, ..., cut to S bytes. The first S whose magic, version, mode, length and check hold (fixed sizes 32, 32, 34; a sealed payload at least 33 bytes) is the seal. Sealed (made for the grain; the digits use AES-GCM): a secret s of 32 random bytes (shown as 43 base64url characters); HKDF-SHA256(s, no salt, info \"terraform-seal/grain-sealed/v1\") gives 64 bytes Ke | Km. The payload fills the frame: ciphertext (S - 43 bytes) | tag (32). The plaintext is the text (UTF-8, no zero byte) followed by zero bytes; ciphertext = plaintext XOR (SHA-256(Ke | uint32 0) | SHA-256(Ke | uint32 1) | ...); tag = HMAC-SHA256(Km, the frame's first 7 bytes | ciphertext). open() checks the tag, decrypts and drops the trailing zeros. The tag binds the text to its one secret: no other secret opens it, so its author cannot choose between two messages later; the length is hidden within the frame size. Payloads: inscription = the text, UTF-8 (Unicode NFC, \\n line ends), never compressed; hash = SHA-256(content); commitment = SHA-256(\"terraform-seal/commit/v1\" | 0x00 | salt (16 bytes) | content); list = root (32) | count (2, 1 to 256) of a Merkle tree split at the largest power of two below the size, leaf SHA-256(0x00 | \"terraform-seal/list/v1\" | salt (16) | text), node SHA-256(0x01 | left | right); an item is revealed as tfs1:<index>:<base64url(salt | text)>:<audit path, 64 hex characters each, joined by \".\">. open(parcel, secret) and openCanvas(16 numbers, secret) open a sealed message. An encoder (seal.js, terraformmandala.xyz) hides the frame by moving the fewest cells of a glyph's grain by one height (the Viterbi algorithm on the trellis); every other cell keeps its digit, and nothing is needed to read it but the drawing. Seals written in the digits themselves are read by TerraformSealReader, 0xF0ecd91e78E0042C1b81945BC8FFB3E7D0E3B623.";
    }

    /* ================================================================= internals */

    /// Terraforms keeps a committed drawing as 16 numbers and nothing for a parcel never
    /// committed, whose getter then reverts. A read that fails with gas to spare is that refusal;
    /// one that fails having used all it was given (63/64 of ours) is our gas running out, which
    /// reverts here rather than pass for "no drawing".
    function _canvas(uint256 tokenId) internal view returns (bool stored, uint256[16] memory canvas) {
        for (uint256 i; i < 16; i++) {
            uint256 g = gasleft();
            (bool ok, bytes memory r) = address(TERRAFORMS).staticcall(abi.encodeCall(ITerraforms.tokenToCanvasData, (tokenId, i)));
            if (!ok || r.length != 32) {
                require(gasleft() > g / 63, "out of gas");
                return (false, canvas);
            }
            canvas[i] = abi.decode(r, (uint256));
        }
        stored = true;
    }

    /// The parities of the 1024 cells (bit c of the bitmap: cell c, row by row), from the 16
    /// numbers of 64 digits; false if a number has more than 64 digits.
    function _cellBits(uint256[16] memory canvas) internal pure returns (bool, uint256[4] memory cells) {
        unchecked {
            for (uint256 i; i < 16; i++) {
                uint256 v = canvas[i];
                uint256 acc;
                for (uint256 d = 64; d > 0; d--) {
                    acc |= ((v % 10) & 1) << ((i * 64 + d - 1) & 255);
                    v /= 10;
                }
                if (v != 0) return (false, cells);
                cells[i >> 2] |= acc;
            }
        }
        return (true, cells);
    }

    /// The code's bits: bit j is cell PERM[j]'s parity.
    function _codeBits(uint256[4] memory cells) internal pure returns (uint256[4] memory bits) {
        bytes memory p = PERM;
        unchecked {
            uint256 word;
            for (uint256 j; j < 1024; j++) {
                uint256 c = (uint256(uint8(p[2 * j])) << 8) | uint8(p[2 * j + 1]);
                word |= ((cells[c >> 8] >> (c & 255)) & 1) << (j & 255);
                if (j & 255 == 255) {
                    bits[j >> 8] = word;
                    word = 0;
                }
            }
        }
    }

    /// The S-byte frame the code gives: k = 10 + 8S trellis rows, the first 10 carrying nothing.
    function _frame(uint256[4] memory bits, uint256 size) internal pure returns (bytes memory out) {
        out = new bytes(size);
        unchecked {
            uint256 k = 10 + 8 * size;
            uint256 state;
            uint256 j;       // the next code bit
            uint256 word;    // bits[j >> 8], shifted so that bit j is its lowest
            uint256 prev;    // floor(i * 1024 / k)
            uint256 acc;     // the frame byte being built
            for (uint256 i; i < k; i++) {
                uint256 next = ((i + 1) * 1024) / k;
                uint256 w = next - prev;
                prev = next;
                uint256 m = k - i >= 11 ? 2047 : (1 << (k - i)) - 1;
                uint256 cols = w == 1 ? C1 : (w == 2 ? C2 : C3);
                for (uint256 t; t < w; t++) {
                    if (j & 255 == 0) word = bits[j >> 8];
                    if (word & 1 == 1) state ^= (cols >> (16 * t)) & m;
                    word >>= 1;
                    j++;
                }
                if (i >= 10) {
                    acc = (acc << 1) | (state & 1);
                    if ((i - 10) & 7 == 7) {
                        out[(i - 10) >> 3] = bytes1(uint8(acc));
                        acc = 0;
                    }
                }
                state >>= 1;
            }
        }
    }

    /// Magic, version, mode (exactly 1 to 5), length, check, fixed sizes, list count.
    function _parse(bytes memory b) internal pure returns (Seal memory s) {
        if (b[0] != 0x54 || b[1] != 0x46 || b[2] != 0x53 || b[3] != 0x01) return s;
        uint8 mb = uint8(b[4]);
        if (mb < 1 || mb > 5) return s;
        uint256 len = (uint256(uint8(b[5])) << 8) | uint8(b[6]);
        if (11 + len > b.length) return s;
        bytes4 check = bytes4(sha256(_slice(b, 0, 7 + len)));
        if (check != bytes4(bytes.concat(b[7 + len], b[8 + len], b[9 + len], b[10 + len]))) return s;
        bytes memory payload = _slice(b, 7, len);
        if ((mb == 3 || mb == 4) && len != 32) return s;
        if (mb == 2 && len < 33) return s;
        if (mb == 5) {
            if (len != 34) return s;
            uint256 count = (uint256(uint8(payload[32])) << 8) | uint8(payload[33]);
            if (count < 1 || count > 256) return s;
        }
        s.found = true;
        s.kind = mb == 1 ? "inscription" : mb == 2 ? "sealed" : mb == 3 ? "commitment" : mb == 4 ? "hash" : "list";
        s.modeByte = mb;
        s.payload = payload;
        if (mb == 1) s.text = string(payload);
        s.fillerIntact = _fillerIntact(b, check, 11 + len);
    }

    /// The bytes from `o` on are the filler SHA-256(check | "fill" | uint32 i), i = 0, 1, ...
    function _fillerIntact(bytes memory b, bytes4 check, uint256 o) internal pure returns (bool) {
        for (uint32 i; o < b.length; i++) {
            bytes32 blk = sha256(abi.encodePacked(check, "fill", i));
            for (uint256 j; j < 32 && o < b.length; j++) {
                if (b[o++] != blk[j]) return false;
            }
        }
        return true;
    }

    function _slice(bytes memory b, uint256 start, uint256 len) internal pure returns (bytes memory out) {
        out = new bytes(len);
        for (uint256 i; i < len; i++) out[i] = b[start + i];
    }

    /* ---------------------------------------------------------- text helpers */

    /// A list item's reveal token: tfs1:<index>:<base64url(salt | text)>:<path, hex, joined by .>
    function _parseToken(bytes memory t)
        internal pure returns (uint256 index, bytes16 salt, bytes memory content, bytes32[] memory path)
    {
        require(
            t.length > 5 && (t[0] | 0x20) == "t" && (t[1] | 0x20) == "f" && (t[2] | 0x20) == "s" && t[3] == "1" && t[4] == ":",
            "not an item reveal (tfs1:...)"
        );
        uint256 a = _colon(t, 5);
        uint256 b = _colon(t, a + 1);
        index = _uint(t, 5, a);
        bytes memory body = _b64url(_slice(t, a + 1, b - a - 1));
        require(body.length >= 16, "item reveal too short");
        salt = bytes16(_slice(body, 0, 16));
        content = _slice(body, 16, body.length - 16);
        path = _path(t, b + 1);
    }

    function _colon(bytes memory t, uint256 from) internal pure returns (uint256) {
        for (uint256 i = from; i < t.length; i++) if (t[i] == ":") return i;
        revert("bad item reveal");
    }

    function _uint(bytes memory t, uint256 from, uint256 to) internal pure returns (uint256 v) {
        require(to > from && to - from < 10, "bad item index");
        for (uint256 i = from; i < to; i++) {
            require(t[i] >= "0" && t[i] <= "9", "bad item index");
            v = v * 10 + (uint8(t[i]) - 48);
        }
    }

    /// Audit path: 64-hex-character hashes joined by '.', possibly none.
    function _path(bytes memory t, uint256 from) internal pure returns (bytes32[] memory path) {
        uint256 rest = t.length - from;
        if (rest == 0) return path;
        require((rest + 1) % 65 == 0, "bad audit path");
        path = new bytes32[]((rest + 1) / 65);
        for (uint256 k; k < path.length; k++) {
            uint256 at = from + 65 * k;
            if (k > 0) require(t[at - 1] == ".", "bad audit path");
            path[k] = bytes32(_hex(_slice(t, at, 64)));
        }
    }

    /// Hex (no 0x), even length; reverts on any other character.
    function _hex(bytes memory t) internal pure returns (bytes memory out) {
        require(t.length % 2 == 0, "odd hex length");
        out = new bytes(t.length / 2);
        for (uint256 i; i < out.length; i++) out[i] = bytes1(uint8((_nib(t[2 * i]) << 4) | _nib(t[2 * i + 1])));
    }

    function _nib(bytes1 b) internal pure returns (uint256) {
        uint8 c = uint8(b);
        if (c >= 48 && c <= 57) return c - 48;
        if (c >= 97 && c <= 102) return c - 87;
        if (c >= 65 && c <= 70) return c - 55;
        revert("not hex");
    }

    /// base64url without padding (A-Z a-z 0-9 - _); reverts on any other character.
    function _b64url(bytes memory t) internal pure returns (bytes memory out) {
        out = new bytes((t.length * 6) / 8);
        uint256 acc;
        uint256 bits;
        uint256 o;
        for (uint256 i; i < t.length; i++) {
            uint8 c = uint8(t[i]);
            uint256 v;
            if (c >= 65 && c <= 90) v = c - 65;
            else if (c >= 97 && c <= 122) v = c - 71;
            else if (c >= 48 && c <= 57) v = c + 4;
            else if (c == 45) v = 62;
            else if (c == 95) v = 63;
            else revert("not base64url");
            acc = (acc << 6) | v;
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                out[o++] = bytes1(uint8(acc >> bits));
                acc &= (1 << bits) - 1;
            }
        }
    }
}
