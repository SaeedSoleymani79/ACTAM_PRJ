# server/engine.py
import threading
import numpy as np
import sounddevice as sd

# Notice the dot (.) before the module names! 
# This means "import from the current directory"
from .instruments import Piano, Guitar, Strings, Drums
from .fx import FXProcessor


class AudioEngine:
    """Manages audio generation, mixing, and the sounddevice stream."""
    def __init__(self, sr=44100, block_size=512):
        self.sr = sr
        self.block_size = block_size
        self.fx = FXProcessor(sr)
        
        # State Management
        self.active_notes = {}
        self.notes_lock = threading.Lock()
        self.param_lock = threading.Lock()
        
        self.params = {
            "tune": 0.0, "pitch_bend": 0.0, "expression": 1.0, "modulation": 0.0,
            "tremolo_on": False, "tremolo_rate": 5.0, "tremolo_depth": 0.5,
            "delay_on": False, "delay_time": 0.33, "delay_feedback": 0.45, "delay_level": 0.50,
            "reverb_on": False, "reverb_mix": 0.40,
        }
        
        # Instantiate Instruments
        print("🔧 Precomputing Instruments (this may take a moment)...")
        self.instruments = {
            "piano": Piano(sr),
            "guitar": Guitar(sr),
            "strings": Strings(sr),
            "drums": Drums(sr)
        }
        
        self.instruments["piano"].precompute(range(36, 91))
        print("🎹 Piano ready!")
        self.instruments["guitar"].precompute(range(36, 91))
        print("🎸 Guitar ready!")
        self.instruments["strings"].precompute(range(36, 91))
        print("🎻 Strings ready!")
        self.instruments["drums"].precompute([36, 38, 41, 42, 45, 46, 48, 49, 51])
        print("🥁 Drums ready!\n✅ Engine fully loaded!")

        self.current_vst = "piano"
        self.stream = sd.OutputStream(
            samplerate=self.sr, channels=1, dtype='float32', 
            blocksize=self.block_size, callback=self.audio_callback
        )

    def start(self):
        self.stream.start()

    def set_vst(self, vst_name: str):
        if vst_name in self.instruments:
            self.current_vst = vst_name
            with self.notes_lock:
                self.active_notes.clear()

    def note_on(self, midi_id: int, freq: float):
        with self.notes_lock:
            midi_note = midi_id if self.current_vst == "drums" else round(12 * np.log2(max(freq, 8.0) / 440.0) + 69)
            inst = self.instruments[self.current_vst]
            self.active_notes[midi_id] = {
                'data': inst.get_note_data(midi_note),
                'pos': 0.0,
                'on': True,
                'rel_pos': 0.0
            }

    def note_off(self, midi_id: int):
        with self.notes_lock:
            if midi_id in self.active_notes:
                self.active_notes[midi_id]['on'] = False

    def update_param(self, name: str, value: float):
        with self.param_lock:
            if name in self.params:
                self.params[name] = value

    def audio_callback(self, outdata: np.ndarray, frames: int, time_info, status) -> None:
        mixed = np.zeros(frames, dtype=np.float32)
        
        with self.param_lock:
            p = self.params.copy()
            
        semitones = float(p['tune']) + float(p['pitch_bend'])
        speed = float(2.0 ** (semitones / 12.0))

        with self.notes_lock:
            dead = []
            for nid, note in list(self.active_notes.items()):
                data, pos, dlen = note['data'], float(note['pos']), len(note['data'])
                if int(pos) >= dlen - 2:
                    dead.append(nid); continue

                frac_idx = pos + np.arange(frames, dtype=np.float32) * speed
                int_idx = frac_idx.astype(np.int64)
                np.clip(int_idx, 0, dlen - 2, out=int_idx)
                frac = (frac_idx - int_idx).astype(np.float32)
                chunk = data[int_idx] * (1.0 - frac) + data[int_idx + 1] * frac

                if not note['on'] and self.current_vst != "drums":
                    rel_t = float(note['rel_pos']) + np.arange(frames, dtype=np.float32) / self.sr
                    chunk *= np.exp(-18.0 * rel_t)
                    note['rel_pos'] = float(rel_t[-1])
                    if note['rel_pos'] > 0.40: dead.append(nid)

                mixed += chunk
                note['pos'] = float(frac_idx[-1] + speed)
                if int(note['pos']) >= dlen - 2: dead.append(nid)
                
            for nid in dead: 
                self.active_notes.pop(nid, None)

        mixed *= float(p['expression'])
        
        # Apply FX
        if p['tremolo_on'] or p['modulation'] > 0:
            depth = max(float(p['tremolo_depth']) if p['tremolo_on'] else 0.0, float(p['modulation']))
            mixed = self.fx.apply_tremolo(mixed, float(p['tremolo_rate']), depth)
            
        if p['delay_on']: 
            mixed = self.fx.apply_delay(mixed, float(p['delay_time']), float(p['delay_feedback']), float(p['delay_level']))
            
        if p['reverb_on']: 
            mixed = self.fx.apply_reverb(mixed, float(p['reverb_mix']))

        outdata[:, 0] = np.tanh(mixed * 0.85)