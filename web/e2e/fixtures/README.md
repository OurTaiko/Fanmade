# Embedded player audio fixture

`embedded-tone.ogg` is a generated 440 Hz sine wave: 6 seconds, stereo, 48 kHz, amplitude 0.1, encoded with libsndfile/Vorbis. It contains no third-party recording. The WebAssembly browser test also generates a PCM WAV tone in memory.
# Opus decode fixture

`embedded-tone-opus.ogg` is an original generated mono 440 Hz sine wave, encoded
with libopus at 48 kHz. It contains exactly 12,000 decoded samples (0.25 seconds),
with a 312-sample pre-skip and a final granule position of 12,312. It exercises
Opus leading/trailing trimming independently of browser-native decoding.
# Background movie fixture

`embedded-movie.mp4` is FFmpeg's generated `testsrc2` pattern: 8 seconds, 320×180,
30 fps, H.264 High (yuv420p, CRF 32), no audio track. It contains no third-party footage.
