/**
 * NWC 파일을 nwc-viewer 파서로 읽어서 멜로디 JSON을 stdout으로 출력.
 * Python에서 subprocess로 호출하여 사용.
 *
 * Usage: node nwc_bridge.mjs <nwc_file_path>
 */

import fs from 'fs';
import { parseNWC } from './lib/nwc2xml/parser.js';

const NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const DURS = ['w', 'h', 'q', '8', '16', '32', '64'];

function pitchStr(pos) {
    const p = -pos + 34;
    const name = NAMES[((p % 7) + 7) % 7];
    const oct = Math.floor(p / 7);
    return name + oct;
}

// NoteAttr bit flags (from lib/nwc2xml/constants.js)
const NA_SlurMask = 0x01800, NA_SlurMid = 0x01800, NA_SlurEnd = 0x01000;
const NA_TieEnd = 0x40000;
const NA_BeamMask = 0x00600, NA_BeamBeg = 0x00200, NA_BeamEnd = 0x00400, NA_BeamMid = 0x00600;

function beamRole(obj) {
    try {
        const na = obj.getAttributes ? obj.getAttributes() : 0;
        const m = na & NA_BeamMask;
        if (m === NA_BeamBeg) return 'beg';
        if (m === NA_BeamEnd) return 'end';
        if (m === NA_BeamMid) return 'mid';
    } catch {}
    return null;
}

function isMelisma(obj) {
    try {
        const ls = obj.getLyricSyllable ? obj.getLyricSyllable() : 0;
        if (ls === 2) return true; // Never consume syllable
        if (ls === 1) return false; // Always consume
    } catch {}
    try {
        const na = obj.getAttributes ? obj.getAttributes() : 0;
        const slur = na & NA_SlurMask;
        if (slur === NA_SlurMid || slur === NA_SlurEnd) return true;
        if (na & NA_TieEnd) return true;
    } catch {}
    return false;
}

// Accidental enum: 0=Sharp, 1=Flat, 2=Natural, 3=SharpSharp, 4=FlatFlat, 5=Normal(none)
const ACC_NAMES = ['sharp', 'flat', 'natural', 'sharpsharp', 'flatflat', null];
function accidentalName(obj) {
    try {
        const a = obj.getAccidental ? obj.getAccidental() : 5;
        return ACC_NAMES[a] || null;
    } catch { return null; }
}

function noteInfo(obj) {
    const dur = DURS[obj.duration & 0x0F] || '?';
    const a1 = obj.attr1 ? obj.attr1[0] : 0;
    let durStr = dur;
    if (a1 & 0x01) durStr += '..';
    else if (a1 & 0x04) durStr += '.';
    const out = { pitch: pitchStr(obj.pos), dur: durStr, melisma: isMelisma(obj) };
    const acc = accidentalName(obj);
    if (acc) out.accidental = acc;
    const beam = beamRole(obj);
    if (beam) out.beam = beam;
    return out;
}

const filePath = process.argv[2];
if (!filePath) {
    console.error('Usage: node nwc_bridge.js <nwc_file>');
    process.exit(1);
}

const nwcData = fs.readFileSync(filePath);
const result = await parseNWC(nwcData);

const staff1 = result.staffs[0];

// 멜로디 추출 + 바라인 위치(다음 음표의 인덱스) 기록
const melody = [];
const barAt = []; // barAt[i] = 이 바라인 직후에 오는 첫 음표의 melody 인덱스
for (const obj of staff1.objects) {
    const type = obj.constructor.name;
    if (type === 'NoteObj') {
        melody.push(noteInfo(obj));
    } else if (type === 'NoteCMObj' && obj.children?.length > 0) {
        melody.push(noteInfo(obj.children[obj.children.length - 1]));
    } else if (type === 'BarLineObj') {
        barAt.push(melody.length);
    }
}

// 가사
const lyrics = (staff1.lyrics || []).map(syllables =>
    syllables.map(s => s.toString ? s.toString() : String(s))
);

// KeySig: flats/sharps는 bitmask → bit count로 개수 산정
let keySig = '';
for (const obj of staff1.objects) {
    if (obj.constructor.name === 'KeySigObj') {
        const f = obj.flats ?? 0;
        const s = obj.sharps ?? 0;
        const fc = f.toString(2).split('1').length - 1;
        const sc = s.toString(2).split('1').length - 1;
        if (fc > 0) keySig = `${fc}b`;
        else if (sc > 0) keySig = `${sc}#`;
        else keySig = 'C';
        break;
    }
}

// TimeSig
let timeSig = '';
for (const obj of staff1.objects) {
    if (obj.constructor.name === 'TimeSigObj') {
        const num = obj.numerator ?? 4;
        const bits = obj.bits ?? 2;
        timeSig = `${num}/${1 << bits}`;
        break;
    }
}

const output = {
    title: result.title?.toString() || '',
    author: result.author?.toString() || '',
    keySig,
    timeSig,
    melody,
    lyrics,
    barAt,
};

console.log(JSON.stringify(output));
