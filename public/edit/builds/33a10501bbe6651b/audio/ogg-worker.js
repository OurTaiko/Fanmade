// This worker processes one complete Ogg file at a time. Libraries/WASM compile lazily,
// decoded PCM is transferred back, and each file's decoder memory is freed in finally.
let chain = Promise.resolve();
self.onmessage = function (event) {
  const data = event.data;
  chain = chain.then(async function () {
    let decoder;
    try {
      const bytes = new Uint8Array(data.bytes);
      if (bytes.length < 28 || bytes[26] === 0) throw new Error('INVALID_OGG');
      const offset = 27 + bytes[26];
      const signature = String.fromCharCode(...bytes.subarray(offset, offset + 8));
      if (signature === 'OpusHead') {
        if (!self['ogg-opus-decoder']) importScripts('vendor/ogg-opus-decoder.min.js');
        decoder = new self['ogg-opus-decoder'].OggOpusDecoder();
      } else if (signature.startsWith('\x01vorbis')) {
        if (!self['ogg-vorbis-decoder']) importScripts('vendor/ogg-vorbis-decoder.min.js');
        decoder = new self['ogg-vorbis-decoder'].OggVorbisDecoder();
      } else throw new Error('UNSUPPORTED_OGG_CODEC');
      await decoder.ready;
      const audio = await decoder.decodeFile(bytes);
      if (audio.errors?.length || !audio.samplesDecoded) throw new Error('INVALID_OGG_AUDIO');
      self.postMessage({ id: data.id, audio: audio }, audio.channelData.map(c => c.buffer));
    } catch (error) {
      self.postMessage({ id: data.id, error: error.message || 'SOFTWARE_DECODE_FAILED' });
    } finally {
      if (decoder) decoder.free();
    }
  });
};
