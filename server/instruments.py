# instruments.py
import numpy as np
from scipy.signal import lfilter, butter, sosfilt

class Instrument:
    """Base class for all virtual instruments."""
    def __init__(self, sr=44100, default_dur=6.0):
        self.sr = sr
        self.default_dur = default_dur
        self.library = {}

    def midi2freq(self, m: int) -> float:
        return 440.0 * (2.0 ** ((m - 69) / 12.0))

    def generate_note(self, midi_note: int) -> np.ndarray:
        raise NotImplementedError("Subclasses must implement this.")

    def precompute(self, notes: list):
        for m in notes:
            self.library[m] = self.generate_note(m)

    def get_note_data(self, midi_note: int) -> np.ndarray:
        m = max(min(int(midi_note), max(self.library.keys())), min(self.library.keys()))
        return self.library[m]


class Piano(Instrument):
    def generate_note(self, midi_note: int) -> np.ndarray:
        n_samp = int(self.default_dur * self.sr)
        t = np.arange(n_samp, dtype=np.float32) / self.sr
        f0 = self.midi2freq(midi_note)
        norm = float(np.clip((midi_note - 21) / 87.0, 0, 1))
        B = 1.6e-4 * (1.0 - norm) + 4e-6 * norm
        brt = 0.30 + 0.70 * norm

        partials = [
            (1, 1.000, 0.35), (2, 0.720, 0.88), (3, 0.510, 1.75),
            (4, 0.350*brt, 3.10), (5, 0.240*brt, 4.90), (6, 0.160*brt, 7.20),
        ]

        sig = np.zeros(n_samp, dtype=np.float32)
        for h, amp, d0 in partials:
            fh = f0 * h * float(np.sqrt(1.0 + B * h * h))
            sig += amp * np.sin(2 * np.pi * fh * t) * np.exp(-d0 * (0.75 + 0.50 * norm) * t)

        peak = float(np.max(np.abs(sig)))
        if peak > 0: sig *= 0.40 / peak
        return sig


class Guitar(Instrument):
    def generate_note(self, midi_note: int) -> np.ndarray:
        n_out = int(self.default_dur * self.sr)
        f0 = self.midi2freq(midi_note)
        N = max(2, int(round(self.sr / f0)))
        exc = np.random.default_rng(int(midi_note)).standard_normal(N).astype(np.float64)
        a_coef = np.zeros(N + 2, dtype=np.float64)
        a_coef[0], a_coef[N], a_coef[N+1] = 1.0, -0.495, -0.495
        x_buf = np.zeros(n_out, dtype=np.float64)
        x_buf[:N] = exc
        output = lfilter([1.0], a_coef, x_buf).astype(np.float32)
        
        try:
            sos_lp = butter(2, 7000 / (self.sr/2), btype='low', output='sos')
            warm = sosfilt(sos_lp, output.astype(np.float64)).astype(np.float32)
            output = 0.72 * output + 0.28 * warm
        except Exception: pass

        peak = float(np.max(np.abs(output)))
        if peak > 0: output *= 0.40 / peak
        return output


class Strings(Instrument):
    def generate_note(self, midi_note: int) -> np.ndarray:
        n_samp = int(self.default_dur * self.sr)
        t = np.arange(n_samp, dtype=np.float32) / self.sr
        f0 = self.midi2freq(midi_note)
        sig = np.zeros(n_samp, dtype=np.float32)
        
        vibrato = 0.003 * np.sin(2 * np.pi * 5.0 * t) 
        
        for d in [-0.15, 0.0, 0.15]:
            freq = f0 + (f0 * d * 0.01)
            phase = np.cumsum((freq * (1.0 + vibrato)) / self.sr)
            sig += (2.0 * (phase % 1.0) - 1.0) * 0.3
        
        attack_len = int(0.25 * self.sr)
        if attack_len > 0 and len(sig) > attack_len:
            sig[:attack_len] *= np.linspace(0.0, 1.0, attack_len, dtype=np.float32)

        try:
            sos = butter(2, 4000 / (self.sr/2), btype='low', output='sos')
            sig = sosfilt(sos, sig)
        except Exception: pass

        peak = np.max(np.abs(sig))
        if peak > 0: sig *= 0.40 / peak
        return sig.astype(np.float32)


class Drums(Instrument):
    def __init__(self, sr=44100):
        super().__init__(sr, default_dur=2.0)

    def generate_note(self, midi_note: int) -> np.ndarray:
        t = np.arange(int(self.default_dur * self.sr), dtype=np.float32) / self.sr
        sig = np.zeros_like(t)

        if midi_note == 36: # Kick
            freqs = 150.0 * np.exp(-30.0 * t) + 40.0
            sig = np.sin(2 * np.pi * np.cumsum(freqs / self.sr)) * np.exp(-4.0 * t)
        elif midi_note == 38: # Snare
            tone = np.sin(2 * np.pi * 180 * t) * np.exp(-12.0 * t)
            noise = np.random.normal(0, 1, len(t)) * np.exp(-25.0 * t)
            try:
                sos = butter(2, 1000 / (self.sr/2), btype='high', output='sos')
                noise = sosfilt(sos, noise)
            except Exception: pass
            sig = tone + (noise * 0.8)
        elif midi_note in [42, 46]: # Hi-Hat
            decay = 35.0 if midi_note == 42 else 5.0
            noise = np.random.normal(0, 1, len(t))
            try:
                sos = butter(4, 5000 / (self.sr/2), btype='high', output='sos')
                sig = sosfilt(sos, noise) * np.exp(-decay * t)
            except Exception: pass
        elif midi_note in [41, 45, 48]: # Toms
            base_freq = 60.0 if midi_note == 41 else (100.0 if midi_note == 45 else 150.0)
            freqs = (base_freq * 1.5) * np.exp(-10.0 * t) + base_freq
            sig = np.sin(2 * np.pi * np.cumsum(freqs / self.sr)) * np.exp(-3.0 * t)
        elif midi_note in [49, 51]: # Cymbals
            decay = 2.5 if midi_note == 49 else 4.0
            noise = np.random.normal(0, 1, len(t))
            try:
                sos = butter(2, [3000/(self.sr/2), 8000/(self.sr/2)], btype='band', output='sos')
                sig = sosfilt(sos, noise) * np.exp(-decay * t)
            except Exception: pass

        peak = float(np.max(np.abs(sig)))
        if peak > 0: sig *= 0.60 / peak
        return sig
