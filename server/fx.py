# fx.py
import numpy as np

class FXProcessor:
    """Encapsulates all digital effects and their state buffers."""
    def __init__(self, sr=44100):
        self.sr = sr
        
        # Delay State
        self.delay_maxn = sr * 3
        self.delay_buf = np.zeros(self.delay_maxn, dtype=np.float32)
        self.delay_wptr = 0

        # Reverb State
        self.rev_comb_d = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116]
        self.rev_cbufs = [np.zeros(d, dtype=np.float32) for d in self.rev_comb_d]
        self.rev_cptrs = [0] * len(self.rev_comb_d)

        # Tremolo State
        self.lfo_phase = 0.0

    def apply_tremolo(self, sig: np.ndarray, rate: float, depth: float) -> np.ndarray:
        n = len(sig)
        t_rel = self.lfo_phase + np.arange(n, dtype=np.float32) / self.sr
        lfo = 1.0 - depth * (0.5 - 0.5 * np.cos(2.0 * np.pi * rate * t_rel))
        self.lfo_phase = float(t_rel[-1]) % (1.0 / max(rate, 0.01))
        return (sig * lfo).astype(np.float32)

    def apply_delay(self, sig: np.ndarray, delay_time: float, feedback: float, level: float) -> np.ndarray:
        n = len(sig)
        d_samp = max(1, int(delay_time * self.sr))
        read_idx = (self.delay_wptr - d_samp + np.arange(n, dtype=np.int64)) % self.delay_maxn
        delayed = self.delay_buf[read_idx]
        write_idx = (self.delay_wptr + np.arange(n, dtype=np.int64)) % self.delay_maxn
        
        self.delay_buf[write_idx] = sig + feedback * delayed * 0.97
        self.delay_wptr = int((self.delay_wptr + n) % self.delay_maxn)
        
        out = sig + level * delayed
        np.clip(out, -1.5, 1.5, out=out)
        return out.astype(np.float32)

    def apply_reverb(self, sig: np.ndarray, mix: float) -> np.ndarray:
        n = len(sig)
        rev = np.zeros(n, dtype=np.float32)
        
        for i, dlen in enumerate(self.rev_comb_d):
            idx = (self.rev_cptrs[i] + np.arange(n, dtype=np.int64)) % dlen
            comb_out = self.rev_cbufs[i][idx]
            self.rev_cbufs[i][idx] = sig + 0.84 * comb_out
            self.rev_cptrs[i] = int((self.rev_cptrs[i] + n) % dlen)
            rev += comb_out
            
        rev *= 0.125
        return ((1.0 - mix) * sig + mix * rev).astype(np.float32)