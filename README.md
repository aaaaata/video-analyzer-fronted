# FrameSeek 前端 MVP

QD-DETR 视频片段检索与高光检测的 Vue 3 前端原型。

与服务器模型服务的字段和接口约定见 [前端接口说明.md](./前端接口说明.md)。

## 本地运行

```powershell
cd frontend
npm install
npm run dev
```

打开终端显示的本地地址，选择一个视频并执行查询。当前使用 mock 推理结果，不依赖 Python 后端。

## 接入后端

后端准备好后，在 `src/services/search.ts` 中将 `searchVideo` 改为请求 `/api/search`。Vite 已将 `/api` 代理到 `http://localhost:8000`。
