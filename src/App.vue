<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { AlertCircle, Check, ChevronDown, FileVideo2, LoaderCircle, Play, Search, Sparkles, Upload, Video } from 'lucide-vue-next'
import ResultList from './components/ResultList.vue'
import VideoTimeline from './components/VideoTimeline.vue'
import { searchVideo, uploadVideo, waitUntilReady } from './services/search'
import type { Mode, VideoJob } from './services/search'
import type { SearchResponse } from './types/search'

type Status = 'idle' | 'loading' | 'uploading' | 'processing' | 'ready' | 'searching' | 'success' | 'error'
const fileInput = ref<HTMLInputElement | null>(null)
const videoElement = ref<HTMLVideoElement | null>(null)
const videoUrl = ref('')
const videoName = ref('')
const videoSize = ref(0)
const videoId = ref('')
const duration = ref(0)
const currentTime = ref(0)
const query = ref('A person prepares and serves food.')
const topK = ref(3)
const mode = ref<Mode>('mock')
const status = ref<Status>('idle')
const stage = ref('')
const progress = ref<number | null>(null)
const inferenceMode = ref('')
const elapsed = ref<number | null>(null)
const cacheHit = ref(false)
const errorMessage = ref('')
const result = ref<SearchResponse | null>(null)
const activeMoment = ref<number | null>(null)
const stopAt = ref<number | null>(null)
let controller: AbortController | null = null
let generation = 0
const cache = new Map<string, SearchResponse>()

const canSearch = computed(() => Boolean(videoUrl.value && videoId.value && duration.value > 0 && query.value.trim()) &&
  ['ready', 'success', 'error'].includes(status.value))
const fileSizeLabel = computed(() => `${(videoSize.value / 1024 / 1024).toFixed(1)} MB`)
const busy = computed(() => ['loading', 'uploading', 'processing', 'searching'].includes(status.value))
const statusText = computed(() => ({ idle: '等待选择视频', loading: '读取视频中', uploading: '上传中', processing: '特征提取中',
  ready: '视频已就绪', searching: '检索中', success: '检索完成', error: '操作失败' })[status.value])

function cancelPending() {
  generation++
  controller?.abort()
  controller = null
  stopAt.value = null
}
function openFilePicker() { fileInput.value?.click() }
function selectFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type) && !/\.(mp4|webm|mov)$/i.test(file.name)) {
    errorMessage.value = '请选择 MP4、WebM 或 MOV 视频文件'
    if (!videoUrl.value) status.value = 'error'
    return
  }
  if (!file.size) { errorMessage.value = '视频文件为空，请重新选择'; if (!videoUrl.value) status.value = 'error'; return }
  cancelPending()
  if (videoUrl.value) URL.revokeObjectURL(videoUrl.value)
  videoUrl.value = URL.createObjectURL(file)
  videoName.value = file.name
  videoSize.value = file.size
  videoId.value = ''
  duration.value = 0
  currentTime.value = 0
  result.value = null
  activeMoment.value = null
  elapsed.value = null
  cacheHit.value = false
  errorMessage.value = ''
  status.value = 'loading'
  // Metadata is loaded before upload, so the backend can receive duration too.
  selectedFile = file
}
let selectedFile: File | null = null
async function onMetadataLoaded() {
  const value = videoElement.value?.duration ?? 0
  if (!Number.isFinite(value) || value <= 0 || !selectedFile) {
    status.value = 'error'; errorMessage.value = '无法读取视频时长，请检查文件是否可播放'; return
  }
  duration.value = value
  const file = selectedFile
  if (mode.value === 'mock') { videoId.value = `${file.name}:${file.size}:${file.lastModified}`; status.value = 'ready'; return }
  const token = ++generation
  controller = new AbortController()
  status.value = 'uploading'
  try {
    const initial = await uploadVideo(file, value, controller.signal)
    if (token !== generation) return
    const job = await waitUntilReady(initial, controller.signal, updateJob)
    if (token !== generation) return
    videoId.value = job.video_id
    inferenceMode.value = job.inference_mode || '后端未提供模型信息'
    status.value = 'ready'
  } catch (error) {
    if (token !== generation) return
    status.value = 'error'; errorMessage.value = error instanceof Error ? error.message : '上传失败'
  }
}
function updateJob(job: VideoJob) {
  status.value = job.status === 'processing' ? 'processing' : 'uploading'
  stage.value = job.stage || '预处理视频'
  progress.value = typeof job.progress === 'number' ? Math.min(100, Math.max(0, job.progress)) : null
  if (job.inference_mode) inferenceMode.value = job.inference_mode
}
function onVideoError() {
  if (status.value !== 'loading') return
  status.value = 'error'; errorMessage.value = '浏览器无法播放此视频，请换用兼容的视频编码'
}
function onTimeUpdate() {
  const player = videoElement.value
  if (!player) return
  currentTime.value = player.currentTime
  if (stopAt.value !== null && player.currentTime >= stopAt.value) { player.pause(); stopAt.value = null }
}
async function runSearch() {
  if (!canSearch.value) return
  cancelPending()
  const token = generation
  controller = new AbortController()
  const request = { video_id: videoId.value, query: query.value.trim(), top_k: topK.value }
  const key = JSON.stringify([mode.value, request])
  status.value = 'searching'; result.value = null; activeMoment.value = null; errorMessage.value = ''
  const start = performance.now()
  try {
    cacheHit.value = cache.has(key)
    const response = cache.get(key) ?? await searchVideo(request, duration.value, mode.value, controller.signal)
    if (token !== generation) return
    cache.set(key, response)
    result.value = response
    elapsed.value = Math.round(performance.now() - start)
    status.value = 'success'
  } catch (error) {
    if (token !== generation) return
    status.value = 'error'; errorMessage.value = error instanceof Error ? error.message : '检索失败，请稍后重试'
  }
}
function seekTo(time: number) {
  if (!videoElement.value) return
  stopAt.value = null
  videoElement.value.currentTime = Math.max(0, Math.min(time, duration.value))
  currentTime.value = videoElement.value.currentTime
}
function playMoment(index: number) {
  const moment = result.value?.moments[index]
  if (!moment || !videoElement.value) return
  activeMoment.value = index
  seekTo(moment.start)
  stopAt.value = moment.end
  void videoElement.value.play().catch(() => { stopAt.value = null; errorMessage.value = '播放未启动，请点击播放器的播放按钮' })
}
function resetResult() {
  if (status.value === 'searching') cancelPending()
  result.value = null; activeMoment.value = null; elapsed.value = null; cacheHit.value = false
  if (status.value === 'searching' || status.value === 'success' || status.value === 'error') {
    status.value = videoId.value ? 'ready' : (videoUrl.value ? 'error' : 'idle')
  }
}
function switchMode() {
  cancelPending()
  cache.clear()
  result.value = null; activeMoment.value = null; videoId.value = ''; elapsed.value = null
  inferenceMode.value = ''; errorMessage.value = ''; progress.value = null
  if (!selectedFile || !videoUrl.value) { status.value = 'idle'; return }
  if (duration.value <= 0) { status.value = 'loading'; return }
  if (mode.value === 'mock') { videoId.value = `${selectedFile.name}:${selectedFile.size}:${selectedFile.lastModified}`; status.value = 'ready' }
  else void onMetadataLoaded()
}
onBeforeUnmount(() => { cancelPending(); if (videoUrl.value) URL.revokeObjectURL(videoUrl.value) })
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark"><Video :size="19" stroke-width="2.4" /></span>
        <span>FrameSeek</span>
        <span class="brand-divider"></span>
        <span class="brand-subtitle">QD-DETR 视频语义定位</span>
      </div>
      <div class="system-state">
        <span class="status-dot" :class="{ 'status-error': status === 'error', 'status-busy': busy }"></span>
        {{ mode === 'mock' ? '模拟演示' : 'HTTP 接口' }} · {{ statusText }}
        <span class="model-tag">{{ mode === 'mock' ? 'Mock' : (inferenceMode || '模型待确认') }}</span>
      </div>
    </header>

    <main class="workspace">
      <section class="viewer-column">
        <div class="section-title-row">
          <div>
            <span class="eyebrow">VIDEO SOURCE</span>
            <h1>视频检索工作台</h1>
          </div>
          <button v-if="videoUrl" class="secondary-button" @click="openFilePicker">
            <Upload :size="16" /> 更换视频
          </button>
        </div>

        <div class="video-stage" :class="{ empty: !videoUrl }">
          <video
            v-if="videoUrl"
            ref="videoElement"
            :src="videoUrl"
            controls
            playsinline
            @loadedmetadata="onMetadataLoaded"
            @error="onVideoError"
            @timeupdate="onTimeUpdate"
          ></video>
          <div v-else class="upload-state">
            <span class="upload-icon"><FileVideo2 :size="30" /></span>
            <h2>载入一段视频开始分析</h2>
            <p>支持 MP4、WebM、MOV，{{ mode === 'mock' ? '模拟模式下仅在本地预览' : 'HTTP 模式下将上传到后端服务器' }}</p>
            <button class="primary-button" @click="openFilePicker">
              <Upload :size="17" /> 选择视频
            </button>
          </div>
          <input
            ref="fileInput"
            class="visually-hidden"
            type="file"
            accept="video/mp4,video/webm,video/quicktime,video/*"
            @change="selectFile"
          />
        </div>

        <div v-if="videoUrl" class="file-strip">
          <span class="file-icon"><FileVideo2 :size="18" /></span>
          <span class="file-info">
            <strong>{{ videoName }}</strong>
            <small>{{ fileSizeLabel }} · {{ Math.round(duration) }} 秒</small>
          </span>
          <span class="file-ready"><Check v-if="status === 'ready' || status === 'success'" :size="14" /><LoaderCircle v-else-if="busy" class="spin" :size="14" /> {{ statusText }}</span>
        </div>

        <p v-if="videoUrl && (busy || errorMessage)" class="operation-note" role="status">{{ errorMessage || `${statusText}${progress !== null && status === 'processing' ? ` · ${progress}%` : ''}${stage && status === 'processing' ? ` · ${stage}` : ''}` }}</p>

        <VideoTimeline
          v-if="result"
          :duration="result.duration"
          :current-time="currentTime"
          :moments="result.moments"
          :saliency-scores="result.saliency_scores"
          :clip-duration="result.clip_duration"
          :active-moment="activeMoment"
          @seek="seekTo"
          @select-moment="playMoment"
        />

        <div v-else-if="videoUrl" class="timeline-placeholder">
          <Sparkles :size="20" />
          <span>完成一次语义检索后，这里将显示相关片段与高光分布。</span>
        </div>
      </section>

      <aside class="inspector">
        <section class="query-section">
          <span class="eyebrow">TEXT QUERY</span>
          <h2>描述你想找的画面</h2>
          <label class="query-field">
            <span class="visually-hidden">视频内容描述</span>
            <textarea
              v-model="query"
              rows="4"
              maxlength="160"
              placeholder="例如：A person cuts a pizza."
              @input="resetResult"
              @keydown.ctrl.enter.prevent="runSearch"
            ></textarea>
            <span class="character-count">{{ query.length }}/160</span>
          </label>

          <div class="query-options mode-option">
            <label for="service-mode">运行模式</label>
            <div class="select-wrap"><select id="service-mode" v-model="mode" @change="switchMode"><option value="mock">Mock 演示</option><option value="http">HTTP 后端</option></select><ChevronDown :size="15" /></div>
          </div>

          <div class="query-options">
            <label for="top-k">返回结果</label>
            <div class="select-wrap">
              <select id="top-k" v-model="topK" @change="resetResult">
                <option :value="1">Top 1</option>
                <option :value="3">Top 3</option>
                <option :value="5">Top 5</option>
              </select>
              <ChevronDown :size="15" />
            </div>
          </div>

          <button class="search-button" :disabled="!canSearch" @click="runSearch">
            <LoaderCircle v-if="status === 'searching'" class="spin" :size="18" />
            <Search v-else :size="18" />
            {{ status === 'searching' ? '正在检索…' : '开始语义检索' }}
          </button>
        </section>

        <section class="result-section">
          <div class="results-heading">
            <div>
              <span class="eyebrow">MATCHES</span>
              <h2>检索结果</h2>
            </div>
            <span v-if="result" class="result-count">{{ result.moments.length }} 个片段</span>
          </div>

          <div v-if="status === 'idle' || status === 'ready' || status === 'loading' || status === 'uploading' || status === 'processing'" class="inspector-empty">
            <span><Play :size="22" /></span>
            <p>{{ busy ? statusText : videoUrl ? '输入描述并开始检索' : '请先在左侧选择视频' }}</p>
          </div>

          <div v-else-if="status === 'searching'" class="searching-state">
            <span class="scan-icon"><LoaderCircle class="spin" :size="24" /></span>
            <strong>正在建立语义匹配</strong>
            <p>{{ mode === 'mock' ? '生成模拟结果' : '等待后端推理结果' }}</p>
            <div class="loading-lines"><i></i><i></i><i></i></div>
          </div>

          <div v-else-if="status === 'error'" class="error-state">
            <AlertCircle :size="24" />
            <strong>无法完成检索</strong>
            <p>{{ errorMessage }}</p>
          </div>

          <ResultList
            v-else-if="result?.moments.length"
            :moments="result.moments"
            :active-moment="activeMoment"
            @select="playMoment"
          />

          <div v-else class="inspector-empty">
            <Search :size="22" />
            <p>没有找到匹配片段，请尝试更具体的描述。</p>
          </div>
        </section>

        <footer class="inspector-footer">
          <span>{{ mode === 'mock' ? '模拟结果，仅供演示' : (inferenceMode || '模型信息未返回') }}</span>
          <span v-if="elapsed !== null">耗时 {{ elapsed }} ms · {{ cacheHit ? '缓存命中' : '首次查询' }}</span>
        </footer>
      </aside>
    </main>
  </div>
</template>
