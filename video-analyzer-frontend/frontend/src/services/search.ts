import type { SearchRequest, SearchResponse } from '../types/search'

export type Mode = 'mock' | 'http'
export interface VideoJob {
  video_id: string
  duration?: number
  status: 'processing' | 'ready' | 'failed'
  stage?: string
  progress?: number
  error?: string | null
  inference_mode?: string
}

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = window.setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
  const abort = () => { window.clearTimeout(timer); reject(new DOMException('已取消', 'AbortError')) }
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
})

async function responseJson(response: Response) {
  let data: unknown
  try { data = await response.json() } catch { data = null }
  if (!response.ok) {
    const detail = data && typeof data === 'object' && 'detail' in data ? (data as { detail: unknown }).detail : null
    const message = typeof detail === 'string' ? detail : `HTTP ${response.status}`
    if (response.status === 409) throw new Error('视频仍在处理，请稍后重试')
    if (response.status === 413) throw new Error('视频文件过大，服务器拒绝上传')
    if (response.status === 415) throw new Error('服务器不支持该视频格式')
    throw new Error(`接口请求失败：${message}`)
  }
  return data
}

async function api(path: string, init: RequestInit) {
  try { return await responseJson(await fetch(path, init)) }
  catch (error) {
    if (error instanceof TypeError) throw new Error('无法连接后端服务，请检查服务器和接口地址')
    throw error
  }
}

function videoJob(value: unknown): VideoJob {
  if (!value || typeof value !== 'object') throw new Error('上传接口返回的数据格式不正确')
  const job = value as VideoJob
  if (typeof job.video_id !== 'string' || !job.video_id || !['processing', 'ready', 'failed'].includes(job.status)) {
    throw new Error('上传接口缺少有效的视频编号或状态')
  }
  return job
}

export async function uploadVideo(file: File, duration: number, signal: AbortSignal) {
  const form = new FormData()
  form.append('file', file)
  if (duration > 0) form.append('duration', String(duration))
  return videoJob(await api('/api/videos', { method: 'POST', body: form, signal }))
}

export async function waitUntilReady(initial: VideoJob, signal: AbortSignal, onUpdate: (job: VideoJob) => void) {
  let job = initial
  onUpdate(job)
  for (let attempt = 0; job.status === 'processing' && attempt < 120; attempt++) {
    await wait(1500, signal)
    job = videoJob(await api(`/api/videos/${encodeURIComponent(job.video_id)}`, { signal }))
    onUpdate(job)
  }
  if (job.status === 'failed') throw new Error(job.error || '视频预处理失败')
  if (job.status !== 'ready') throw new Error('视频处理等待超时，请稍后重新上传')
  return job
}

export function validateResult(value: unknown, videoDuration: number): SearchResponse {
  if (!value || typeof value !== 'object') throw new Error('检索接口返回的数据格式不正确')
  const result = value as SearchResponse
  const duration = videoDuration > 0 ? videoDuration : result.duration
  if (!Number.isFinite(duration) || duration <= 0 || !Array.isArray(result.moments) ||
      !Array.isArray(result.saliency_scores) || !Number.isFinite(result.clip_duration) || result.clip_duration <= 0) {
    throw new Error('检索结果缺少有效的时长、片段或高光数据')
  }
  if (result.moments.some(m => !Number.isFinite(m.start) || !Number.isFinite(m.end) ||
      !Number.isFinite(m.score) || m.start < 0 || m.start >= m.end || m.end > duration + 0.5 ||
      m.score < 0 || m.score > 1) || result.saliency_scores.some(s => !Number.isFinite(s))) {
    throw new Error('检索结果的时间边界或分数无效')
  }
  return { ...result, duration, moments: [...result.moments].sort((a, b) => b.score - a.score) }
}

function seededValue(index: number, seed: number) {
  const value = Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453
  return value - Math.floor(value)
}

export async function mockSearch(request: SearchRequest, duration: number, signal?: AbortSignal): Promise<SearchResponse> {
  await wait(1100, signal)
  const safeDuration = Math.max(duration, 0.1)
  const seed = [...request.query].reduce((total, char) => total + char.charCodeAt(0), 0)
  const clipDuration = 2
  const clipCount = Math.max(1, Math.ceil(safeDuration / clipDuration))
  const saliency = Array.from({ length: clipCount }, (_, index) => {
    const wave = (Math.sin(index * 0.42 + seed) + 1) * 0.42
    return Number((wave + seededValue(index, seed) * 0.55).toFixed(4))
  })
  const candidates = Array.from({ length: Math.min(request.top_k, 5) }, (_, index) => {
    const ratio = (index + 1) / (request.top_k + 1)
    const length = Math.min(8 + seededValue(index + 20, seed) * 10, safeDuration * 0.3)
    const start = Math.min(safeDuration - length,
      Math.max(0, safeDuration * ratio - length / 2 + seededValue(index, seed) * 5))
    return { start: Number(start.toFixed(3)), end: Number(Math.min(start + length, safeDuration).toFixed(3)),
      score: Number(Math.max(0.58, 0.96 - index * 0.09 - seededValue(index + 8, seed) * 0.03).toFixed(3)) }
  })
  return { video_id: request.video_id, query: request.query, duration: safeDuration,
    moments: candidates, saliency_scores: saliency, clip_duration: clipDuration }
}

export async function searchVideo(request: SearchRequest, duration: number, mode: Mode, signal: AbortSignal) {
  const raw = mode === 'mock' ? await mockSearch(request, duration, signal) :
    await api('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request), signal })
  return validateResult(raw, duration)
}
