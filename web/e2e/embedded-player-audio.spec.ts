import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

// Real browser + transferable buffers + bundled WASM decoders + the production jslib.
// The Unity scene host is replaced with the same decode polling protocol, so these tests
// run without a fresh Unity build. Full scene/device acceptance remains a separate test.
const webRoot = process.env.VIEW_WEB_ROOT || resolve(process.cwd(), '../../OurTaikoView_Web')
const template = resolve(webRoot, 'Assets/WebGLTemplates/OurTaikoView')
const origin = 'https://audio.test'
const parentHtml = `<!doctype html><iframe src="/frame"></iframe><script type="module">
import { PlayerAudioLoad } from '/embedded-player-audio';
import { isPlayerMessage } from '/embedded-player-protocol';
window.events = []; window.sent = []; window.currentId = ''; window.failure = '';
const frame = document.querySelector('iframe');
window.addEventListener('message', event => {
  if (!isPlayerMessage(event, frame.contentWindow, location.origin)) return;
  window.events.push(event.data);
  if (event.data.type === 'ready') { window.ready = true; return; }
  if (event.data.requestId !== window.currentId) return;
  if (window.load?.receive(event.data)) return;
  if (event.data.type === 'error') window.failure = event.data.payload.code;
});
window.beginLoad = () => {
  window.load = new PlayerAudioLoad({ audioUrl: '/song', chartText: 'test', course: 'Oni',
    mode: 'auto', audioType: 'ogg', onRequest: id => window.currentId = id,
    onError: code => window.failure = code,
    post: (message, transfer) => {
      window.sent.push({ requestId: message.requestId, mode: message.payload.audioDecode });
      frame.contentWindow.postMessage(message, location.origin, transfer);
      if (message.payload.audioBytes.byteLength !== 0) throw new Error('Not transferred');
    }
  });
  return window.load.start();
};
</script>`

const frameHtml = `<!doctype html><script src="/audio/decode.js"></script><script>
window.LibraryManager = { library: {} };
window.mergeInto = (target, values) => Object.assign(target, values);
window.UTF8ToString = value => value;
</script><script src="/OurTaikoView.jslib"></script><script src="/OurTaikoAudioDecode.jslib"></script><script>
for (const [key, value] of Object.entries(LibraryManager.library)) {
  if (!key.endsWith('__deps')) window[key.startsWith('$') ? key.slice(1) : key] = value;
}
OurTaikoAudioInit();
const params = new URLSearchParams(location.search);
if (params.has('failNative')) {
  const native = OurTaikoAudio.context.decodeAudioData.bind(OurTaikoAudio.context);
  OurTaikoAudio.context.decodeAudioData = (bytes, done, failed) => {
    const b = new Uint8Array(bytes);
    if (b[0] === 79 && b[1] === 103) { const e = new Error('Unsupported Ogg'); failed(e); return Promise.reject(e); }
    return native(bytes, done, failed);
  };
}
const emit = (type, requestId, payload) => parent.postMessage({channel:'ourtaiko-view',type,requestId,payload}, location.origin);
async function wait(buffer) {
  while (OurTaikoAudioBufferInfo(buffer, 0) === 0) await new Promise(r => setTimeout(r, 10));
  if (OurTaikoAudioBufferInfo(buffer, 0) !== 1) throw new Error('AUDIO_DECODE_FAILED');
}
window.addEventListener('message', async event => {
  if (event.source !== parent || event.origin !== location.origin || event.data.type !== 'load') return;
  const data = event.data, id = data.requestId;
  let buffer = 0, sound = 0;
  try {
    OurTaikoAudioSetDecodeMode(data.payload.audioDecode === 'software');
    window.ourTaikoPendingAudio = {requestId:id, bytes:data.payload.audioBytes};
    buffer = OurTaikoAudioDecodeTransferred(id);
    await wait(buffer);
    if (params.has('checkSound')) {
      const bytes = await (await fetch('/drum')).arrayBuffer();
      sound = OurTaikoAudioDecodeBytes(bytes);
      await wait(sound);
    }
    emit('loaded', id, {duration:OurTaikoAudioBufferInfo(buffer, 1)});
  } catch(error) { emit('error', id, {code:error.message}); }
  finally { if (buffer) OurTaikoAudioRelease(buffer); if (sound) OurTaikoAudioRelease(sound); }
});
emit('ready');
</script>`

async function fixture(
  page: import('@playwright/test').Page,
  options: { failNative: boolean; checkSound: boolean; corrupt: boolean; wavSong?: boolean } = {
    failNative: true,
    checkSound: false,
    corrupt: false,
  },
) {
  let downloads = 0
  await page.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/') {
      const query = new URLSearchParams()
      if (options.failNative) query.set('failNative', '1')
      if (options.checkSound) query.set('checkSound', '1')
      return route.fulfill({
        body: parentHtml.replace('src="/frame"', `src="/frame?${query}"`),
        contentType: 'text/html',
      })
    }
    if (url.pathname === '/frame')
      return route.fulfill({ body: frameHtml, contentType: 'text/html' })
    if (url.pathname === '/song' || url.pathname === '/drum') {
      if (url.pathname === '/song') downloads++
      let body = options.corrupt
        ? Buffer.from('OggS invalid data')
        : readFileSync(resolve('e2e/fixtures/embedded-tone.ogg'))
      if (url.pathname === '/song' && options.wavSong) {
        body = Buffer.alloc(44 + 12000 * 2)
        body.write('RIFF', 0)
        body.writeUInt32LE(body.length - 8, 4)
        body.write('WAVEfmt ', 8)
        body.writeUInt32LE(16, 16)
        body.writeUInt16LE(1, 20)
        body.writeUInt16LE(1, 22)
        body.writeUInt32LE(48000, 24)
        body.writeUInt32LE(96000, 28)
        body.writeUInt16LE(2, 32)
        body.writeUInt16LE(16, 34)
        body.write('data', 36)
        body.writeUInt32LE(24000, 40)
      }
      return route.fulfill({ body, contentType: 'audio/ogg' })
    }
    if (url.pathname.startsWith('/embedded-player-')) {
      const source = readFileSync(resolve('src', url.pathname.slice(1) + '.ts'), 'utf8')
      return route.fulfill({
        body: ts.transpileModule(source, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        }).outputText,
        contentType: 'application/javascript',
      })
    }
    if (url.pathname.endsWith('.jslib')) {
      return route.fulfill({
        body: readFileSync(resolve(webRoot, 'Assets/Plugins/WebGL', url.pathname.slice(1))),
        contentType: 'application/javascript',
      })
    }
    return route.fulfill({
      body: readFileSync(resolve(template, url.pathname.slice(1))),
      contentType: 'application/javascript',
    })
  })
  await page.goto(origin)
  await page.waitForFunction(() => (window as unknown as { ready: boolean }).ready)
  return { downloads: () => downloads }
}

test('native success sends only one request', async ({ page }) => {
  const f = await fixture(page, { failNative: false, checkSound: false, corrupt: false })
  await page.evaluate('beginLoad()')
  await page.waitForFunction("events.some(e => e.type === 'loaded')")
  expect(await page.evaluate('sent.map(s => s.mode)')).toEqual(['native'])
  expect(f.downloads()).toBe(1)
})

test('Safari-style Ogg rejection re-posts Blob once and plays through the real software decoder', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const f = await fixture(page, { failNative: true, checkSound: true, corrupt: false })
  await page.evaluate('beginLoad()')
  await page.waitForFunction("events.some(e => e.type === 'loaded')")
  expect(await page.evaluate('sent.map(s => s.mode)')).toEqual(['native', 'software'])
  expect(await page.evaluate('new Set(sent.map(s => s.requestId)).size')).toBe(2)
  expect(await page.evaluate('failure')).toBe('')
  expect(f.downloads()).toBe(1)
  expect(errors).toEqual([])
})

test('corrupt Ogg stops after software failure', async ({ page }) => {
  const f = await fixture(page, { failNative: true, checkSound: false, corrupt: true })
  await page.evaluate('beginLoad()')
  await page.waitForFunction("failure === 'AUDIO_DECODE_FAILED'")
  expect(await page.evaluate('sent.map(s => s.mode)')).toEqual(['native', 'software'])
  expect(f.downloads()).toBe(1)
})

test('a native-compatible song still retries when an Ogg drum sound fails', async ({ page }) => {
  const f = await fixture(page, {
    failNative: true,
    checkSound: true,
    corrupt: false,
    wavSong: true,
  })
  await page.evaluate('beginLoad()')
  await page.waitForFunction("events.some(e => e.type === 'loaded')")
  expect(await page.evaluate('sent.map(s => s.mode)')).toEqual(['native', 'software'])
  expect(f.downloads()).toBe(1)
  expect(await page.evaluate('failure')).toBe('')
})

test('software Opus preserves trimmed sample count and cancellation leaves the next job usable', async ({
  page,
}) => {
  await fixture(page)
  const opus = [...readFileSync(resolve('e2e/fixtures/embedded-tone-opus.ogg'))]
  const result = await page.frames()[1].evaluate(async (bytes) => {
    const w = window as unknown as {
      ourTaikoAudioDecoder: {
        decode: (
          context: AudioContext,
          bytes: ArrayBuffer,
          mode: string,
        ) => { promise: Promise<AudioBuffer>; cancel: () => void }
      }
    }
    const context = new AudioContext()
    const cancelled = w.ourTaikoAudioDecoder.decode(
      context,
      new Uint8Array(bytes).buffer,
      'software',
    )
    const caught = cancelled.promise.catch((error) => error.message)
    cancelled.cancel()
    const buffer = await w.ourTaikoAudioDecoder.decode(
      context,
      new Uint8Array(bytes).buffer,
      'software',
    ).promise
    const result = {
      cancelled: await caught,
      samples: buffer.length,
      rate: buffer.sampleRate,
      duration: buffer.duration,
    }
    await context.close()
    return result
  }, opus)
  expect(result).toEqual({
    cancelled: 'AUDIO_DECODE_CANCELLED',
    samples: 12000,
    rate: 48000,
    duration: 0.25,
  })
})
