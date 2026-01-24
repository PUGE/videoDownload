// content.js - 简化版
let downloadBuffers = new Map();

// 检测页面中的视频
function detectVideos() {
  const videos = [];
  
  // 1. 查找 video 元素
  const videoElements = document.querySelectorAll('video');
  videoElements.forEach((video, index) => {
    const src = video.src || video.currentSrc;
    if (src && src.includes('.m3u8')) {
      videos.push({
        type: 'hls',
        url: src,
        title: video.getAttribute('title') || document.title || `视频 ${index + 1}`,
        quality: getQualityFromUrl(src),
        duration: video.duration ? formatDuration(video.duration) : null
      });
    }
  });
  
  // 2. 查找网络请求中的 m3u8
  const networkRequests = performance.getEntriesByType('resource')
    .filter(entry => entry.name.includes('.m3u8'))
    .map(entry => ({
      type: 'hls',
      url: entry.name,
      title: document.title || '网络视频',
      quality: getQualityFromUrl(entry.name),
      duration: null
    }));
  
  videos.push(...networkRequests);
  
  // 3. 查找页面中的 m3u8 链接
  const links = document.querySelectorAll('a[href*=".m3u8"], source[src*=".m3u8"]');
  links.forEach(link => {
    const url = link.href || link.src;
    if (url) {
      videos.push({
        type: 'hls',
        url: url,
        title: link.getAttribute('title') || link.textContent || document.title || '链接视频',
        quality: getQualityFromUrl(url),
        duration: null
      });
    }
  });
  
  return [...new Map(videos.map(v => [v.url, v])).values()]; // 去重
}

function getQualityFromUrl(url) {
  const qualityMap = {
    '360p': /360|low/i,
    '480p': /480|sd/i,
    '720p': /720|hd/i,
    '1080p': /1080|fullhd/i,
    '4k': /4k|2160|uhd/i
  };
  
  for (const [quality, regex] of Object.entries(qualityMap)) {
    if (regex.test(url)) return quality;
  }
  
  // 从文件名判断
  if (url.includes('360')) return '360p';
  if (url.includes('480')) return '480p';
  if (url.includes('720')) return '720p';
  if (url.includes('1080')) return '1080p';
  if (url.includes('4k')) return '4k';
  
  return 'unknown';
}

function formatDuration(seconds) {
  if (!seconds) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  return hours > 0 
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    : `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// 页面加载完成后自动检测
window.addEventListener('load', () => {
  setTimeout(() => {
    const videos = detectVideos();
    if (videos.length > 0) {
      console.log('🎬 HLS 下载器检测到视频:', videos);
    }
  }, 3000);
});

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('content收到消息:', request.action);
  
  switch (request.action) {
    case 'detectVideos':
      const videos = detectVideos();
      sendResponse({ success: true, videos: videos });
      break;
      
    case 'downloadFile':
      // 处理小文件下载
      try {
        const data = new Uint8Array(request.data);
        const blob = new Blob([data], { type: request.mimeType });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = request.fileName;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // 清理
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      break;
      
    case 'downloadProgress':
      // 显示下载进度
      sendResponse({ success: true });
      break;
      
    case 'prepareDownload':
      // 准备大文件下载
      downloadBuffers.set(request.taskId, {
        fileName: request.fileName,
        totalSize: request.totalSize,
        totalChunks: request.totalChunks,
        receivedChunks: 0,
        chunks: new Array(request.totalChunks),
        startTime: Date.now()
      });
      sendResponse({ success: true });
      break;
      
    case 'downloadChunk':
      // 处理下载分块
      const bufferInfo = downloadBuffers.get(request.taskId);
      if (bufferInfo) {
        // 保存分块
        bufferInfo.chunks[request.chunkIndex] = new Uint8Array(request.chunkData);
        bufferInfo.receivedChunks++;
        
        // 更新进度
        const percent = Math.round((bufferInfo.receivedChunks / bufferInfo.totalChunks) * 100);
        updateDownloadProgressPanel(request.taskId, percent);
        
        // 如果是最后一个分块，开始合并
        if (request.isLast) {
          setTimeout(() => {
            finalizeLargeDownload(request.taskId);
          }, 100);
        }
      }
      sendResponse({ success: true });
      break;
      
    case 'showDownloadPanel':
      // 显示下载面板
      showSimpleDownloadPanel(request);
      sendResponse({ success: true });
      break;
      
    default:
      sendResponse({ success: false, error: '未知的操作' });
      break;
  }
  
  return true; // 异步响应
});

// 显示简单下载面板
function showSimpleDownloadPanel(data) {
  const container = document.createElement('div');
  container.id = 'hls-simple-download';
  container.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: white;
    padding: 20px;
    border-radius: 10px;
    box-shadow: 0 5px 30px rgba(0,0,0,0.3);
    z-index: 999999;
    max-width: 600px;
    max-height: 80vh;
    overflow-y: auto;
    font-family: sans-serif;
  `;
  
  // 解析 ts 文件列表
  const tsFiles = [];
  const lines = data.m3u8Content.split('\n');
  lines.forEach((line, i) => {
    if (line.includes('.ts') && !line.startsWith('#')) {
      tsFiles.push(line.trim());
    }
  });
  
  container.innerHTML = `
    <h3 style="margin-top: 0; color: #333;">🎬 ${data.title} (${data.quality})</h3>
    
    <div style="margin: 15px 0;">
      <p><strong>找到 ${tsFiles.length} 个视频片段</strong></p>
      <p style="font-size: 14px; color: #666;">
        下载所有 .ts 文件后，使用以下方法合并：
      </p>
    </div>
    
    <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 15px 0;">
      <h4 style="margin-top: 0;">方法1：使用 FFmpeg（推荐）</h4>
      <pre style="margin: 10px 0; padding: 10px; background: #333; color: #fff; border-radius: 3px; overflow-x: auto;">
# 下载 ffmpeg: https://ffmpeg.org/
ffmpeg -i "${data.m3u8Url}" -c copy "${data.title}_${data.quality}.mp4"
      </pre>
      
      <h4>方法2：使用 N_m3u8DL-RE（最简单）</h4>
      <pre style="margin: 10px 0; padding: 10px; background: #333; color: #fff; border-radius: 3px;">
# 下载工具: https://github.com/nilaoda/N_m3u8DL-RE
N_m3u8DL-RE "${data.m3u8Url}" --workDir ./downloads
      </pre>
      
      <h4>方法3：手动合并</h4>
      <pre style="margin: 10px 0; padding: 10px; background: #333; color: #fff; border-radius: 3px;">
# 下载所有 .ts 文件到同一文件夹
# Windows: copy /b *.ts output.mp4
# Mac/Linux: cat *.ts > output.mp4
      </pre>
    </div>
    
    <div style="margin: 15px 0;">
      <button id="downloadM3U8Btn" style="padding: 10px 20px; background: #4285f4; color: white; border: none; border-radius: 5px; cursor: pointer; margin-right: 10px;">
        📥 下载 M3U8 文件
      </button>
      <button id="downloadTSListBtn" style="padding: 10px 20px; background: #34a853; color: white; border: none; border-radius: 5px; cursor: pointer;">
        📋 下载 TS 文件列表
      </button>
      <button id="closeBtn" style="padding: 10px 20px; background: #ccc; color: #333; border: none; border-radius: 5px; cursor: pointer; margin-left: 10px;">
        关闭
      </button>
    </div>
    
    <div style="font-size: 12px; color: #999; margin-top: 20px;">
      <p>提示：某些视频可能需要授权验证，建议使用方法1或2的工具下载</p>
    </div>
  `;
  
  document.body.appendChild(container);
  
  // 事件处理
  document.getElementById('closeBtn').onclick = () => container.remove();
  
  document.getElementById('downloadM3U8Btn').onclick = () => {
    const blob = new Blob([data.m3u8Content], { type: 'application/vnd.apple.mpegurl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.title}.m3u8`;
    a.click();
    URL.revokeObjectURL(url);
  };
  
  document.getElementById('downloadTSListBtn').onclick = () => {
    const tsList = tsFiles.map((url, i) => `${i + 1}. ${url}`).join('\n');
    const blob = new Blob([`# TS 文件列表 (${tsFiles.length}个)\n${tsList}`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.title}_ts_list.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };
}

// 完成大文件下载
function finalizeLargeDownload(taskId) {
  const bufferInfo = downloadBuffers.get(taskId);
  if (!bufferInfo) return;
  
  console.log(`开始合并 ${bufferInfo.totalChunks} 个分块...`);
  
  try {
    // 合并所有分块
    const totalSize = bufferInfo.totalSize;
    const merged = new Uint8Array(totalSize);
    let offset = 0;
    
    for (let i = 0; i < bufferInfo.chunks.length; i++) {
      const chunk = bufferInfo.chunks[i];
      if (chunk) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
    }
    
    // 创建 Blob 并下载
    const blob = new Blob([merged], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = bufferInfo.fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // 清理
    setTimeout(() => {
      URL.revokeObjectURL(url);
      downloadBuffers.delete(taskId);
      hideDownloadProgressPanel(taskId);
      console.log('✅ 大文件下载完成');
    }, 1000);
    
  } catch (error) {
    console.error('合并文件失败:', error);
    alert('下载失败: ' + error.message);
  }
}



// 更新下载进度
function updateDownloadProgressPanel(taskId, percent) {
  console.log(percent)
}
