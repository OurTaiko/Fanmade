import { describe, expect, it } from 'vitest'
import { isPlayerMessage, playerDrumVolume, playerLoad } from './embedded-player-protocol'
describe('embedded player boundary', () => {
  const frame = {} as Window
  const origin = 'https://player.example.com'
  const event = (
    source: Window,
    messageOrigin = origin,
    data: unknown = { channel: 'ourtaiko-view', type: 'ready' },
  ) => ({ source, origin: messageOrigin, data }) as MessageEvent
  it('accepts messages only from the configured iframe and origin', () => {
    expect(isPlayerMessage(event(frame), frame, origin)).toBe(true)
    expect(isPlayerMessage(event({} as Window), frame, origin)).toBe(false)
    expect(isPlayerMessage(event(frame, 'https://other.example.com'), frame, origin)).toBe(false)
    expect(isPlayerMessage(event(frame), null, origin)).toBe(false)
    expect(
      isPlayerMessage(
        event(frame, origin, { channel: 'other-channel', type: 'ready' }),
        frame,
        origin,
      ),
    ).toBe(false)
  })
  it('keeps practice controls in both modes and reserves replay as disabled', () => {
    const practice = playerLoad('a', 'TITLE:测试', new ArrayBuffer(4), 'Oni', 'practice')
    const auto = playerLoad('b', 'TITLE:测试', new ArrayBuffer(4), 'Edit', 'auto')
    expect(practice.payload).toMatchObject({
      practice: true,
      autoPlay: false,
      replay: false,
      course: 'Oni',
      audioDecode: 'native',
    })
    expect(auto.payload).toMatchObject({
      practice: true,
      autoPlay: true,
      replay: false,
      course: 'Edit',
    })
    expect(auto.requestId).toBe('b')
  })
})

describe('branch selection', () => {
  it('allows an explicit software decode request without changing playback mode', () => {
    const load = playerLoad(
      'soft',
      '#START\n#END',
      new ArrayBuffer(4),
      'Oni',
      'auto',
      'ogg',
      'software',
    )
    expect(load.payload).toMatchObject({ audioDecode: 'software', autoPlay: true, practice: true })
  })
  it('leaves the route to the in-game practice menu', () => {
    const load = playerLoad('a', '#START\n#END', new ArrayBuffer(4), 'Edit', 'practice', 'wav')
    expect(load.payload).not.toHaveProperty('branch')
    expect(load.payload).toMatchObject({ autoPlay: false, audioType: 'wav', course: 'Edit' })
  })
  it('sends the drum volume as an integer from 0 to 100', () => {
    expect(playerDrumVolume('a', 42.4)).toEqual({
      channel: 'ourtaiko-view',
      type: 'setDrumVolume',
      requestId: 'a',
      payload: { volume: 42 },
    })
    expect(playerDrumVolume('a', -5).payload.volume).toBe(0)
    expect(playerDrumVolume('a', 250).payload.volume).toBe(100)
    expect(playerDrumVolume('a', Number.NaN).payload.volume).toBe(100)
  })
})
