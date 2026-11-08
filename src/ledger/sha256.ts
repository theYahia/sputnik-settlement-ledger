/**
 * Dependency-free SHA-256 over UTF-8 text.
 *
 * Why not `node:crypto` or a host binding: the same hash must be produced by
 * the contract, by the CLI and by the tests. A single pure implementation
 * removes the "which host hashed this" question entirely, and keeps the
 * ledger module importable by near-sdk-js without host-specific imports.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Fixed-size typed arrays below are always in range; this keeps that provable. */
function at<T>(array: ArrayLike<T>, index: number): T {
  const value = array[index];
  if (value === undefined) throw new RangeError(`sha256: index ${index} out of range`);
  return value;
}

function utf8Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function pad(message: Uint8Array): Uint8Array {
  const bitLength = message.length * 8;
  let paddedLength = message.length + 1;
  while (paddedLength % 64 !== 56) paddedLength++;
  const padded = new Uint8Array(paddedLength + 8);
  padded.set(message, 0);
  padded[message.length] = 0x80;
  // A ledger large enough to overflow 2^32 bits cannot fit in contract state,
  // so the high length word is derived without BigInt.
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  padded[paddedLength] = (high >>> 24) & 0xff;
  padded[paddedLength + 1] = (high >>> 16) & 0xff;
  padded[paddedLength + 2] = (high >>> 8) & 0xff;
  padded[paddedLength + 3] = high & 0xff;
  padded[paddedLength + 4] = (low >>> 24) & 0xff;
  padded[paddedLength + 5] = (low >>> 16) & 0xff;
  padded[paddedLength + 6] = (low >>> 8) & 0xff;
  padded[paddedLength + 7] = low & 0xff;
  return padded;
}

export function sha256Hex(text: string): string {
  const data = pad(utf8Bytes(text));
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const base = offset + i * 4;
      w[i] =
        ((at(data, base) << 24) |
          (at(data, base + 1) << 16) |
          (at(data, base + 2) << 8) |
          at(data, base + 3)) >>>
        0;
    }
    for (let i = 16; i < 64; i++) {
      const w15 = at(w, i - 15);
      const w2 = at(w, i - 2);
      const s0 = (rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3)) >>> 0;
      const s1 = (rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10)) >>> 0;
      w[i] = (at(w, i - 16) + s0 + at(w, i - 7) + s1) >>> 0;
    }

    let a = at(h, 0);
    let b = at(h, 1);
    let c = at(h, 2);
    let d = at(h, 3);
    let e = at(h, 4);
    let f = at(h, 5);
    let g = at(h, 6);
    let hh = at(h, 7);

    for (let i = 0; i < 64; i++) {
      const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (hh + s1 + ch + at(K, i) + at(w, i)) >>> 0;
      const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (at(h, 0) + a) >>> 0;
    h[1] = (at(h, 1) + b) >>> 0;
    h[2] = (at(h, 2) + c) >>> 0;
    h[3] = (at(h, 3) + d) >>> 0;
    h[4] = (at(h, 4) + e) >>> 0;
    h[5] = (at(h, 5) + f) >>> 0;
    h[6] = (at(h, 6) + g) >>> 0;
    h[7] = (at(h, 7) + hh) >>> 0;
  }

  let hex = "";
  for (let i = 0; i < 8; i++) hex += at(h, i).toString(16).padStart(8, "0");
  return hex;
}
