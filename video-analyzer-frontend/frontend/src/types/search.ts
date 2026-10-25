export interface Moment {
  start: number
  end: number
  score: number
}

export interface SearchRequest {
  video_id: string
  query: string
  top_k: number
}

export interface SearchResponse {
  video_id: string
  query: string
  duration: number
  moments: Moment[]
  saliency_scores: number[]
  clip_duration: number
}
