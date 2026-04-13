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

function noteInfo(obj) {
    const dur = DURS[obj.duration & 0x0F] || '?';
    const a1 = obj.attr1 ? obj.attr1[0] : 0;
    let durStr = dur;
    if (a1 & 0x01) durStr += '..';
    else if (a1 & 0x04) durStr += '.';
    return { pitch: pitchStr(obj.pos), dur: durStr };
}

const filePath = process.argv[2];
if (!filePath) {
    console.error('Usage: node nwc_bridge.js <nwc_file>');
    process.exit(1);
}

const nwcData = fs.readFileSync(filePath);
const result = await parseNWC(nwcData);

const staff1 = result.staffs[0];

// 멜로디 추출: NoteCMObj → 마지막 child, NoteObj → 직접
const melody = [];
for (const obj of staff1.objects) {
    const type = obj.constructor.name;
    if (type === 'NoteObj') {
        melody.push(noteInfo(obj));
    } else if (type === 'NoteCMObj' && obj.children?.length > 0) {
        melody.push(noteInfo(obj.children[obj.children.length - 1]));
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
};

console.log(JSON.stringify(output));
