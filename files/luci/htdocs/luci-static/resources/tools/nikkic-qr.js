'use strict';
'require baseclass';

/*
 * Lightweight offline QR decoder for Nikki Concord LuCI (lazy-loaded only on image upload).
 * Tier 1: Native BarcodeDetector fast-path (when available on HTTPS / supported browsers).
 * Tier 2: Pure-JS QR decoder supporting Versions 1-14 (up to 73x73 modules, ECC L/M/Q/H,
 *         Byte / Alphanumeric / Numeric modes) over plain LAN HTTP without external assets.
 */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
        GF_EXP[i] = x;
        GF_LOG[x] = i;
        x <<= 1;
        if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
    return (a === 0 || b === 0) ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}
function gfInv(a) {
    return GF_EXP[255 - GF_LOG[a]];
}

// Reed-Solomon decoder over GF(256) with generator x^0..x^(ecLen-1)
function rsDecode(codewords, ecLen) {
    const n = codewords.length;
    const synd = new Uint8Array(ecLen);
    let hasErr = false;
    for (let i = 0; i < ecLen; i++) {
        let s = 0;
        const alpha = GF_EXP[i];
        for (let j = 0; j < n; j++) s = gfMul(s, alpha) ^ codewords[j];
        synd[i] = s;
        if (s !== 0) hasErr = true;
    }
    if (!hasErr) return codewords.slice(0, n - ecLen);

    // Berlekamp-Massey
    let C = [1], B = [1], L = 0, m = 1, b = 1;
    for (let r = 0; r < ecLen; r++) {
        let d = synd[r];
        for (let i = 1; i <= L; i++) d ^= gfMul(C[i] || 0, synd[r - i]);
        if (d === 0) {
            m++;
        } else {
            const T = C.slice();
            const coef = gfMul(d, gfInv(b));
            while (C.length < B.length + m) C.push(0);
            for (let i = 0; i < B.length; i++) C[i + m] ^= gfMul(coef, B[i]);
            if (2 * L <= r) {
                L = r + 1 - L;
                B = T;
                b = d;
                m = 1;
            } else {
                m++;
            }
        }
    }
    if (L > (ecLen >> 1)) return null;

    // Chien search for error locations
    const errPos = [];
    for (let i = 0; i < n; i++) {
        const xInv = GF_EXP[255 - i];
        let acc = 0;
        let xp = 1;
        for (let j = 0; j < C.length; j++) {
            acc ^= gfMul(C[j], xp);
            xp = gfMul(xp, xInv);
        }
        if (acc === 0) errPos.push(n - 1 - i);
    }
    if (errPos.length !== L) return null;

    // Error evaluator Omega(x) = S(x) * C(x) mod x^ecLen
    const omega = new Uint8Array(ecLen);
    for (let i = 0; i < ecLen; i++) {
        let v = 0;
        for (let j = 0; j <= i && j < C.length; j++) v ^= gfMul(C[j], synd[i - j]);
        omega[i] = v;
    }

    const out = codewords.slice();
    for (let k = 0; k < errPos.length; k++) {
        const pos = errPos[k];
        const xInv = GF_EXP[255 - (n - 1 - pos)];
        let num = 0, den = 0, xp = 1;
        for (let i = 0; i < ecLen; i++) {
            num ^= gfMul(omega[i], xp);
            xp = gfMul(xp, xInv);
        }
        xp = xInv;
        for (let i = 1; i < C.length; i += 2) {
            den ^= gfMul(C[i], xp);
            xp = gfMul(xp, gfMul(xInv, xInv));
        }
        if (den === 0) return null;
        out[pos] ^= gfMul(num, gfInv(den));
    }
    // Verify corrected syndromes
    for (let i = 0; i < ecLen; i++) {
        let s = 0;
        const alpha = GF_EXP[i];
        for (let j = 0; j < n; j++) s = gfMul(s, alpha) ^ out[j];
        if (s !== 0) return null;
    }
    return out.slice(0, n - ecLen);
}

// Alignment pattern center positions per QR version (1..14)
const ALIGN_POS = [
    [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
    [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66]
];

// RS block specs for versions 1..14, indexed by format EC level bits:
// 0 = M, 1 = L, 2 = H, 3 = Q. Each entry: [ecPerBlock, count1, data1, count2, data2]
const RS_SPEC = {
    1:  [[10,1,16],[7,1,19],[17,1,9],[13,1,13]],
    2:  [[16,1,28],[10,1,34],[28,1,16],[22,1,22]],
    3:  [[26,1,44],[15,1,55],[22,2,13],[18,2,17]],
    4:  [[18,2,32],[20,1,80],[16,4,9],[26,2,24]],
    5:  [[24,2,43],[26,1,108],[22,2,11,2,12],[18,2,15,2,16]],
    6:  [[16,4,27],[18,2,68],[28,4,15],[24,4,19]],
    7:  [[18,4,31],[20,2,78],[26,4,13,1,14],[18,2,14,4,15]],
    8:  [[22,2,38,2,39],[24,2,97],[26,4,14,2,15],[22,4,18,2,19]],
    9:  [[22,3,36,2,37],[30,2,116],[24,4,12,4,13],[20,4,16,4,17]],
    10: [[26,4,43,1,44],[18,2,68,2,69],[28,6,15,2,16],[24,6,19,2,20]],
    11: [[30,1,50,4,51],[20,4,81],[24,3,12,8,13],[28,4,22,4,23]],
    12: [[22,6,36,2,37],[24,2,92,2,93],[28,7,14,4,15],[26,4,20,6,21]],
    13: [[22,8,37,1,38],[26,4,107],[22,12,11,4,12],[24,8,20,4,21]],
    14: [[24,4,40,5,41],[30,3,115,1,116],[24,11,12,5,13],[20,11,16,5,17]]
};

const FORMAT_MASK = 0x5412;
const FORMAT_VALID = [];
(function initFormatTable() {
    for (let d = 0; d < 32; d++) {
        let rem = d << 10;
        for (let i = 14; i >= 10; i--) {
            if (rem & (1 << i)) rem ^= 0x537 << (i - 10);
        }
        FORMAT_VALID.push(((d << 10) | rem) ^ FORMAT_MASK);
    }
})();

function popcount(x) {
    let c = 0;
    while (x) { x &= x - 1; c++; }
    return c;
}

function decodeFormatInfo(bits) {
    let bestDist = 4, bestIdx = -1;
    for (let i = 0; i < 32; i++) {
        const d = popcount(bits ^ FORMAT_VALID[i]);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return bestIdx >= 0 ? { ecLevel: (bestIdx >> 3) & 3, mask: bestIdx & 7 } : null;
}

function maskBit(mask, r, c) {
    switch (mask) {
        case 0: return ((r + c) & 1) === 0;
        case 1: return (r & 1) === 0;
        case 2: return (c % 3) === 0;
        case 3: return ((r + c) % 3) === 0;
        case 4: return (((r >> 1) + Math.floor(c / 3)) & 1) === 0;
        case 5: return (((r * c) & 1) + ((r * c) % 3)) === 0;
        case 6: return ((((r * c) & 1) + ((r * c) % 3)) & 1) === 0;
        case 7: return ((((r + c) & 1) + ((r * c) % 3)) & 1) === 0;
    }
    return false;
}

function buildFunctionMask(ver, size) {
    const fn = new Uint8Array(size * size);
    const mark = (r0, c0, h, w) => {
        for (let r = r0; r < r0 + h; r++) {
            for (let c = c0; c < c0 + w; c++) {
                if (r >= 0 && r < size && c >= 0 && c < size) fn[r * size + c] = 1;
            }
        }
    };
    mark(0, 0, 9, 9);
    mark(0, size - 8, 9, 8);
    mark(size - 8, 0, 8, 9);
    for (let i = 8; i < size - 8; i++) {
        fn[6 * size + i] = 1;
        fn[i * size + 6] = 1;
    }
    const pos = ALIGN_POS[ver] || [];
    for (let i = 0; i < pos.length; i++) {
        for (let j = 0; j < pos.length; j++) {
            const r = pos[i], c = pos[j];
            if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
            mark(r - 2, c - 2, 5, 5);
        }
    }
    if (ver >= 7) {
        mark(0, size - 11, 6, 3);
        mark(size - 11, 0, 3, 6);
    }
    return fn;
}

function parseByteStream(bytes, ver) {
    let bitPos = 0;
    const totalBits = bytes.length * 8;
    const readBits = (n) => {
        if (bitPos + n > totalBits) return -1;
        let v = 0;
        for (let i = 0; i < n; i++) {
            const bi = bitPos >> 3;
            const shift = 7 - (bitPos & 7);
            v = (v << 1) | ((bytes[bi] >> shift) & 1);
            bitPos++;
        }
        return v;
    };
    const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
    const outBytes = [];
    while (bitPos + 4 <= totalBits) {
        const mode = readBits(4);
        if (mode === 0) break;
        if (mode === 4) { // Byte mode
            const countBits = ver <= 9 ? 8 : 16;
            const len = readBits(countBits);
            if (len < 0) return null;
            for (let i = 0; i < len; i++) {
                const b = readBits(8);
                if (b < 0) return null;
                outBytes.push(b);
            }
        } else if (mode === 2) { // Alphanumeric
            const countBits = ver <= 9 ? 9 : 11;
            const len = readBits(countBits);
            if (len < 0) return null;
            for (let i = 0; i < len; i += 2) {
                if (i + 1 < len) {
                    const v = readBits(11);
                    if (v < 0) return null;
                    outBytes.push(ALNUM.charCodeAt(Math.floor(v / 45)), ALNUM.charCodeAt(v % 45));
                } else {
                    const v = readBits(6);
                    if (v < 0) return null;
                    outBytes.push(ALNUM.charCodeAt(v));
                }
            }
        } else if (mode === 1) { // Numeric
            const countBits = ver <= 9 ? 10 : 12;
            const len = readBits(countBits);
            if (len < 0) return null;
            for (let i = 0; i < len; i += 3) {
                const rem = Math.min(3, len - i);
                const v = readBits(rem === 3 ? 10 : rem === 2 ? 7 : 4);
                if (v < 0) return null;
                const s = String(v).padStart(rem, '0');
                for (let k = 0; k < s.length; k++) outBytes.push(s.charCodeAt(k));
            }
        } else if (mode === 7) { // ECI — skip assignment number
            const b1 = readBits(8);
            if (b1 < 0) return null;
            if ((b1 & 0x80) !== 0) {
                if ((b1 & 0x40) === 0) readBits(8);
                else readBits(16);
            }
        } else {
            return null;
        }
    }
    if (!outBytes.length) return null;
    try {
        return new TextDecoder('utf-8').decode(new Uint8Array(outBytes));
    } catch (_) {
        return String.fromCharCode(...outBytes);
    }
}

// Decode a clean size x size binary module grid (1 = dark, 0 = light)
function decodeMatrix(grid, size) {
    const ver = (size - 17) / 4;
    if (!Number.isInteger(ver) || ver < 1 || ver > 14) return null;
    const at = (r, c) => grid[r * size + c] ? 1 : 0;

    // Read both format copies
    let f1 = 0;
    const f1Coords = [
        [8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],
        [7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]
    ];
    for (let i = 0; i < 15; i++) f1 = (f1 << 1) | at(f1Coords[i][0], f1Coords[i][1]);
    let f2 = 0;
    for (let i = 0; i < 7; i++) f2 = (f2 << 1) | at(size - 1 - i, 8);
    for (let i = 0; i < 8; i++) f2 = (f2 << 1) | at(8, size - 8 + i);

    const fmt = decodeFormatInfo(f1) || decodeFormatInfo(f2);
    if (!fmt) return null;

    const fnMask = buildFunctionMask(ver, size);
    const codewords = [];
    let curByte = 0, bitCnt = 0;
    let upward = true;
    for (let col = size - 1; col > 0; col -= 2) {
        if (col === 6) col--;
        for (let step = 0; step < size; step++) {
            const row = upward ? size - 1 - step : step;
            for (let dx = 0; dx < 2; dx++) {
                const c = col - dx;
                if (fnMask[row * size + c]) continue;
                const bit = at(row, c) ^ (maskBit(fmt.mask, row, c) ? 1 : 0);
                curByte = (curByte << 1) | bit;
                bitCnt++;
                if (bitCnt === 8) {
                    codewords.push(curByte);
                    curByte = 0;
                    bitCnt = 0;
                }
            }
        }
        upward = !upward;
    }

    const spec = RS_SPEC[ver][fmt.ecLevel];
    if (!spec) return null;
    const ecLen = spec[0];
    const blocks = [];
    for (let i = 0; i < spec[1]; i++) blocks.push({ dLen: spec[2], data: new Uint8Array(spec[2] + ecLen) });
    if (spec.length >= 5) {
        for (let i = 0; i < spec[3]; i++) blocks.push({ dLen: spec[4], data: new Uint8Array(spec[4] + ecLen) });
    }
    const totalExpected = blocks.reduce((a, b) => a + b.data.length, 0);
    if (codewords.length < totalExpected) return null;

    const maxData = Math.max(...blocks.map(b => b.dLen));
    let ptr = 0;
    for (let i = 0; i < maxData; i++) {
        for (let b = 0; b < blocks.length; b++) {
            if (i < blocks[b].dLen) blocks[b].data[i] = codewords[ptr++];
        }
    }
    for (let i = 0; i < ecLen; i++) {
        for (let b = 0; b < blocks.length; b++) {
            blocks[b].data[blocks[b].dLen + i] = codewords[ptr++];
        }
    }

    const payload = [];
    for (let b = 0; b < blocks.length; b++) {
        const dec = rsDecode(blocks[b].data, ecLen);
        if (!dec) return null;
        for (let i = 0; i < dec.length; i++) payload.push(dec[i]);
    }
    return parseByteStream(new Uint8Array(payload), ver);
}

// Binarize RGBA pixels into 1 (dark) / 0 (light) using adaptive local block thresholding
function binarize(rgba, w, h) {
    const gray = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
        gray[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
    }
    const bs = Math.max(8, Math.min(32, Math.floor(Math.min(w, h) / 8)));
    const bw = Math.ceil(w / bs), bh = Math.ceil(h / bs);
    const mean = new Uint8Array(bw * bh);
    for (let by = 0; by < bh; by++) {
        const y0 = by * bs, y1 = Math.min(h, y0 + bs);
        for (let bx = 0; bx < bw; bx++) {
            const x0 = bx * bs, x1 = Math.min(w, x0 + bs);
            let sum = 0, mn = 255, mx = 0, cnt = 0;
            for (let y = y0; y < y1; y++) {
                for (let x = x0; x < x1; x++) {
                    const v = gray[y * w + x];
                    sum += v; if (v < mn) mn = v; if (v > mx) mx = v; cnt++;
                }
            }
            mean[by * bw + bx] = (mx - mn <= 24) ? (mn >> 1) : Math.floor(sum / cnt);
        }
    }
    const bin = new Uint8Array(w * h);
    for (let by = 0; by < bh; by++) {
        const y0 = by * bs, y1 = Math.min(h, y0 + bs);
        for (let bx = 0; bx < bw; bx++) {
            let sum = 0, cnt = 0;
            for (let dy = -2; dy <= 2; dy++) {
                const ny = by + dy;
                if (ny < 0 || ny >= bh) continue;
                for (let dx = -2; dx <= 2; dx++) {
                    const nx = bx + dx;
                    if (nx < 0 || nx >= bw) continue;
                    sum += mean[ny * bw + nx]; cnt++;
                }
            }
            const thr = Math.floor(sum / cnt);
            const x0 = bx * bs, x1 = Math.min(w, x0 + bs);
            for (let y = y0; y < y1; y++) {
                for (let x = x0; x < x1; x++) {
                    bin[y * w + x] = gray[y * w + x] <= thr ? 1 : 0;
                }
            }
        }
    }
    return bin;
}

function checkRatio(s) {
    const total = s[0] + s[1] + s[2] + s[3] + s[4];
    if (total < 7) return false;
    const mod = total / 7;
    const maxVar = mod * 0.6;
    return Math.abs(mod - s[0]) < maxVar &&
        Math.abs(mod - s[1]) < maxVar &&
        Math.abs(3 * mod - s[2]) < 3 * maxVar &&
        Math.abs(mod - s[3]) < maxVar &&
        Math.abs(mod - s[4]) < maxVar;
}

function crossCheck(bin, w, h, startX, startY, vertical, centerCount) {
    const s = [0, 0, 0, 0, 0];
    const limit = vertical ? h : w;
    let i = vertical ? startY : startX;
    const fixed = vertical ? startX : startY;
    const get = (p) => vertical ? bin[p * w + fixed] : bin[fixed * w + p];
    while (i >= 0 && get(i)) { s[2]++; i--; }
    if (i < 0) return null;
    while (i >= 0 && !get(i)) { s[1]++; i--; }
    if (i < 0) return null;
    while (i >= 0 && get(i)) { s[0]++; i--; }
    if (s[0] === 0) return null;
    i = (vertical ? startY : startX) + 1;
    while (i < limit && get(i)) { s[2]++; i++; }
    if (i === limit) return null;
    while (i < limit && !get(i)) { s[3]++; i++; }
    if (i === limit) return null;
    while (i < limit && get(i)) { s[4]++; i++; }
    if (s[4] === 0) return null;
    const total = s[0] + s[1] + s[2] + s[3] + s[4];
    if (5 * Math.abs(total - centerCount) >= 2 * centerCount) return null;
    if (!checkRatio(s)) return null;
    return { center: (i - s[4] - s[3]) - s[2] / 2, mod: total / 7 };
}

function findFinders(bin, w, h) {
    const centers = [];
    const step = Math.max(1, Math.floor((3 * Math.min(w, h)) / (4 * 97)));
    for (let y = step; y < h; y += step) {
        const s = [0, 0, 0, 0, 0];
        let state = 0;
        for (let x = 0; x < w; x++) {
            const dark = bin[y * w + x] === 1;
            if (dark) {
                if ((state & 1) === 1) state++;
                s[state]++;
            } else {
                if ((state & 1) === 0) {
                    if (state === 4) {
                        if (checkRatio(s)) {
                            const total = s[0] + s[1] + s[2] + s[3] + s[4];
                            const cx = Math.floor(x - s[4] - s[3] - s[2] / 2);
                            const v = crossCheck(bin, w, h, cx, y, true, total);
                            if (v) {
                                const hc = crossCheck(bin, w, h, cx, Math.floor(v.center), false, total);
                                if (hc) {
                                    const mod = (v.mod + hc.mod) / 2;
                                    let merged = false;
                                    for (let k = 0; k < centers.length; k++) {
                                        const c = centers[k];
                                        if (Math.hypot(c.x - hc.center, c.y - v.center) < mod * 2.5) {
                                            const n = c.cnt + 1;
                                            c.x = (c.x * c.cnt + hc.center) / n;
                                            c.y = (c.y * c.cnt + v.center) / n;
                                            c.mod = (c.mod * c.cnt + mod) / n;
                                            c.cnt = n;
                                            merged = true;
                                            break;
                                        }
                                    }
                                    if (!merged) centers.push({ x: hc.center, y: v.center, mod, cnt: 1 });
                                }
                            }
                            state = 0; s[0] = s[1] = s[2] = s[3] = s[4] = 0;
                        } else {
                            s[0] = s[2]; s[1] = s[3]; s[2] = s[4]; s[3] = 1; s[4] = 0; state = 3;
                        }
                    } else {
                        state++; s[state]++;
                    }
                } else {
                    s[state]++;
                }
            }
        }
    }
    centers.sort((a, b) => b.cnt - a.cnt);
    return centers.slice(0, 8);
}

function orderThreeFinders(pts) {
    const d01 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const d12 = Math.hypot(pts[1].x - pts[2].x, pts[1].y - pts[2].y);
    const d02 = Math.hypot(pts[0].x - pts[2].x, pts[0].y - pts[2].y);
    let tl, a, b;
    if (d12 >= d01 && d12 >= d02) { tl = pts[0]; a = pts[1]; b = pts[2]; }
    else if (d02 >= d01 && d02 >= d12) { tl = pts[1]; a = pts[0]; b = pts[2]; }
    else { tl = pts[2]; a = pts[0]; b = pts[1]; }
    const cross = (a.x - tl.x) * (b.y - tl.y) - (a.y - tl.y) * (b.x - tl.x);
    return cross > 0 ? { tl, tr: a, bl: b } : { tl, tr: b, bl: a };
}

function sampleAffine(bin, w, h, tl, tr, bl, size) {
    const span = size - 7;
    const ux = (tr.x - tl.x) / span, uy = (tr.y - tl.y) / span;
    const vx = (bl.x - tl.x) / span, vy = (bl.y - tl.y) / span;
    const ox = tl.x - 3.5 * ux - 3.5 * vx;
    const oy = tl.y - 3.5 * uy - 3.5 * vy;
    const grid = new Uint8Array(size * size);
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            const px = Math.round(ox + (c + 0.5) * ux + (r + 0.5) * vx);
            const py = Math.round(oy + (c + 0.5) * uy + (r + 0.5) * vy);
            if (px >= 0 && px < w && py >= 0 && py < h) grid[r * size + c] = bin[py * w + px];
        }
    }
    return grid;
}

function decodeImageData(imageData) {
    const w = imageData.width, h = imageData.height;
    const bin = binarize(imageData.data, w, h);
    const finders = findFinders(bin, w, h);
    if (finders.length < 3) return null;

    // Try top combinations of 3 finder candidates
    const limit = Math.min(finders.length, 6);
    for (let i = 0; i < limit; i++) {
        for (let j = i + 1; j < limit; j++) {
            for (let k = j + 1; k < limit; k++) {
                const { tl, tr, bl } = orderThreeFinders([finders[i], finders[j], finders[k]]);
                const mod = (tl.mod + tr.mod + bl.mod) / 3;
                if (mod < 1) continue;
                const d1 = Math.hypot(tr.x - tl.x, tr.y - tl.y);
                const d2 = Math.hypot(bl.x - tl.x, bl.y - tl.y);
                const estSize = Math.round(((d1 + d2) / (2 * mod)) + 7);
                const baseVer = Math.max(1, Math.min(14, Math.round((estSize - 17) / 4)));
                for (const dv of [0, -1, 1]) {
                    const ver = baseVer + dv;
                    if (ver < 1 || ver > 14) continue;
                    const size = 17 + 4 * ver;
                    const grid = sampleAffine(bin, w, h, tl, tr, bl, size);
                    const text = decodeMatrix(grid, size);
                    if (text) return text;
                }
            }
        }
    }
    return null;
}

function parseQrPayload(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;
    if (/^clash:\/\//i.test(text)) {
        try {
            const u = new URL(text);
            const url = u.searchParams.get('url') || '';
            const name = u.searchParams.get('name') || '';
            if (/^https?:\/\//i.test(url)) return { url, name };
        } catch (_) {}
    }
    if (/^https?:\/\//i.test(text)) return { url: text, name: '' };
    return null;
}

return baseclass.extend({
    decodeMatrix: decodeMatrix,
    decodeImageData: decodeImageData,
    parseQrPayload: parseQrPayload,

    decodeFile: async function (file) {
        if (!file) return null;
        // Tier 1: Native BarcodeDetector fast-path
        if (typeof window !== 'undefined' && 'BarcodeDetector' in window && typeof createImageBitmap === 'function') {
            try {
                const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
                const bmp = await createImageBitmap(file);
                const codes = await detector.detect(bmp);
                if (bmp.close) bmp.close();
                if (codes && codes.length && codes[0].rawValue)
                    return codes[0].rawValue;
            } catch (_) {
                // Fall through to pure-JS decoder
            }
        }
        // Tier 2: Pure-JS Canvas decoder (works on plain LAN HTTP & Safari/Firefox)
        return new Promise(function (resolve) {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = function () {
                URL.revokeObjectURL(url);
                try {
                    const maxDim = 960;
                    const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
                    const w = Math.max(1, Math.round(img.width * scale));
                    const h = Math.max(1, Math.round(img.height * scale));
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d', { willReadFrequently: true });
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, w, h);
                    ctx.drawImage(img, 0, 0, w, h);
                    const result = decodeImageData(ctx.getImageData(0, 0, w, h));
                    resolve(result);
                } catch (_) {
                    resolve(null);
                }
            };
            img.onerror = function () {
                URL.revokeObjectURL(url);
                resolve(null);
            };
            img.src = url;
        });
    }
});
