/**
 * 악보 렌더링 엔진 (Notes Engine) - Bravura SMuFL 폰트 버전
 *
 * 한글 가사 위에 오선지와 음표를 렌더링합니다.
 * - Bravura 폰트 (SMuFL 표준) 사용
 * - 각 글자와 음표의 가로 중앙 정렬
 * - 편집 모드 지원 (호버, 클릭, 드래그)
 */

// 색상 상수 (CSS 변수 --color-gray와 동일)
const COLOR_GRAY = '#666';

class NotesEngine {
    constructor(options = {}) {
        // 오선지 설정
        this.staffHeight = options.staffHeight || 40;      // 오선지 높이
        this.lineSpacing = this.staffHeight / 4;           // 줄 간격 (5개 줄 = 4개 간격)
        this.staffColor = options.staffColor || COLOR_GRAY;    // 오선지 색상
        this.noteColor = options.noteColor || '#000';      // 음표 색상
        this.previewColor = options.previewColor || COLOR_GRAY; // 미리보기 색상

        // Bravura 폰트 크기 (오선지 높이 기준)
        this.fontSize = this.staffHeight * 0.85;     // 음표 크기
        this.stemHeight = this.staffHeight * 0.7;
        this.clefMargin = this.lineSpacing * 4;      // 음자리표 영역 여백 (스케일 비례)

        // 기둥(stem) 오프셋 상수
        this.stemStartOffsetDown = 5;    // stemDown일 때 기둥 시작 오프셋
        this.stemStartOffsetUp = 2.5;    // stemUp일 때 기둥 시작 오프셋

        // SVG 레이아웃 상수
        this.staffTopMargin = 30;        // 오선지 상단 여백
        this.svgExtraHeight = 55;        // SVG 추가 높이 (꼬리 + 하단 덧줄 여유)

        // 꼬리(flag) 위치 조정 상수
        this.flagOffsetX = -0.55;        // 꼬리 X 오프셋
        this.flagOffsetYDown = -2;       // stemDown일 때 꼬리 Y 오프셋
        this.flagOffsetYUp = -6;         // stemUp일 때 꼬리 Y 오프셋

        // 연결선(beam) 상수 — lineSpacing 비례로 확대/축소에서도 굵기 비율 유지
        // (staffHeight 40 = lineSpacing 10 기준 각각 5 / 4 로, 기존 값과 동일)
        this.beamThickness = this.lineSpacing * 0.5;   // 연결선 두께 (모든 단계 동일)
        this.beamSpacing = this.lineSpacing * 0.4;     // 연결선 사이 간격 (1↔2단계)
        this.beamSpacingFactor = 0.7;                  // 2단계 이상 간격을 1단계 간격의 70%로
        this.beamStubLength = this.lineSpacing * 1.1;  // 부분 연결선(stub) 길이

        // SMuFL 코드포인트 (Bravura 폰트)
        this.smufl = {
            // 음자리표
            gClef: '\uE050',           // 높은음자리표
            fClef: '\uE062',           // 낮은음자리표

            // 조표 (임시표)
            sharp: '\uE262',           // 샵 (#)
            flat: '\uE260',            // 플랫 (b)
            natural: '\uE261',         // 내츄럴

            // 음표 머리
            noteheadWhole: '\uE0A2',   // 온음표 머리
            noteheadHalf: '\uE0A3',    // 2분음표 머리
            noteheadBlack: '\uE0A4',   // 4분/8분/16분 음표 머리

            // 꼬리 (기둥 위로)
            flag8thUp: '\uE240',       // 8분음표 꼬리 (위)
            flag16thUp: '\uE242',      // 16분음표 꼬리 (위)

            // 꼬리 (기둥 아래로)
            flag8thDown: '\uE241',     // 8분음표 꼬리 (아래)
            flag16thDown: '\uE243',    // 16분음표 꼬리 (아래)

            // 점음표
            augmentationDot: '\uE1E7', // 점 (augmentation dot)

            // 페르마타 (음표 위)
            fermataAbove: '\uE4C0',    // 페르마타 (위)
        };

        // 조표 위치 (플랫/샵 순서, 오선지 기준 - 0=F5 top line, 4=E4 bottom line)
        // 음자리표와 동일한 좌표계 사용 (G4 = position 3)
        this.flatPositions = [1.5, 0, 2, 0.5, 2.5, 1, 3];       // Bb(시), Eb(미), Ab(라), Db(레), Gb(솔), Cb(도), Fb(파)
        this.sharpPositions = [-0.5, 1, -1, 0.5, 2, 0, 1.5];       // F#(파)=F5, C#(도)=C5, G#(솔)=G5, D#(레)=D5, A#(라)=A4, E#(미)=E5, B#(시)=B4

        // 조표 간격 (스케일 비례)
        this.keySignatureSpacing = this.lineSpacing;        // 조표 간 간격 (기본 10)
        this.keyToFirstNoteGap = this.lineSpacing * 1.4;    // 조표와 첫 음표 사이 (기본 14)

        // 음높이 -> Y 위치 매핑 (Bravura 글리프 앵커 기준 렌더링 좌표)
        // 시각적 notehead 중심은 여기 값 + 0.5*lineSpacing 위치에 그려짐.
        // (calculatePitch는 이 오프셋을 역으로 보정한다)
        // 시각 좌표계: F5(top line)=0, D5=1, B4=2, G4=3, E4(bottom line)=4
        this.pitchMap = {
            'A3': 5.5,  // 아래 둘째 덧줄 아래
            'B3': 5,    // 아래 첫째 덧줄
            'C4': 4.5,
            'D4': 4,    // 아래줄
            'E4': 3.5,
            'F4': 3,
            'G4': 2.5,
            'A4': 2,    // 가운데 줄 아래 칸
            'B4': 1.5,
            'C5': 1,
            'D5': 0.5,
            'E5': 0,
            'F5': -0.5,
            'G5': -1,
            'A5': -1.5,
            'B5': -2,
            'C6': -2.5,
            'D6': -3
        };

        // 박자 -> 음표 모양 매핑
        this.durationMap = {
            'w': { notehead: 'noteheadWhole', stem: false, flag: null },      // 온음표
            'h': { notehead: 'noteheadHalf', stem: true, flag: null },        // 2분음표
            'q': { notehead: 'noteheadBlack', stem: true, flag: null },       // 4분음표
            '8': { notehead: 'noteheadBlack', stem: true, flag: '8th' },      // 8분음표
            '16': { notehead: 'noteheadBlack', stem: true, flag: '16th' }     // 16분음표
        };

        // 편집 모드
        this.editMode = options.editMode || false;
        this.defaultDuration = 'q';  // 기본 박자
    }

    /**
     * 박자표에서 기본 음표 박자 결정
     */
    getDefaultDuration(timeSignature) {
        if (!timeSignature) return 'q';

        const denominator = parseInt(timeSignature.split('/')[1]);
        switch (denominator) {
            case 2: return 'h';
            case 4: return 'q';
            case 8: return '8';
            default: return 'q';
        }
    }

    /**
     * 조표 문자열 파싱 (예: "4b", "3#", "Bb", "F#")
     * @returns {Object} { type: 'flat'|'sharp'|'none', count: number }
     */
    parseKeySignature(key) {
        if (!key) return { type: 'none', count: 0 };

        // "4b", "3#" 형식 파싱
        const countMatch = key.match(/^(\d+)(b|#)$/);
        if (countMatch) {
            return {
                type: countMatch[2] === 'b' ? 'flat' : 'sharp',
                count: parseInt(countMatch[1])
            };
        }

        // 조 이름으로 변환 (예: "Bb" -> 2b, "D" -> 2#)
        const keyToFlats = { 'Cb': 7, 'Gb': 6, 'Db': 5, 'Ab': 4, 'Eb': 3, 'Bb': 2, 'F': 1 };
        const keyToSharps = { 'G': 1, 'D': 2, 'A': 3, 'E': 4, 'B': 5, 'F#': 6, 'C#': 7 };

        if (keyToFlats[key]) {
            return { type: 'flat', count: keyToFlats[key] };
        }
        if (keyToSharps[key]) {
            return { type: 'sharp', count: keyToSharps[key] };
        }

        // C 또는 인식 불가
        return { type: 'none', count: 0 };
    }

    /**
     * 조표 너비 계산
     */
    getKeySignatureWidth(keyInfo) {
        // 조표가 없는 경우에도 음자리표와 첫 음표 사이 여백을 확보
        if (!keyInfo || keyInfo.count === 0) return this.keyToFirstNoteGap * 1.6;
        return keyInfo.count * this.keySignatureSpacing + 5 + this.keyToFirstNoteGap;
    }

    /**
     * 조표 SVG 생성
     */
    createKeySignature(x, staffTop, keyInfo) {
        if (!keyInfo || keyInfo.count === 0) return '';

        let svg = '';
        const glyph = keyInfo.type === 'flat' ? this.smufl.flat : this.smufl.sharp;
        const positions = keyInfo.type === 'flat' ? this.flatPositions : this.sharpPositions;
        const fontSize = this.fontSize * 1.0;

        for (let i = 0; i < keyInfo.count && i < positions.length; i++) {
            const accidentalX = x + (i * this.keySignatureSpacing);
            const accidentalY = staffTop + (positions[i] * this.lineSpacing);

            svg += `
                <text x="${accidentalX}" y="${accidentalY}"
                      font-family="Bravura, 'Bravura Text'"
                      font-size="${fontSize}"
                      fill="${this.staffColor}"
                      text-anchor="middle"
                      dominant-baseline="middle">${glyph}</text>
            `;
        }

        return svg;
    }

    /**
     * 높은음자리표 SVG 생성 (Bravura 폰트)
     */
    createTrebleClef(x, staffTop) {
        // 높은음자리표는 G4 라인을 기준으로 배치
        // 오선지: 0=F5, 1=D5, 2=B4, 3=G4, 4=E4
        const y = staffTop + (3 * this.lineSpacing); // G4 라인 (위에서 4번째 줄)
        const fontSize = this.staffHeight * 1.0;

        return `
            <text x="${x}" y="${y}"
                  font-family="Bravura, 'Bravura Text'"
                  font-size="${fontSize}"
                  fill="${this.staffColor}"
                  text-anchor="middle"
                  dominant-baseline="middle">${this.smufl.gClef}</text>
        `;
    }

    /**
     * 오선지 SVG 생성
     * @param {number} width - 오선지 끝점 (가사 끝)
     * @param {number} staffTop - 오선지 상단 Y 좌표
     * @param {number} startX - 오선지 시작점 (기본: 0)
     */
    createStaff(width, staffTop, startX = 0) {
        let lines = '';
        for (let i = 0; i < 5; i++) {
            const y = staffTop + (i * this.lineSpacing);
            lines += `<line x1="${startX}" y1="${y}" x2="${width}" y2="${y}"
                           stroke="${this.staffColor}" stroke-width="1"/>`;
        }
        return lines;
    }

    /**
     * 음표 SVG 생성 (Bravura 폰트)
     * @param {string} duration - 박자 (예: 'q', 'h', 'q.', 'h.' 등, '.'은 점음표)
     * @param {boolean} skipFlag - true면 꼬리 생략 (연결선 사용 시)
     * @param {boolean} skipStem - true면 기둥 생략 (연결선에서 기둥을 직접 그릴 때)
     */
    createNote(x, pitch, duration, staffTop, color = null, skipFlag = false, skipStem = false, accidental = null, fermata = false) {
        const noteColor = color || this.noteColor;
        const pitchPos = this.pitchMap[pitch] ?? 3;

        // 점음표 여부 확인
        const isDotted = duration && duration.endsWith('.');
        const baseDuration = isDotted ? duration.slice(0, -1) : duration;
        const durationInfo = this.durationMap[baseDuration] || this.durationMap['q'];

        // Y 좌표 계산
        const noteY = staffTop + (pitchPos * this.lineSpacing);

        let svg = '';

        // 임시표 (sharp/flat/natural) - 음표 머리 왼쪽에 배치
        const accGlyph = accidental === 'sharp' ? this.smufl.sharp
            : accidental === 'flat' ? this.smufl.flat
            : accidental === 'natural' ? this.smufl.natural
            : null;
        if (accGlyph) {
            const accX = x - this.lineSpacing * 0.85;
            svg += `
                <text x="${accX}" y="${noteY}"
                      font-family="Bravura, 'Bravura Text'"
                      font-size="${this.fontSize}"
                      fill="${noteColor}"
                      text-anchor="middle"
                      dominant-baseline="middle">${accGlyph}</text>
            `;
        }

        // 덧줄 (오선지 밖의 음표)
        svg += this.createLedgerLines(x, pitchPos, staffTop, noteColor);

        // 기둥 방향 결정 (B4 이상=아래로, B4 미만=위로). B4 pitchPos = 1.5.
        const stemDown = pitchPos <= 1.5;

        // 음표 머리 (Bravura 글리프)
        const noteheadGlyph = this.smufl[durationInfo.notehead];

        svg += `
            <text x="${x}" y="${noteY}"
                  font-family="Bravura, 'Bravura Text'"
                  font-size="${this.fontSize}"
                  fill="${noteColor}"
                  text-anchor="middle"
                  dominant-baseline="middle">${noteheadGlyph}</text>
        `;

        // 점음표 (augmentation dot)
        if (isDotted) {
            const dotX = x + this.lineSpacing * 0.9;  // 음표 머리 오른쪽
            const dotY = noteY;

            svg += `
                <text x="${dotX}" y="${dotY}"
                      font-family="Bravura, 'Bravura Text'"
                      font-size="${this.fontSize * 0.8}"
                      fill="${noteColor}"
                      text-anchor="middle"
                      dominant-baseline="middle">${this.smufl.augmentationDot}</text>
            `;
        }

        // 기둥 (stem) - SVG line으로 직접 그리기 (skipStem이면 생략)
        if (durationInfo.stem && !skipStem) {
            const { stemX, stemStartY, stemEndY } = this.getStemPosition(x, pitchPos, staffTop, stemDown);

            svg += `<line x1="${stemX}" y1="${stemStartY}" x2="${stemX}" y2="${stemEndY}"
                         stroke="${noteColor}" stroke-width="1.2"/>`;

            // 꼬리 (flag) - Bravura 글리프 (연결선이 있으면 생략)
            if (durationInfo.flag && !skipFlag) {
                const flagGlyph = this.getFlag(durationInfo.flag, stemDown);
                const flagOffsetY = stemDown ? this.flagOffsetYDown : this.flagOffsetYUp;

                svg += `
                    <text x="${stemX + this.flagOffsetX}" y="${stemEndY + flagOffsetY}"
                          font-family="Bravura, 'Bravura Text'"
                          font-size="${this.fontSize}"
                          fill="${noteColor}"
                          text-anchor="start"
                          dominant-baseline="middle">${flagGlyph}</text>
                `;
            }
        }

        // 페르마타 (음표 위)
        // - 최소 오선지 위쪽에 위치
        // - 음표 머리(stemUp이면 stem top)보다 위에 위치
        if (fermata) {
            const noteTopY = stemDown
                ? (noteY - this.lineSpacing * 0.55)              // 머리 위
                : (noteY - this.stemHeight + this.stemStartOffsetUp); // stem 위
            const fermataY = Math.min(staffTop - this.lineSpacing * 0.3, noteTopY - this.lineSpacing * 0.4);
            svg += `
                <text x="${x}" y="${fermataY}"
                      font-family="Bravura, 'Bravura Text'"
                      font-size="${this.fontSize}"
                      fill="${noteColor}"
                      text-anchor="middle"
                      dominant-baseline="alphabetic">${this.smufl.fermataAbove}</text>
            `;
        }

        return svg;
    }

    /**
     * 꼬리 글리프 가져오기
     */
    getFlag(flagType, stemDown) {
        if (flagType === '8th') {
            return stemDown ? this.smufl.flag8thDown : this.smufl.flag8thUp;
        } else if (flagType === '16th') {
            return stemDown ? this.smufl.flag16thDown : this.smufl.flag16thUp;
        }
        return '';
    }

    /**
     * 기둥(stem) 위치 계산 헬퍼 메서드
     * @param {number} x - 음표 X 좌표
     * @param {number} pitchPos - 음높이 위치 (pitchMap 값)
     * @param {number} staffTop - 오선지 상단 Y 좌표
     * @param {boolean} stemDown - 기둥 방향 (true: 아래로, false: 위로)
     * @returns {Object} { noteY, stemX, stemStartY, stemEndY }
     */
    getStemPosition(x, pitchPos, staffTop, stemDown) {
        const noteY = staffTop + (pitchPos * this.lineSpacing);
        const stemOffset = stemDown ? this.lineSpacing * 0.4 : this.lineSpacing * 0.5;
        const stemX = stemDown ? x - stemOffset : x + stemOffset;
        const stemStartY = stemDown
            ? noteY + this.stemStartOffsetDown
            : noteY + this.stemStartOffsetUp;
        const stemEndY = stemDown
            ? noteY + this.stemHeight + this.stemStartOffsetDown
            : noteY - this.stemHeight + this.stemStartOffsetUp;
        return { noteY, stemX, stemStartY, stemEndY };
    }

    /**
     * 연결선(beam) 그룹 정보 수집
     * @returns {Object} beamGroup ID -> [{index, x, pitch, duration}, ...]
     */
    collectBeamGroups(notes, charPositions, totalMargin) {
        const groups = {};

        for (let i = 0; i < notes.length; i++) {
            const note = notes[i];
            if (!note || note.beamGroup == null) continue;

            // 가사 글자 수를 넘는 음표(dangling)는 x 좌표가 없다. 그대로 두면 NaN이 되어
            // polygon 좌표가 깨지고 SVG 전체가 사라진다 — 그룹에서 빼고 일반 음표로 그린다.
            const x = charPositions[i];
            if (!Number.isFinite(x)) continue;

            if (!groups[note.beamGroup]) {
                groups[note.beamGroup] = [];
            }
            groups[note.beamGroup].push({
                index: i,
                x: x + totalMargin,
                pitch: note.pitch,
                duration: note.duration || 'q'
            });
        }

        return groups;
    }

    /**
     * 박자 -> 연결선 개수 (8분=1, 16분=2). 점(.)은 개수에 영향을 주지 않는다.
     * '8'/'8.' -> 1, '16'/'16.' -> 2, 그 외 -> 0
     */
    getBeamCount(duration) {
        const base = String(duration || '').replace(/\.+$/, '');
        if (base === '8') return 1;
        if (base === '16') return 2;
        return 0;
    }

    /**
     * 연결선(beam) SVG 생성 - 기둥도 함께 그림
     *
     * 음표마다 필요한 연결선 개수(8분=1, 16분=2)를 따로 계산해서 단계별로 그린다.
     * - 1단계 연결선: 그룹 전체를 잇는다.
     * - 2단계 이상: 그 단계가 필요한 음표들이 연속된 구간만 잇고,
     *   혼자 떨어진 음표는 부분 연결선(stub)으로 그린다.
     *   점8분+16분(당김음)이 바로 이 경우로, 16분 쪽에만 짧은 stub이 붙는다.
     *
     * @param {Array} beamNotes - 연결할 음표들 [{x, pitch, duration}, ...]
     */
    createBeams(beamNotes, staffTop) {
        if (!beamNotes || beamNotes.length < 2) return '';

        let svg = '';

        // 평균 음높이로 기둥 방향 결정
        const avgPitch = beamNotes.reduce((sum, n) => {
            return sum + (this.pitchMap[n.pitch] ?? 3);
        }, 0) / beamNotes.length;
        const stemDown = avgPitch <= 1.5;

        // 각 음표의 기둥 위치 + 필요한 연결선 개수
        const noteInfos = beamNotes.map(note => {
            const pitchPos = this.pitchMap[note.pitch] ?? 3;
            const { stemX, stemStartY, stemEndY } = this.getStemPosition(note.x, pitchPos, staffTop, stemDown);
            return {
                x: note.x, stemX, stemStartY, defaultStemEndY: stemEndY, pitchPos,
                duration: note.duration,
                // 연결선 그룹에 속한 이상 최소 1개는 그린다 (4분음표가 섞여 들어와도 깨지지 않도록)
                beams: Math.max(1, this.getBeamCount(note.duration))
            };
        });

        // 첫 번째와 마지막 음표의 기본 기둥 끝으로 연결선 기울기 결정
        const firstNote = noteInfos[0];
        const lastNote = noteInfos[noteInfos.length - 1];
        const span = lastNote.stemX - firstNote.stemX;
        const beamSlope = span === 0 ? 0 : (lastNote.defaultStemEndY - firstNote.defaultStemEndY) / span;
        const rawBeamYAt = (x) => firstNote.defaultStemEndY + beamSlope * (x - firstNote.stemX);

        // 높이 보정: 첫/끝 음표만으로 정한 연결선은 중간에 더 튀어나온 음표의 머리를 지나갈 수 있다.
        // (예: B3 … G4 … D4 에서 가운데 G4 가 빔에 붙어 보임)
        // 모든 음표의 기둥이 최소 길이(stemHeight) 이상 되도록 연결선을 머리 반대쪽으로 밀어낸다.
        // stemUp = 위로(작은 Y), stemDown = 아래로(큰 Y).
        const minStemLen = this.stemHeight;
        let shift = 0;
        noteInfos.forEach((info) => {
            const rawY = rawBeamYAt(info.stemX);
            // 기둥 길이 = 머리(stemStartY)에서 연결선까지의 거리 (양수여야 정상)
            const stemLen = stemDown ? (rawY - info.stemStartY) : (info.stemStartY - rawY);
            const deficit = minStemLen - stemLen;
            if (deficit > shift) shift = deficit;
        });
        const awayFromHead = stemDown ? 1 : -1;   // 머리에서 멀어지는 방향(기둥이 길어지는 쪽)
        const beamYAt = (x) => rawBeamYAt(x) + awayFromHead * shift;

        // 연결선은 기둥 끝에서 음표 머리 쪽으로 쌓인다. 2단계 이상은 간격을 70%로 좁힌다.
        const towardHead = stemDown ? -1 : 1;
        const levelOffset = (level) => towardHead * (this.beamThickness + this.beamSpacing * this.beamSpacingFactor) * (level - 1);

        // 각 음표의 기둥을 1단계 연결선까지 연장하여 그림
        noteInfos.forEach((info) => {
            svg += `<line x1="${info.stemX}" y1="${info.stemStartY}" x2="${info.stemX}" y2="${beamYAt(info.stemX)}"
                         stroke="${this.noteColor}" stroke-width="1.2"/>`;
        });

        // xa~xb 구간에 level 단계 연결선 하나를 사각형으로 그린다
        const beamQuad = (xa, xb, level) => {
            const ya = beamYAt(xa) + levelOffset(level);
            const yb = beamYAt(xb) + levelOffset(level);
            const t = towardHead * this.beamThickness;
            return `<polygon points="${xa},${ya} ${xb},${yb} ${xb},${yb + t} ${xa},${ya + t}"
                            fill="${this.noteColor}"/>`;
        };

        const maxLevel = noteInfos.reduce((max, info) => Math.max(max, info.beams), 1);

        for (let level = 1; level <= maxLevel; level++) {
            let i = 0;
            while (i < noteInfos.length) {
                if (noteInfos[i].beams < level) {
                    i++;
                    continue;
                }

                // 이 단계가 필요한 음표들의 연속 구간 [i, j]
                let j = i;
                while (j + 1 < noteInfos.length && noteInfos[j + 1].beams >= level) {
                    j++;
                }

                if (j > i) {
                    svg += beamQuad(noteInfos[i].stemX, noteInfos[j].stemX, level);
                } else if (level > 1) {
                    // 혼자 떨어진 음표 -> 부분 연결선(stub).
                    // 앞 음표가 있으면 뒤(왼쪽)로, 없으면 앞(오른쪽)으로 뻗는다.
                    const prev = noteInfos[i - 1];
                    const next = noteInfos[i + 1];
                    const neighbor = prev || next;
                    const direction = prev ? -1 : 1;
                    const gap = neighbor
                        ? Math.abs(noteInfos[i].stemX - neighbor.stemX)
                        : this.beamStubLength;
                    const stubLength = Math.max(1, Math.min(this.beamStubLength, gap * 0.45));
                    const xa = noteInfos[i].stemX;
                    svg += beamQuad(xa, xa + direction * stubLength, level);
                }

                i = j + 1;
            }
        }

        return svg;
    }

    /**
     * 덧줄 생성
     */
    createLedgerLines(x, pitchPos, staffTop, color) {
        let svg = '';
        const ledgerWidth = this.fontSize * 0.25;  // 덧줄 너비 축소

        if (pitchPos >= 4.5) {
            // C4 이하 보조선은 시각 중심에 맞춰 반 칸 아래로 내립니다.
            for (let i = 4.5; i <= pitchPos; i += 1) {
                const y = staffTop + ((i + 0.5) * this.lineSpacing);
                svg += `<line x1="${x - ledgerWidth}" y1="${y}" x2="${x + ledgerWidth}" y2="${y}"
                             stroke="${color}" stroke-width="1"/>`;
            }
        } else if (pitchPos <= -1.5) {
            // A5 이상 보조선은 현재 위치에서 한 칸 위로 올려서 표시합니다.
            for (let i = -1.5; i >= pitchPos; i -= 1) {
                const y = staffTop + ((i + 0.5) * this.lineSpacing);
                svg += `<line x1="${x - ledgerWidth}" y1="${y}" x2="${x + ledgerWidth}" y2="${y}"
                             stroke="${color}" stroke-width="1"/>`;
            }
        }

        return svg;
    }

    /**
     * 한 줄의 가사에 대한 오선지와 음표 SVG 생성
     * @param {string} key - 조표 문자열 (예: "4b", "Bb")
     */
    createLineNotation(chars, notes, charPositions, totalWidth, key = null, dangling = null) {
        if (!notes || notes.length === 0) return '';

        const svgHeight = this.staffHeight + this.svgExtraHeight;
        const staffTop = this.staffTopMargin;

        // 조표 파싱 및 너비 계산
        const keyInfo = this.parseKeySignature(key);
        const keyWidth = this.getKeySignatureWidth(keyInfo);

        // 추가 음표(dangling, chars 범위 밖) 폭 확보
        const danglingColor = '#d8324c';
        const extraNotes = (dangling && Array.isArray(dangling.extraNotes)) ? dangling.extraNotes : [];
        const extraSpacing = this.lineSpacing * 2.5;
        const extraWidth = extraNotes.length > 0 ? (extraNotes.length * extraSpacing + extraSpacing * 0.5) : 0;

        // SVG 전체 너비 = 가사 너비 + 음자리표 영역 + 조표 영역 + dangling 음표 영역
        const totalMargin = this.clefMargin + keyWidth;
        const fullWidth = totalWidth + totalMargin + extraWidth;

        // viewBox와 width를 일치시켜 스케일링 방지
        let svg = `<svg class="notation-svg" width="${fullWidth}" height="${svgHeight}"
                       viewBox="0 0 ${fullWidth} ${svgHeight}"
                       style="overflow: visible; margin-left: -${totalMargin}px;">`;

        // 오선지 (전체 너비에 걸쳐 그림 - 음자리표 영역부터 가사 끝까지)
        svg += this.createStaff(fullWidth, staffTop, 0);

        // 높은음자리표 (음자리표 영역 중앙에 배치)
        svg += this.createTrebleClef(this.clefMargin * 0.5, staffTop);

        // 조표 (음자리표 오른쪽에 배치)
        if (keyInfo.count > 0) {
            svg += this.createKeySignature(this.clefMargin + 5, staffTop, keyInfo);
        }

        // 연결선 그룹 수집 (2개 이상인 그룹만 실제 연결선으로 취급)
        const beamGroups = Object.values(this.collectBeamGroups(notes, charPositions, totalMargin))
            .filter(group => group.length >= 2);
        const beamedIndices = new Set();
        beamGroups.forEach(group => {
            group.forEach(n => beamedIndices.add(n.index));
        });

        // 각 글자 위에 음표 (음자리표 + 조표 영역만큼 오프셋 추가)
        for (let i = 0; i < chars.length && i < notes.length; i++) {
            if (notes[i] && notes[i].pitch) {
                const isBeamed = beamedIndices.has(i);  // 연결선 그룹 여부
                svg += this.createNote(
                    charPositions[i] + totalMargin,  // 전체 마진만큼 오프셋
                    notes[i].pitch,
                    notes[i].duration || 'q',
                    staffTop,
                    null,
                    isBeamed,  // skipFlag: 연결선 그룹이면 꼬리 생략
                    isBeamed,  // skipStem: 연결선 그룹이면 기둥도 생략 (createBeams에서 그림)
                    notes[i].accidental || null,
                    !!notes[i].fermata
                );
            }
        }

        // 연결선 렌더링
        beamGroups.forEach(group => {
            svg += this.createBeams(group, staffTop);
        });

        // Dangling notes (chars 범위 밖) — 빨간색으로 끝에 추가 표시
        if (extraNotes.length > 0) {
            const lastCharX = charPositions.length > 0
                ? charPositions[charPositions.length - 1] + totalMargin
                : totalMargin;
            extraNotes.forEach((note, idx) => {
                if (!note || !note.pitch) return;
                const ex = lastCharX + extraSpacing * (idx + 1);
                svg += this.createNote(
                    ex,
                    note.pitch,
                    note.duration || 'q',
                    staffTop,
                    danglingColor,
                    false,
                    false,
                    note.accidental || null,
                    !!note.fermata
                );
            });
        }

        svg += '</svg>';
        return svg;
    }

    /**
     * 가사 요소에 악보 추가
     * @param {string} key - 조표 문자열 (예: "4b", "Bb")
     */
    addNotationToLyrics(lyricsElement, notesData, timeSignature, key = null) {
        if (!notesData) return;

        this.defaultDuration = this.getDefaultDuration(timeSignature);
        this.currentKey = key;  // 조표 저장

        const html = lyricsElement.innerHTML;
        const lines = html.split(/<br\s*\/?>/gi);

        let newHtml = '';

        lines.forEach((line, lineIndex) => {
            const lineNotes = notesData[lineIndex];

            if (lineNotes && lineNotes.length > 0) {
                newHtml += `<div class="lyrics-line-with-notes" data-line="${lineIndex}">`;
                newHtml += `<div class="notation-container" data-line="${lineIndex}"></div>`;
                newHtml += `<div class="lyrics-line-text">${line}</div>`;
                newHtml += '</div>';
            } else {
                newHtml += `<div class="lyrics-line-text">${line}</div>`;
            }

            if (lineIndex < lines.length - 1) {
                newHtml += '<br>';
            }
        });

        lyricsElement.innerHTML = newHtml;

        requestAnimationFrame(() => {
            this.renderNotations(lyricsElement, notesData, key);
        });
    }

    /**
     * 모든 줄의 악보 렌더링
     * @param {string} key - 조표 문자열
     */
    renderNotations(lyricsElement, notesData, key = null) {
        const lineContainers = lyricsElement.querySelectorAll('.lyrics-line-with-notes');

        lineContainers.forEach((container) => {
            const lineIndex = parseInt(container.dataset.line);
            const lineNotes = notesData[lineIndex];

            if (!lineNotes) return;

            const textElement = container.querySelector('.lyrics-line-text');
            const notationContainer = container.querySelector('.notation-container');

            if (!textElement || !notationContainer) return;

            const { chars, positions, totalWidth } = this.measureCharPositions(textElement);
            const svg = this.createLineNotation(chars, lineNotes, positions, totalWidth, key);
            notationContainer.innerHTML = svg;
        });
    }

    /**
     * 텍스트 요소에서 각 글자의 위치 측정
     */
    measureCharPositions(textElement) {
        const text = textElement.textContent;
        const chars = [];
        const positions = [];

        const originalHtml = textElement.innerHTML;
        let measuringHtml = '';

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (char !== ' ' && char !== '\n') {
                chars.push(char);
                measuringHtml += `<span class="char-measure" data-index="${chars.length - 1}">${char}</span>`;
            } else {
                measuringHtml += char;
            }
        }

        textElement.innerHTML = measuringHtml;

        const charSpans = textElement.querySelectorAll('.char-measure');
        const containerRect = textElement.getBoundingClientRect();

        charSpans.forEach((span) => {
            const rect = span.getBoundingClientRect();
            const centerX = rect.left - containerRect.left + rect.width / 2;
            positions.push(centerX);
        });

        textElement.innerHTML = originalHtml;

        return {
            chars,
            positions,
            totalWidth: containerRect.width
        };
    }
}

// 전역 접근용
window.NotesEngine = NotesEngine;
