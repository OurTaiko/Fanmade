// Browser-facing adapter. Native playback always remains Web Audio; software mode replaces
// only Ogg decoding. MP3/WAV keep the browser decoder. No UA sniffing or implicit retry here.
(function () {
  'use strict';
  const workerUrl = new URL('ogg-worker.js', document.currentScript.src);
  let worker = null, current = null, nextId = 0;
  const queue = [];

  function stopWorker() {
    if (worker) worker.terminate();
    worker = null;
  }

  function finish(error, result) {
    const job = current;
    if (!job) return;
    current = null;
    clearTimeout(job.timeout);
    job.bytes = null;
    if (error) job.reject(error);
    else job.resolve(result);
    pump();
  }

  function pump() {
    if (current || !queue.length) return;
    current = queue.shift();
    const job = current;
    try {
      if (!worker) {
        worker = new Worker(workerUrl);
        worker.onmessage = function (event) {
          const data = event.data;
          if (!current || data.id !== current.id) return;
          finish(data.error ? new Error(data.error) : null, data.audio);
        };
        worker.onerror = function () {
          stopWorker();
          finish(new Error('SOFTWARE_DECODER_UNAVAILABLE'));
        };
      }
      job.timeout = setTimeout(function () {
        stopWorker();
        finish(new Error('SOFTWARE_DECODE_TIMEOUT'));
      }, 60000);
      worker.postMessage({ id: job.id, bytes: job.bytes }, [job.bytes]);
      job.bytes = null;
    } catch (error) {
      stopWorker();
      finish(error);
    }
  }

  function software(bytes, context) {
    const job = { id: ++nextId, bytes: bytes };
    const promise = new Promise(function (resolve, reject) {
      job.resolve = resolve;
      job.reject = reject;
      queue.push(job);
      pump();
    }).then(function (audio) {
      const channels = audio.channelData;
      if (!channels.length || channels.length > 32 || !audio.samplesDecoded ||
          channels.some(c => c.length !== audio.samplesDecoded)) throw new Error('INVALID_PCM');
      const buffer = context.createBuffer(channels.length, audio.samplesDecoded, audio.sampleRate);
      channels.forEach((channel, index) => buffer.copyToChannel(channel, index));
      return buffer;
    });
    return {
      promise: promise,
      cancel: function () {
        if (current === job) {
          stopWorker();
          finish(new Error('AUDIO_DECODE_CANCELLED'));
        } else {
          const index = queue.indexOf(job);
          if (index < 0) return;
          queue.splice(index, 1);
          job.bytes = null;
          job.reject(new Error('AUDIO_DECODE_CANCELLED'));
        }
      }
    };
  }

  window.ourTaikoAudioDecoder = {
    decode: function (context, bytes, mode) {
      if (mode !== 'native' && mode !== 'software') throw new Error('INVALID_AUDIO_DECODE');
      const header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 4));
      const ogg = header[0] === 79 && header[1] === 103 && header[2] === 103 && header[3] === 83;
      if (mode === 'software' && ogg) return software(bytes, context);
      return {
        // Use callbacks as well as the promise for Safari implementations with either API.
        promise: new Promise(function (resolve, reject) {
          const result = context.decodeAudioData(bytes, resolve, reject);
          if (result && result.catch) result.catch(reject);
        }),
        cancel: function () {} // Native decode cannot be cancelled; caller discards stale results.
      };
    },
    dispose: function () {
      const jobs = queue.splice(0);
      if (current) { clearTimeout(current.timeout); jobs.push(current); current = null; }
      stopWorker();
      jobs.forEach(function (job) { job.bytes = null; job.reject(new Error('AUDIO_DECODE_CANCELLED')); });
    }
  };
  window.addEventListener('pagehide', window.ourTaikoAudioDecoder.dispose);
})();
