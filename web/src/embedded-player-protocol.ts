export const playerChannel = 'ourtaiko-view'
export type PlayerMode = 'practice' | 'auto'
export type PlayerAudioDecode = 'native' | 'software'
export function playerLoad(
  requestId: string,
  chartText: string,
  audioBytes: ArrayBuffer,
  course: string,
  mode: PlayerMode,
  audioType = 'ogg',
  audioDecode: PlayerAudioDecode = 'native',
) {
  return {
    channel: playerChannel,
    type: 'load',
    requestId,
    payload: {
      chartText,
      audioBytes,
      audioType,
      audioDecode,
      course,
      practice: true,
      autoPlay: mode === 'auto',
      replay: false,
    },
  }
}
export const defaultDrumVolume = 100
// Hit-sound volume, 0-100; the player rejects anything else.
export function playerDrumVolume(requestId: string, volume: number) {
  const value = Number.isFinite(volume) ? Math.round(Math.min(100, Math.max(0, volume))) : 100
  return {
    channel: playerChannel,
    type: 'setDrumVolume',
    requestId,
    payload: { volume: value },
  }
}
export function isPlayerMessage(
  event: MessageEvent,
  source: Window | null,
  origin: string,
): boolean {
  return (
    source !== null &&
    event.source === source &&
    event.origin === origin &&
    event.data?.channel === playerChannel &&
    typeof event.data?.type === 'string'
  )
}
