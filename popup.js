document.addEventListener('DOMContentLoaded', async () => {  // ✅ 添加 async
  const statusEl = document.getElementById('status');
  const videoInfoEl = document.getElementById('videoInfo');
  const videoDetailsEl = document.getElementById('videoDetails');
  const qualitySelectorEl = document.getElementById('qualitySelector');
  const qualitySelectEl = document.getElementById('qualitySelect');
  const downloadBtn = document.getElementById('downloadBtn');
  const progressContainer = document.getElementById('progressContainer');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const viewListBtn = document.getElementById('viewListBtn');

  let currentVideos = [];
  let currentQuality = '';
  
  // 获取当前标签页信息
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  // 发送消息给 content script 检测视频
  try {
    // 使用 await 等待响应
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'detectVideos' });
    
    if (response && response.success && response.videos && response.videos.length > 0) {
      currentVideos = response.videos;
      
      statusEl.textContent = `✅ 检测到 ${response.videos.length} 个视频`;
      statusEl.className = 'status detected';
      
      videoInfoEl.style.display = 'block';
      videoDetailsEl.innerHTML = response.videos.map(video => 
        `<li>${video.title || '未命名视频'} (${video.duration || '未知时长'})</li>`
      ).join('');
      
      // 填充质量选项
      const qualities = [...new Set(response.videos.map(v => v.quality).filter(Boolean))];
      if (qualities.length > 0) {
        qualitySelectorEl.style.display = 'block';
        qualitySelectEl.innerHTML = '<option value="">选择视频质量...</option>' +
          qualities.map(q => `<option value="${q}">${q}</option>`).join('');
      } else {
        qualitySelectorEl.style.display = 'none';
      }
      
    } else {
      statusEl.textContent = '❌ 未检测到 HLS 视频流';
      statusEl.className = 'status error';
      downloadBtn.disabled = true;
    }
  } catch (error) {
    console.error('检测视频失败:', error);
    statusEl.textContent = '❌ 无法连接到页面，请刷新页面后重试';
    statusEl.className = 'status error';
    downloadBtn.disabled = true;
  }
  
  // 质量选择变化
  qualitySelectEl.addEventListener('change', (e) => {
    currentQuality = e.target.value;
    downloadBtn.disabled = !currentQuality;
  });

  // 查看下载列表按钮点击事件
  viewListBtn.addEventListener('click', () => {
    openDownloadManager();
  });

  // 打开下载管理器
  function openDownloadManager() {
      // 方式1：打开独立的下载管理页面
      chrome.tabs.create({
          url: chrome.runtime.getURL('download.html')
      });
  
  }
  
  // 下载按钮点击
  downloadBtn.addEventListener('click', async () => {  // ✅ 添加 async
    if (!currentQuality) return;
    
    const selectedVideos = currentVideos.filter(v => v.quality === currentQuality);
    if (selectedVideos.length === 0) return;
    
    // 显示进度条
    progressContainer.style.display = 'block';
    downloadBtn.disabled = true;
    downloadBtn.textContent = '下载中...';
    
    try {
      // 发送下载请求到 background
      chrome.runtime.sendMessage({
        action: 'downloadHLS',
        videos: selectedVideos,
        quality: currentQuality,
        tabId: tab.id
      }, (response) => {
        if (response && response.success) {
          progressFill.style.width = '100%';
          progressText.textContent = '✅ 下载任务已开始！';
          openDownloadManager()
          setTimeout(() => {
            downloadBtn.disabled = false;
            downloadBtn.textContent = '开始下载';
            progressContainer.style.display = 'none';
            progressFill.style.width = '0%';
          }, 2000);
        } else {
          progressText.textContent = '❌ 下载失败';
          downloadBtn.disabled = false;
          downloadBtn.textContent = '开始下载';
        }
      });
      
    } catch (error) {
      console.error('下载失败:', error);
      progressText.textContent = '❌ 下载失败: ' + error.message;
      downloadBtn.disabled = false;
      downloadBtn.textContent = '开始下载';
    }
  });
});