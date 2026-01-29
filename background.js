// 存储下载任务
let downloadTasks = new Map();
let downloadProgress = new Map();

// 在 background.js 开头添加
class VideoSegmentDB {
  constructor() {
    this.db = null;
    this.dbName = 'VideoSegmentsDB';
    this.storeName = 'segments';
    this.version = 1;
  }

  // 初始化数据库
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      
      request.onerror = (event) => {
        console.error('IndexedDB 打开失败:', event.target.error);
        reject(event.target.error);
      };
      
      request.onsuccess = (event) => {
        this.db = event.target.result;
        console.log('IndexedDB 初始化成功');
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // 创建存储对象
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { 
            keyPath: ['taskId', 'index'] 
          });
          // 创建索引以便查询
          store.createIndex('taskId', 'taskId', { unique: false });
          store.createIndex('index', 'index', { unique: false });
        }
      };
    });
  }

  // 保存片段
  async saveSegment(taskId, index, data) {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('数据库未初始化'));
        return;
      }
      
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      
      const request = store.put({
        taskId: taskId,
        index: index,
        data: data,
        timestamp: Date.now(),
        size: data.byteLength
      });
      
      request.onsuccess = () => {
        console.log(`片段 ${index} 保存成功: ${(data.byteLength / 1024 / 1024).toFixed(2)} MB`);
        resolve();
      };
      
      request.onerror = (event) => {
        console.error(`保存片段 ${index} 失败:`, event.target.error);
        reject(event.target.error);
      };
    });
  }

  // 获取片段
  async getSegment(taskId, index) {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('数据库未初始化'));
        return;
      }
      
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      
      const request = store.get([taskId, index]);
      
      request.onsuccess = (event) => {
        const result = event.target.result;
        resolve(result ? result.data : null);
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  // 获取任务的所有片段
  async getAllSegments(taskId) {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('数据库未初始化'));
        return;
      }
      
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('taskId');
      
      const request = index.getAll(taskId);
      
      request.onsuccess = (event) => {
        const results = event.target.result;
        // 按索引排序
        results.sort((a, b) => a.index - b.index);
        resolve(results.map(item => ({
          data: item.data,
          index: item.index
        })));
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  // 删除任务的所有片段
  async deleteTaskSegments(taskId) {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('数据库未初始化'));
        return;
      }
      
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('taskId');
      
      // 获取所有该任务的key
      const getRequest = index.getAllKeys(taskId);
      
      getRequest.onsuccess = (event) => {
        const keys = event.target.result;
        if (keys.length === 0) {
          resolve();
          return;
        }
        
        // 删除所有片段
        let deletedCount = 0;
        keys.forEach(key => {
          const deleteRequest = store.delete(key);
          deleteRequest.onsuccess = () => {
            deletedCount++;
            if (deletedCount === keys.length) {
              console.log(`删除任务 ${taskId} 的 ${deletedCount} 个片段`);
              resolve();
            }
          };
          deleteRequest.onerror = (e) => {
            console.error('删除失败:', e.target.error);
          };
        });
      };
      
      getRequest.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  // 清理旧数据（超过24小时）
  async cleanupOldData(hours = 24) {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('数据库未初始化'));
        return;
      }
      
      const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);
      
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const cursorRequest = store.openCursor();
      
      let deletedCount = 0;
      
      cursorRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (cursor.value.timestamp < cutoffTime) {
            cursor.delete();
            deletedCount++;
          }
          cursor.continue();
        } else {
          console.log(`清理了 ${deletedCount} 个旧片段`);
          resolve(deletedCount);
        }
      };
      
      cursorRequest.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }
}

// 创建全局实例
const segmentDB = new VideoSegmentDB();

// 在 Service Worker 启动时初始化
async function initServiceWorker() {
  try {
    await segmentDB.init();
    console.log('VideoSegmentDB 初始化完成');
    
    // 清理旧数据
    setTimeout(() => {
      segmentDB.cleanupOldData().catch(console.error);
    }, 5000);
    
  } catch (error) {
    console.error('初始化数据库失败:', error);
  }
}

// 调用初始化
initServiceWorker();


// 监听来自 content script 和 popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'downloadHLS':
      handleDownload(request.videos, request.quality, request.tabId);
      sendResponse({ success: true });
      break;
      
    case 'getDownloadProgress':
      const taskId = request.taskId;
      sendResponse({ progress: downloadProgress.get(taskId) });
      break;
      
    case 'cancelDownload':
      cancelDownload(request.taskId);
      sendResponse({ success: true });
      break;
      
    case 'openDownloadPanel':
      // 打开下载管理页面
      chrome.tabs.create({
        url: chrome.runtime.getURL('download.html')
      });
      sendResponse({ success: true });
      break;
    case 'getDownloadTasks':
      const tasks = Array.from(downloadTasks.values()).map(task => ({
        id: task.id,
        videos: task.videos,
        quality: task.quality,
        status: task.status,
        progress: task.progress || { downloaded: 0, total: 0, failed: 0 },
        startTime: task.startTime,
        endTime: task.endTime,
        error: task.error
      }));
      sendResponse({ tasks });
      break;
    case 'getFileChunk':
      handleGetFileChunk(request, sendResponse);
      return true; // 异步响应

    case 'cleanupFile':
      handleCleanupFile(request.taskId);
      sendResponse({ success: true });
      break;

    // 处理获取分块请求
    async function handleGetFileChunk(request, sendResponse) {
      try {
        const chunkKey = `chunk_${request.taskId}_${request.chunkIndex}`;
        const result = await chrome.storage.local.get([chunkKey]);
        
        if (result[chunkKey]) {
          sendResponse({
            success: true,
            chunk: result[chunkKey]
          });
        } else {
          sendResponse({
            success: false,
            error: '分块不存在'
          });
        }
      } catch (error) {
        sendResponse({
          success: false,
          error: error.message
        });
      }
    }

    // 清理文件数据
    async function handleCleanupFile(taskId) {
      try {
        // 获取文件信息
        const fileKey = `file_${taskId}`;
        const result = await chrome.storage.local.get([fileKey]);
        
        if (result[fileKey]) {
          const fileInfo = result[fileKey];
          
          // 删除所有分块
          const keysToDelete = [fileKey, ...fileInfo.chunks];
          await chrome.storage.local.remove(keysToDelete);
          
          console.log(`清理文件 ${taskId} 的数据`);
        }
      } catch (error) {
        console.error('清理文件数据失败:', error);
      }
    }
  }
  return true;
});

// 从 IndexedDB 合并片段
async function mergeSegmentsFromDB(taskId) {
  console.log(`开始从数据库合并片段 (任务: ${taskId})`);
  
  // 获取所有片段
  const segments = await segmentDB.getAllSegments(taskId);
  console.log(`从数据库加载了 ${segments.length} 个片段`);
  
  if (segments.length === 0) {
    throw new Error('数据库中没有找到片段数据');
  }
  
  // 计算总大小
  const totalSize = segments.reduce((sum, seg) => sum + seg.data.byteLength, 0);
  console.log(`总大小: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  
  // 如果文件太大，使用流式处理
  if (totalSize > 500 * 1024 * 1024) { // 大于500MB
    console.log('文件较大，使用流式处理...');
    return await mergeLargeSegments(segments, taskId);
  }
  
  // 普通合并
  const merged = new Uint8Array(totalSize);
  let offset = 0;
  
  for (const segment of segments) {
    merged.set(new Uint8Array(segment.data), offset);
    offset += segment.data.byteLength;
  }
  
  return merged.buffer;
}

// 合并大文件（流式处理）
async function mergeLargeSegments(segments, taskId) {
  // 创建一个可读流来逐步处理
  const chunkSize = 10 * 1024 * 1024; // 10MB 分块
  
  // 由于 Service Worker 环境限制，我们使用分块方式
  const buffers = [];
  
  for (const segment of segments) {
    buffers.push(new Uint8Array(segment.data));
  }
  
  // 计算总大小并创建 ArrayBuffer
  const totalSize = buffers.reduce((sum, buf) => sum + buf.length, 0);
  const result = new Uint8Array(totalSize);
  let offset = 0;
  
  // 分批处理避免内存过高
  const BATCH_SIZE = 5; // 每次处理5个片段
  for (let i = 0; i < buffers.length; i += BATCH_SIZE) {
    const batch = buffers.slice(i, i + BATCH_SIZE);
    
    for (const buffer of batch) {
      result.set(buffer, offset);
      offset += buffer.length;
    }
    
    // 报告进度
    const progress = Math.round((offset / totalSize) * 100);
    console.log(`合并进度: ${progress}%`);
    
    // 让出控制权避免阻塞
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  
  return result.buffer;
}


async function handleDownload(videos, quality, tabId) {
  const taskId = Date.now().toString();
  const task = {
    id: taskId,
    videos: videos,
    quality: quality,
    status: 'pending',
    progress: { downloaded: 0, total: 0, failed: 0 },
    startTime: new Date(),
    dbReady: false
  };
  
  downloadTasks.set(taskId, task);
  downloadProgress.set(taskId, task.progress);
  
  try {
    // 等待数据库初始化
    if (!segmentDB.db) {
      await segmentDB.init();
    }
    task.dbReady = true;
    
    // 1. 获取 m3u8 内容
    const m3u8Url = videos[0].url;
    console.log('开始下载视频，M3U8 URL:', m3u8Url);
    
    task.status = 'parsing';
    downloadTasks.set(taskId, task);
    
    const response = await fetch(m3u8Url, {
      headers: {
        'Referer': new URL(m3u8Url).origin,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const m3u8Content = await response.text();
    
    // 2. 解析 m3u8
    const tsSegments = await parseM3U8(m3u8Content, m3u8Url);
    console.log(`找到 ${tsSegments.length} 个视频片段`);
    
    if (tsSegments.length === 0) {
      throw new Error('无法从 M3U8 文件中找到视频片段');
    }
    
    task.progress.total = tsSegments.length;
    task.status = 'downloading';
    downloadTasks.set(taskId, task);
    
    // 3. 并行下载片段（控制并发数）
    const CONCURRENT_LIMIT = 3; // 同时下载3个片段
    let downloadedCount = 0;
    let failedCount = 0;
    
    // 创建下载队列
    const downloadQueue = [...tsSegments.entries()]; // [index, segment]
    
    async function downloadWorker() {
      while (downloadQueue.length > 0) {
        const [index, segment] = downloadQueue.shift();
        
        try {
          console.log(`下载片段 ${index + 1}/${tsSegments.length}: ${segment.url.substring(0, 80)}...`);
          
          const response = await fetch(segment.url, {
            headers: {
              'Referer': new URL(segment.url).origin,
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': '*/*',
              'Accept-Encoding': 'gzip, deflate, br'
            }
          });
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          
          const data = await response.arrayBuffer();
          
          // 保存到 IndexedDB
          await segmentDB.saveSegment(taskId, index, data);
          
          downloadedCount++;
          
          // 更新进度
          task.progress.downloaded = downloadedCount;
          task.progress.failed = failedCount;
          downloadProgress.set(taskId, task.progress);
          
          // 发送进度
          chrome.tabs.sendMessage(tabId, {
            action: 'downloadProgress',
            taskId: taskId,
            downloaded: downloadedCount,
            total: tsSegments.length,
            failed: failedCount,
            segment: index + 1
          });
          
        } catch (error) {
          console.error(`下载片段 ${index} 失败:`, error.message);
          failedCount++;
          task.progress.failed = failedCount;
          downloadProgress.set(taskId, task.progress);
          
          // 可选：将失败的任务重新加入队列
          // downloadQueue.push([index, segment]);
        }
      }
    }
    
    // 启动多个下载worker
    const workers = [];
    for (let i = 0; i < CONCURRENT_LIMIT; i++) {
      workers.push(downloadWorker());
    }
    
    // 等待所有worker完成
    await Promise.all(workers);
    
    // 4. 检查下载结果
    if (downloadedCount === 0) {
      throw new Error('没有成功下载任何视频片段');
    }
    
    console.log(`下载完成: ${downloadedCount} 成功, ${failedCount} 失败`);
    
    // 5. 从 IndexedDB 合并文件
    task.status = 'merging';
    downloadTasks.set(taskId, task);
    
    const mergedData = await mergeSegmentsFromDB(taskId);
    
    // 6. 保存文件
    task.status = 'saving';
    downloadTasks.set(taskId, task);
    
    const fileName = generateFileName(videos[0].title, quality);
    await saveLargeFile(mergedData, fileName, tabId, taskId);
    
    task.status = 'completed';
    task.endTime = new Date();
    downloadTasks.set(taskId, task);
    
    console.log('✅ 视频下载完成');
    
    // 7. 清理数据库中的片段数据（延迟执行）
    setTimeout(() => {
      segmentDB.deleteTaskSegments(taskId).catch(console.error);
    }, 30000); // 30秒后清理
    
  } catch (error) {
    console.error('下载失败:', error);
    task.status = 'error';
    task.error = error.message;
    task.endTime = new Date();
    downloadTasks.set(taskId, task);
    
    // 清理数据库
    if (task.dbReady) {
      try {
        await segmentDB.deleteTaskSegments(taskId);
      } catch (e) {
        console.warn('清理数据库失败:', e);
      }
    }
    
    chrome.tabs.sendMessage(tabId, {
      action: 'downloadError',
      taskId: taskId,
      error: error.message
    });
  }
}


// 保存大文件 - 优化版
async function saveLargeFile(data, fileName, tabId, taskId) {
  const fileSize = data.byteLength;
  console.log(`准备保存文件: ${fileName}, 大小: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
  
  // 根据文件大小选择不同方案
  if (fileSize < 50 * 1024 * 1024) { // 小于50MB，直接下载
    return saveSmallFile(data, fileName);
  } 
  else { // 50MB-500MB，使用分块下载
    return saveMediumFile(data, fileName, tabId, taskId);
  }
}

// 保存小文件（直接下载）
async function saveSmallFile(data, fileName) {
  return new Promise((resolve, reject) => {
    // 创建 Blob
    const blob = new Blob([data], { type: 'video/mp4' });
    
    // 使用 FileReader 转换为 data URL
    const reader = new FileReader();
    
    reader.onloadend = function() {
      const dataUrl = reader.result;
      
      chrome.downloads.download({
        url: dataUrl,
        filename: fileName,
        saveAs: true
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          console.log('下载已开始，ID:', downloadId);
          resolve(downloadId);
        }
      });
    };
    
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// 保存中等文件（分块下载）
async function saveMediumFile(data, fileName, tabId, taskId) {
  console.log('使用分块下载方案');
  
  // 将数据分块保存到 storage
  const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
  const dataArray = new Uint8Array(data);
  const totalChunks = Math.ceil(dataArray.length / CHUNK_SIZE);
  
  // 通知前端准备下载
  chrome.tabs.sendMessage(tabId, {
    action: 'prepareDownload',
    taskId: taskId,
    fileName: fileName,
    totalSize: dataArray.length,
    totalChunks: totalChunks,
    chunkSize: CHUNK_SIZE
  });
  
  // 逐块发送数据
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, dataArray.length);
    const chunk = dataArray.slice(start, end);
    
    await chrome.tabs.sendMessage(tabId, {
      action: 'downloadChunk',
      taskId: taskId,
      chunkIndex: i,
      chunkData: Array.from(chunk),
      isLast: i === totalChunks - 1
    });
    
    // 报告进度
    if (i % 10 === 0 || i === totalChunks - 1) {
      const percent = Math.round(((i + 1) / totalChunks) * 100);
      console.log(`发送进度: ${percent}%`);
    }
    
    // 避免发送过快
    if (i % 5 === 0) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  
  return taskId;
}

// 使用分块存储方案
async function saveViaChunks(data, fileName, tabId, taskId) {
  console.log('使用分块存储方案保存大文件');
  
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB 分块
  const dataArray = new Uint8Array(data);
  const totalChunks = Math.ceil(dataArray.length / CHUNK_SIZE);
  
  // 存储分块信息
  const fileInfo = {
    fileName: fileName,
    totalSize: dataArray.length,
    totalChunks: totalChunks,
    chunks: [],
    mimeType: 'video/mp4',
    taskId: taskId
  };
  
  // 分块保存到 IndexedDB 或 storage
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, dataArray.length);
    const chunk = dataArray.slice(start, end);
    
    // 保存分块到 storage
    const chunkKey = `chunk_${taskId}_${i}`;
    await chrome.storage.local.set({
      [chunkKey]: Array.from(chunk)
    });
    
    fileInfo.chunks.push(chunkKey);
    
    console.log(`保存分块 ${i + 1}/${totalChunks}: ${(chunk.length / 1024 / 1024).toFixed(2)} MB`);
  }
  
  // 保存文件信息
  await chrome.storage.local.set({
    [`file_${taskId}`]: fileInfo
  });
  
  console.log('文件分块保存完成，通知前端下载');
  
  // 通知 content script 开始下载
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, {
      action: 'downloadLargeFile',
      taskId: taskId,
      fileName: fileName,
      totalSize: dataArray.length,
      totalChunks: totalChunks
    }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && response.success) {
        resolve();
      } else {
        reject(new Error('前端响应失败'));
      }
    });
  });
}

// 解析媒体播放列表（包含实际 ts 文件）
function parseMediaPlaylist(content, baseUrl) {
  const segments = [];
  const lines = content.split('\n');
  
  let currentDuration = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // 解析片段时长
    if (line.startsWith('#EXTINF:')) {
      const match = line.match(/#EXTINF:([\d.]+)/);
      if (match) {
        currentDuration = parseFloat(match[1]);
      }
    }
    
    // 解析片段URL
    if (line && !line.startsWith('#') && (line.includes('.ts') || line.includes('.m4s'))) {
      const segmentUrl = resolveUrl(line, baseUrl);
      
      segments.push({
        url: segmentUrl,
        index: segments.length,
        duration: currentDuration
      });
    }
  }
  
  console.log(`解析到 ${segments.length} 个视频片段`);
  return segments;
}


// 修改 parseM3U8 函数
async function parseM3U8(content, baseUrl) {
  const segments = [];
  
  // 检查是否是主播放列表（包含 #EXT-X-STREAM-INF）
  if (content.includes('#EXT-X-STREAM-INF:')) {
    console.log('检测到主播放列表（多级 M3U8），正在解析子播放列表...');
    return await parseMasterPlaylist(content, baseUrl);
  } else {
    // 普通播放列表
    return parseMediaPlaylist(content, baseUrl);
  }
}

// 解析主播放列表（选择最佳质量）
async function parseMasterPlaylist(content, baseUrl) {
  const lines = content.split('\n');
  const streams = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // 解析流信息
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const nextLine = lines[i + 1] ? lines[i + 1].trim() : '';
      
      if (nextLine && !nextLine.startsWith('#')) {
        // 提取流信息
        const streamInfo = extractStreamInfo(line);
        const streamUrl = resolveUrl(nextLine, baseUrl);
        
        streams.push({
          ...streamInfo,
          url: streamUrl
        });
      }
    }
  }
  
  console.log(`找到 ${streams.length} 个质量选项:`, streams.map(s => s.resolution || s.bandwidth));
  
  // 选择最高质量的流
  if (streams.length > 0) {
    // 按分辨率或带宽排序，选择最佳质量
    const sortedStreams = streams.sort((a, b) => {
      // 优先按分辨率
      if (a.resolution && b.resolution) {
        const aRes = a.resolution.split('x').reduce((x, y) => x * y);
        const bRes = b.resolution.split('x').reduce((x, y) => x * y);
        return bRes - aRes;
      }
      // 其次按带宽
      return (b.bandwidth || 0) - (a.bandwidth || 0);
    });
    
    const bestStream = sortedStreams[0];
    console.log(`选择最佳质量: ${bestStream.resolution || bestStream.bandwidth}`, bestStream.url);
    
    // 获取子播放列表
    try {
      const response = await fetch(bestStream.url, {
        headers: {
          'Referer': new URL(baseUrl).origin,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const subContent = await response.text();
      console.log('子播放列表内容（前200字符）:', subContent.substring(0, 200));
      
      // 解析子播放列表
      return parseMediaPlaylist(subContent, bestStream.url);
      
    } catch (error) {
      console.error('获取子播放列表失败:', error);
      throw error;
    }
  }
  
  return [];
}



// 提取流信息
function extractStreamInfo(line) {
  const info = {};
  
  // 提取带宽
  const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
  if (bandwidthMatch) {
    info.bandwidth = parseInt(bandwidthMatch[1]);
  }
  
  // 提取分辨率
  const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);
  if (resolutionMatch) {
    info.resolution = resolutionMatch[1];
  }
  
  // 提取编码
  const codecsMatch = line.match(/CODECS="([^"]+)"/);
  if (codecsMatch) {
    info.codecs = codecsMatch[1];
  }
  
  // 提取帧率
  const frameRateMatch = line.match(/FRAME-RATE=([\d.]+)/);
  if (frameRateMatch) {
    info.frameRate = parseFloat(frameRateMatch[1]);
  }
  
  return info;
}

// 解析URL（处理相对路径）
function resolveUrl(url, baseUrl) {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  
  try {
    const base = new URL(baseUrl);
    
    if (url.startsWith('/')) {
      // 绝对路径
      return new URL(url, base.origin).href;
    } else {
      // 相对路径
      const basePath = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
      return new URL(url, base.origin + basePath).href;
    }
  } catch (error) {
    console.error('解析URL失败:', url, baseUrl, error);
    return url;
  }
}



// 下载单个 ts 片段
async function downloadSegment(url) {
  console.log('下载片段:', url);
  
  try {
    const response = await fetch(url, {
      headers: {
        'Referer': new URL(url).origin, // 添加 Referer 头
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const contentType = response.headers.get('content-type');
    const data = await response.arrayBuffer();
    
    // 检查是否是有效的 ts 文件
    if (data.byteLength < 188) { // TS 包最小长度
      console.warn('下载的数据可能不是有效的 TS 文件');
    }
    
    console.log(`下载成功: ${(data.byteLength / 1024 / 1024).toFixed(2)} MB`);
    return data;
    
  } catch (error) {
    console.error('下载失败:', error.message, 'URL:', url);
    throw error;
  }
}



// 生成文件名
function generateFileName(title, quality) {
  const safeTitle = (title || 'video')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 50);
    
  const timestamp = new Date().toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .replace('Z', '');
    
  return `${safeTitle}_${quality}_${timestamp}.mp4`;
}

// 取消下载
function cancelDownload(taskId) {
  const task = downloadTasks.get(taskId);
  if (task) {
    task.status = 'cancelled';
    downloadTasks.set(taskId, task);
  }
}



// 监听下载事件
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state && delta.state.current === 'complete') {
    console.log('下载完成:', delta.id);
  }
});

