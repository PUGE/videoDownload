document.addEventListener('DOMContentLoaded', () => {
  const tasksContainer = document.getElementById('tasksContainer');
  
  // 加载下载任务
  loadTasks();
  
  // 每隔 2 秒更新一次
  setInterval(loadTasks, 2000);
  
  async function loadTasks() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getDownloadTasks' });
      
      if (response && response.tasks && response.tasks.length > 0) {
        renderTasks(response.tasks);
      } else {
        tasksContainer.innerHTML = `
          <div class="empty-state">
            <h3>没有下载任务</h3>
            <p>打开视频网站，点击插件图标开始下载</p>
          </div>
        `;
      }
    } catch (error) {
      console.error('加载任务失败:', error);
    }
  }
  
  function renderTasks(tasks) {
    tasksContainer.innerHTML = tasks.map(task => `
      <div class="task">
        <div class="task-header">
          <div class="task-title">${task.videos[0]?.title || '未命名视频'}</div>
          <div class="task-status status-${task.status}">${getStatusText(task.status)}</div>
        </div>
        
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${task.progress.total > 0 ? (task.progress.downloaded / task.progress.total * 100) : 0}%"></div>
        </div>
        
        <div class="task-info">
          <span>质量: ${task.quality}</span>
          <span>${task.progress.downloaded}/${task.progress.total} 片段</span>
          <span>开始时间: ${new Date(task.startTime).toLocaleTimeString()}</span>
        </div>
        
        ${task.error ? `<div style="color: #dc3545; font-size: 12px; margin-top: 5px;">错误: ${task.error}</div>` : ''}
        
        <div class="task-actions">
          ${['pending', 'downloading', 'merging'].includes(task.status) ? `
            <button class="btn btn-cancel" onclick="cancelTask('${task.id}')">取消</button>
          ` : ''}
          
          ${task.status === 'error' ? `
            <button class="btn btn-retry" onclick="retryTask('${task.id}')">重试</button>
          ` : ''}
        </div>
      </div>
    `).join('');
  }
  
  function getStatusText(status) {
    const statusMap = {
      pending: '等待中',
      downloading: '下载中',
      merging: '合并中',
      completed: '已完成',
      error: '失败',
      cancelled: '已取消'
    };
    return statusMap[status] || status;
  }
});

// 全局函数供按钮调用
window.cancelTask = async (taskId) => {
  await chrome.runtime.sendMessage({ 
    action: 'cancelDownload', 
    taskId: taskId 
  });
  location.reload();
};

window.retryTask = async (taskId) => {
  // 这里需要添加重试逻辑
  alert('重试功能正在开发中');
};