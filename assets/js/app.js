// --- WEBSOCKET CLIENT CLASS ---
class AudioClient {
    constructor(url) {
        this.url = url;
        this.ws = null;
        this.dot = document.getElementById('wsDot');
        this.connect();
    }
    connect() {
        this.ws = new WebSocket(this.url);
        this.ws.addEventListener('open', () => { if (this.dot) this.dot.className = 'ws-dot ok'; });
        this.ws.addEventListener('close', () => {
            if (this.dot) this.dot.className = 'ws-dot err';
            setTimeout(() => this.connect(), 2500);
        });
        this.ws.addEventListener('error', () => {});
    }
    send(obj) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(obj));
        }
    }
}

// --- SEQUENCER CLASS ---
class Sequencer {
    constructor() {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        this.seqInterval = null;
        this.currentStep = 0;
        this.isPlaying = false;
        this.isRecording = false;
        
        // Looper properties
        this.measureStartTime = 0;
        this.measureDuration = 0;
        
        this.initDOM();
    }
    initDOM() {
        this.bpmInput = document.getElementById('bpmInput');
        this.timeSignature = document.getElementById('timeSignature');
        this.visualizer = document.getElementById('seqVisualizer');
        this.btnPlay = document.getElementById('btnPlay');
        this.btnRec = document.getElementById('btnRec');
        this.updateVisualizer();
    }
    playClick(isAccent) {
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(isAccent ? 1200 : 800, this.audioCtx.currentTime);
        gain.gain.setValueAtTime(0.3, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.1);
        osc.start(); osc.stop(this.audioCtx.currentTime + 0.1);
    }
    updateVisualizer() {
        const beats = parseInt(this.timeSignature.value.split('/')[0]);
        this.visualizer.innerHTML = '';
        for (let i = 0; i < beats; i++) {
            const dot = document.createElement('div');
            dot.className = 'beat-dot';
            dot.id = 'beat-' + i;
            this.visualizer.appendChild(dot);
        }
    }
    togglePlay() {
        this.isPlaying = !this.isPlaying;
        if (this.isPlaying) {
            this.btnPlay.classList.add('active-play');
            this.btnPlay.textContent = '⏹';
            this.currentStep = 0;
            this.scheduleNextBeat();
        } else {
            this.btnPlay.classList.remove('active-play');
            this.btnPlay.textContent = '▶';
            clearTimeout(this.seqInterval);
            document.querySelectorAll('.beat-dot').forEach(d => d.classList.remove('active', 'active-accent'));
        }
    }
    toggleRecord() {
        this.isRecording = !this.isRecording;
        this.btnRec.classList.toggle('active-rec', this.isRecording);
    }
    scheduleNextBeat() {
        if (!this.isPlaying) return;
        const bpm = parseInt(this.bpmInput.value) || 120;
        const beats = parseInt(this.timeSignature.value.split('/')[0]);
        const msPerBeat = (60 / bpm) * 1000;
        
        // If it's the start of a measure, update the looper timing
        if (this.currentStep === 0) {
            this.measureStartTime = performance.now();
            this.measureDuration = msPerBeat * beats;
            // Dispatch a custom event so the AppController knows the loop restarted
            window.dispatchEvent(new Event('measureRestart'));
        }

        document.querySelectorAll('.beat-dot').forEach(d => d.classList.remove('active', 'active-accent'));
        const activeDot = document.getElementById('beat-' + this.currentStep);
        if (activeDot) activeDot.classList.add(this.currentStep === 0 ? 'active-accent' : 'active');

        this.playClick(this.currentStep === 0);
        this.currentStep = (this.currentStep + 1) % beats;
        this.seqInterval = setTimeout(() => this.scheduleNextBeat(), msPerBeat);
    }
}

// --- MAIN APPLICATION CONTROLLER ---
class AppController {
    constructor() {
        this.client = new AudioClient('ws://localhost:8765');
        this.sequencer = new Sequencer();
        this.isPlayable = false;
        this.activeVst = 'piano';
        this.activeSet = new Set();
        this.heldKeys = new Set();
        this.octaveShift = 0;
        this.playedNotes = new Map(); 
        
        // --- LOOPER STATE ---
        this.isOverdubbing = false;
        this.loopEvents = []; // Array to hold { timeOffset, type, id, freq, vst }
        this.playbackTimer = null;
        
        this.initSplash();
        this.initKeyboard();
        this.initFretboard(); // <-- ADD THIS LINE
        this.initEventListeners();        
        
        // Expose to window
        window.enterInstrument = this.enterInstrument.bind(this);
        window.goMenu = this.goMenu.bind(this);
        window.togglePlay = () => this.sequencer.togglePlay();
        window.updateSequencer = () => this.sequencer.updateVisualizer();
        window.toggleFX = this.toggleFX.bind(this);
        window.changeOctave = this.changeOctave.bind(this);
        window.toggleLoop = this.toggleLoop.bind(this);
        window.clearLoop = this.clearLoop.bind(this);
        
        // --- QUIT LOGIC ---
        window.quitApp = () => {
            this.client.send({ type: 'quit' });
            
            // Clear the screen and show an offline message
            document.body.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh;">
                    <h1 style="color:#ff5555; font-size:48px; letter-spacing:4px;">🔌 SYSTEM OFFLINE</h1>
                    <p style="color:#888; font-size:18px;">The audio server has been successfully shut down.</p>
                    <p style="color:#555; font-size:14px; margin-top:20px;">You can now safely close this browser tab.</p>
                </div>
            `;
        };
        
        window.toggleRecord = () => {
            this.sequencer.toggleRecord();
            const subEl = document.getElementById('lcdSub');
            const formatSelect = document.getElementById('recFormat');
            const format = formatSelect ? formatSelect.value : 'wav';
            
            if (this.sequencer.isRecording) {
                this.client.send({ type: 'start_recording', format: format });
                if (subEl) { subEl.textContent = `• REC ${format.toUpperCase()} •`; subEl.style.color = '#ff4455'; }
            } else {
                this.client.send({ type: 'stop_recording' });
                this.updateDisplay(); 
                if (subEl) subEl.style.color = ''; 
            }
        };

        // Listen for the sequencer restarting the measure to trigger playback
        window.addEventListener('measureRestart', () => this.playLoop());
    }

    // --- GUITAR UI METHODS ---
    initFretboard() {
        const fretboard = document.getElementById('fretboard');
        if (!fretboard) return;
        
        // Standard tuning MIDI notes: E4, B3, G3, D3, A2, E2
        const strings = [64, 59, 55, 50, 45, 40]; 
        const numFrets = 15; // Show 15 frets
        const singleMarkers = [3, 5, 7, 9, 15]; // Frets with single dot

        strings.forEach((openMidi, stringIdx) => {
            const stringEl = document.createElement('div');
            stringEl.className = 'guitar-string';
            // Lower strings get progressively thicker visuals
            stringEl.style.setProperty('--string-thickness', (1 + (stringIdx * 0.4)) + 'px');

            for (let fret = 0; fret <= numFrets; fret++) {
                const fretEl = document.createElement('div');
                fretEl.className = `fret fret-${fret}`;
                
                // Add fret markers (inlays)
                if (fret > 0) {
                    // Standard single dot markers (placed between D & G strings for aesthetics)
                    if (singleMarkers.includes(fret) && stringIdx === 2) {
                        const marker = document.createElement('div');
                        marker.className = 'fret-marker';
                        marker.style.top = '100%'; // Center between strings
                        fretEl.appendChild(marker);
                    }
                    // 12th fret double dots
                    if (fret === 12 && (stringIdx === 1 || stringIdx === 3)) {
                        const marker = document.createElement('div');
                        marker.className = 'fret-marker';
                        marker.style.top = '100%';
                        fretEl.appendChild(marker);
                    }
                }

                // The glowing note indicator
                const currentMidi = openMidi + fret;
                const dot = document.createElement('div');
                dot.className = 'note-dot';
                dot.dataset.midi = currentMidi;
                fretEl.appendChild(dot);
                
                // Allow users to play the guitar by clicking the fretboard directly!
                fretEl.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    // Shift the base midi back depending on octave settings so it maps properly
                    const baseMidiToPlay = currentMidi - (this.octaveShift * 12);
                    this.noteOn(baseMidiToPlay);
                    // Temporarily map it into playedNotes so mouseup releases it correctly
                    this.playedNotes.set('fret_' + currentMidi, currentMidi); 
                });

                stringEl.appendChild(fretEl);
            }
            fretboard.appendChild(stringEl);
        });
    }

    updateFretboard(actualMidi, isOn) {
        // Find ALL positions on the neck where this note exists and highlight them
        const dots = document.querySelectorAll(`.note-dot[data-midi="${actualMidi}"]`);
        dots.forEach(dot => {
            if (isOn) dot.classList.add('active');
            else dot.classList.remove('active');
        });
    }

    // --- LOOPER METHODS ---
    toggleLoop() {
        // Automatically start the sequencer if it's not running
        if (!this.sequencer.isPlaying) this.sequencer.togglePlay();
        
        this.isOverdubbing = !this.isOverdubbing;
        document.getElementById('btnLoop').classList.toggle('active-loop', this.isOverdubbing);
        
        const subEl = document.getElementById('lcdSub');
        if (this.isOverdubbing && subEl) {
            subEl.textContent = '• OVERDUB •';
            subEl.style.color = '#8899ff';
        } else {
            this.updateDisplay();
            if (subEl) subEl.style.color = '';
        }
    }

    clearLoop() {
        this.loopEvents = [];
        this.client.send({ type: 'param', name: 'stop_all', val: 0 }); // Optional panic button effect
        
        const subEl = document.getElementById('lcdSub');
        if (subEl) {
            subEl.textContent = 'LOOP CLEARED';
            setTimeout(() => this.updateDisplay(), 1000);
        }
    }

    recordLoopEvent(type, id, freq) {
        if (!this.isOverdubbing || !this.sequencer.isPlaying) return;
        
        // Calculate exactly when in the measure this note was played
        const timeOffset = performance.now() - this.sequencer.measureStartTime;
        
        this.loopEvents.push({
            timeOffset: timeOffset,
            type: type,
            id: id,
            freq: freq,
            vst: this.activeVst // Bind the current instrument to the event!
        });
    }

    playLoop() {
        if (this.loopEvents.length === 0) return;
        
        // Schedule all recorded events for this measure
        this.loopEvents.forEach(ev => {
            setTimeout(() => {
                // If user stops sequencer mid-loop, don't play
                if (!this.sequencer.isPlaying) return;
                
                if (ev.type === 'note_on') {
                    // Send to backend WITH the specific vst name
                    this.client.send({ type: 'note_on', id: ev.id, freq: ev.freq, vst: ev.vst });
                } else if (ev.type === 'note_off') {
                    this.client.send({ type: 'note_off', id: ev.id });
                }
            }, ev.timeOffset);
        });
    }

    initSplash() {
        const canvas = document.getElementById('particles');
        const ctx = canvas.getContext('2d');
        const resize = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
        resize(); window.addEventListener('resize', resize);
        
        const DOTS = Array.from({ length: 90 }, () => ({
            x: Math.random() * innerWidth, y: Math.random() * innerHeight,
            r: Math.random() * 1.6 + 0.4, vy: -(Math.random() * 0.4 + 0.1),
            vx: (Math.random() - 0.5) * 0.2, a: Math.random() * 0.5 + 0.1,
            hue: Math.random() > 0.7 ? 340 : 220
        }));
        
        let raf;
        const loop = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            DOTS.forEach(d => {
                d.x = (d.x + d.vx + canvas.width) % canvas.width;
                d.y = (d.y + d.vy + canvas.height) % canvas.height;
                ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
                ctx.fillStyle = `hsla(${d.hue},80%,70%,${d.a})`; ctx.fill();
            });
            raf = requestAnimationFrame(loop);
        };
        loop();

        const letters = document.querySelectorAll('.splash-logo span');
        letters.forEach((l, i) => setTimeout(() => l.classList.add('vis'), 500 + i * 130));
        setTimeout(() => document.querySelector('.splash-sub').classList.add('vis'), 1400);
        setTimeout(() => {
            document.getElementById('splash').classList.add('out');
            document.getElementById('menu').classList.remove('out');
            cancelAnimationFrame(raf);
        }, 3200);
    }

    initKeyboard() {
        this.LAYOUT = [
            { type:'white', note:'C3',  midi:48, kbd:'Z' }, { type:'black', note:'C#3', midi:49, kbd:'S' },
            { type:'white', note:'D3',  midi:50, kbd:'X' }, { type:'black', note:'D#3', midi:51, kbd:'D' },
            { type:'white', note:'E3',  midi:52, kbd:'C' }, { type:'white', note:'F3',  midi:53, kbd:'V' },
            { type:'black', note:'F#3', midi:54, kbd:'G' }, { type:'white', note:'G3',  midi:55, kbd:'B' },
            { type:'black', note:'G#3', midi:56, kbd:'H' }, { type:'white', note:'A3',  midi:57, kbd:'N' },
            { type:'black', note:'A#3', midi:58, kbd:'J' }, { type:'white', note:'B3',  midi:59, kbd:'M' },
            { type:'white', note:'C4',  midi:60, kbd:'Q' }, { type:'black', note:'C#4', midi:61, kbd:'2' },
            { type:'white', note:'D4',  midi:62, kbd:'W' }, { type:'black', note:'D#4', midi:63, kbd:'3' },
            { type:'white', note:'E4',  midi:64, kbd:'E' }, { type:'white', note:'F4',  midi:65, kbd:'R' },
            { type:'black', note:'F#4', midi:66, kbd:'5' }, { type:'white', note:'G4',  midi:67, kbd:'T' },
            { type:'black', note:'G#4', midi:68, kbd:'6' }, { type:'white', note:'A4',  midi:69, kbd:'Y' },
            { type:'black', note:'A#4', midi:70, kbd:'7' }, { type:'white', note:'B4',  midi:71, kbd:'U' },
            { type:'white', note:'C5',  midi:72, kbd:'I' }, { type:'black', note:'C#5', midi:73, kbd:'9' },
            { type:'white', note:'D5',  midi:74, kbd:'O' }, { type:'black', note:'D#5', midi:75, kbd:'0' },
            { type:'white', note:'E5',  midi:76, kbd:'P' }
        ];
        this.kbdMap = {};
        this.keyElems = {};
        this.drumMap = {};
        
        this.LAYOUT.forEach(d => { this.kbdMap[d.kbd.toLowerCase()] = d; });
        
        const bed = document.getElementById('keyBed');
        this.LAYOUT.filter(d => d.type === 'white').forEach(def => {
            const el = document.createElement('div'); el.className = 'wk'; el.dataset.midi = def.midi;
            const kh = document.createElement('span'); kh.className = 'kb-hint'; kh.textContent = def.kbd;
            el.appendChild(kh); bed.appendChild(el); this.keyElems[def.midi] = el;
        });
        
        requestAnimationFrame(() => {
            this.LAYOUT.filter(d => d.type === 'black').forEach(def => {
                const leftEl = this.keyElems[def.midi - 1]; if (!leftEl) return;
                const leftPos = leftEl.getBoundingClientRect().right - bed.getBoundingClientRect().left - 12 + 2;
                const el = document.createElement('div'); el.className = 'bk'; el.dataset.midi = def.midi; el.style.left = leftPos + 'px';
                const kh = document.createElement('span'); kh.className = 'kb-hint'; kh.textContent = def.kbd;
                el.appendChild(kh); bed.appendChild(el); this.keyElems[def.midi] = el;
            });
        });

        document.querySelectorAll('.drum-pad').forEach(pad => {
            const note = parseInt(pad.getAttribute('data-note'));
            const key = pad.getAttribute('data-key').toLowerCase();
            this.drumMap[key] = note;
            pad.addEventListener('mousedown', () => this.hitDrum(note, pad));
        });
    }

    initEventListeners() {
        document.addEventListener('keydown', e => {
            if (!this.isPlayable) return;
            const key = e.key.toLowerCase();
            if (e.repeat || this.heldKeys.has(key)) return;
            this.heldKeys.add(key);
            
            if (this.activeVst === 'drums') {
                if (this.drumMap[key]) {
                    e.preventDefault();
                    this.hitDrum(this.drumMap[key], document.querySelector(`.drum-pad[data-key="${key}"]`));
                }
            } else {
                if (this.kbdMap[key]) this.noteOn(this.kbdMap[key].midi);
            }
        });

        document.addEventListener('keyup', e => {
            const key = e.key.toLowerCase(); this.heldKeys.delete(key);
            if (this.activeVst !== 'drums' && this.kbdMap[key]) this.noteOff(this.kbdMap[key].midi);
        });

        const bed = document.getElementById('keyBed');
        bed.addEventListener('mousedown', e => {
            const el = e.target.closest('[data-midi]');
            if (el) this.noteOn(+el.dataset.midi);
        });
        document.addEventListener('mouseup', () => {
            if(this.activeVst !== 'drums') this.releaseAllNotes();
        });

        this.pitchBend = 0;
        this.handle = document.getElementById('pitchHandle');
        document.addEventListener('keydown', e => {
            if (!this.isPlayable || this.activeVst === 'drums') return;
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                this.pitchBend = Math.max(-2, Math.min(2, this.pitchBend + (e.key === 'ArrowUp' ? 0.5 : -0.5)));
                if (this.handle) this.handle.style.top = (37 - (this.pitchBend / 2) * 32) + 'px';
                this.client.send({ type:'param', name:'pitch_bend', val:this.pitchBend });
            }
        });
        document.addEventListener('keyup', e => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                this.pitchBend = 0;
                if (this.handle) this.handle.style.top = '37px';
                this.client.send({ type:'param', name:'pitch_bend', val:0 });
            }
        });

        this.tuneVal = 0;
        const tuneKnob = document.getElementById('tuneKnob');
        if (tuneKnob) {
            tuneKnob.addEventListener('wheel', e => {
                e.preventDefault(); 
                this.tuneVal = Math.max(-2, Math.min(2, this.tuneVal - (e.deltaY > 0 ? 0.1 : -0.1)));
                this.tuneVal = Math.round(this.tuneVal * 10) / 10; 
                tuneKnob.style.setProperty('--angle', (this.tuneVal * 45) + 'deg');
                this.client.send({ type:'param', name:'tune', val:this.tuneVal });
            }, { passive:false });
        }
        
        this.fxState = { tremolo:false, delay:false, reverb:false };
        
        document.querySelectorAll('.knob[data-param]').forEach(knob => {
            const min = parseFloat(knob.dataset.min);
            const max = parseFloat(knob.dataset.max); 
            let val = parseFloat(knob.dataset.val), startY = 0, startV = val, active = false;
            
            const setAngle = v => knob.style.setProperty('--angle', (((v - min) / (max - min)) * 270 - 135) + 'deg');
            setAngle(val); 
            
            knob.addEventListener('mousedown', e => { 
                if (!knob.closest('.module').classList.contains('active')) return; 
                active = true; startY = e.clientY; startV = val; e.preventDefault(); 
            });
            
            document.addEventListener('mousemove', e => { 
                if (!active) return; 
                val = Math.max(min, Math.min(max, startV + (startY - e.clientY) / 150 * (max - min))); 
                setAngle(val); 
                this.client.send({ type:'param', name: knob.dataset.param, val }); 
            });
            
            document.addEventListener('mouseup', () => active = false);
        });

        const xyCanvas = document.getElementById('xyPad');
        if (xyCanvas) {
            const xyCtx = xyCanvas.getContext('2d');
            let isDraggingXY = false;
            
            const drawXY = (x, y) => {
                xyCtx.clearRect(0, 0, xyCanvas.width, xyCanvas.height);
                xyCtx.strokeStyle = '#2a2a3a'; xyCtx.beginPath(); 
                xyCtx.moveTo(xyCanvas.width/2, 0); xyCtx.lineTo(xyCanvas.width/2, xyCanvas.height); xyCtx.stroke();
                xyCtx.beginPath(); 
                xyCtx.moveTo(0, xyCanvas.height/2); xyCtx.lineTo(xyCanvas.width, xyCanvas.height/2); xyCtx.stroke();
                xyCtx.strokeStyle = '#ff4455'; xyCtx.beginPath(); 
                xyCtx.arc(x * xyCanvas.width, (1 - y) * xyCanvas.height, 6, 0, Math.PI * 2); xyCtx.stroke();
            };
            
            const resizeXY = () => { 
                xyCanvas.width = xyCanvas.parentElement.getBoundingClientRect().width - 20; 
                drawXY(0.5, 0.5); 
            };
            window.addEventListener('resize', resizeXY); 
            setTimeout(resizeXY, 100); 
            
            const handleXY = (e) => {
                if (!isDraggingXY && e.type !== 'mousedown') return; 
                e.preventDefault();
                const rect = xyCanvas.getBoundingClientRect();
                const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
                drawXY(x, y); 
                this.client.send({ type: 'param', name: 'modulation', val: x }); 
                this.client.send({ type: 'param', name: 'expression', val: y });
            };
            
            xyCanvas.addEventListener('mousedown', e => { isDraggingXY = true; handleXY(e); });
            document.addEventListener('mousemove', handleXY); 
            document.addEventListener('mouseup', () => isDraggingXY = false);
        }
    }

    changeOctave(dir) {
        if (this.activeVst === 'drums') return;
        this.octaveShift = Math.max(-2, Math.min(2, this.octaveShift + dir));
        
        const display = document.getElementById('octaveDisplay');
        if (display) {
            display.textContent = 'OCT: ' + (this.octaveShift > 0 ? '+' : '') + this.octaveShift;
        }
    }

    midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

    noteOn(baseMidi) {
        if (!this.isPlayable) return;
        
        let actualMidi = this.activeVst === 'drums' ? baseMidi : baseMidi + (this.octaveShift * 12);
        if (this.activeSet.has(actualMidi)) return;
        
        this.activeSet.add(actualMidi);
        this.playedNotes.set(baseMidi, actualMidi); 
        if (this.keyElems[baseMidi]) this.keyElems[baseMidi].classList.add('active');
        
        const freq = this.midiToFreq(actualMidi);
        
        // --- PASS VST TO BACKEND ---
        this.client.send({ type: 'note_on', id: actualMidi, freq: freq, vst: this.activeVst });
        
        // --- RECORD EVENT TO LOOPER ---
        this.recordLoopEvent('note_on', actualMidi, freq);
        if (this.activeVst === 'guitar') this.updateFretboard(actualMidi, true);
        
        this.updateDisplay();
    }

    noteOff(baseMidi) {
        const actualMidi = this.playedNotes.get(baseMidi);
        if (actualMidi === undefined) return;
        
        this.playedNotes.delete(baseMidi);
        this.activeSet.delete(actualMidi);
        if (this.keyElems[baseMidi]) this.keyElems[baseMidi].classList.remove('active');
        
        this.client.send({ type: 'note_off', id: actualMidi });
        
        // --- RECORD EVENT TO LOOPER ---
        this.recordLoopEvent('note_off', actualMidi, 0);
        if (this.activeVst === 'guitar') this.updateFretboard(actualMidi, false);
        this.updateDisplay();
    }

    releaseAllNotes() { 
        [...this.playedNotes.keys()].forEach(baseMidi => {
            // Support releasing clicked fretboard notes
            if (typeof baseMidi === 'string' && baseMidi.startsWith('fret_')) {
                const actualMidi = this.playedNotes.get(baseMidi);
                this.playedNotes.delete(baseMidi);
                this.activeSet.delete(actualMidi);
                this.client.send({ type: 'note_off', id: actualMidi });
                if (this.activeVst === 'guitar') this.updateFretboard(actualMidi, false);
            } else {
                this.noteOff(baseMidi);
            }
        }); 
    }

    hitDrum(midiNote, padElement) {
        if(!this.isPlayable) return;
        
        this.client.send({ type: 'note_on', id: midiNote, freq: 0, vst: 'drums' });
        this.recordLoopEvent('note_on', midiNote, 0);
        
        if (padElement) {
            padElement.classList.add('active');
            setTimeout(() => padElement.classList.remove('active'), 80);
        }
    }

    updateDisplay() {
        if (this.activeVst === 'drums' || this.isOverdubbing) return; // Don't override special states
        const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
        let info = { lcd: this.activeVst.toUpperCase(), sub: 'READY', isChord:false };
        
        const midis = [...this.activeSet];
        if (midis.length === 1) {
            info = { lcd: NOTE_NAMES[midis[0] % 12] + Math.floor(midis[0]/12 - 1), sub: 'Single Note', isChord:false };
        } else if (midis.length > 1) {
            const pcs = [...new Set(midis.map(m => m % 12))].sort((a,b) => a-b);
            info = { lcd: pcs.map(p => NOTE_NAMES[p]).join(' '), sub: pcs.length + ' notes', isChord: true };
        }

        const lcdEl = document.getElementById('lcd');
        const subEl = document.getElementById('lcdSub');
        if(lcdEl) lcdEl.textContent = info.lcd;
        if(subEl) subEl.textContent = info.sub;
        if(lcdEl) lcdEl.className = 'lcd' + (info.isChord ? ' chord' : '');
    }

    goMenu() {
        this.releaseAllNotes();
        document.getElementById('menu').classList.remove('out');
        document.body.classList.add('locked');
        this.isPlayable = false;
        if(this.sequencer.isPlaying) this.sequencer.togglePlay();
        if(this.isOverdubbing) this.toggleLoop(); // Turn off overdub if exiting
    }

    enterInstrument(vst) {
        this.activeVst = vst;
        document.getElementById('menu').classList.add('out');
        document.body.classList.remove('locked');
        this.client.send({ type: 'switch', vst: vst });
        this.isPlayable = true;

        if (vst === 'drums') {
            document.getElementById('melodic-ui').style.display = 'none';
            document.getElementById('drum-ui').style.display = 'flex';
            document.getElementById('lcd').textContent = 'DRUMS';
            
            if(!this.isOverdubbing) document.getElementById('lcdSub').textContent = 'Percussion';
        } else {
            document.getElementById('melodic-ui').style.display = 'flex';
            document.getElementById('drum-ui').style.display = 'none';
            
            const guitarUI = document.getElementById('guitar-ui');
            if (guitarUI) {
                guitarUI.style.display = (vst === 'guitar') ? 'flex' : 'none';
            }
            
            this.updateDisplay();
            
        }
    }

    toggleFX(name) {
        this.fxState[name] = !this.fxState[name];
        document.getElementById('led-' + name).classList.toggle('on', this.fxState[name]);
        document.getElementById('mod-' + name).classList.toggle('active', this.fxState[name]);
        this.client.send({ type:'param', name: name + '_on', val: this.fxState[name] });
    }
}

// Bootstrap Application
window.addEventListener('DOMContentLoaded', () => {
    window.actamApp = new AppController();
});
