<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import {
  AlertCircle,
  Check,
  ChevronDown,
  FileVideo2,
  LoaderCircle,
  Play,
  Search,
  Sparkles,
  Upload,
  Video,
} from 'lucide-vue-next'
import ResultList from './components/ResultList.vue'
import VideoTimeline from './components/VideoTimeline.vue'
import { searchVideo } from './services/search'
import type { SearchResponse } from './types/search'

type Status = 'idle' | 'ready' | 'searching' | 'success' | 'error'

const fileInput = ref<HTMLInputElement | null>(null)
const videoElement = ref<HTMLVideoElement | null>(null)
const videoUrl = ref('')
const videoName = ref('')
const videoSize = ref(0)
const duration = ref(0)
const currentTime = ref(0)
const query = ref('A person prepares and serves food.')
const topK = ref(3)
const status = ref<Status>('idle')
const errorMessage = ref('')
const result = ref<SearchResponse | null>(null)
const activeMoment = ref<number | null>(null)
const stopAt = ref<number | null>(null)

const canSearch = computed(() => Boolean(videoUrl.value && query.value.trim()) && status.value !== 'searching')
const fileSizeLabel = computed(() => `${(videoSize.value / 1024 / 1024).toFixed(1)} MB`)

function openFilePicker() {
  fileInput.value?.click()
}

function selectFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!file.type.startsWith('video/')) {
    status.value = 'error'
    errorMessage.value = '请选择 MP4、WebM 或 MOV 视频文件'
    return
  }

  if (videoUrl.value) URL.revokeObjectURL(videoUrl.value)
  videoUrl.value = URL.createObjectURL(file)
  videoName.value = file.name
  videoSize.value = file.size
  duration.value = 0
  currentTime.value = 0
  result.value = null
  activeMoment.value = null
  status.value = 'ready'
  errorMessage.value = ''
}

function onMetadataLoaded() {
  duration.value = videoElement.value?.duration || 0
}

function onTimeUpdate() {
  const player = videoElement.value
  if (!player) return
  currentTime.value = player.currentTime
  if (stopAt.value !== null && player.currentTime >= stopAt.value) {
    player.pause()
    stopAt.value = null
  }
}

async function runSearch() {
  if (!canSearch.value) return
  status.value = 'searching'
  result.value = null
  activeMoment.value = null
  errorMessage.value = ''

  try {
    result.value = await searchVideo(
      {
        video_id: videoName.value || 'local-video',
        query: query.value.trim(),
        top_k: topK.value,
      },
      duration.value,
    )
    status.value = 'success'
  } catch (error) {
    status.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : '检索失败，请稍后重试'
  }
}

function seekTo(time: number) {
  if (!videoElement.value) return
  videoElement.value.currentTime = time
  currentTime.value = time
}

function playMoment(index: number) {
  const moment = result.value?.moments[index]
  if (!moment || !videoElement.value) return
  activeMoment.value = index
  seekTo(moment.start)
  stopAt.value = moment.end
  void videoElement.value.play()
}

function resetResult() {
  result.value = null
  activeMoment.value = null
  status.value = videoUrl.value ? 'ready' : 'idle'
}

onBeforeUnmount(() => {
  if (videoUrl.value) URL.revokeObjectURL(videoUrl.value)
})
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
        <span class="status-dot"></span>
        Mock 服务可用
        <span class="model-tag">CLIP · 2s</span>
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
            @timeupdate="onTimeUpdate"
          ></video>
          <div v-else class="upload-state">
            <span class="upload-icon"><FileVideo2 :size="30" /></span>
            <h2>载入一段视频开始分析</h2>
            <p>支持 MP4、WebM、MOV，本地文件不会上传到服务器</p>
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
          <span class="file-ready"><Check :size="14" /> 已就绪</span>
        </div>

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
            {{ status === 'searching' ? '正在分析视频…' : '开始语义检索' }}
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

          <div v-if="status === 'idle' || status === 'ready'" class="inspector-empty">
            <span><Play :size="22" /></span>
            <p>{{ videoUrl ? '输入描述并开始检索' : '请先在左侧选择视频' }}</p>
          </div>

          <div v-else-if="status === 'searching'" class="searching-state">
            <span class="scan-icon"><LoaderCircle class="spin" :size="24" /></span>
            <strong>正在建立语义匹配</strong>
            <p>模拟 QD-DETR 推理过程</p>
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
          <span>当前为前端 Mock 模式</span>
          <span>QD-DETR · ViT-B/32</span>
        </footer>
      </aside>
    </main>
  </div>
</template>
