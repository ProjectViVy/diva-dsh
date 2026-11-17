# 验收清单

主人按顺序看，全部是「现在就能做」的：

1. **听 TTS 样本**：双击 `samples/tts-native-aigc-qwen3-flash.wav` 与 `samples/tts-native-synthesizer-qwen-audio.wav`。
   两段都是「你好，我是 Diva。这是一条语音合成冒烟测试。」——听音色、听断句、听有没有爆音。
2. **看转写结果**：`probe-final.json` → `.capabilities.asr`。
   官方示例音频的那句话是「欢迎使用阿里云。」；三个模型里只有 `qwen-audio-3.0-asr-flash` 首词正确。
3. **确认 key 没有泄露**：`probe-final.json` 的 `.key` 只有 `prefix / length / sha256_12`；全仓库 grep `sk-ws-` 只命中类型名，不命中明文。
4. **定 D1**：ASR 用现成的 `qwen-audio-3.0-asr-flash`，还是去控制台开通 3.1？
5. **定 D2**：向量对照测现在做还是等 mempalace 方案定了再做？
6. **定 D3**：要不要给 `plugins/capability-hub` 写 dashscope 适配器（asr + tts + embedding 三合一，一次把 `invoke` 补上）？

## 如果你要自己复现

```powershell
$env:QWEN_WS_KEY='<你的 key>'   # 不要写进命令行参数，脚本只从环境变量读
node scripts/probe-world-gateway.mjs --key-env QWEN_WS_KEY `
  --samples <输出目录> `
  --audio-url https://dashscope.oss-cn-beijing.aliyuncs.com/audios/welcome.mp3 `
  --out <证据 JSON>
```

注意：**必须走代理出网**（见 `summary.md` 坑 1），且**不要传 base64 大请求体**。
