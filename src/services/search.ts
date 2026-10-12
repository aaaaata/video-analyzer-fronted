import type { SearchRequest, SearchResponse } from '../types/search'

const wait = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds))

function seededValue(index: number, seed: number) {
  const value = Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453
  return value - Math.floor(value)
}

export async function mockSearch(
  request: SearchRequest,
  duration: number,
): Promise<SearchResponse> {
  await wait(1100)

  if (!request.query.trim()) {
    throw new Error('请输入要查找的视频内容')
  }

  const safeDuration = Math.max(duration, 12)
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
    const start = Math.min(
      safeDuration - length,
      Math.max(0, safeDuration * ratio - length / 2 + seededValue(index, seed) * 5),
    )

    return {
      start: Number(start.toFixed(1)),
      end: Number(Math.min(start + length, safeDuration).toFixed(1)),
      score: Number(Math.max(0.58, 0.96 - index * 0.09 - seededValue(index + 8, seed) * 0.03).toFixed(3)),
    }
  })

  return {
    video_id: request.video_id,
    query: request.query,
    duration: safeDuration,
    moments: candidates.sort((a, b) => b.score - a.score),
    saliency_scores: saliency,
    clip_duration: clipDuration,
  }
}

export async function searchVideo(
  request: SearchRequest,
  duration: number,
): Promise<SearchResponse> {
  // Replace this mock with fetch('/api/search', ...) when the backend is ready.
  return mockSearch(request, duration)
}
