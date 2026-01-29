document.addEventListener('DOMContentLoaded', () => {
  const tasksContainer = document.getElementById('tasksContainer');
  const taskCountEl = document.getElementById('taskCount');
  
  let allTasks = [];
  let activeFilter = 'all';
  let speedData = new Map(); // 存储下载速度数据
  
  // 加载下载任务
  loadTasks();
  
  // 每隔 1 秒更新一次（更频繁的更新）
  setInterval(loadTasks, 1000);
  
  async function loadTasks() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getDownloadTasks' });
      
      if (response && response.tasks) {
        allTasks = response.tasks;
        updateSpeedData();
        renderTasks();
      } else {
        showEmptyState();
      }
    } catch (error) {
      console.error('加载任务失败:', error);
      showErrorState(error);
    }
  }
  
  // 更新下载速度数据
  function updateSpeedData() {
    allTasks.forEach(task => {
      if (!speedData.has(task.id)) {
        speedData.set(task.id, {
          lastDownloaded: 0,
          lastTime: Date.now(),
          speed: 0,
          history: []
        });
      }
      
      const data = speedData.get(task.id);
      const now = Date.now();
      const timeDiff = (now - data.lastTime) / 1000; // 转换为秒
      
      if (timeDiff >= 1 && task.progress) {
        const downloaded = task.progress.downloaded || 0;
        const downloadedDiff = downloaded - data.lastDownloaded;
        
        if (downloadedDiff > 0) {
          // 计算速度 (KB/s)
          const speed = (downloadedDiff * 0.001) / timeDiff; // 假设每个片段约1KB
          data.speed = speed;
          data.history.push({ time: now, speed: speed });
          
          // 保持最近10个记录
          if (data.history.length > 10) {
            data.history.shift();
          }
          
          data.lastDownloaded = downloaded;
          data.lastTime = now;
        }
      }
    });
  }
  
  // 渲染任务列表
  function renderTasks() {
    let filteredTasks = allTasks;
    
    // 应用过滤器
    if (activeFilter !== 'all') {
      filteredTasks = allTasks.filter(task => {
        if (activeFilter === 'active') {
          return ['pending', 'downloading', 'merging', 'saving'].includes(task.status);
        } else if (activeFilter === 'completed') {
          return task.status === 'completed';
        } else if (activeFilter === 'error') {
          return task.status === 'error';
        }
        return true;
      });
    }
    
    // 按开始时间倒序排序（最新的在最上面）
    filteredTasks.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    
    // 更新任务计数
    taskCountEl.textContent = `(${filteredTasks.length}个任务)`;
    
    if (filteredTasks.length === 0) {
      showEmptyState();
      return;
    }
    
    tasksContainer.innerHTML = filteredTasks.map(task => `
      <div class="task">
        <div class="task-header">
          <div class="task-title">${task.videos[0]?.title || '未命名视频'}</div>
          <div class="task-status status-${task.status}">${getStatusText(task.status)}</div>
        </div>
        
        <div class="download-info">
          <div class="info-row">
            <span class="info-label">视频质量:</span>
            <span class="info-value">${task.quality || '未知'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">开始时间:</span>
            <span class="info-value">${formatTime(task.startTime)}</span>
          </div>
          ${task.endTime ? `
            <div class="info-row">
              <span class="info-label">结束时间:</span>
              <span class="info-value">${formatTime(task.endTime)}</span>
            </div>
          ` : ''}
        </div>
        
        ${renderProgress(task)}
        
        ${task.error ? renderError(task) : ''}
        
        <div class="task-actions">
          ${renderActionButtons(task)}
        </div>
      </div>
    `).join('');
  }
  
  // 渲染进度信息
  function renderProgress(task) {
    const speedInfo = speedData.get(task.id);
    const speed = speedInfo ? `${speedInfo.speed.toFixed(1)} KB/s` : '0 KB/s';
    
    let progressHTML = '';
    
    switch (task.status) {
      case 'downloading':
        const downloaded = task.progress.downloaded || 0;
        const total = task.progress.total || 1;
        const failed = task.progress.failed || 0;
        const percent = Math.round((downloaded / total) * 100);
        
        progressHTML = `
          <div class="progress-container">
            <div class="progress-info">
              <span>下载片段: ${downloaded}/${total}</span>
              <span class="speed">${speed}</span>
              ${failed > 0 ? `<span class="failed">失败: ${failed}个</span>` : ''}
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${percent}%"></div>
            </div>
            <div class="sub-progress">${percent}% - 正在下载视频片段</div>
          </div>
        `;
        break;
        
      case 'merging':
        progressHTML = `
          <div class="progress-container">
            <div class="progress-info">
              <span>正在合并视频文件</span>
              <span>请稍候...</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width: 100%; background: #17a2b8;"></div>
            </div>
            <div class="sub-progress">合并中，请勿关闭页面</div>
          </div>
        `;
        break;
        
      case 'saving':
        progressHTML = `
          <div class="progress-container">
            <div class="progress-info">
              <span>正在保存文件</span>
              <span class="speed">${speed}</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width: 100%; background: #ffc107;"></div>
            </div>
            <div class="sub-progress">文件较大，正在分块保存...</div>
          </div>
        `;
        break;
        
      case 'completed':
        const duration = task.endTime ? 
          Math.round((new Date(task.endTime) - new Date(task.startTime)) / 1000) : 0;
        
        progressHTML = `
          <div class="progress-container">
            <div class="progress-info">
              <span>✅ 下载完成</span>
              <span>用时: ${formatDuration(duration)}</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width: 100%; background: #28a745;"></div>
            </div>
            <div class="sub-progress">成功下载 ${task.progress?.downloaded || 0} 个片段</div>
          </div>
        `;
        break;
        
      default:
        if (task.progress) {
          const downloaded = task.progress.downloaded || 0;
          const total = task.progress.total || 1;
          const percent = Math.round((downloaded / total) * 100);
          
          progressHTML = `
            <div class="progress-container">
              <div class="progress-info">
                <span>进度: ${downloaded}/${total}</span>
                <span>${percent}%</span>
              </div>
              <div class="progress-bar">
                <div class="progress-fill" style="width: ${percent}%"></div>
              </div>
            </div>
          `;
        }
    }
    
    return progressHTML;
  }
  
  // 渲染错误信息
  function renderError(task) {
    return `
      <div class="error-box">
        <div class="error-title">❌ 错误信息</div>
        <div>${task.error || '未知错误'}</div>
        ${task.progress?.failed ? `<div>失败片段数: ${task.progress.failed}</div>` : ''}
      </div>
    `;
  }
  
  // 渲染操作按钮
  function renderActionButtons(task) {
    let buttons = '';
    
    if (['pending', 'downloading', 'merging', 'saving'].includes(task.status)) {
      buttons += `<button class="btn btn-cancel" onclick="cancelTask('${task.id}')">取消</button>`;
    }
    
    if (task.status === 'error') {
      buttons += `<button class="btn btn-retry" onclick="retryTask('${task.id}')">重试</button>`;
    }
    
    if (task.status === 'completed') {
      buttons += `<button class="btn btn-manage" onclick="cleanupTask('${task.id}')">清理</button>`;
    }
    
    return buttons;
  }
  
  // 显示空状态
  function showEmptyState() {
    tasksContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <h3>没有下载任务</h3>
        <p>打开视频网站，点击插件图标开始下载</p>
        <p style="font-size: 12px; color: #999; margin-top: 10px;">
          支持 HLS/m3u8 格式的视频流
        </p>
      </div>
    `;
    taskCountEl.textContent = '(0个任务)';
  }
  
  // 显示错误状态
  function showErrorState(error) {
    tasksContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <h3>加载失败</h3>
        <p>${error?.message || '未知错误'}</p>
        <button class="btn btn-retry" onclick="location.reload()" style="margin-top: 10px;">
          重新加载
        </button>
      </div>
    `;
  }
  
  // 获取状态文本
  function getStatusText(status) {
    const statusMap = {
      pending: '等待中',
      downloading: '下载中',
      merging: '合并中',
      saving: '保存中',
      completed: '已完成',
      error: '失败',
      cancelled: '已取消'
    };
    return statusMap[status] || status;
  }
  
  // 格式化时间
  function formatTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }
  
  // 格式化时长
  function formatDuration(seconds) {
    if (seconds < 60) return `${seconds}秒`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}分${remainingSeconds}秒`;
  }
});

// 全局函数供按钮调用
window.cancelTask = async (taskId) => {
  if (confirm('确定要取消这个下载任务吗？')) {
    await chrome.runtime.sendMessage({ 
      action: 'cancelDownload', 
      taskId: taskId 
    });
  }
};

window.retryTask = async (taskId) => {
  alert('重试功能正在开发中，请稍候...');
};

window.cleanupTask = async (taskId) => {
  if (confirm('确定要清理这个任务的数据吗？清理后将无法重新下载。')) {
    await chrome.runtime.sendMessage({
      action: 'cleanupFile',
      taskId: taskId
    });
    alert('清理完成');
    location.reload();
  }
};

window.filterTasks = function(filter) {
  // 更新按钮状态
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  event.target.classList.add('active');
  
  // 设置当前过滤器
  window.activeFilter = filter;
  
  // 重新渲染
  const downloadJS = document.querySelector('script[src="download.js"]');
  if (downloadJS) {
    downloadJS.onload();
  }
};