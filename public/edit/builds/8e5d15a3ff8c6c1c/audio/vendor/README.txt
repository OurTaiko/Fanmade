Pinned software Ogg decoders, distributed separately from OurTaiko's Unity WASM.

@wasm-audio-decoders/ogg-vorbis 0.1.20
  npm SHA-1: 14c684f2a844c51b9c56f846f07f09ffd7e069f5
ogg-opus-decoder 1.7.5 (standard build, no optional speech ML model)
  npm SHA-1: aabc6f019da44acd9c127bf6f8ec298e50021602

Upstream: https://github.com/eshaz/wasm-audio-decoders
The .min.js files and their .map files are unmodified npm dist artifacts. Source
maps include the JavaScript sources. Upstream decoder glue is MIT licensed;
see wasm-audio-decoders-LICENSE.txt. Underlying library licenses remain separate:
libopus/libvorbis/libogg (BSD), puff (zlib), simple-yenc (MIT), codec-parser
(LGPL-3.0). Copies of the licenses and notices are in this directory.

Corresponding sources and rebuild instructions:
https://www.npmjs.com/package/@wasm-audio-decoders/ogg-vorbis/v/0.1.20
https://www.npmjs.com/package/ogg-opus-decoder/v/1.7.5
https://www.npmjs.com/package/codec-parser/v/2.5.0
https://github.com/eshaz/wasm-audio-decoders#building
https://github.com/xiph/opus
https://github.com/xiph/vorbis
https://github.com/xiph/ogg
https://github.com/madler/zlib/tree/master/contrib/puff

The Worker loads these independently replaceable JavaScript libraries through
importScripts. Their public OggVorbisDecoder/OggOpusDecoder interfaces are the
only integration boundary; OurTaiko does not modify the decoder libraries.

To update, npm pack the exact versions, copy the matching dist JS and source
maps, update this notice/licenses, then run the audio decoder browser tests.
