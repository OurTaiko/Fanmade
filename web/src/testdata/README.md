# Synthetic MP3 fixtures

0.5-second 440 Hz sine waves generated locally using FFmpeg/libmp3lame.
`cbr.mp3` is 44100 Hz stereo, 128 kbit/s with ID3v2/Xing metadata.
`raw.mp3` is 22050 Hz mono, 64 kbit/s, with `-id3v2_version 0 -write_xing 0`.
The matching backend fixtures exercise full decoding; frontend tests exercise the lightweight header check.
