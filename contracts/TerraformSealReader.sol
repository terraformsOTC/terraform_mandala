// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title Terraform Seals: the on-chain reader for TFS1 seals in Terraforms drawings
/// @notice A seal is a message, a sealed (encrypted) message, a commitment, a plain SHA-256
///         hash or a committed list, written into the 1,024 digits of a Terraforms parcel's
///         drawing. This contract reads a parcel's stored drawing straight from the Terraforms
///         contract and does everything the reference decoder (seal.js) does: decodes the seal,
///         reads inscriptions (inflating DEFLATE), opens sealed messages with their secret
///         (HKDF-SHA256 + AES-256-GCM), checks reveals of hashes, commitments and list items,
///         and encodes payloads into the 16 numbers commitDreamToCanvas takes. The format is
///         spec(). The date of a seal is its commit transaction's block.
/// @dev    Immutable by design: no owner, no admin, no proxy, no storage, nothing payable. Its
///         only external call is a read of Terraforms' canvas; SHA-256 is the precompile.
///         Everything is view or pure: reading costs nothing through eth_call.
///         Texts are compared as the exact UTF-8 bytes that were sealed (seal.js normalises
///         to Unicode NFC with \n line ends before sealing).
interface ITerraforms {
    function tokenToCanvasData(uint256 tokenId, uint256 index) external view returns (uint256);
}

contract TerraformSealReader {
    ITerraforms public constant TERRAFORMS = ITerraforms(0x4E1f41613c9084FdB9E34E11fAE9412427480e56);
    string public constant version = "TFS1 reader 1.0";
    /// @notice The most bytes an inflated text may have here (seal.js compresses only texts up to this).
    uint256 public constant MAX_INFLATED = 65536;

    struct Seal {
        bool found;         // false: no seal in this drawing
        string layout;      // eighth | quarter | pinwheel | mirror | rotation | plain
        string kind;        // inscription | sealed | commitment | hash | list
        uint8 modeByte;     // low 4 bits the kind (1-5), bit 7 the text is DEFLATE'd
        bool compressed;
        bool fillerIntact;  // false: a digit outside the message was changed
        bytes payload;      // the text, digest, root | count, or commitment | ciphertext | tag
        string text;        // an inscription's text (inflated); empty for other kinds
    }

    uint256 private constant LIMBS = 28;   // little-endian base 2^128 limbs: room for 1024 digits
    uint256 private constant MASK128 = type(uint128).max;
    uint256 private constant TEN38 = 1e38;

    /* ===================================================================== reading */

    /// @notice The seal in a parcel's stored drawing (found = false if there is none, also for a
    ///         parcel never committed, which has no stored drawing).
    function decode(uint256 tokenId) public view returns (Seal memory s) {
        (bool stored, uint256[16] memory canvas) = _canvas(tokenId);
        if (stored) s = decodeCanvas(canvas);
    }

    /// @notice An inscription's text, inflated if it was compressed.
    function textOf(uint256 tokenId) external view returns (string memory) {
        Seal memory s = decode(tokenId);
        require(s.found && (s.modeByte & 0x0f) == 1, "not an inscription");
        return s.text;
    }

    /// @notice A parcel's stored drawing: the 16 numbers the Terraforms contract keeps.
    ///         Reverts for a parcel never committed: Terraforms keeps no drawing for it.
    function canvasOf(uint256 tokenId) public view returns (uint256[16] memory canvas) {
        bool stored;
        (stored, canvas) = _canvas(tokenId);
        require(stored, "no stored drawing");
    }

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

    /// @notice A parcel's stored drawing as 1,024 digits, row by row.
    function heightmapOf(uint256 tokenId) external view returns (string memory) {
        (bool ok, bytes memory hm) = _digitsOf(canvasOf(tokenId));
        require(ok, "not a 64-digit canvas");
        for (uint256 i; i < 1024; i++) hm[i] = bytes1(uint8(hm[i]) + 48);
        return string(hm);
    }

    /// @notice Decode any drawing given as its 16 numbers (for example from a commit transaction).
    function decodeCanvas(uint256[16] memory canvas) public pure returns (Seal memory s) {
        (bool ok, bytes memory hm) = _digitsOf(canvas);
        if (!ok) return s;
        for (uint256 l; l < 6; l++) {
            if (!_symmetric(hm, l)) continue;
            (bool fits, bytes memory b) = _bytesOf(hm, l);
            if (!fits) continue;
            s = _parse(b);
            if (s.found) {
                s.layout = _layoutName(l);
                return s;
            }
        }
    }

    /* ================================================================= revealing */

    /// @notice Open a parcel's sealed message with its secret, as the site shows it:
    ///         43 characters of base64url. Reverts if the secret does not open this seal.
    function open(uint256 tokenId, string calldata secret) external view returns (string memory) {
        bytes memory s = _b64url(bytes(secret));
        require(s.length == 32, "a secret is 43 base64url characters");
        Seal memory d = decode(tokenId);
        require(d.found && (d.modeByte & 0x0f) == 2, "not a sealed message");
        return string(_openSealed(d.payload, d.modeByte, bytes32(s)));
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

    /* ================================================================== encoding */

    /// @notice The 16 numbers for Terraforms' commitDreamToCanvas that hold a plain SHA-256
    ///         seal of this text. layout: 0 eighth, 1 quarter, 2 pinwheel, 3 mirror, 4 rotation,
    ///         5 plain.
    function encodeHash(string calldata text, uint256 layout) external pure returns (uint256[16] memory) {
        return encode(4, layout, abi.encodePacked(sha256(bytes(text))));
    }

    /// @notice The 16 numbers holding this text as an inscription (stored as is, not compressed).
    function encodeInscription(string calldata text, uint256 layout) external pure returns (uint256[16] memory) {
        return encode(1, layout, bytes(text));
    }

    /// @notice The 16 numbers holding a finished payload: the text (inscription), the digest
    ///         (hash, commitment), root | count (list), or commitment | ciphertext | tag (sealed).
    ///         Secrets and salts are used before this step, so they never reach the chain.
    ///         Reverts unless the result decodes (so nothing undecodable can be committed).
    function encode(uint8 modeByte, uint256 layout, bytes memory payload) public pure returns (uint256[16] memory canvas) {
        require(layout < 6, "layout is 0-5");
        require(11 + payload.length <= _capacity(layout), "too long for this layout");
        bytes memory frame = _frame(modeByte, payload, _capacity(layout));
        // only what decodes: the kind, reserved bits, sizes and any DEFLATE data are checked here
        require(_parse(frame).found, "this payload would not decode");
        bytes memory grid = _place(_decimal(frame, _digitCount(layout)), layout);
        for (uint256 i; i < 16; i++) {
            uint256 v;
            for (uint256 j; j < 64; j++) v = v * 10 + uint8(grid[i * 64 + j]);
            canvas[i] = v;
        }
    }

    /// 'TFS' | 1 | mode | length | payload | check | filler, B bytes in all.
    function _frame(uint8 modeByte, bytes memory payload, uint256 B) internal pure returns (bytes memory frame) {
        bytes memory body = abi.encodePacked(bytes3("TFS"), uint8(1), modeByte, uint16(payload.length), payload);
        bytes4 check = bytes4(sha256(body));
        frame = new bytes(B);
        uint256 o;
        for (; o < body.length; o++) frame[o] = body[o];
        for (uint256 j; j < 4; j++) frame[o++] = check[j];
        for (uint32 i; o < B; i++) {
            bytes32 blk = sha256(abi.encodePacked(check, "fill", i));
            for (uint256 j; j < 32 && o < B; j++) frame[o++] = blk[j];
        }
    }

    /* ====================================================================== spec */

    /// @notice The TFS1 format, in full.
    function spec() external pure returns (string memory) {
        return "TFS1. A heightmap is 1024 digits, 32 rows of 32; Terraforms stores them as 16 numbers of 64 decimal digits, two rows each, top-left first. A seal's bytes: 'TFS' | 0x01 | mode (low 4 bits 1 inscription, 2 sealed, 3 commitment, 4 hash, 5 list; bit 7 the text is raw DEFLATE; bits 4-6 zero) | payload length (2 bytes, big-endian) | payload | check (first 4 bytes of SHA-256 of all before it) | filler SHA-256(check | 'fill' | uint32 i), i = 0, 1, ..., to the layout's capacity. These bytes, as one big-endian number in decimal zero-padded to the layout's digits, fill its cells row by row; every other cell repeats one: plain 1024 digits/425 bytes, every cell; mirror 512/212, columns 0-15, column 31-c repeats c; rotation 512/212, rows 0-15, (31-r,31-c) repeats (r,c); quarter 256/106, rows and columns 0-15, mirrored left-right and top-bottom; pinwheel 256/106, that quarter repeated at (c,31-r), (31-r,31-c), (31-c,r); eighth 136/56, the quarter's cells with column >= row, mirrored across its diagonal, then as quarter. Decoders try eighth, quarter, pinwheel, mirror, rotation, plain. Payloads: inscription = the text; hash = SHA-256(content); commitment = SHA-256('terraform-seal/commit/v1' | 0x00 | salt (16) | content); list = root | count (2): an RFC 6962 Merkle tree, leaf SHA-256(0x00 | 'terraform-seal/list/v1' | salt (16) | text), node SHA-256(0x01 | left | right); sealed: HKDF-SHA256(secret (32), no salt, info 'terraform-seal/sealed/v1') gives an AES-256 key (32), a nonce (12) and a commitment (32); payload = commitment | AES-256-GCM ciphertext and 16-byte tag of length (2) | text | zeros to the layout's capacity, with the frame's first 7 bytes as additional data. Texts are UTF-8, Unicode NFC, \\n line ends, DEFLATE'd when shorter (inflating to at most 64 KiB).";
    }

    /* ================================================================= internals */

    function _layoutName(uint256 l) internal pure returns (string memory) {
        if (l == 0) return "eighth";
        if (l == 1) return "quarter";
        if (l == 2) return "pinwheel";
        if (l == 3) return "mirror";
        if (l == 4) return "rotation";
        return "plain";
    }

    function _digitCount(uint256 l) internal pure returns (uint256) {
        if (l == 0) return 136;
        if (l <= 2) return 256;
        if (l <= 4) return 512;
        return 1024;
    }

    function _capacity(uint256 l) internal pure returns (uint256) {
        if (l == 0) return 56;
        if (l <= 2) return 106;
        if (l <= 4) return 212;
        return 425;
    }

    function _inDomain(uint256 l, uint256 r, uint256 c) internal pure returns (bool) {
        if (l == 5) return true;
        if (l == 3) return c < 16;
        if (l == 4) return r < 16;
        if (l == 0) return r < 16 && c < 16 && c >= r;
        return r < 16 && c < 16;
    }

    /// 1,024 digit values (0-9) from the 16 numbers; false if a number has more than 64 digits.
    function _digitsOf(uint256[16] memory canvas) internal pure returns (bool, bytes memory hm) {
        hm = new bytes(1024);
        for (uint256 i; i < 16; i++) {
            uint256 v = canvas[i];
            for (uint256 j = 64; j > 0; j--) {
                hm[i * 64 + j - 1] = bytes1(uint8(v % 10));
                v /= 10;
            }
            if (v != 0) return (false, hm);
        }
        return (true, hm);
    }

    /// Every cell equals its images under the layout's symmetry (checked on its generators).
    function _symmetric(bytes memory hm, uint256 l) internal pure returns (bool) {
        if (l == 5) return true;
        for (uint256 r; r < 32; r++) {
            for (uint256 c; c < 32; c++) {
                bytes1 v = hm[r * 32 + c];
                if (l == 3) {
                    if (v != hm[r * 32 + 31 - c]) return false;
                } else if (l == 4) {
                    if (v != hm[(31 - r) * 32 + 31 - c]) return false;
                } else if (l == 2) {
                    if (v != hm[c * 32 + 31 - r]) return false;
                } else {
                    if (v != hm[r * 32 + 31 - c] || v != hm[(31 - r) * 32 + c]) return false;
                    if (l == 0 && v != hm[c * 32 + r]) return false;
                }
            }
        }
        return true;
    }

    /// The layout's digits, row by row, as one number, as its B bytes (false if it is too big).
    function _bytesOf(bytes memory hm, uint256 l) internal pure returns (bool, bytes memory out) {
        uint256[LIMBS] memory n;
        uint256 chunk;
        uint256 mult = 1;
        for (uint256 r; r < 32; r++) {
            for (uint256 c; c < 32; c++) {
                if (!_inDomain(l, r, c)) continue;
                chunk = chunk * 10 + uint8(hm[r * 32 + c]);
                mult *= 10;
                if (mult == TEN38) {
                    _mulAdd(n, mult, chunk);
                    chunk = 0;
                    mult = 1;
                }
            }
        }
        if (mult > 1) _mulAdd(n, mult, chunk);
        uint256 B = _capacity(l);
        uint256 bits = 8 * B;
        for (uint256 k; k < LIMBS; k++) {
            uint256 lo = 128 * k;
            if (lo >= bits) {
                if (n[k] != 0) return (false, out);
            } else if (lo + 128 > bits && (n[k] >> (bits - lo)) != 0) {
                return (false, out);
            }
        }
        out = new bytes(B);
        for (uint256 b; b < B; b++) {
            uint256 pos = (B - 1 - b) * 8;
            out[b] = bytes1(uint8(n[pos / 128] >> (pos % 128)));
        }
        return (true, out);
    }

    function _mulAdd(uint256[LIMBS] memory n, uint256 m, uint256 a) internal pure {
        uint256 carry = a;
        for (uint256 k; k < LIMBS; k++) {
            uint256 t = n[k] * m + carry;
            n[k] = t & MASK128;
            carry = t >> 128;
        }
        require(carry == 0, "overflow");
    }

    /// Magic, version, kind, reserved bits, length, check, fixed sizes, filler: as seal.js.
    function _parse(bytes memory b) internal pure returns (Seal memory s) {
        if (b[0] != 0x54 || b[1] != 0x46 || b[2] != 0x53 || b[3] != 0x01) return s;
        uint8 mb = uint8(b[4]);
        uint8 kind = mb & 0x0f;
        if (kind < 1 || kind > 5 || (mb & 0x70) != 0) return s;
        bool compressed = (mb & 0x80) != 0;
        if (compressed && kind != 1 && kind != 2) return s;
        uint256 len = (uint256(uint8(b[5])) << 8) | uint8(b[6]);
        if (11 + len > b.length) return s;
        bytes4 check = bytes4(sha256(_slice(b, 0, 7 + len)));
        if (check != bytes4(bytes.concat(b[7 + len], b[8 + len], b[9 + len], b[10 + len]))) return s;
        bytes memory payload = _slice(b, 7, len);
        if ((kind == 3 || kind == 4) && len != 32) return s;
        if (kind == 5) {
            if (len != 34) return s;
            uint256 count = (uint256(uint8(payload[32])) << 8) | uint8(payload[33]);
            if (count < 1 || count > 256) return s;
        }
        s.found = true;
        s.kind = kind == 1 ? "inscription" : kind == 2 ? "sealed" : kind == 3 ? "commitment" : kind == 4 ? "hash" : "list";
        s.modeByte = mb;
        s.compressed = compressed;
        s.payload = payload;
        if (kind == 1) s.text = string(compressed ? _inflate(payload) : payload);
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

    /// The frame's bytes as one number, in decimal, zero-padded to D digit values.
    function _decimal(bytes memory frame, uint256 D) internal pure returns (bytes memory ds) {
        uint256[LIMBS] memory n;
        uint256 B = frame.length;
        for (uint256 b; b < B; b++) {
            uint256 pos = (B - 1 - b) * 8;
            n[pos / 128] |= uint256(uint8(frame[b])) << (pos % 128);
        }
        ds = new bytes(D);
        uint256 filled;
        while (filled < D) {
            uint256 rem;
            for (uint256 k = LIMBS; k > 0; k--) {
                uint256 cur = (rem << 128) | n[k - 1];
                n[k - 1] = cur / TEN38;
                rem = cur % TEN38;
            }
            for (uint256 j; j < 38 && filled < D; j++) {
                ds[D - 1 - filled] = bytes1(uint8(rem % 10));
                rem /= 10;
                filled++;
            }
        }
    }

    /// Write the digits into the layout's cells and their images.
    function _place(bytes memory ds, uint256 l) internal pure returns (bytes memory g) {
        g = new bytes(1024);
        uint256 i;
        for (uint256 r; r < 32; r++) {
            for (uint256 c; c < 32; c++) {
                if (!_inDomain(l, r, c)) continue;
                bytes1 d = ds[i++];
                g[r * 32 + c] = d;
                if (l == 3) {
                    g[r * 32 + 31 - c] = d;
                } else if (l == 4) {
                    g[(31 - r) * 32 + 31 - c] = d;
                } else if (l == 2) {
                    g[c * 32 + 31 - r] = d;
                    g[(31 - r) * 32 + 31 - c] = d;
                    g[(31 - c) * 32 + r] = d;
                } else if (l != 5) {
                    g[r * 32 + 31 - c] = d;
                    g[(31 - r) * 32 + c] = d;
                    g[(31 - r) * 32 + 31 - c] = d;
                    if (l == 0) {
                        g[c * 32 + r] = d;
                        g[c * 32 + 31 - r] = d;
                        g[(31 - c) * 32 + r] = d;
                        g[(31 - c) * 32 + 31 - r] = d;
                    }
                }
            }
        }
    }

    function _slice(bytes memory b, uint256 start, uint256 len) internal pure returns (bytes memory out) {
        out = new bytes(len);
        for (uint256 i; i < len; i++) out[i] = b[start + i];
    }

    /* ---------------------------------------------------------- sealed messages */

    /// Check the key commitment, then AES-256-GCM-decrypt and authenticate; strip the padding,
    /// inflate if the text was compressed. Reverts unless this secret opens this seal.
    function _openSealed(bytes memory p, uint8 modeByte, bytes32 secret) internal pure returns (bytes memory) {
        require(p.length >= 32 + 2 + 16, "malformed sealed message");
        (bytes32 key, bytes12 nonce, bytes32 commitment) = _sealedKeys(secret);
        require(commitment == bytes32(_slice(p, 0, 32)), "this secret does not open this seal");
        bytes memory plain = _gcmDecrypt(
            key, nonce, abi.encodePacked(bytes3("TFS"), uint8(1), modeByte, uint16(p.length)),
            _slice(p, 32, p.length - 48), bytes16(_slice(p, p.length - 16, 16))
        );
        uint256 len = (uint256(uint8(plain[0])) << 8) | uint8(plain[1]);
        require(len <= plain.length - 2, "malformed sealed message");
        bytes memory data = _slice(plain, 2, len);
        return (modeByte & 0x80) != 0 ? _inflate(data) : data;
    }

    /// HKDF-SHA256 (RFC 5869) with no salt and info "terraform-seal/sealed/v1" -> 76 bytes:
    /// key (32) | nonce (12) | commitment (32).
    function _sealedKeys(bytes32 secret) internal pure returns (bytes32 key, bytes12 nonce, bytes32 commitment) {
        bytes32 prk = _hmac(bytes32(0), abi.encodePacked(secret));
        bytes32 t1 = _hmac(prk, abi.encodePacked("terraform-seal/sealed/v1", uint8(1)));
        bytes32 t2 = _hmac(prk, abi.encodePacked(t1, "terraform-seal/sealed/v1", uint8(2)));
        bytes32 t3 = _hmac(prk, abi.encodePacked(t2, "terraform-seal/sealed/v1", uint8(3)));
        key = t1;
        nonce = bytes12(t2);
        commitment = (t2 << 96) | (t3 >> 160);
    }

    /// HMAC-SHA256 with a key of at most 32 bytes (zero-padded to the 64-byte block).
    function _hmac(bytes32 key, bytes memory m) internal pure returns (bytes32) {
        bytes32 ipad = 0x3636363636363636363636363636363636363636363636363636363636363636;
        bytes32 opad = 0x5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c;
        bytes32 inner = sha256(abi.encodePacked(key ^ ipad, ipad, m));
        return sha256(abi.encodePacked(key ^ opad, opad, inner));
    }

    /// AES-256-GCM decryption (NIST SP 800-38D) with a 96-bit nonce and a 128-bit tag.
    function _gcmDecrypt(bytes32 key, bytes12 nonce, bytes memory aad, bytes memory ct, bytes16 tag)
        internal pure returns (bytes memory pt)
    {
        uint256[60] memory w = _expandKey(key);
        bytes memory sb = _sboxBytes();
        uint256 j0 = (uint256(uint96(nonce)) << 32) | 1;
        require(_tag(w, sb, j0, aad, ct) == tag, "this secret does not open this seal");
        pt = new bytes(ct.length);
        for (uint256 i; i * 16 < ct.length; i++) {
            // counter blocks start at inc32(J0); J0's last word is 1, so block i uses 2 + i
            uint256 ks = _aes(w, sb, (j0 & ~uint256(0xffffffff)) | (2 + i));
            for (uint256 j; j < 16 && i * 16 + j < ct.length; j++) {
                pt[i * 16 + j] = bytes1(uint8(ct[i * 16 + j]) ^ uint8(ks >> (120 - 8 * j)));
            }
        }
    }

    /// The GCM tag: GHASH over the additional data, the ciphertext and their lengths in bits,
    /// masked with the encryption of J0.
    function _tag(uint256[60] memory w, bytes memory sb, uint256 j0, bytes memory aad, bytes memory ct)
        internal pure returns (bytes16)
    {
        uint256 h = _aes(w, sb, 0);
        uint256 x = _ghash(_ghash(0, h, aad), h, ct);
        x = _gmul(x ^ ((aad.length * 8) << 64) ^ (ct.length * 8), h);
        return bytes16(uint128(x ^ _aes(w, sb, j0)));
    }

    /// x <- (x ^ block) * h for each 16-byte block of `data`, the last zero-padded.
    function _ghash(uint256 x, uint256 h, bytes memory data) internal pure returns (uint256) {
        for (uint256 i; i < data.length; i += 16) {
            uint256 blk;
            for (uint256 j; j < 16; j++) blk = (blk << 8) | (i + j < data.length ? uint8(data[i + j]) : 0);
            x = _gmul(x ^ blk, h);
        }
        return x;
    }

    /// Multiplication in GF(2^128) as GCM defines it (bit 0 is the most significant).
    function _gmul(uint256 x, uint256 y) internal pure returns (uint256 z) {
        uint256 v = y;
        unchecked {
            for (uint256 i; i < 128; i++) {
                if ((x >> (127 - i)) & 1 == 1) z ^= v;
                v = (v & 1 == 1) ? (v >> 1) ^ (uint256(0xe1) << 120) : v >> 1;
            }
        }
    }

    /// The AES S-box (FIPS 197); gen-tables.mjs writes it from its definition.
    function _sboxBytes() internal pure returns (bytes memory) {
        return hex"637c777bf26b6fc53001672bfed7ab76ca82c97dfa5947f0add4a2af9ca472c0b7fd9326363ff7cc34a5e5f171d8311504c723c31896059a071280e2eb27b27509832c1a1b6e5aa0523bd6b329e32f8453d100ed20fcb15b6acbbe394a4c58cfd0efaafb434d338545f9027f503c9fa851a3408f929d38f5bcb6da2110fff3d2cd0c13ec5f974417c4a77e3d645d197360814fdc222a908846eeb814de5e0bdbe0323a0a4906245cc2d3ac629195e479e7c8376d8dd54ea96c56f4ea657aae08ba78252e1ca6b4c6e8dd741f4bbd8b8a703eb5664803f60e613557b986c11d9ee1f8981169d98e949b1e87e9ce5528df8ca1890dbfe6426841992d0fb054bb16";
    }

    /// AES-256 key schedule: 60 words.
    function _expandKey(bytes32 key) internal pure returns (uint256[60] memory w) {
        bytes memory sb = _sboxBytes();
        for (uint256 i; i < 8; i++) w[i] = uint32(uint256(key) >> (224 - 32 * i));
        uint256 rcon = 1;
        for (uint256 i = 8; i < 60; i++) {
            uint256 t = w[i - 1];
            if (i % 8 == 0) {
                t = ((t << 8) | (t >> 24)) & 0xffffffff;
                t = _subWord(sb, t) ^ (rcon << 24);
                rcon = rcon << 1;
            } else if (i % 8 == 4) {
                t = _subWord(sb, t);
            }
            w[i] = w[i - 8] ^ t;
        }
    }

    function _sbox(bytes memory sb, uint256 x) internal pure returns (uint256 v) {
        assembly {
            v := byte(0, mload(add(add(sb, 32), x)))
        }
    }

    /// Te0[x] = (2*S[x], S[x], S[x], 3*S[x]) as a 32-bit word.
    function _tw(bytes memory sb, uint256 x) internal pure returns (uint256) {
        uint256 s = _sbox(sb, x);
        uint256 d = ((s << 1) ^ ((s >> 7) * 0x1b)) & 0xff;
        return (d << 24) | (s << 16) | (s << 8) | (d ^ s);
    }

    function _subWord(bytes memory sb, uint256 t) internal pure returns (uint256) {
        return (_sbox(sb, t >> 24) << 24) | (_sbox(sb, (t >> 16) & 0xff) << 16) | (_sbox(sb, (t >> 8) & 0xff) << 8) | _sbox(sb, t & 0xff);
    }

    function _ror(uint256 x, uint256 n) internal pure returns (uint256) {
        return ((x >> n) | (x << (32 - n))) & 0xffffffff;
    }

    /// AES-256 encryption of one 128-bit block (FIPS 197), T-table form.
    function _aes(uint256[60] memory w, bytes memory sb, uint256 input) internal pure returns (uint256) {
        uint256[4] memory a;
        uint256[4] memory b;
        for (uint256 i; i < 4; i++) a[i] = ((input >> (96 - 32 * i)) & 0xffffffff) ^ w[i];
        for (uint256 r = 1; r < 14; r++) {
            for (uint256 i; i < 4; i++) b[i] = _column(sb, a[i], a[(i + 1) % 4], a[(i + 2) % 4], a[(i + 3) % 4]) ^ w[4 * r + i];
            (a, b) = (b, a);
        }
        uint256 out;
        for (uint256 i; i < 4; i++) {
            out = (out << 32) | (_final(sb, a[i], a[(i + 1) % 4], a[(i + 2) % 4], a[(i + 3) % 4]) ^ w[56 + i]);
        }
        return out;
    }

    /// One output column of a full round: SubBytes, ShiftRows and MixColumns via Te0 and its rotations.
    function _column(bytes memory sb, uint256 a, uint256 b, uint256 c, uint256 d) internal pure returns (uint256) {
        return _tw(sb, a >> 24) ^ _ror(_tw(sb, (b >> 16) & 0xff), 8) ^ _ror(_tw(sb, (c >> 8) & 0xff), 16) ^ _ror(_tw(sb, d & 0xff), 24);
    }

    function _final(bytes memory sb, uint256 a, uint256 b, uint256 c, uint256 d) internal pure returns (uint256) {
        return (_sbox(sb, a >> 24) << 24) | (_sbox(sb, (b >> 16) & 0xff) << 16) | (_sbox(sb, (c >> 8) & 0xff) << 8) | _sbox(sb, d & 0xff);
    }

    /* -------------------------------------------------------------- DEFLATE */

    /// Raw DEFLATE (RFC 1951) decoder after Mark Adler's puff: stored, fixed and dynamic
    /// Huffman blocks. Reverts on malformed input or more than MAX_INFLATED bytes of output.
    struct Inflate {
        bytes inp;
        uint256 pos;     // next input byte
        uint256 bitbuf;
        uint256 bitcnt;
        bytes out;
        uint256 outcnt;
    }

    struct Huff {
        uint256[16] count;  // codes of each length
        uint256[] symbol;   // symbols ordered by code
    }

    function _inflate(bytes memory inp) internal pure returns (bytes memory) {
        Inflate memory s;
        s.inp = inp;
        s.out = new bytes(MAX_INFLATED + 32); // 32 bytes of slack for word copies
        uint256 last;
        do {
            last = _bits(s, 1);
            uint256 t = _bits(s, 2);
            if (t == 0) _stored(s);
            else if (t == 1) _fixed(s);
            else if (t == 2) _dynamic(s);
            else revert("bad DEFLATE data");
        } while (last == 0);
        bytes memory o = s.out;
        uint256 n = s.outcnt;
        assembly {
            mstore(o, n)
        }
        return o;
    }

    function _bits(Inflate memory s, uint256 need) internal pure returns (uint256 v) {
        uint256 buf = s.bitbuf;
        uint256 cnt = s.bitcnt;
        while (cnt < need) {
            require(s.pos < s.inp.length, "bad DEFLATE data");
            buf |= uint256(uint8(s.inp[s.pos++])) << cnt;
            cnt += 8;
        }
        s.bitbuf = buf >> need;
        s.bitcnt = cnt - need;
        return buf & ((1 << need) - 1);
    }

    function _stored(Inflate memory s) internal pure {
        s.bitbuf = 0;
        s.bitcnt = 0;
        require(s.pos + 4 <= s.inp.length, "bad DEFLATE data");
        uint256 len = uint256(uint8(s.inp[s.pos])) | (uint256(uint8(s.inp[s.pos + 1])) << 8);
        uint256 nlen = uint256(uint8(s.inp[s.pos + 2])) | (uint256(uint8(s.inp[s.pos + 3])) << 8);
        require(len == (~nlen & 0xffff), "bad DEFLATE data");
        s.pos += 4;
        require(s.pos + len <= s.inp.length, "bad DEFLATE data");
        require(s.outcnt + len <= MAX_INFLATED, "inflated text too long");
        bytes memory o = s.out;
        bytes memory inp = s.inp;
        uint256 dst = s.outcnt;
        uint256 src = s.pos;
        // 32 bytes at a time: the tail of the last word may hold bytes past the block, which
        // land in the output's unused space (or its slack) and are overwritten or cut off later
        assembly {
            for { let k := 0 } lt(k, len) { k := add(k, 32) } {
                mstore(add(add(add(o, 32), dst), k), mload(add(add(add(inp, 32), src), k)))
            }
        }
        s.outcnt = dst + len;
        s.pos = src + len;
    }

    /// Build a canonical Huffman decoding table; returns how many codes are missing
    /// (0: complete). Reverts if over-subscribed.
    function _construct(Huff memory h, uint256[] memory lengths, uint256 start, uint256 n) internal pure returns (uint256 left) {
        for (uint256 len; len < 16; len++) h.count[len] = 0;
        for (uint256 i; i < n; i++) h.count[lengths[start + i]]++;
        if (h.count[0] == n) return 0; // no codes: complete, but decoding will fail
        left = 1;
        for (uint256 len = 1; len < 16; len++) {
            left <<= 1;
            require(left >= h.count[len], "bad DEFLATE data");
            left -= h.count[len];
        }
        uint256[16] memory offs;
        for (uint256 len = 1; len < 15; len++) offs[len + 1] = offs[len] + h.count[len];
        h.symbol = new uint256[](n);
        for (uint256 i; i < n; i++) {
            uint256 l = lengths[start + i];
            if (l != 0) h.symbol[offs[l]++] = i;
        }
    }

    function _decode(Inflate memory s, Huff memory h) internal pure returns (uint256) {
        uint256 code;
        uint256 first;
        uint256 index;
        for (uint256 len = 1; len < 16; len++) {
            code |= _bits(s, 1);
            uint256 count = h.count[len];
            if (code < first + count) return h.symbol[index + (code - first)];
            index += count;
            first += count;
            first <<= 1;
            code <<= 1;
        }
        revert("bad DEFLATE data");
    }

    function _codes(Inflate memory s, Huff memory lencode, Huff memory distcode) internal pure {
        uint256 sym;
        do {
            sym = _decode(s, lencode);
            if (sym < 256) {
                require(s.outcnt < MAX_INFLATED, "inflated text too long");
                s.out[s.outcnt++] = bytes1(uint8(sym));
            } else if (sym > 256) {
                _copy(s, sym - 257, distcode);
            }
        } while (sym != 256);
    }

    /// A length (symbol 257 + lsym) and a distance: copy from earlier output, overlap allowed.
    function _copy(Inflate memory s, uint256 lsym, Huff memory distcode) internal pure {
        require(lsym < 29, "bad DEFLATE data");
        uint256 len = _field(LBASE_0, LBASE_1, lsym, 16) + _bits(s, _field(LEXT, 0, lsym, 4));
        uint256 dsym = _decode(s, distcode);
        require(dsym < 30, "bad DEFLATE data");
        uint256 dist = _field(DBASE_0, DBASE_1, dsym, 16) + _bits(s, _field(DEXT, 0, dsym, 4));
        require(dist <= s.outcnt, "bad DEFLATE data");
        require(s.outcnt + len <= MAX_INFLATED, "inflated text too long");
        bytes memory o = s.out;
        uint256 at = s.outcnt;
        // The output from at - dist on repeats with period dist, so a source D back, D any
        // multiple of dist, holds the same bytes. Take D as large as what is already written
        // allows (i + dist, rounded down to a multiple of dist) and copy min(D, 32, rest) bytes
        // per step; a step's 32-byte store may spill past its chunk into bytes not yet written,
        // which the next steps (or the slack) take.
        assembly {
            let base := add(add(o, 32), at)
            for { let i := 0 } lt(i, len) {} {
                let d := mul(dist, div(add(i, dist), dist))
                let c := d
                if gt(c, 32) { c := 32 }
                if gt(c, sub(len, i)) { c := sub(len, i) }
                mstore(add(base, i), mload(sub(add(base, i), d)))
                i := add(i, c)
            }
        }
        s.outcnt = at + len;
    }

    // RFC 1951 tables, packed into words, entry 0 in the lowest bits (gen-tables.mjs writes them):
    // base lengths (symbols 257-285) and base distances (0-29) in 16-bit fields, extra bits in
    // 4-bit fields, and the order of the code-length code lengths in 8-bit fields.
    uint256 private constant LBASE_0 = 0x1f001b001700130011000f000d000b000a0009000800070006000500040003;
    uint256 private constant LBASE_1 = 0x10200e300c300a300830073006300530043003b0033002b0023;
    uint256 private constant LEXT = 0x5555444433332222111100000000;
    uint256 private constant DBASE_0 = 0xc10081006100410031002100190011000d0009000700050004000300020001;
    uint256 private constant DBASE_1 = 0x6001400130012001180110010c010801060104010301020101810101;
    uint256 private constant DEXT = 0xddccbbaa9988776655443322110000;
    uint256 private constant ORDER = 0xf010e020d030c040b050a0609070800121110;

    /// Entry i of a table packed into one or two words in fields of `width` bits.
    function _field(uint256 lo, uint256 hi, uint256 i, uint256 width) internal pure returns (uint256) {
        uint256 per = 256 / width;
        return ((i < per ? lo : hi) >> (width * (i % per))) & ((1 << width) - 1);
    }

    function _fixed(Inflate memory s) internal pure {
        uint256[] memory lengths = new uint256[](318);
        for (uint256 i; i < 318; i++) lengths[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : i < 288 ? 8 : 5;
        Huff memory lencode;
        Huff memory distcode;
        _construct(lencode, lengths, 0, 288);
        _construct(distcode, lengths, 288, 30);
        _codes(s, lencode, distcode);
    }

    function _dynamic(Inflate memory s) internal pure {
        uint256 nlen = _bits(s, 5) + 257;
        uint256 ndist = _bits(s, 5) + 1;
        uint256 ncode = _bits(s, 4) + 4;
        require(nlen <= 286 && ndist <= 30, "bad DEFLATE data");
        uint256[] memory lengths = new uint256[](316);
        for (uint256 i; i < ncode; i++) lengths[_field(ORDER, 0, i, 8)] = _bits(s, 3);
        Huff memory lencode;
        require(_construct(lencode, lengths, 0, 19) == 0, "bad DEFLATE data");
        _readLengths(s, lencode, lengths, nlen + ndist);
        require(lengths[256] != 0, "bad DEFLATE data");
        Huff memory distcode;
        uint256 err = _construct(lencode, lengths, 0, nlen);
        require(err == 0 || nlen == lencode.count[0] + lencode.count[1], "bad DEFLATE data");
        err = _construct(distcode, lengths, nlen, ndist);
        require(err == 0 || ndist == distcode.count[0] + distcode.count[1], "bad DEFLATE data");
        _codes(s, lencode, distcode);
    }

    /// The literal/length and distance code lengths, run-length coded with the code-length code.
    function _readLengths(Inflate memory s, Huff memory lencode, uint256[] memory lengths, uint256 total) internal pure {
        uint256 index;
        while (index < total) {
            uint256 sym = _decode(s, lencode);
            if (sym < 16) {
                lengths[index++] = sym;
                continue;
            }
            uint256 len;
            uint256 rep;
            if (sym == 16) {
                require(index > 0, "bad DEFLATE data");
                len = lengths[index - 1];
                rep = 3 + _bits(s, 2);
            } else if (sym == 17) {
                rep = 3 + _bits(s, 3);
            } else {
                rep = 11 + _bits(s, 7);
            }
            require(index + rep <= total, "bad DEFLATE data");
            for (; rep > 0; rep--) lengths[index++] = len;
        }
    }

    /* ---------------------------------------------------------- text helpers */

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
}
