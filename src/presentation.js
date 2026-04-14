/**
 * 찬양 프레젠테이션 엔진 (Vanilla JS) - Notes 기능 포함
 *
 * 미니멀리즘 원칙:
 * - 트랜지션 없음 (즉시 전환)
 * - 좌/우 방향키, 클릭만 지원
 * - 고정 타이포그래피
 *
 * Notes 기능:
 * - 한글 가사 위에 오선지와 음표 표시
 * - 음표 정보가 없으면 오선지 표시 안 함
 */

class PresentationEngine {
    constructor(containerId, data) {
        this.container = document.getElementById(containerId);
        this.data = data;
        this.slides = [];
        this.currentIndex = 0;
        this.options = data.options || {};

        // Notes 엔진 초기화
        this.notesEngine = window.NotesEngine ? new NotesEngine({
            staffHeight: 40,
            staffColor: '#bbb',
            noteColor: '#000'
        }) : null;

        this.init();
    }

    init() {
        this.buildSlides();
        this.applyBackgroundSettings();
        this.render();
        this.bindEvents();
        this.showSlide(0);
    }

    buildSlides() {
        const hymn = this.data.hymn;
        const songRef = this.getSongReference(hymn);
        const songTitle = this.getSongDisplayTitle(hymn);

        // 1. 타이틀 슬라이드
        this.slides.push({
            type: 'title',
            number: hymn.number,
            id: this.getSongId(hymn),
            category: this.getSongCategory(hymn),
            reference: songRef,
            title: hymn.title,
            newNumber: hymn.newNumber,
            subtitle: hymn.subtitle,
            newTitle: hymn.newTitle,
            meta: `${hymn.key} | ${hymn.timeSignature} | ${hymn.composer}`,
            timeSignature: hymn.timeSignature,
            key: hymn.key  // 조표
        });

        // 2. 각 절 슬라이드
        const verseNumbers = Object.keys(hymn.verses).sort((a, b) => parseInt(a) - parseInt(b));
        const totalVerses = verseNumbers.length;

        for (const verseNum of verseNumbers) {
            const verse = hymn.verses[verseNum];
            const slideCount = Math.max(verse.korean.length, verse.english.length);

            for (let i = 0; i < slideCount; i++) {
                // 음표 데이터 가져오기
                const notesData = verse.notes && verse.notes[i] ? verse.notes[i] : null;

                this.slides.push({
                    type: 'verse',
                    title: songTitle,
                    korean: verse.korean[i] || '',
                    english: verse.english[i] || '',
                    verseNum: verseNum,
                    totalVerses: totalVerses,
                    notes: notesData,
                    timeSignature: hymn.timeSignature,
                    key: hymn.key  // 조표
                });
            }

            // 후렴이 있으면 각 절 뒤에 추가
            if (hymn.chorus && hymn.chorus.korean.length > 0) {
                const chorus = hymn.chorus;

                for (let i = 0; i < chorus.korean.length; i++) {
                    // 후렴 음표 데이터
                    const chorusNotesData = chorus.notes && chorus.notes[i] ? chorus.notes[i] : null;

                    this.slides.push({
                        type: 'chorus',
                        title: songTitle,
                        korean: chorus.korean[i] || '',
                        english: chorus.english[i] || '',
                        totalVerses: totalVerses,
                        notes: chorusNotesData,
                        timeSignature: hymn.timeSignature,
                        key: hymn.key  // 조표
                    });
                }
            }
        }
    }

    applyBackgroundSettings() {
        if (this.options.useBackground && this.options.backgroundImage) {
            document.documentElement.style.setProperty(
                '--bg-image',
                `url('${this.options.backgroundImage}')`
            );
            document.documentElement.style.setProperty(
                '--bg-overlay-opacity',
                this.options.backgroundOpacity || 0.7
            );
        }
    }

    formatLyrics(text) {
        if (!text) return '';
        return text.replace(/<br\/>/g, '<br>');
    }

    getSongId(song) {
        return String((song && (song.id || song.number)) || '').trim();
    }

    getSongCategory(song) {
        if (song && typeof song.category === 'string' && song.category.trim()) {
            return song.category.trim();
        }

        return /^\d+$/.test(this.getSongId(song)) ? 'hymn' : 'song';
    }

    getSongReference(song) {
        if (!song) return '';
        if (this.getSongCategory(song) === 'hymn' && song.number) {
            return `${song.number}장`;
        }
        return this.getSongId(song);
    }

    getSongDisplayTitle(song) {
        const reference = this.getSongReference(song);
        if (!song || !song.title) {
            return reference;
        }
        return reference ? `${reference} ${song.title}` : song.title;
    }

    createTitleSlide(slide) {
        const bgClass = this.options.useBackground ? 'with-background' : '';
        const subtitle = slide.category === 'hymn' && slide.newNumber
            ? `새찬송가 ${slide.newNumber}장`
            : (slide.subtitle || '');

        return `
            <div class="slide title-slide ${bgClass}">
                <div class="slide-content">
                    <div class="hymn-number">${slide.reference || slide.id || ''}</div>
                    <div class="hymn-title">${slide.title}</div>
                    ${subtitle ? `<div class="hymn-subtitle">${subtitle}</div>` : ''}
                    <div class="hymn-meta">${slide.meta}</div>
                </div>
            </div>
        `;
    }

    createVerseSlide(slide, slideIndex) {
        const bgClass = this.options.useBackground ? 'with-background' : '';
        const hasNotes = this.options.showNotes && slide.notes;
        const notesClass = hasNotes ? 'with-notes' : '';

        return `
            <div class="slide ${bgClass}" data-slide-index="${slideIndex}">
                <div class="slide-content">
                    <div class="slide-title">${slide.title}</div>
                    <div class="lyrics-content ${notesClass}">
                        <div class="verse-badge"><span class="current">${slide.verseNum}절</span>/<span class="total">${slide.totalVerses}절</span></div>
                        <div class="lyrics-korean" data-has-notes="${hasNotes}">${this.formatLyrics(slide.korean)}</div>
                        ${slide.english ? `
                            <div class="lyrics-english">${this.formatLyrics(slide.english)}</div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    createChorusSlide(slide, slideIndex) {
        const bgClass = this.options.useBackground ? 'with-background' : '';
        const hasNotes = this.options.showNotes && slide.notes;
        const notesClass = hasNotes ? 'with-notes' : '';

        return `
            <div class="slide ${bgClass}" data-slide-index="${slideIndex}">
                <div class="slide-content">
                    <div class="slide-title">${slide.title}</div>
                    <div class="lyrics-content ${notesClass}">
                        <div class="chorus-badge"><span class="current">후렴</span>/<span class="total">${slide.totalVerses}절</span></div>
                        <div class="lyrics-korean" data-has-notes="${hasNotes}">${this.formatLyrics(slide.korean)}</div>
                        ${slide.english ? `
                            <div class="lyrics-english">${this.formatLyrics(slide.english)}</div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    render() {
        let html = '';

        for (let i = 0; i < this.slides.length; i++) {
            const slide = this.slides[i];
            switch (slide.type) {
                case 'title':
                    html += this.createTitleSlide(slide);
                    break;
                case 'verse':
                    html += this.createVerseSlide(slide, i);
                    break;
                case 'chorus':
                    html += this.createChorusSlide(slide, i);
                    break;
            }
        }

        this.container.innerHTML = html;
        this.slideElements = this.container.querySelectorAll('.slide');

        // Notes 렌더링
        if (this.notesEngine && this.options.showNotes) {
            this.renderAllNotes();
        }
    }

    /**
     * 모든 슬라이드의 악보 렌더링
     */
    renderAllNotes() {
        this.slideElements.forEach((slideEl, index) => {
            const slide = this.slides[index];

            if (slide.notes) {
                const koreanEl = slideEl.querySelector('.lyrics-korean');
                if (koreanEl) {
                    this.notesEngine.addNotationToLyrics(
                        koreanEl,
                        slide.notes,
                        slide.timeSignature,
                        slide.key  // 조표 전달
                    );
                }
            }
        });
    }

    showSlide(index) {
        if (index < 0 || index >= this.slides.length) return;

        this.slideElements.forEach((el, i) => {
            el.classList.toggle('active', i === index);
        });

        this.currentIndex = index;

        // 슬라이드 전환 후 악보 재렌더링 (레이아웃 변경 대응)
        if (this.notesEngine && this.options.showNotes) {
            const currentSlide = this.slides[index];
            if (currentSlide.notes) {
                requestAnimationFrame(() => {
                    const slideEl = this.slideElements[index];
                    const koreanEl = slideEl.querySelector('.lyrics-korean');
                    if (koreanEl) {
                        this.notesEngine.renderNotations(koreanEl, currentSlide.notes, currentSlide.key);
                    }
                });
            }
        }
    }

    next() {
        if (this.currentIndex < this.slides.length - 1) {
            this.showSlide(this.currentIndex + 1);
        }
    }

    prev() {
        if (this.currentIndex > 0) {
            this.showSlide(this.currentIndex - 1);
        }
    }

    goTo(index) {
        this.showSlide(index);
    }

    bindEvents() {
        // 키보드 제어
        document.addEventListener('keydown', (e) => {
            switch (e.key) {
                case 'ArrowRight':
                case ' ':
                    e.preventDefault();
                    this.next();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    this.prev();
                    break;
                case 'f':
                case 'F':
                    this.toggleFullscreen();
                    break;
                case 'Escape':
                    if (document.fullscreenElement) {
                        document.exitFullscreen();
                    }
                    break;
                case 'n':
                case 'N':
                    // N키로 악보 표시 토글
                    this.toggleNotes();
                    break;
            }
        });

        // 클릭 제어 (좌측 50% = 이전, 우측 50% = 다음)
        this.container.addEventListener('click', (e) => {
            const x = e.clientX;
            const width = window.innerWidth;

            if (x < width / 2) {
                this.prev();
            } else {
                this.next();
            }
        });
    }

    /**
     * 악보 표시 토글
     */
    toggleNotes() {
        this.options.showNotes = !this.options.showNotes;

        // 모든 슬라이드 재렌더링
        this.render();
        this.showSlide(this.currentIndex);
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    }
}

// 전역 접근용
window.PresentationEngine = PresentationEngine;
