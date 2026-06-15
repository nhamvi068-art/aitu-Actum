var sw = (function(exports) {
  "use strict";
  var TaskType = /* @__PURE__ */ ((TaskType2) => {
    TaskType2["IMAGE"] = "image";
    TaskType2["VIDEO"] = "video";
    TaskType2["AUDIO"] = "audio";
    TaskType2["CHARACTER"] = "character";
    TaskType2["INSPIRATION_BOARD"] = "inspiration_board";
    TaskType2["CHAT"] = "chat";
    return TaskType2;
  })(TaskType || {});
  ({
    timeouts: {
      [TaskType.IMAGE]: 15 * 60 * 1e3,
      // 15 minutes for image
      [TaskType.VIDEO]: 20 * 60 * 1e3,
      // 20 minutes for video
      [TaskType.AUDIO]: 30 * 60 * 1e3,
      // 30 minutes for audio
      [TaskType.CHARACTER]: 10 * 60 * 1e3,
      // 10 minutes
      [TaskType.INSPIRATION_BOARD]: 15 * 60 * 1e3,
      // 15 minutes (same as image)
      [TaskType.CHAT]: 10 * 60 * 1e3
      // 10 minutes
    }
  });
  const SENSITIVE_KEYS$1 = [
    "apikey",
    "api_key",
    "password",
    "token",
    "secret",
    "authorization",
    "bearer",
    "credential",
    "key"
  ];
  function sanitizeObject$1(obj) {
    if (!obj) return obj;
    if (typeof obj === "string") {
      if (obj.toLowerCase().startsWith("bearer ")) {
        return "[REDACTED]";
      }
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => sanitizeObject$1(item));
    }
    if (typeof obj === "object") {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase();
        if (SENSITIVE_KEYS$1.some((k2) => lowerKey.includes(k2))) {
          result[key] = "[REDACTED]";
        } else {
          result[key] = sanitizeObject$1(value);
        }
      }
      return result;
    }
    return obj;
  }
  function sanitizeRequestBody(requestBody) {
    if (!requestBody) return requestBody;
    try {
      const parsed = JSON.parse(requestBody);
      const sanitized = sanitizeObject$1(parsed);
      return JSON.stringify(sanitized);
    } catch {
      let result = requestBody;
      result = result.replace(/Bearer\s+[a-zA-Z0-9-_]+/gi, "Bearer [REDACTED]");
      result = result.replace(
        /"(api[_-]?key|apikey|authorization|token|secret|password|credential)"\s*:\s*"[^"]+"/gi,
        (match, key) => `"${key}": "[REDACTED]"`
      );
      return result;
    }
  }
  function getSafeErrorMessage(error) {
    if (error instanceof Error) {
      return error.name || "Error";
    }
    return "Unknown error";
  }
  const DB_NAME$1 = "sw-task-queue";
  const MIN_DB_VERSION = 3;
  const TASKS_STORE = "tasks";
  const CONFIG_STORE = "config";
  const WORKFLOWS_STORE = "workflows";
  const CHAT_WORKFLOWS_STORE = "chat-workflows";
  const PENDING_TOOL_REQUESTS_STORE = "pending-tool-requests";
  const PENDING_DOM_OPERATIONS_STORE = "pending-dom-operations";
  const TASK_STEP_MAPPINGS_STORE = "task-step-mappings";
  const PENDING_CANVAS_OPERATIONS_STORE = "pending-canvas-operations";
  const REQUIRED_STORES = [
    TASKS_STORE,
    CONFIG_STORE,
    WORKFLOWS_STORE,
    CHAT_WORKFLOWS_STORE,
    PENDING_TOOL_REQUESTS_STORE,
    PENDING_DOM_OPERATIONS_STORE,
    TASK_STEP_MAPPINGS_STORE,
    PENDING_CANVAS_OPERATIONS_STORE
  ];
  function detectDatabaseVersion() {
    return new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME$1);
      request.onsuccess = () => {
        const db = request.result;
        const version = db.version;
        db.close();
        resolve(Math.max(version, MIN_DB_VERSION));
      };
      request.onerror = () => {
        resolve(MIN_DB_VERSION);
      };
    });
  }
  function checkStoresIntegrity(db) {
    const missing = [];
    for (const store of REQUIRED_STORES) {
      if (!db.objectStoreNames.contains(store)) {
        missing.push(store);
      }
    }
    return missing;
  }
  function repairDatabase(currentVersion) {
    return new Promise((resolve, reject) => {
      const newVersion = currentVersion + 1;
      const request = indexedDB.open(DB_NAME$1, newVersion);
      request.onerror = () => {
        console.error("[SWStorage] Failed to repair DB:", request.error);
        reject(request.error);
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        createAllStores(db);
      };
    });
  }
  function createAllStores(db) {
    if (!db.objectStoreNames.contains(TASKS_STORE)) {
      const tasksStore = db.createObjectStore(TASKS_STORE, { keyPath: "id" });
      tasksStore.createIndex("status", "status", { unique: false });
      tasksStore.createIndex("type", "type", { unique: false });
      tasksStore.createIndex("createdAt", "createdAt", { unique: false });
    }
    if (!db.objectStoreNames.contains(CONFIG_STORE)) {
      db.createObjectStore(CONFIG_STORE, { keyPath: "key" });
    }
    if (!db.objectStoreNames.contains(WORKFLOWS_STORE)) {
      const workflowsStore = db.createObjectStore(WORKFLOWS_STORE, {
        keyPath: "id"
      });
      workflowsStore.createIndex("status", "status", { unique: false });
      workflowsStore.createIndex("createdAt", "createdAt", { unique: false });
    }
    if (!db.objectStoreNames.contains(CHAT_WORKFLOWS_STORE)) {
      const chatWorkflowsStore = db.createObjectStore(CHAT_WORKFLOWS_STORE, {
        keyPath: "id"
      });
      chatWorkflowsStore.createIndex("status", "status", { unique: false });
      chatWorkflowsStore.createIndex("createdAt", "createdAt", { unique: false });
    }
    if (!db.objectStoreNames.contains(PENDING_TOOL_REQUESTS_STORE)) {
      const pendingRequestsStore = db.createObjectStore(
        PENDING_TOOL_REQUESTS_STORE,
        { keyPath: "requestId" }
      );
      pendingRequestsStore.createIndex("workflowId", "workflowId", {
        unique: false
      });
    }
    if (!db.objectStoreNames.contains(PENDING_DOM_OPERATIONS_STORE)) {
      const pendingDomOpsStore = db.createObjectStore(
        PENDING_DOM_OPERATIONS_STORE,
        { keyPath: "id" }
      );
      pendingDomOpsStore.createIndex("workflowId", "workflowId", {
        unique: false
      });
      pendingDomOpsStore.createIndex("chatId", "chatId", { unique: false });
    }
    if (!db.objectStoreNames.contains(TASK_STEP_MAPPINGS_STORE)) {
      const taskStepMappingsStore = db.createObjectStore(
        TASK_STEP_MAPPINGS_STORE,
        { keyPath: "taskId" }
      );
      taskStepMappingsStore.createIndex("workflowId", "workflowId", {
        unique: false
      });
    }
    if (!db.objectStoreNames.contains(PENDING_CANVAS_OPERATIONS_STORE)) {
      const pendingCanvasOpsStore = db.createObjectStore(
        PENDING_CANVAS_OPERATIONS_STORE,
        { keyPath: "id" }
      );
      pendingCanvasOpsStore.createIndex("workflowId", "workflowId", {
        unique: false
      });
    }
  }
  async function openDB$1() {
    const targetVersion = await detectDatabaseVersion();
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME$1, targetVersion);
      request.onerror = () => {
        console.error("[SWStorage] Failed to open DB:", request.error);
        reject(request.error);
      };
      request.onsuccess = () => {
        const db = request.result;
        const missingStores = checkStoresIntegrity(db);
        if (missingStores.length > 0) {
          console.warn(
            `[SWStorage] Missing object stores: ${missingStores.join(
              ", "
            )}. Repairing...`
          );
          db.close();
          repairDatabase(db.version).then(resolve).catch(reject);
          return;
        }
        resolve(db);
      };
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        createAllStores(db);
      };
    });
  }
  class TaskQueueStorage {
    constructor() {
      this.dbPromise = null;
      this.pendingTaskSaves = /* @__PURE__ */ new Map();
      this.batchSaveTimer = null;
      this.batchSavePromises = /* @__PURE__ */ new Map();
      this.BATCH_SAVE_DELAY = 50;
    }
    // ms - batch saves within this window
    /**
     * Get database connection
     */
    async getDB() {
      if (!this.dbPromise) {
        this.dbPromise = openDB$1();
      }
      return this.dbPromise;
    }
    /**
     * Flush pending task saves immediately
     */
    async flushPendingTaskSaves() {
      if (this.batchSaveTimer) {
        clearTimeout(this.batchSaveTimer);
        this.batchSaveTimer = null;
      }
      const tasksToSave = Array.from(this.pendingTaskSaves.values());
      const promisesToResolve = new Map(this.batchSavePromises);
      this.pendingTaskSaves.clear();
      this.batchSavePromises.clear();
      if (tasksToSave.length === 0) return;
      try {
        const db = await this.getDB();
        await new Promise((resolve, reject) => {
          const transaction = db.transaction(TASKS_STORE, "readwrite");
          const store = transaction.objectStore(TASKS_STORE);
          for (const task of tasksToSave) {
            store.put(task);
          }
          transaction.oncomplete = () => {
            promisesToResolve.forEach(({ resolve: resolve2 }) => resolve2());
            resolve();
          };
          transaction.onerror = () => {
            const error = transaction.error;
            promisesToResolve.forEach(({ reject: reject2 }) => reject2(error));
            reject(error);
          };
        });
      } catch (error) {
        console.error("[SWStorage] Failed to batch save tasks:", error);
        promisesToResolve.forEach(({ reject }) => reject(error));
      }
    }
    /**
     * Save a task to IndexedDB (batched for performance)
     */
    async saveTask(task) {
      return new Promise((resolve, reject) => {
        this.pendingTaskSaves.set(task.id, task);
        this.batchSavePromises.set(task.id, { resolve, reject });
        if (!this.batchSaveTimer) {
          this.batchSaveTimer = setTimeout(() => {
            this.flushPendingTaskSaves();
          }, this.BATCH_SAVE_DELAY);
        }
      });
    }
    /**
     * Save a task immediately without batching (for critical saves)
     */
    async saveTaskImmediate(task) {
      this.pendingTaskSaves.delete(task.id);
      const pendingPromise = this.batchSavePromises.get(task.id);
      if (pendingPromise) {
        this.batchSavePromises.delete(task.id);
      }
      try {
        const db = await this.getDB();
        await new Promise((resolve, reject) => {
          const transaction = db.transaction(TASKS_STORE, "readwrite");
          const store = transaction.objectStore(TASKS_STORE);
          const request = store.put(task);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve();
        });
        if (pendingPromise) {
          pendingPromise.resolve();
        }
      } catch (error) {
        console.error("[SWStorage] Failed to save task:", error);
        if (pendingPromise) {
          pendingPromise.reject(error);
        }
        throw error;
      }
    }
    /**
     * Get a task by ID
     */
    async getTask(taskId) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(TASKS_STORE, "readonly");
          const store = transaction.objectStore(TASKS_STORE);
          const request = store.get(taskId);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result || null);
        });
      } catch (error) {
        console.error("[SWStorage] Failed to get task:", error);
        return null;
      }
    }
    /**
     * Get all tasks
     */
    async getAllTasks() {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(TASKS_STORE, "readonly");
          const store = transaction.objectStore(TASKS_STORE);
          const request = store.getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result || []);
        });
      } catch (error) {
        console.error("[SWStorage] Failed to get all tasks:", error);
        return [];
      }
    }
    /**
     * Get tasks by status
     */
    async getTasksByStatus(status) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(TASKS_STORE, "readonly");
          const store = transaction.objectStore(TASKS_STORE);
          const index = store.index("status");
          const request = index.getAll(status);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result || []);
        });
      } catch (error) {
        console.error("[SWStorage] Failed to get tasks by status:", error);
        return [];
      }
    }
    /**
     * Get tasks with pagination using cursor
     * @param options Pagination options
     * @returns Paginated tasks and metadata
     */
    async getTasksPaginated(options) {
      const { offset, limit, status, type, sortOrder = "desc" } = options;
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(TASKS_STORE, "readonly");
          const store = transaction.objectStore(TASKS_STORE);
          const index = store.index("createdAt");
          const direction = sortOrder === "desc" ? "prev" : "next";
          const cursorRequest = index.openCursor(null, direction);
          const tasks = [];
          let skipped = 0;
          let filteredTotal = 0;
          cursorRequest.onerror = () => reject(cursorRequest.error);
          cursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) {
              resolve({
                tasks,
                total: filteredTotal,
                hasMore: filteredTotal > offset + tasks.length
              });
              return;
            }
            const task = cursor.value;
            const matchesStatus = !status || task.status === status;
            const matchesType = !type || task.type === type;
            if (matchesStatus && matchesType) {
              filteredTotal++;
              if (skipped < offset) {
                skipped++;
              } else if (tasks.length < limit) {
                tasks.push(task);
              }
            }
            cursor.continue();
          };
        });
      } catch (error) {
        console.error("[SWStorage] Failed to get paginated tasks:", error);
        return { tasks: [], total: 0, hasMore: false };
      }
    }
    /**
     * Delete a task
     */
    async deleteTask(taskId) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(TASKS_STORE, "readwrite");
          const store = transaction.objectStore(TASKS_STORE);
          const request = store.delete(taskId);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve();
        });
      } catch (error) {
        console.error("[SWStorage] Failed to delete task:", error);
      }
    }
    /**
     * Get a specific configuration by key
     */
    async getConfig(key) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(CONFIG_STORE, "readonly");
          const store = transaction.objectStore(CONFIG_STORE);
          const request = store.get(key);
          request.onsuccess = () => {
            const result = request.result;
            if (!result) {
              resolve(null);
              return;
            }
            const { key: _2, ...config } = result;
            resolve(config);
          };
          request.onerror = () => reject(request.error);
        });
      } catch (error) {
        console.error(
          "[SWStorage] Failed to get config:",
          getSafeErrorMessage(error)
        );
        return null;
      }
    }
    /**
     * Save a configuration by key
     * 持久化配置到 IndexedDB，确保 SW 重启后可恢复
     */
    async saveConfig(key, config) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(CONFIG_STORE, "readwrite");
          const store = transaction.objectStore(CONFIG_STORE);
          store.put({
            key,
            ...config,
            updatedAt: Date.now()
          });
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        });
      } catch (error) {
        console.error(
          "[SWStorage] Failed to save config:",
          getSafeErrorMessage(error)
        );
        throw error;
      }
    }
    /**
     * Load both gemini and video configurations
     * 便捷方法，一次性加载两个配置
     */
    async loadConfig() {
      const geminiConfig = await this.getConfig("gemini");
      const videoConfig = await this.getConfig("video");
      return { geminiConfig, videoConfig };
    }
    /**
     * Save both gemini and video configurations
     * 便捷方法，一次性保存两个配置
     */
    async saveAllConfig(geminiConfig, videoConfig) {
      await this.saveConfig("gemini", geminiConfig);
      await this.saveConfig("video", videoConfig);
    }
    // ============================================================================
    // MCP System Prompt Storage Methods
    // ============================================================================
    /**
     * Save MCP system prompt to IndexedDB
     * Called from main thread during initialization
     */
    async saveSystemPrompt(systemPrompt) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(CONFIG_STORE, "readwrite");
          const store = transaction.objectStore(CONFIG_STORE);
          store.put({
            key: "systemPrompt",
            value: systemPrompt,
            updatedAt: Date.now()
          });
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        });
      } catch (error) {
        console.error("[SWStorage] Failed to save system prompt:", error);
      }
    }
    /**
     * Get MCP system prompt from IndexedDB
     * Called from SW during AI analysis
     */
    async getSystemPrompt() {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(CONFIG_STORE, "readonly");
          const store = transaction.objectStore(CONFIG_STORE);
          const request = store.get("systemPrompt");
          request.onsuccess = () => {
            const result = request.result;
            resolve((result == null ? void 0 : result.value) || null);
          };
          request.onerror = () => reject(request.error);
        });
      } catch (error) {
        console.error("[SWStorage] Failed to get system prompt:", error);
        return null;
      }
    }
    // ============================================================================
    // Workflow Storage Methods
    // ============================================================================
    /**
     * Save a workflow to IndexedDB
     */
    async saveWorkflow(workflow) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(WORKFLOWS_STORE, "readwrite");
          const store = transaction.objectStore(WORKFLOWS_STORE);
          const request = store.put(workflow);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve();
        });
      } catch (error) {
        console.error("[SWStorage] Failed to save workflow:", error);
      }
    }
    /**
     * Get a workflow by ID
     */
    async getWorkflow(workflowId) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(WORKFLOWS_STORE, "readonly");
          const store = transaction.objectStore(WORKFLOWS_STORE);
          const request = store.get(workflowId);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result || null);
        });
      } catch (error) {
        console.error("[SWStorage] Failed to get workflow:", error);
        return null;
      }
    }
    /**
     * Get all workflows
     */
    async getAllWorkflows() {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(WORKFLOWS_STORE, "readonly");
          const store = transaction.objectStore(WORKFLOWS_STORE);
          const request = store.getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result || []);
        });
      } catch (error) {
        console.error("[SWStorage] Failed to get all workflows:", error);
        return [];
      }
    }
    /**
     * Get workflows by status
     */
    async getWorkflowsByStatus(status) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(WORKFLOWS_STORE, "readonly");
          const store = transaction.objectStore(WORKFLOWS_STORE);
          const index = store.index("status");
          const request = index.getAll(status);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result || []);
        });
      } catch (error) {
        console.error("[SWStorage] Failed to get workflows by status:", error);
        return [];
      }
    }
    /**
     * Delete a workflow
     */
    async deleteWorkflow(workflowId) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(WORKFLOWS_STORE, "readwrite");
          const store = transaction.objectStore(WORKFLOWS_STORE);
          const request = store.delete(workflowId);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve();
        });
      } catch (error) {
        console.error("[SWStorage] Failed to delete workflow:", error);
      }
    }
    // ============================================================================
    // Chat Workflow Storage Methods
    // ============================================================================
    /**
     * Save a chat workflow to IndexedDB
     */
    async saveChatWorkflow(workflow) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(CHAT_WORKFLOWS_STORE, "readwrite");
          const store = transaction.objectStore(CHAT_WORKFLOWS_STORE);
          const request = store.put(workflow);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve();
        });
      } catch (error) {
        console.error("[SWStorage] Failed to save chat workflow:", error);
      }
    }
    /**
     * Get a chat workflow by ID
     */
    async getChatWorkflow(workflowId) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(CHAT_WORKFLOWS_STORE, "readonly");
          const store = transaction.objectStore(CHAT_WORKFLOWS_STORE);
          const request = store.get(workflowId);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result || null);
        });
      } catch (error) {
        console.error("[SWStorage] Failed to get chat workflow:", error);
        return null;
      }
    }
    /**
     * Get all chat workflows
     */
    async getAllChatWorkflows() {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(CHAT_WORKFLOWS_STORE, "readonly");
          const store = transaction.objectStore(CHAT_WORKFLOWS_STORE);
          const request = store.getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result || []);
        });
      } catch (error) {
        console.error("[SWStorage] Failed to get all chat workflows:", error);
        return [];
      }
    }
    /**
     * Get chat workflows by status
     */
    async getChatWorkflowsByStatus(status) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(CHAT_WORKFLOWS_STORE, "readonly");
          const store = transaction.objectStore(CHAT_WORKFLOWS_STORE);
          const index = store.index("status");
          const request = index.getAll(status);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result || []);
        });
      } catch (error) {
        console.error(
          "[SWStorage] Failed to get chat workflows by status:",
          error
        );
        return [];
      }
    }
    /**
     * Delete a chat workflow
     */
    async deleteChatWorkflow(workflowId) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(CHAT_WORKFLOWS_STORE, "readwrite");
          const store = transaction.objectStore(CHAT_WORKFLOWS_STORE);
          const request = store.delete(workflowId);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve();
        });
      } catch (error) {
        console.error("[SWStorage] Failed to delete chat workflow:", error);
      }
    }
    // ============================================================================
    // Pending Tool Request Storage Methods
    // ============================================================================
    /**
     * Save a pending tool request to IndexedDB
     */
    async savePendingToolRequest(request) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(
            PENDING_TOOL_REQUESTS_STORE,
            "readwrite"
          );
          const store = transaction.objectStore(PENDING_TOOL_REQUESTS_STORE);
          const req = store.put(request);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => resolve();
        });
      } catch (error) {
        console.error("[SWStorage] Failed to save pending tool request:", error);
      }
    }
    /**
     * Get all pending tool requests
     */
    async getAllPendingToolRequests() {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(
            PENDING_TOOL_REQUESTS_STORE,
            "readonly"
          );
          const store = transaction.objectStore(PENDING_TOOL_REQUESTS_STORE);
          const request = store.getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result || []);
        });
      } catch (error) {
        console.error(
          "[SWStorage] Failed to get all pending tool requests:",
          error
        );
        return [];
      }
    }
    /**
     * Get pending tool requests by workflow ID
     */
    async getPendingToolRequestsByWorkflow(workflowId) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(
            PENDING_TOOL_REQUESTS_STORE,
            "readonly"
          );
          const store = transaction.objectStore(PENDING_TOOL_REQUESTS_STORE);
          const index = store.index("workflowId");
          const request = index.getAll(workflowId);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result || []);
        });
      } catch (error) {
        console.error(
          "[SWStorage] Failed to get pending tool requests by workflow:",
          error
        );
        return [];
      }
    }
    /**
     * Get a pending tool request by requestId
     */
    async getPendingToolRequest(requestId) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(
            PENDING_TOOL_REQUESTS_STORE,
            "readonly"
          );
          const store = transaction.objectStore(PENDING_TOOL_REQUESTS_STORE);
          const request = store.get(requestId);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result || null);
        });
      } catch (error) {
        console.error("[SWStorage] Failed to get pending tool request:", error);
        return null;
      }
    }
    /**
     * Delete a pending tool request
     */
    async deletePendingToolRequest(requestId) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(
            PENDING_TOOL_REQUESTS_STORE,
            "readwrite"
          );
          const store = transaction.objectStore(PENDING_TOOL_REQUESTS_STORE);
          const request = store.delete(requestId);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve();
        });
      } catch (error) {
        console.error(
          "[SWStorage] Failed to delete pending tool request:",
          error
        );
      }
    }
    /**
     * Delete all pending tool requests for a workflow
     */
    async deletePendingToolRequestsByWorkflow(workflowId) {
      try {
        const requests = await this.getPendingToolRequestsByWorkflow(workflowId);
        for (const request of requests) {
          await this.deletePendingToolRequest(request.requestId);
        }
      } catch (error) {
        console.error(
          "[SWStorage] Failed to delete pending tool requests by workflow:",
          error
        );
      }
    }
    /**
     * Cleanup stale pending tool requests older than maxAgeMs
     * @param maxAgeMs Maximum age in milliseconds (default: 1 hour)
     * @returns Number of requests deleted
     */
    async cleanupStalePendingToolRequests(maxAgeMs = 36e5) {
      try {
        const db = await this.getDB();
        const cutoff = Date.now() - maxAgeMs;
        return new Promise((resolve, reject) => {
          const tx = db.transaction(PENDING_TOOL_REQUESTS_STORE, "readwrite");
          const store = tx.objectStore(PENDING_TOOL_REQUESTS_STORE);
          const cursorReq = store.openCursor();
          let deleted = 0;
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor) return;
            if (cursor.value.createdAt < cutoff) {
              cursor.delete();
              deleted++;
            }
            cursor.continue();
          };
          tx.oncomplete = () => {
            resolve(deleted);
          };
          tx.onerror = () => reject(tx.error);
        });
      } catch (error) {
        console.error(
          "[SWStorage] Failed to cleanup stale pending tool requests:",
          error
        );
        return 0;
      }
    }
    // ============================================================================
    // Pending DOM Operations Storage Methods
    // ============================================================================
    /**
     * Save a pending DOM operation to IndexedDB
     * Called when a main-thread tool result is ready but no client is available
     */
    async savePendingDomOperation(operation) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(
            PENDING_DOM_OPERATIONS_STORE,
            "readwrite"
          );
          const store = transaction.objectStore(PENDING_DOM_OPERATIONS_STORE);
          const request = store.put(operation);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve();
        });
      } catch (error) {
        console.error("[SWStorage] Failed to save pending DOM operation:", error);
      }
    }
    /**
     * Get all pending DOM operations
     */
    async getAllPendingDomOperations() {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(
            PENDING_DOM_OPERATIONS_STORE,
            "readonly"
          );
          const store = transaction.objectStore(PENDING_DOM_OPERATIONS_STORE);
          const request = store.getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result || []);
        });
      } catch (error) {
        console.error(
          "[SWStorage] Failed to get all pending DOM operations:",
          error
        );
        return [];
      }
    }
    /**
     * Get pending DOM operations by workflow ID
     */
    async getPendingDomOperationsByWorkflow(workflowId) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(
            PENDING_DOM_OPERATIONS_STORE,
            "readonly"
          );
          const store = transaction.objectStore(PENDING_DOM_OPERATIONS_STORE);
          const index = store.index("workflowId");
          const request = index.getAll(workflowId);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result || []);
        });
      } catch (error) {
        console.error(
          "[SWStorage] Failed to get pending DOM operations by workflow:",
          error
        );
        return [];
      }
    }
    /**
     * Get pending DOM operations by chat ID
     */
    async getPendingDomOperationsByChatId(chatId) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(
            PENDING_DOM_OPERATIONS_STORE,
            "readonly"
          );
          const store = transaction.objectStore(PENDING_DOM_OPERATIONS_STORE);
          const index = store.index("chatId");
          const request = index.getAll(chatId);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result || []);
        });
      } catch (error) {
        console.error(
          "[SWStorage] Failed to get pending DOM operations by chat ID:",
          error
        );
        return [];
      }
    }
    /**
     * Get a pending DOM operation by ID
     */
    async getPendingDomOperation(operationId) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(
            PENDING_DOM_OPERATIONS_STORE,
            "readonly"
          );
          const store = transaction.objectStore(PENDING_DOM_OPERATIONS_STORE);
          const request = store.get(operationId);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result || null);
        });
      } catch (error) {
        console.error("[SWStorage] Failed to get pending DOM operation:", error);
        return null;
      }
    }
    /**
     * Delete a pending DOM operation
     */
    async deletePendingDomOperation(operationId) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(
            PENDING_DOM_OPERATIONS_STORE,
            "readwrite"
          );
          const store = transaction.objectStore(PENDING_DOM_OPERATIONS_STORE);
          const request = store.delete(operationId);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve();
        });
      } catch (error) {
        console.error(
          "[SWStorage] Failed to delete pending DOM operation:",
          error
        );
      }
    }
    /**
     * Delete all pending DOM operations for a workflow
     */
    async deletePendingDomOperationsByWorkflow(workflowId) {
      try {
        const operations = await this.getPendingDomOperationsByWorkflow(
          workflowId
        );
        for (const op of operations) {
          await this.deletePendingDomOperation(op.id);
        }
      } catch (error) {
        console.error(
          "[SWStorage] Failed to delete pending DOM operations by workflow:",
          error
        );
      }
    }
    /**
     * Delete all pending DOM operations for a chat
     */
    async deletePendingDomOperationsByChatId(chatId) {
      try {
        const operations = await this.getPendingDomOperationsByChatId(chatId);
        for (const op of operations) {
          await this.deletePendingDomOperation(op.id);
        }
      } catch (error) {
        console.error(
          "[SWStorage] Failed to delete pending DOM operations by chat ID:",
          error
        );
      }
    }
    // ============================================================================
    // Task-Step Mapping Storage Methods (for unified progress sync)
    // ============================================================================
    /**
     * Save a task-step mapping to IndexedDB
     */
    async saveTaskStepMapping(mapping) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(
            TASK_STEP_MAPPINGS_STORE,
            "readwrite"
          );
          const store = transaction.objectStore(TASK_STEP_MAPPINGS_STORE);
          const request = store.put(mapping);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve();
        });
      } catch (error) {
        console.error("[SWStorage] Failed to save task-step mapping:", error);
      }
    }
    /**
     * Get all task-step mappings
     */
    async getAllTaskStepMappings() {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(
            TASK_STEP_MAPPINGS_STORE,
            "readonly"
          );
          const store = transaction.objectStore(TASK_STEP_MAPPINGS_STORE);
          const request = store.getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result || []);
        });
      } catch (error) {
        console.error("[SWStorage] Failed to get all task-step mappings:", error);
        return [];
      }
    }
    /**
     * Get task-step mapping by task ID
     */
    async getTaskStepMapping(taskId) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(
            TASK_STEP_MAPPINGS_STORE,
            "readonly"
          );
          const store = transaction.objectStore(TASK_STEP_MAPPINGS_STORE);
          const request = store.get(taskId);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result || null);
        });
      } catch (error) {
        console.error("[SWStorage] Failed to get task-step mapping:", error);
        return null;
      }
    }
    /**
     * Get task-step mappings by workflow ID
     */
    async getTaskStepMappingsByWorkflow(workflowId) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(
            TASK_STEP_MAPPINGS_STORE,
            "readonly"
          );
          const store = transaction.objectStore(TASK_STEP_MAPPINGS_STORE);
          const index = store.index("workflowId");
          const request = index.getAll(workflowId);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result || []);
        });
      } catch (error) {
        console.error(
          "[SWStorage] Failed to get task-step mappings by workflow:",
          error
        );
        return [];
      }
    }
    /**
     * Delete a task-step mapping
     */
    async deleteTaskStepMapping(taskId) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(
            TASK_STEP_MAPPINGS_STORE,
            "readwrite"
          );
          const store = transaction.objectStore(TASK_STEP_MAPPINGS_STORE);
          const request = store.delete(taskId);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve();
        });
      } catch (error) {
        console.error("[SWStorage] Failed to delete task-step mapping:", error);
      }
    }
    /**
     * Delete all task-step mappings for a workflow
     */
    async deleteTaskStepMappingsByWorkflow(workflowId) {
      try {
        const mappings = await this.getTaskStepMappingsByWorkflow(workflowId);
        for (const mapping of mappings) {
          await this.deleteTaskStepMapping(mapping.taskId);
        }
      } catch (error) {
        console.error(
          "[SWStorage] Failed to delete task-step mappings by workflow:",
          error
        );
      }
    }
    // ============================================================================
    // Pending Canvas Operation Storage Methods (for canvas operation retry)
    // ============================================================================
    /**
     * Save a pending canvas operation to IndexedDB
     */
    async savePendingCanvasOperation(operation) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(
            PENDING_CANVAS_OPERATIONS_STORE,
            "readwrite"
          );
          const store = transaction.objectStore(PENDING_CANVAS_OPERATIONS_STORE);
          const request = store.put(operation);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve();
        });
      } catch (error) {
        console.error(
          "[SWStorage] Failed to save pending canvas operation:",
          error
        );
      }
    }
    /**
     * Get all pending canvas operations
     */
    async getAllPendingCanvasOperations() {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(
            PENDING_CANVAS_OPERATIONS_STORE,
            "readonly"
          );
          const store = transaction.objectStore(PENDING_CANVAS_OPERATIONS_STORE);
          const request = store.getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result || []);
        });
      } catch (error) {
        console.error(
          "[SWStorage] Failed to get all pending canvas operations:",
          error
        );
        return [];
      }
    }
    /**
     * Get pending canvas operations by workflow ID
     */
    async getPendingCanvasOperationsByWorkflow(workflowId) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(
            PENDING_CANVAS_OPERATIONS_STORE,
            "readonly"
          );
          const store = transaction.objectStore(PENDING_CANVAS_OPERATIONS_STORE);
          const index = store.index("workflowId");
          const request = index.getAll(workflowId);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result || []);
        });
      } catch (error) {
        console.error(
          "[SWStorage] Failed to get pending canvas operations by workflow:",
          error
        );
        return [];
      }
    }
    /**
     * Delete a pending canvas operation
     */
    async deletePendingCanvasOperation(operationId) {
      try {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(
            PENDING_CANVAS_OPERATIONS_STORE,
            "readwrite"
          );
          const store = transaction.objectStore(PENDING_CANVAS_OPERATIONS_STORE);
          const request = store.delete(operationId);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve();
        });
      } catch (error) {
        console.error(
          "[SWStorage] Failed to delete pending canvas operation:",
          error
        );
      }
    }
    /**
     * Delete all pending canvas operations for a workflow
     */
    async deletePendingCanvasOperationsByWorkflow(workflowId) {
      try {
        const operations = await this.getPendingCanvasOperationsByWorkflow(
          workflowId
        );
        for (const op of operations) {
          await this.deletePendingCanvasOperation(op.id);
        }
      } catch (error) {
        console.error(
          "[SWStorage] Failed to delete pending canvas operations by workflow:",
          error
        );
      }
    }
    /**
     * 归档超出保留限制的终态任务（标记 archived=true）
     * SW 启动时调用，确保 IndexedDB 中活跃任务数量受控
     * @param maxRetained 最大保留活跃任务数
     */
    async archiveOldTasks(maxRetained = 100) {
      try {
        const db = await this.getDB();
        const allTasks = await new Promise((resolve, reject) => {
          const tx = db.transaction(TASKS_STORE, "readonly");
          const store = tx.objectStore(TASKS_STORE);
          const index = store.index("createdAt");
          const results = [];
          const cursorReq = index.openCursor(null, "next");
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor) {
              resolve(results);
              return;
            }
            const task = cursor.value;
            if (!task.archived) {
              results.push(task);
            }
            cursor.continue();
          };
          cursorReq.onerror = () => reject(cursorReq.error);
        });
        const toArchiveCount = allTasks.length - maxRetained;
        if (toArchiveCount <= 0) return 0;
        const terminalStatuses = ["completed", "failed", "cancelled"];
        const toArchive = allTasks.filter((t2) => terminalStatuses.includes(t2.status)).slice(0, toArchiveCount);
        if (toArchive.length === 0) return 0;
        const now = Date.now();
        return new Promise((resolve, reject) => {
          const tx = db.transaction(TASKS_STORE, "readwrite");
          const store = tx.objectStore(TASKS_STORE);
          for (const task of toArchive) {
            task.archived = true;
            task.updatedAt = now;
            store.put(task);
          }
          tx.oncomplete = () => {
            resolve(toArchive.length);
          };
          tx.onerror = () => reject(tx.error);
        });
      } catch (error) {
        console.error("[SWStorage] Failed to archive old tasks:", error);
        return 0;
      }
    }
  }
  const taskQueueStorage = new TaskQueueStorage();
  const SENSITIVE_KEYS = [
    "apikey",
    "api_key",
    "password",
    "token",
    "secret",
    "authorization",
    "bearer",
    "credential",
    "key"
  ];
  function sanitizeObject(data) {
    if (!data) return data;
    if (typeof data === "string") {
      if (data.toLowerCase().startsWith("bearer ")) {
        return "[REDACTED]";
      }
      if (data.length > 30 && /^[a-zA-Z0-9-_]+$/.test(data) && !data.includes("-")) {
        return "[REDACTED]";
      }
      return data;
    }
    if (Array.isArray(data)) {
      return data.map((item) => sanitizeObject(item));
    }
    if (typeof data === "object") {
      const sanitized = {};
      for (const [key, value] of Object.entries(data)) {
        const lowerKey = key.toLowerCase();
        if (SENSITIVE_KEYS.some((k2) => lowerKey.includes(k2))) {
          sanitized[key] = "[REDACTED]";
        } else {
          sanitized[key] = sanitizeObject(value);
        }
      }
      return sanitized;
    }
    return data;
  }
  let debugModeEnabled$2 = false;
  const MAX_LOGS = 500;
  const logs = [];
  let logIdCounter = 0;
  function isDebugModeActive() {
    return debugModeEnabled$2;
  }
  const EXCLUDED_MESSAGE_TYPES = [
    // Native message types
    "SW_DEBUG_ENABLE",
    "SW_DEBUG_DISABLE",
    "SW_DEBUG_GET_STATUS",
    "SW_DEBUG_CLEAR_LOGS",
    "SW_DEBUG_CLEAR_CONSOLE_LOGS",
    "SW_DEBUG_GET_CONSOLE_LOGS",
    "SW_DEBUG_EXPORT_LOGS",
    "SW_DEBUG_HEARTBEAT",
    "SW_DEBUG_STATUS",
    "SW_DEBUG_ENABLED",
    "SW_DEBUG_DISABLED",
    "SW_DEBUG_LOG",
    "SW_DEBUG_LOGS",
    "SW_DEBUG_LOGS_CLEARED",
    "SW_CONSOLE_LOG",
    "SW_DEBUG_CONSOLE_LOGS",
    "SW_DEBUG_CONSOLE_LOGS_CLEARED",
    "SW_POSTMESSAGE_LOG",
    "SW_DEBUG_POSTMESSAGE_LOGS",
    "SW_DEBUG_POSTMESSAGE_LOGS_CLEARED",
    "SW_DEBUG_NEW_CRASH_SNAPSHOT",
    "SW_DEBUG_CRASH_SNAPSHOTS",
    "SW_DEBUG_CRASH_SNAPSHOTS_CLEARED",
    "SW_DEBUG_GET_CRASH_SNAPSHOTS",
    "SW_DEBUG_CLEAR_CRASH_SNAPSHOTS",
    "CRASH_SNAPSHOT",
    // postmessage-duplex debug event names (避免死循环)
    "debug:log",
    "debug:llmLog",
    "debug:statusChanged",
    "debug:enable",
    "debug:disable",
    "debug:getStatus",
    "debug:getLogs",
    "debug:clearLogs",
    "debug:getConsoleLogs",
    "debug:clearConsoleLogs",
    "debug:getPostMessageLogs",
    "debug:clearPostMessageLogs",
    "debug:getCrashSnapshots",
    "debug:clearCrashSnapshots",
    "debug:getLLMApiLogs",
    "debug:clearLLMApiLogs",
    "debug:getCacheStats",
    "debug:exportLogs",
    "debug:newCrashSnapshot",
    "console:log",
    "console:report",
    "postmessage:log",
    "postmessage:logBatch",
    "crash:snapshot",
    "crash:heartbeat"
  ];
  const pendingRequests = /* @__PURE__ */ new Map();
  function setPostMessageLoggerDebugMode(enabled) {
    const wasEnabled = debugModeEnabled$2;
    debugModeEnabled$2 = enabled;
    if (!enabled && wasEnabled) {
      logs.length = 0;
      pendingRequests.clear();
      logIdCounter = 0;
    }
  }
  function isPostMessageLoggerDebugMode() {
    return debugModeEnabled$2;
  }
  function shouldLogMessage(messageType) {
    if (!isDebugModeActive()) {
      return false;
    }
    if (messageType === "unknown") {
      return false;
    }
    if (EXCLUDED_MESSAGE_TYPES.includes(messageType)) {
      return false;
    }
    if (messageType.startsWith("RPC:")) {
      let methodName = messageType.slice(4);
      if (methodName.endsWith(":response")) {
        methodName = methodName.slice(0, -9);
      } else if (methodName.endsWith(":error")) {
        methodName = methodName.slice(0, -6);
      }
      if (EXCLUDED_MESSAGE_TYPES.includes(methodName)) {
        return false;
      }
    }
    return true;
  }
  function getClientInfo(clientUrl) {
    if (!clientUrl) {
      return {};
    }
    let clientType = "other";
    if (clientUrl.includes("sw-debug")) {
      clientType = "debug";
    } else if (clientUrl.includes("localhost") || clientUrl.includes("127.0.0.1")) {
      clientType = "main";
    } else if (!clientUrl.includes("chrome-extension") && !clientUrl.includes("moz-extension")) {
      clientType = "main";
    }
    return {
      clientType,
      clientUrl: new URL(clientUrl).pathname + new URL(clientUrl).search
    };
  }
  function logReceivedMessage(messageType, data, clientId, clientUrl, isInternal) {
    if (isInternal) {
      return "";
    }
    if (!shouldLogMessage(messageType)) {
      return "";
    }
    const clientInfo = getClientInfo(clientUrl);
    if (clientInfo.clientType === "debug") {
      return "";
    }
    const logId = `pm-recv-${Date.now()}-${++logIdCounter}`;
    const entry = {
      id: logId,
      timestamp: Date.now(),
      direction: "receive",
      messageType,
      data: sanitizeData(data),
      clientId,
      clientUrl: clientInfo.clientUrl,
      clientType: clientInfo.clientType
    };
    addLog(entry);
    if (isRequestMessage(messageType)) {
      const requestId = getRequestId(data);
      if (requestId) {
        pendingRequests.set(requestId, {
          entry,
          startTime: Date.now()
        });
      }
    }
    return logId;
  }
  function logSentMessage(messageType, data, clientId, clientUrl) {
    if (!shouldLogMessage(messageType)) {
      return "";
    }
    const clientInfo = getClientInfo(clientUrl);
    if (clientInfo.clientType === "debug") {
      return "";
    }
    const logId = `pm-send-${Date.now()}-${++logIdCounter}`;
    const entry = {
      id: logId,
      timestamp: Date.now(),
      direction: "send",
      messageType,
      data: sanitizeData(data),
      clientId,
      clientUrl: clientInfo.clientUrl,
      clientType: clientInfo.clientType
    };
    let linkedRequestId = null;
    if (isResponseMessage(messageType)) {
      const requestId = getRequestId(data);
      if (requestId) {
        const pending = pendingRequests.get(requestId);
        if (pending) {
          entry.duration = Date.now() - pending.startTime;
          pending.entry.response = sanitizeData(data);
          pending.entry.duration = entry.duration;
          linkedRequestId = pending.entry.id;
          pendingRequests.delete(requestId);
        }
      }
    }
    addLog(entry);
    return linkedRequestId ? `${logId}|${linkedRequestId}` : logId;
  }
  function addLog(entry) {
    logs.unshift(entry);
    if (logs.length > MAX_LOGS) {
      logs.pop();
    }
  }
  function updateRequestWithResponse(requestId, response, duration, error) {
    if (!isDebugModeActive()) {
      return "";
    }
    const pending = pendingRequests.get(requestId);
    if (pending) {
      pending.entry.response = sanitizeData(response);
      pending.entry.duration = duration;
      if (error) {
        pending.entry.error = error;
      }
      const logId = pending.entry.id;
      pendingRequests.delete(requestId);
      return logId;
    }
    return "";
  }
  function getAllLogs() {
    return [...logs];
  }
  function clearLogs() {
    logs.length = 0;
    pendingRequests.clear();
    logIdCounter = 0;
  }
  function isRequestMessage(messageType) {
    if (messageType.startsWith("RPC:") && !messageType.endsWith(":response") && !messageType.endsWith(":error")) {
      return true;
    }
    const requestPatterns = [
      "TASK_SUBMIT",
      "TASK_CANCEL",
      "TASK_RETRY",
      "TASK_DELETE",
      "TASK_GET_",
      "WORKFLOW_SUBMIT",
      "WORKFLOW_CANCEL",
      "WORKFLOW_GET_",
      "CHAT_START",
      "MCP_TOOL_EXECUTE",
      "MAIN_THREAD_TOOL_REQUEST"
    ];
    return requestPatterns.some((p2) => messageType.includes(p2));
  }
  function isResponseMessage(messageType) {
    if (messageType.endsWith(":response") || messageType.endsWith(":error")) {
      return true;
    }
    const responsePatterns = [
      "TASK_QUEUE_INITIALIZED",
      "TASK_STATUS",
      "TASK_COMPLETED",
      "TASK_FAILED",
      "TASK_CREATED",
      "TASK_CANCELLED",
      "TASK_DELETED",
      "WORKFLOW_STATUS",
      "WORKFLOW_STEP_STATUS",
      "WORKFLOW_COMPLETED",
      "WORKFLOW_FAILED",
      "CHAT_CHUNK",
      "CHAT_DONE",
      "CHAT_ERROR",
      "MCP_TOOL_RESULT",
      "MAIN_THREAD_TOOL_RESPONSE"
    ];
    return responsePatterns.some((p2) => messageType.includes(p2));
  }
  function getRequestId(data) {
    if (!data || typeof data !== "object") return null;
    const obj = data;
    return obj.requestId || obj.taskId || obj.workflowId || obj.chatId || null;
  }
  function sanitizeData(data) {
    if (!data) return data;
    try {
      const cloned = JSON.parse(JSON.stringify(data));
      return sanitizeObject(cloned);
    } catch {
      return "[Non-serializable data]";
    }
  }
  function getLogStats() {
    const stats = {
      total: logs.length,
      sent: 0,
      received: 0,
      byType: {}
    };
    for (const log of logs) {
      if (log.direction === "send") {
        stats.sent++;
      } else {
        stats.received++;
      }
      if (!stats.byType[log.messageType]) {
        stats.byType[log.messageType] = 0;
      }
      stats.byType[log.messageType]++;
    }
    return stats;
  }
  const postmessageLogger = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    clearLogs,
    getAllLogs,
    getLogStats,
    isPostMessageLoggerDebugMode,
    logReceivedMessage,
    logSentMessage,
    setPostMessageLoggerDebugMode,
    updateRequestWithResponse
  }, Symbol.toStringTag, { value: "Module" }));
  function e() {
    return "undefined" != typeof window ? window : "undefined" != typeof self ? self : {};
  }
  function t(e2) {
    return JSON.parse(JSON.stringify(e2));
  }
  function i(e2) {
    const t2 = Date.now().toString(36);
    let i2;
    if ("undefined" != typeof crypto && crypto.getRandomValues) {
      const e3 = new Uint32Array(2);
      crypto.getRandomValues(e3), i2 = e3[0].toString(36) + e3[1].toString(36);
    } else i2 = Math.floor(1e10 * Math.random()).toString(36);
    return `${e2}${t2}${i2}_`;
  }
  const n = "postmessage-duplex", r = "1.2.0", a = e();
  var o, c;
  a.__POSTMESSAGE_DUPLEX__ || (a.__POSTMESSAGE_DUPLEX__ = {}), a.__POSTMESSAGE_DUPLEX__.version = r, a.__POSTMESSAGE_DUPLEX__.name = n, (function(e2) {
    e2[e2.Success = 0] = "Success", e2[e2.ReceiverCallbackError = -1] = "ReceiverCallbackError", e2[e2.SendCallbackError = -2] = "SendCallbackError", e2[e2.NoSubscribe = -3] = "NoSubscribe", e2[e2.TimeOut = -99] = "TimeOut";
  })(o || (o = {})), (function(e2) {
    e2.ConnectionDestroyed = "CONNECTION_DESTROYED", e2.ConnectionTimeout = "CONNECTION_TIMEOUT", e2.MethodCallTimeout = "METHOD_CALL_TIMEOUT", e2.MethodNotFound = "METHOD_NOT_FOUND", e2.TransmissionFailed = "TRANSMISSION_FAILED", e2.MessageSizeExceeded = "MESSAGE_SIZE_EXCEEDED", e2.RateLimitExceeded = "RATE_LIMIT_EXCEEDED", e2.HandlerError = "HANDLER_ERROR", e2.InvalidMessage = "INVALID_MESSAGE", e2.OriginMismatch = "ORIGIN_MISMATCH", e2.HeartbeatFailed = "HEARTBEAT_FAILED", e2.ReconnectFailed = "RECONNECT_FAILED", e2.HandshakeFailed = "HANDSHAKE_FAILED", e2.ServiceWorkerUnavailable = "SERVICE_WORKER_UNAVAILABLE";
  })(c || (c = {}));
  class l extends Error {
    constructor(e2, t2, i2) {
      super(e2), Object.defineProperty(this, "code", { enumerable: 1, configurable: 1, writable: 1, value: void 0 }), Object.defineProperty(this, "details", { enumerable: 1, configurable: 1, writable: 1, value: void 0 }), this.name = "ChannelError", this.code = t2, this.details = i2, Error.captureStackTrace && Error.captureStackTrace(this, l);
    }
    toJSON() {
      return { name: this.name, message: this.message, code: this.code, details: this.details, stack: this.stack };
    }
  }
  class d {
    constructor() {
      Object.defineProperty(this, "timeouts", { enumerable: 1, configurable: 1, writable: 1, value: /* @__PURE__ */ new Map() }), Object.defineProperty(this, "timer", { enumerable: 1, configurable: 1, writable: 1, value: null }), Object.defineProperty(this, "nextDeadline", { enumerable: 1, configurable: 1, writable: 1, value: 1 / 0 }), Object.defineProperty(this, "destroyed", { enumerable: 1, configurable: 1, writable: 1, value: 0 });
    }
    add(e2, t2, i2) {
      if (this.destroyed) return;
      const s = Date.now() + t2;
      this.timeouts.set(e2, { deadline: s, callback: i2 }), s < this.nextDeadline && this.reschedule(s);
    }
    remove(e2) {
      return this.timeouts.delete(e2);
    }
    has(e2) {
      return this.timeouts.has(e2);
    }
    get size() {
      return this.timeouts.size;
    }
    reschedule(e2) {
      null !== this.timer && clearTimeout(this.timer), this.nextDeadline = e2;
      const t2 = Math.max(0, e2 - Date.now());
      this.timer = setTimeout(() => this.processTimeouts(), t2);
    }
    processTimeouts() {
      if (this.destroyed) return;
      const e2 = Date.now(), t2 = [];
      for (const [i2, { deadline: s, callback: n2 }] of this.timeouts) s <= e2 && (t2.push(n2), this.timeouts.delete(i2));
      for (const e3 of t2) try {
        e3();
      } catch (e4) {
        console.error("[TimeoutManager] Callback error:", e4);
      }
      this.scheduleNext();
    }
    scheduleNext() {
      if (0 === this.timeouts.size) return this.nextDeadline = 1 / 0, void (this.timer = null);
      let e2 = 1 / 0;
      for (const { deadline: t2 } of this.timeouts.values()) t2 < e2 && (e2 = t2);
      e2 < 1 / 0 && this.reschedule(e2);
    }
    destroy() {
      this.destroyed = 1, null !== this.timer && (clearTimeout(this.timer), this.timer = null), this.timeouts.clear(), this.nextDeadline = 1 / 0;
    }
    clear() {
      null !== this.timer && (clearTimeout(this.timer), this.timer = null), this.timeouts.clear(), this.nextDeadline = 1 / 0;
    }
  }
  class f {
    constructor(e2, t2 = 1e3) {
      Object.defineProperty(this, "limit", { enumerable: 1, configurable: 1, writable: 1, value: e2 }), Object.defineProperty(this, "windowMs", { enumerable: 1, configurable: 1, writable: 1, value: t2 }), Object.defineProperty(this, "timestamps", { enumerable: 1, configurable: 1, writable: 1, value: void 0 }), Object.defineProperty(this, "head", { enumerable: 1, configurable: 1, writable: 1, value: 0 }), Object.defineProperty(this, "tail", { enumerable: 1, configurable: 1, writable: 1, value: 0 }), Object.defineProperty(this, "count", { enumerable: 1, configurable: 1, writable: 1, value: 0 }), Object.defineProperty(this, "enabled", { enumerable: 1, configurable: 1, writable: 1, value: void 0 }), this.enabled = e2 > 0, this.timestamps = this.enabled ? new Array(e2).fill(0) : [];
    }
    tryAcquire() {
      if (!this.enabled) return 1;
      const e2 = Date.now(), t2 = e2 - this.windowMs;
      for (; this.count > 0 && this.timestamps[this.head] <= t2; ) this.head = (this.head + 1) % this.limit, this.count--;
      return this.count >= this.limit ? 0 : (this.timestamps[this.tail] = e2, this.tail = (this.tail + 1) % this.limit, this.count++, 1);
    }
    getCurrentCount() {
      if (!this.enabled) return 0;
      const e2 = Date.now() - this.windowMs;
      let t2 = 0, i2 = this.head;
      for (let s = 0; s < this.count; s++) this.timestamps[i2] > e2 && t2++, i2 = (i2 + 1) % this.limit;
      return t2;
    }
    getRemainingCapacity() {
      return this.enabled ? Math.max(0, this.limit - this.getCurrentCount()) : 1 / 0;
    }
    getTimeUntilAvailable() {
      if (!this.enabled || this.count < this.limit) return 0;
      const e2 = Date.now() - this.windowMs;
      let t2 = this.head;
      for (; t2 !== this.tail; ) {
        if (this.timestamps[t2] > e2) return this.timestamps[t2] - e2;
        t2 = (t2 + 1) % this.limit;
      }
      return 0;
    }
    isLimited() {
      return this.enabled ? this.getCurrentCount() >= this.limit : 0;
    }
    reset() {
      this.head = 0, this.tail = 0, this.count = 0, this.enabled && this.timestamps.fill(0);
    }
    getLimit() {
      return this.limit;
    }
    getWindowMs() {
      return this.windowMs;
    }
    isEnabled() {
      return this.enabled;
    }
  }
  class g {
    constructor() {
      Object.defineProperty(this, "eventHandlers", { enumerable: 1, configurable: 1, writable: 1, value: /* @__PURE__ */ new Map() }), Object.defineProperty(this, "eventsEnabled", { enumerable: 1, configurable: 1, writable: 1, value: 1 });
    }
    on(e2, t2) {
      let i2 = this.eventHandlers.get(e2);
      return i2 || (i2 = /* @__PURE__ */ new Set(), this.eventHandlers.set(e2, i2)), i2.add(t2), () => {
        i2 == null ? void 0 : i2.delete(t2), 0 === (i2 == null ? void 0 : i2.size) && this.eventHandlers.delete(e2);
      };
    }
    once(e2, t2) {
      const i2 = (s) => {
        this.off(e2, i2), t2(s);
      };
      return this.on(e2, i2);
    }
    off(e2, t2) {
      const i2 = this.eventHandlers.get(e2);
      if (!i2) return 0;
      const s = i2.delete(t2);
      return 0 === i2.size && this.eventHandlers.delete(e2), s;
    }
    offAll(e2) {
      e2 ? this.eventHandlers.delete(e2) : this.eventHandlers.clear();
    }
    emit(e2, t2) {
      if (!this.eventsEnabled) return;
      const i2 = this.eventHandlers.get(e2);
      if (i2) for (const s of [...i2]) try {
        s(t2);
      } catch (t3) {
        console.error(`[ChannelEventEmitter] Error in ${e2} handler:`, t3);
      }
    }
    hasListeners(e2) {
      const t2 = this.eventHandlers.get(e2);
      return void 0 !== t2 && t2.size > 0;
    }
    listenerCount(e2) {
      var _a;
      return ((_a = this.eventHandlers.get(e2)) == null ? void 0 : _a.size) ?? 0;
    }
    setEventsEnabled(e2) {
      this.eventsEnabled = e2;
    }
    destroyEventEmitter() {
      this.eventHandlers.clear(), this.eventsEnabled = 0;
    }
  }
  function m(e2) {
    return "object" == typeof e2 && null !== e2 && !Array.isArray(e2);
  }
  const w = (e2) => ({ valid: 0, error: e2 });
  function p(e2) {
    if (!m(e2)) return w("Message must be an object");
    const t2 = e2, i2 = "requestId" in t2, s = "cmdname" in t2, n2 = "msg" in t2, r2 = "ret" in t2;
    return i2 || s || n2 ? i2 && "string" != typeof t2.requestId ? w("requestId must be a string") : s && "string" != typeof t2.cmdname ? w("cmdname must be a string") : n2 && "string" != typeof t2.msg ? w("msg must be a string") : !r2 || "number" == typeof (a2 = t2.ret) && Object.values(o).includes(a2) ? "data" in t2 && void 0 !== t2.data && !m(t2.data) ? w("data must be an object") : "_senderKey" in t2 && void 0 !== t2._senderKey && "string" != typeof t2._senderKey ? w("_senderKey must be a string") : !("time" in t2) || void 0 === t2.time || "number" == typeof t2.time && Number.isFinite(t2.time) ? { valid: 1, message: t2 } : w("time must be a finite number") : w("ret must be a valid ReturnCode") : w("Message must have requestId, cmdname, or msg field");
    var a2;
  }
  function S(e2) {
    return "ret" in e2 && "number" == typeof e2.ret;
  }
  function O(e2) {
    return "ready" === e2.msg;
  }
  function _(e2) {
    return 1 == e2._broadcast && "string" == typeof e2.cmdname;
  }
  function E(e2) {
    try {
      const t2 = JSON.stringify(e2);
      return "undefined" != typeof Blob ? new Blob([t2]).size : 2 * t2.length;
    } catch {
      return 1 / 0;
    }
  }
  const j = [], k = [];
  function D(e2) {
    k.length >= 200 && k.shift(), k.push(e2);
  }
  function R(e2, t2) {
    for (let i2 = k.length - 1; i2 >= 0; i2--) if (k[i2].requestId === e2 && "pending" === k[i2].status) {
      k[i2].status = t2, k[i2].duration = Date.now() - k[i2].timestamp;
      break;
    }
  }
  class x extends g {
    constructor(e2) {
      if (super(), Object.defineProperty(this, "baseKey", { enumerable: 1, configurable: 1, writable: 1, value: "" }), Object.defineProperty(this, "peerKey", { enumerable: 1, configurable: 1, writable: 1, value: "" }), Object.defineProperty(this, "reqTime", { enumerable: 1, configurable: 1, writable: 1, value: 0 }), Object.defineProperty(this, "callbackMap", { enumerable: 1, configurable: 1, writable: 1, value: /* @__PURE__ */ new Map() }), Object.defineProperty(this, "subscribeMap", { enumerable: 1, configurable: 1, writable: 1, value: /* @__PURE__ */ new Map() }), Object.defineProperty(this, "broadcastHandlers", { enumerable: 1, configurable: 1, writable: 1, value: /* @__PURE__ */ new Map() }), Object.defineProperty(this, "timeout", { enumerable: 1, configurable: 1, writable: 1, value: void 0 }), Object.defineProperty(this, "isReady", { enumerable: 1, configurable: 1, writable: 1, value: 0 }), Object.defineProperty(this, "isDestroyed", { enumerable: 1, configurable: 1, writable: 1, value: 0 }), Object.defineProperty(this, "postTasks", { enumerable: 1, configurable: 1, writable: 1, value: /* @__PURE__ */ new Map() }), Object.defineProperty(this, "bindOnMessage", { enumerable: 1, configurable: 1, writable: 1, value: void 0 }), Object.defineProperty(this, "console", { enumerable: 1, configurable: 1, writable: 1, value: void 0 }), Object.defineProperty(this, "maxMessageSize", { enumerable: 1, configurable: 1, writable: 1, value: void 0 }), Object.defineProperty(this, "timeoutManager", { enumerable: 1, configurable: 1, writable: 1, value: void 0 }), Object.defineProperty(this, "rateLimiter", { enumerable: 1, configurable: 1, writable: 1, value: void 0 }), Object.defineProperty(this, "strictValidation", { enumerable: 1, configurable: 1, writable: 1, value: void 0 }), Object.defineProperty(this, "requestCmdMap", { enumerable: 1, configurable: 1, writable: 1, value: /* @__PURE__ */ new Map() }), Object.defineProperty(this, "isProcessingBatch", { enumerable: 1, configurable: 1, writable: 1, value: 0 }), this.timeout = (e2 == null ? void 0 : e2.timeout) ?? 5e3, this.console = (e2 == null ? void 0 : e2.log) ?? ("undefined" != typeof window ? window.console : console), this.maxMessageSize = (e2 == null ? void 0 : e2.maxMessageSize) ?? 1048576, this.strictValidation = (e2 == null ? void 0 : e2.strictValidation) ?? 1, this.timeoutManager = new d(), this.rateLimiter = new f((e2 == null ? void 0 : e2.rateLimit) ?? 100, 1e3), e2 == null ? void 0 : e2.subscribeMap) for (const t3 in e2.subscribeMap) this.subscribeMap.set(t3, e2.subscribeMap[t3]);
      var t2;
      this.bindOnMessage = this.onMessage.bind(this), t2 = this, j.push(new WeakRef(t2)), t2.on("message:sent", ({ cmdname: e3, requestId: t3 }) => {
        D({ direction: "send", cmdname: e3, requestId: t3, status: "pending", timestamp: Date.now(), dataSummary: "" });
      }), t2.on("message:received", ({ cmdname: e3, requestId: t3, isResponse: i2 }) => {
        const s = e3 || "", n2 = t3 || "";
        i2 ? R(n2, "ok") : D({ direction: "receive", cmdname: s, requestId: n2, status: "ok", timestamp: Date.now(), dataSummary: "" });
      }), t2.on("timeout", ({ cmdname: e3, requestId: t3 }) => {
        R(t3, "timeout");
      }), t2.on("error", ({ context: e3 }) => {
      }), t2.on("destroy", () => {
      });
    }
    checkRateLimit() {
      if (!this.rateLimiter.isEnabled()) return 1;
      if (!this.rateLimiter.tryAcquire()) {
        const e2 = this.rateLimiter.getCurrentCount(), t2 = this.rateLimiter.getLimit();
        return this.log("warn", "Rate limit exceeded:", e2, "/", t2, "messages per second"), this.emit("rate:limited", { currentCount: e2, limit: t2 }), 0;
      }
      return 1;
    }
    validateMessageSize(e2) {
      if (this.maxMessageSize <= 0) return;
      const t2 = E(e2);
      if (t2 > this.maxMessageSize) {
        const e3 = new l(`Message size (${t2} bytes) exceeds limit (${this.maxMessageSize} bytes)`, c.MessageSizeExceeded, { size: t2, limit: this.maxMessageSize });
        throw this.emit("error", { error: e3, context: "validateMessageSize" }), e3;
      }
    }
    init() {
      this.setupMessageListener(), this.sendMessage({ requestId: this.baseKey + this.reqTime, msg: "ready", _senderKey: this.baseKey });
    }
    log(e2, ...t2) {
      var _a, _b;
      (_b = (_a = this.console) == null ? void 0 : _a[e2]) == null ? void 0 : _b.call(_a, `[${this.channelType}]: `, ...t2);
    }
    isFromPeer(e2) {
      return this.peerKey ? e2._senderKey && e2._senderKey !== this.peerKey ? (this.log("log", "Message from non-paired channel, ignored", e2._senderKey, "expected:", this.peerKey), 0) : S(e2) && e2.requestId && !e2.requestId.startsWith(this.baseKey) ? 0 : 1 : 1;
    }
    sendMessage(e2, t2) {
      this.validateMessageSize(e2), this.checkRateLimit() ? (e2.time = Date.now(), e2._senderKey = this.baseKey, this.sendRawMessage(e2, t2)) : this.log("warn", "Message dropped due to rate limiting");
    }
    async onMessage(e2) {
      if (this.log("log", "onMessage", e2.data), !this.isValidSource(e2)) return;
      if (this.strictValidation) {
        const t3 = p(e2.data);
        if (!t3.valid) return this.log("warn", "Invalid message structure:", t3.error), void this.emit("validation:failed", { reason: t3.error, data: e2.data });
      }
      const t2 = e2.data;
      if (!t2) return;
      if (!this.isFromPeer(t2)) return;
      this.emit("message:received", { cmdname: t2.cmdname || "", requestId: t2.requestId || "", isResponse: S(t2) });
      const { requestId: i2, cmdname: s } = t2;
      this.handleResponseMessage(t2, i2) || this.handleBroadcastMessage(t2, s) || await this.handleSubscriptionMessage(t2, i2, s) || this.handleReadyMessage(t2, i2) || this.handleUnhandledMessage(t2, i2, s);
    }
    handleResponseMessage(e2, t2) {
      const i2 = t2 ? this.callbackMap.get(t2) : void 0;
      return i2 && t2 ? (this.timeoutManager.remove(t2), this.requestCmdMap.delete(t2), i2.resolve(e2), this.deleteCallback(t2), 1) : 0;
    }
    handleBroadcastMessage(e2, t2) {
      if (!_(e2)) return 0;
      const i2 = t2 ? this.broadcastHandlers.get(t2) : void 0;
      if (i2) try {
        i2({ cmdname: t2, data: e2.data });
      } catch (e3) {
        const i3 = e3 instanceof Error ? e3.message : String(e3);
        this.emit("error", { error: e3 instanceof Error ? e3 : new Error(i3), context: `broadcast:${t2}` });
      }
      return 1;
    }
    async handleSubscriptionMessage(e2, t2, i2) {
      if (!i2) return 0;
      const s = this.subscribeMap.get(i2);
      if (!s) return 0;
      try {
        const i3 = await s(e2);
        this.sendMessage({ requestId: t2, ret: o.Success, data: i3 });
      } catch (s2) {
        const n2 = s2 instanceof Error ? s2.message : String(s2);
        this.sendMessage({ req: e2, requestId: t2, ret: o.ReceiverCallbackError, msg: n2 || "unknown error" }), this.emit("error", { error: s2 instanceof Error ? s2 : new Error(n2), context: `handler:${i2}` });
      }
      return 1;
    }
    handleReadyMessage(e2, t2) {
      if (!O(e2)) return 0;
      const { _senderKey: i2 } = e2;
      return i2 && !this.peerKey && (this.peerKey = i2, this.log("log", "Point-to-point pairing established", "self:", this.baseKey, "peer:", this.peerKey)), this.isReady = 1, this.executePosts(), this.emit("ready", { peerKey: this.peerKey }), S(e2) || this.sendMessage({ requestId: t2, ret: o.Success, msg: "ready" }), 1;
    }
    handleUnhandledMessage(e2, t2, i2) {
      t2 && !S(e2) && (this.log("warn", "No registered handler for:", i2 || t2), this.sendMessage({ requestId: t2, ret: o.NoSubscribe }));
    }
    postMessage(e2, t2) {
      try {
        this.sendMessage(e2, t2), this.emit("message:sent", { cmdname: e2.cmdname || "", requestId: e2.requestId || "" });
      } catch (t3) {
        this.log("error", t3, e2), this.emit("error", { error: t3 instanceof Error ? t3 : new Error(String(t3)), context: "postMessage" });
      }
    }
    publish(e2, t2, i2) {
      if (this.isDestroyed) return Promise.reject(new l("Cannot publish: channel has been destroyed", c.ConnectionDestroyed, { cmdname: e2 }));
      const s = this.baseKey + ++this.reqTime, n2 = { requestId: s, cmdname: e2, data: t2 };
      this.requestCmdMap.set(s, e2);
      const r2 = new Promise((e3, t3) => {
        this.callbackMap.set(s, { resolve: e3, reject: t3 });
      });
      return this.log("log", "publish", this.isReady, this.postTasks.size), this.isReady ? this.doPublish(n2, i2) : this.postTasks.set(s, { data: n2, prm: r2, options: i2 }), r2;
    }
    doPublish(e2, t2) {
      const { requestId: i2, cmdname: s } = e2, n2 = (t2 == null ? void 0 : t2.timeout) ?? this.timeout;
      this.timeoutManager.add(i2, n2, () => {
        const t3 = this.callbackMap.get(i2);
        if (t3) {
          const r2 = { req: e2, requestId: i2, ret: o.TimeOut, time: Date.now(), msg: "timeout" };
          this.log("error", "postmessage timeout", r2), this.emit("timeout", { requestId: i2, cmdname: s, timeoutMs: n2 }), t3.resolve(r2), this.deleteCallback(i2), this.requestCmdMap.delete(i2);
        }
      }), this.postMessage(e2, t2 == null ? void 0 : t2.transferables);
    }
    deleteCallback(e2) {
      this.callbackMap.delete(e2), this.postTasks.delete(e2), this.timeoutManager.remove(e2);
    }
    executePosts() {
      0 === this.postTasks.size || this.isProcessingBatch || (this.isProcessingBatch = 1, queueMicrotask(() => {
        this.processBatch(), this.isProcessingBatch = 0;
      }));
    }
    processBatch() {
      const e2 = Array.from(this.postTasks.entries());
      for (const [t2, i2] of e2) this.postTasks.has(t2) && (t2.startsWith("_broadcast_") ? (this.doBroadcast(i2.data, i2.options), this.postTasks.delete(t2)) : this.doPublish(i2.data, i2.options));
    }
    call(e2, t2, i2) {
      return this.publish(e2, t2, i2);
    }
    subscribe(e2, t2) {
      return this.subscribeMap.has(e2) && this.log("warn", `${e2} has been subscribed`), this.subscribeMap.set(e2, t2), this;
    }
    unSubscribe(e2) {
      return this.subscribeMap.delete(e2), this;
    }
    subscribeOnce(e2, t2) {
      return this.subscribe(e2, async (i2) => (this.unSubscribe(e2), t2(i2)));
    }
    broadcast(e2, t2, i2) {
      if (this.isDestroyed) return void this.log("warn", "Cannot broadcast: channel has been destroyed");
      const s = { cmdname: e2, data: t2, time: Date.now(), _broadcast: 1 };
      if (this.log("log", "broadcast", e2, this.isReady), this.isReady) this.doBroadcast(s, i2);
      else {
        const e3 = `_broadcast_${Date.now()}_${Math.random()}`;
        this.postTasks.set(e3, { data: s, prm: Promise.resolve({}), options: i2 });
      }
    }
    doBroadcast(e2, t2) {
      try {
        this.sendMessage(e2, t2 == null ? void 0 : t2.transferables), this.emit("broadcast:sent", { cmdname: e2.cmdname });
      } catch (t3) {
        this.log("error", "broadcast error", t3, e2), this.emit("error", { error: t3 instanceof Error ? t3 : new Error(String(t3)), context: "broadcast" });
      }
    }
    onBroadcast(e2, t2) {
      return this.broadcastHandlers.has(e2) && this.log("warn", `Broadcast handler for ${e2} already registered, replacing`), this.broadcastHandlers.set(e2, t2), this;
    }
    offBroadcast(e2) {
      return this.broadcastHandlers.delete(e2), this;
    }
    getPeerKey() {
      return this.peerKey;
    }
    getRateLimitStats() {
      return { current: this.rateLimiter.getCurrentCount(), limit: this.rateLimiter.getLimit(), remaining: this.rateLimiter.getRemainingCapacity() };
    }
    getPendingCount() {
      return this.callbackMap.size;
    }
    destroy() {
      if (this.isDestroyed) return;
      this.isDestroyed = 1, this.emit("destroy", { reason: "explicit" }), (function(e3) {
        const t2 = j.findIndex((t3) => t3.deref() === e3);
        -1 !== t2 && j.splice(t2, 1);
      })(this);
      const e2 = new l("Channel has been destroyed", c.ConnectionDestroyed);
      for (const [t2, i2] of this.callbackMap) try {
        i2.reject({ ret: o.SendCallbackError, msg: e2.message });
      } catch (e3) {
        this.log("warn", "Error rejecting pending request:", t2, e3);
      }
      this.removeMessageListener(), this.subscribeMap.clear(), this.broadcastHandlers.clear(), this.postTasks.clear(), this.callbackMap.clear(), this.requestCmdMap.clear(), this.timeoutManager.destroy(), this.rateLimiter.reset(), this.destroyEventEmitter(), this.isReady = 0, this.peerKey = "";
    }
  }
  class K {
    constructor() {
      Object.defineProperty(this, "clientMeta", { enumerable: 1, configurable: 1, writable: 1, value: /* @__PURE__ */ new Map() }), Object.defineProperty(this, "channelsByClientId", { enumerable: 1, configurable: 1, writable: 1, value: /* @__PURE__ */ new Map() }), Object.defineProperty(this, "globalSubscribeMap", { enumerable: 1, configurable: 1, writable: 1, value: /* @__PURE__ */ new Map() }), Object.defineProperty(this, "initialized", { enumerable: 1, configurable: 1, writable: 1, value: 0 }), Object.defineProperty(this, "options", { enumerable: 1, configurable: 1, writable: 1, value: {} }), Object.defineProperty(this, "cleanupIntervalId", { enumerable: 1, configurable: 1, writable: 1, value: null }), Object.defineProperty(this, "globalListenerSetup", { enumerable: 1, configurable: 1, writable: 1, value: 0 }), Object.defineProperty(this, "unknownClientCallback", { enumerable: 1, configurable: 1, writable: 1, value: null }), Object.defineProperty(this, "channelFactory", { enumerable: 1, configurable: 1, writable: 1, value: null }), Object.defineProperty(this, "globalMessageHandler", { enumerable: 1, configurable: 1, writable: 1, value: (e2) => {
        const t2 = e2.source, i2 = t2 == null ? void 0 : t2.id;
        if (!i2) return;
        const s = this.channelsByClientId.get(i2);
        s ? s.handleMessage(e2) : this.unknownClientCallback && this.unknownClientCallback(i2, e2);
      } });
    }
    static getInstance() {
      return K.instance || (K.instance = new K()), K.instance;
    }
    static resetInstance() {
      K.instance && (K.instance.shutdown(), K.instance = null);
    }
    setup(e2, t2) {
      if (this.initialized) return void console.warn("[ServiceWorkerHub] Already initialized");
      this.options = e2, this.channelFactory = t2, this.initialized = 1, this.registerBuiltInHandlers(), this.setupLifecycleEvents();
      const i2 = e2.cleanupInterval ?? 3e4;
      i2 > 0 && (this.cleanupIntervalId = setInterval(() => this.cleanupInactiveClients(), i2));
    }
    shutdown() {
      this.cleanupIntervalId && (clearInterval(this.cleanupIntervalId), this.cleanupIntervalId = null), this.globalListenerSetup && (self.removeEventListener("message", this.globalMessageHandler), this.globalListenerSetup = 0);
      for (const e2 of this.channelsByClientId.values()) try {
        e2.destroy();
      } catch {
      }
      this.channelsByClientId.clear(), this.clientMeta.clear(), this.globalSubscribeMap.clear(), this.initialized = 0;
    }
    isInitialized() {
      return this.initialized;
    }
    getOptions() {
      return this.options;
    }
    enableGlobalRouting(e2) {
      this.unknownClientCallback = e2 ?? null, this.globalListenerSetup || (self.addEventListener("message", this.globalMessageHandler), this.globalListenerSetup = 1);
    }
    disableGlobalRouting() {
      this.globalListenerSetup && (self.removeEventListener("message", this.globalMessageHandler), this.globalListenerSetup = 0);
    }
    isGlobalRoutingEnabled() {
      return this.globalListenerSetup;
    }
    registerChannel(e2, t2) {
      this.channelsByClientId.set(e2, t2), this.applyGlobalHandlersToChannel(t2, e2);
    }
    unregisterChannel(e2) {
      var _a, _b;
      this.channelsByClientId.delete(e2), this.clientMeta.delete(e2), (_b = (_a = this.options).onClientDisconnect) == null ? void 0 : _b.call(_a, e2);
    }
    getChannel(e2) {
      return this.channelsByClientId.get(e2);
    }
    hasChannel(e2) {
      return this.channelsByClientId.has(e2);
    }
    getChannelCount() {
      return this.channelsByClientId.size;
    }
    createChannelForClient(e2) {
      if (!this.channelFactory) return console.warn("[ServiceWorkerHub] No channel factory configured"), null;
      const t2 = this.channelFactory(e2);
      return this.registerChannel(e2, t2), t2;
    }
    registerClientMeta(e2, t2) {
      var _a, _b;
      const i2 = { clientId: e2, appType: t2.appType, appName: t2.appName, connectedAt: (/* @__PURE__ */ new Date()).toISOString() };
      return this.clientMeta.set(e2, i2), (_b = (_a = this.options).onClientConnect) == null ? void 0 : _b.call(_a, e2, i2), i2;
    }
    getClientMeta(e2) {
      return this.clientMeta.get(e2);
    }
    getAllClientMeta() {
      return new Map(this.clientMeta);
    }
    getClientsByType(e2) {
      const t2 = [];
      for (const i2 of this.clientMeta.values()) i2.appType === e2 && t2.push(i2);
      return t2;
    }
    subscribeGlobal(e2, t2) {
      e2.startsWith("__") && console.warn(`[ServiceWorkerHub] Handler name '${e2}' uses reserved prefix '__'.`), this.globalSubscribeMap.set(e2, t2);
      for (const [i2, s] of this.channelsByClientId) this.applyHandlerToChannel(s, i2, e2, t2);
    }
    unsubscribeGlobal(e2) {
      this.globalSubscribeMap.delete(e2);
      for (const t2 of this.channelsByClientId.values()) t2.unSubscribe(e2);
    }
    applyGlobalHandlersToChannel(e2, t2) {
      for (const [i2, s] of this.globalSubscribeMap) this.applyHandlerToChannel(e2, t2, i2, s);
    }
    applyHandlerToChannel(e2, t2, i2, s) {
      e2.subscribe(i2, async (e3) => {
        const i3 = this.clientMeta.get(t2);
        return s({ data: e3.data || {}, clientId: t2, clientMeta: i3 });
      });
    }
    registerBuiltInHandlers() {
      this.globalSubscribeMap.set("__register__", ({ data: e2, clientId: t2 }) => (this.registerClientMeta(t2, { appType: e2.appType, appName: e2.appName }), { success: 1, clientId: t2, totalClients: this.clientMeta.size })), this.globalSubscribeMap.set("__ping__", ({ clientId: e2 }) => ({ pong: 1, timestamp: Date.now(), clientId: e2, activeClients: this.channelsByClientId.size }));
    }
    setupLifecycleEvents() {
      self.addEventListener("install", (e2) => {
        "function" == typeof self.skipWaiting && self.skipWaiting();
      }), self.addEventListener("activate", (e2) => {
        const t2 = (async () => {
          var _a;
          "function" == typeof ((_a = self.clients) == null ? void 0 : _a.claim) && await self.clients.claim(), await this.notifyAllClientsSwActivated();
        })();
        "function" == typeof e2.waitUntil && e2.waitUntil(t2);
      });
    }
    async notifyAllClientsSwActivated() {
      try {
        const e2 = await self.clients.matchAll();
        for (const t2 of e2) t2.postMessage({ cmdname: "__sw-activated__", data: { version: this.options.version }, _broadcast: 1 });
      } catch (e2) {
        console.error("[ServiceWorkerHub] Error notifying clients:", e2);
      }
    }
    async cleanupInactiveClients() {
      var _a, _b;
      try {
        const e2 = await self.clients.matchAll(), t2 = new Set(e2.map((e3) => e3.id));
        for (const [e3, i2] of this.channelsByClientId) t2.has(e3) || (i2.destroy(), this.channelsByClientId.delete(e3), this.clientMeta.delete(e3), (_b = (_a = this.options).onClientDisconnect) == null ? void 0 : _b.call(_a, e3));
      } catch (e2) {
        console.error("[ServiceWorkerHub] Cleanup error:", e2);
      }
    }
    async broadcastToAll(e2, t2, i2) {
      if (!this.initialized) return console.warn("[ServiceWorkerHub] Not initialized"), 0;
      try {
        const s = await self.clients.matchAll();
        let n2 = 0;
        for (const r2 of s) {
          if (i2 && r2.id === i2) continue;
          const s2 = this.channelsByClientId.get(r2.id);
          if (s2) try {
            s2.broadcast(e2, { ...t2, t: 1, i: Date.now() }), n2++;
          } catch (e3) {
            console.warn("[ServiceWorkerHub] Failed to broadcast to client:", r2.id, e3);
          }
        }
        return n2;
      } catch (e3) {
        return console.error("[ServiceWorkerHub] broadcastToAll error:", e3), 0;
      }
    }
    async broadcastToType(e2, t2, i2, s) {
      if (!this.initialized) return console.warn("[ServiceWorkerHub] Not initialized"), 0;
      try {
        const n2 = await self.clients.matchAll();
        let r2 = 0;
        for (const a2 of n2) {
          if (s && a2.id === s) continue;
          const n3 = this.clientMeta.get(a2.id);
          if (!n3 || n3.appType !== e2) continue;
          const o2 = this.channelsByClientId.get(a2.id);
          if (o2) try {
            o2.broadcast(t2, { ...i2, t: 1, o: e2, i: Date.now() }), r2++;
          } catch (e3) {
            console.warn("[ServiceWorkerHub] Failed to broadcast to client:", a2.id, e3);
          }
        }
        return r2;
      } catch (e3) {
        return console.error("[ServiceWorkerHub] broadcastToType error:", e3), 0;
      }
    }
  }
  Object.defineProperty(K, "instance", { enumerable: 1, configurable: 1, writable: 1, value: null });
  class G extends x {
    static enableGlobalRouting(e2) {
      G.useGlobalRouting = 1, G.unknownClientCallback = e2 ?? null, G.globalListenerSetup || (self.addEventListener("message", G.globalMessageHandler), G.globalListenerSetup = 1);
    }
    static disableGlobalRouting() {
      G.useGlobalRouting = 0, G.globalListenerSetup && (self.removeEventListener("message", G.globalMessageHandler), G.globalListenerSetup = 0);
    }
    static setupHub(e2 = {}) {
      if (G.hubInitialized) return void console.warn("[ServiceWorkerChannel] Hub already initialized");
      G.hubOptions = e2, G.hubInitialized = 1, K.getInstance().setup(e2, (e3) => G.createFromWorker(e3)), G.enableGlobalRouting((e3, t3) => {
        const i2 = G.createFromWorker(e3);
        G.setupChannelHandlers(i2, e3), i2.handleMessage(t3);
      }), G.registerBuiltInHandlers();
      const t2 = e2.cleanupInterval ?? 3e4;
      t2 > 0 && (G.cleanupIntervalId = setInterval(() => G.cleanupInactiveClients(), t2));
    }
    static registerBuiltInHandlers() {
      G.globalSubscribeMap.set("__register__", ({ data: e2, clientId: t2 }) => {
        var _a, _b;
        const i2 = { clientId: t2, appType: e2.appType, appName: e2.appName, connectedAt: (/* @__PURE__ */ new Date()).toISOString() };
        return G.clientMeta.set(t2, i2), (_b = (_a = G.hubOptions).onClientConnect) == null ? void 0 : _b.call(_a, t2, i2), { success: 1, clientId: t2, totalClients: G.clientMeta.size };
      }), G.globalSubscribeMap.set("__ping__", ({ clientId: e2 }) => ({ pong: 1, timestamp: Date.now(), clientId: e2, activeClients: G.channelsByClientId.size }));
    }
    static setupChannelHandlers(e2, t2) {
      for (const [i2, s] of G.globalSubscribeMap) e2.subscribe(i2, async (e3) => {
        const i3 = G.clientMeta.get(t2);
        return s({ data: e3.data || {}, clientId: t2, clientMeta: i3 });
      });
    }
    static setupLifecycleEvents() {
      self.addEventListener("install", () => {
        "function" == typeof self.skipWaiting && self.skipWaiting();
      }), self.addEventListener("activate", (e2) => {
        const t2 = (async () => {
          var _a;
          "function" == typeof ((_a = self.clients) == null ? void 0 : _a.claim) && await self.clients.claim(), await G.notifyAllClientsSwActivated();
        })();
        "function" == typeof e2.waitUntil && e2.waitUntil(t2);
      });
    }
    static async notifyAllClientsSwActivated() {
      try {
        const e2 = await self.clients.matchAll();
        for (const t2 of e2) t2.postMessage({ cmdname: "__sw-activated__", data: { version: G.hubOptions.version }, _broadcast: 1 });
      } catch (e2) {
        console.error("[ServiceWorkerChannel] Error notifying clients:", e2);
      }
    }
    static async cleanupInactiveClients() {
      var _a, _b;
      try {
        const e2 = await self.clients.matchAll(), t2 = new Set(e2.map((e3) => e3.id));
        for (const [e3] of G.channelsByClientId) if (!t2.has(e3)) {
          const t3 = G.channelsByClientId.get(e3);
          t3 && t3.destroy(), G.clientMeta.delete(e3), (_b = (_a = G.hubOptions).onClientDisconnect) == null ? void 0 : _b.call(_a, e3);
        }
      } catch (e2) {
        console.error("[ServiceWorkerChannel] Cleanup error:", e2);
      }
    }
    static async broadcastToAll(e2, t2, i2) {
      if (!G.hubInitialized) return console.warn("[ServiceWorkerChannel] Hub not initialized. Call setupHub() first."), 0;
      try {
        const s = await self.clients.matchAll();
        let n2 = 0;
        for (const r2 of s) {
          if (i2 && r2.id === i2) continue;
          const s2 = G.channelsByClientId.get(r2.id);
          if (s2) try {
            s2.broadcast(e2, { ...t2, t: 1, i: Date.now() }), n2++;
          } catch (e3) {
            console.warn("[ServiceWorkerChannel] Failed to broadcast to client:", r2.id, e3);
          }
        }
        return n2;
      } catch (e3) {
        return console.error("[ServiceWorkerChannel] broadcastToAll error:", e3), 0;
      }
    }
    static async broadcastToType(e2, t2, i2, s) {
      if (!G.hubInitialized) return console.warn("[ServiceWorkerChannel] Hub not initialized. Call setupHub() first."), 0;
      try {
        const n2 = await self.clients.matchAll();
        let r2 = 0;
        for (const a2 of n2) {
          if (s && a2.id === s) continue;
          const n3 = G.clientMeta.get(a2.id);
          if (!n3 || n3.appType !== e2) continue;
          const o2 = G.channelsByClientId.get(a2.id);
          if (o2) try {
            o2.broadcast(t2, { ...i2, t: 1, o: e2, i: Date.now() }), r2++;
          } catch (e3) {
            console.warn("[ServiceWorkerChannel] Failed to broadcast to client:", a2.id, e3);
          }
        }
        return r2;
      } catch (e3) {
        return console.error("[ServiceWorkerChannel] broadcastToType error:", e3), 0;
      }
    }
    static getClientInfo(e2) {
      return G.clientMeta.get(e2);
    }
    static getAllClients() {
      return new Map(G.clientMeta);
    }
    static getClientsByType(e2) {
      const t2 = [];
      for (const i2 of G.clientMeta.values()) i2.appType === e2 && t2.push(i2);
      return t2;
    }
    static subscribeGlobal(e2, t2) {
      e2.startsWith("__") && console.warn(`[ServiceWorkerChannel] Handler name '${e2}' uses reserved prefix '__'. This may conflict with internal handlers.`), G.globalSubscribeMap.set(e2, t2);
      for (const [i2, s] of G.channelsByClientId) s.subscribe(e2, async (e3) => {
        const s2 = G.clientMeta.get(i2);
        return t2({ data: e3.data || {}, clientId: i2, clientMeta: s2 });
      });
    }
    static unsubscribeGlobal(e2) {
      G.globalSubscribeMap.delete(e2);
      for (const t2 of G.channelsByClientId.values()) t2.unSubscribe(e2);
    }
    registerInGlobalRouter() {
      this.isWorkerSide && this.clientId && G.useGlobalRouting && G.channelsByClientId.set(this.clientId, this);
    }
    unregisterFromGlobalRouter() {
      this.isWorkerSide && this.clientId && G.channelsByClientId.delete(this.clientId);
    }
    static getChannelByClientId(e2) {
      return G.channelsByClientId.get(e2);
    }
    static hasChannel(e2) {
      return G.channelsByClientId.has(e2);
    }
    static getChannelCount() {
      return G.channelsByClientId.size;
    }
    handleMessage(e2) {
      return this.onMessage(e2);
    }
    constructor(e2, t2) {
      if (super(t2), Object.defineProperty(this, "channelType", { enumerable: 1, configurable: 1, writable: 1, value: "ServiceWorkerChannel" }), Object.defineProperty(this, "isWorkerSide", { enumerable: 1, configurable: 1, writable: 1, value: void 0 }), Object.defineProperty(this, "worker", { enumerable: 1, configurable: 1, writable: 1, value: void 0 }), Object.defineProperty(this, "clientId", { enumerable: 1, configurable: 1, writable: 1, value: void 0 }), Object.defineProperty(this, "swContainer", { enumerable: 1, configurable: 1, writable: 1, value: void 0 }), Object.defineProperty(this, "l", { enumerable: 1, configurable: 1, writable: 1, value: "connecting" }), Object.defineProperty(this, "lastSuccessfulMessageTime", { enumerable: 1, configurable: 1, writable: 1, value: 0 }), Object.defineProperty(this, "heartbeatIntervalId", { enumerable: 1, configurable: 1, writable: 1, value: null }), Object.defineProperty(this, "missedHeartbeatCount", { enumerable: 1, configurable: 1, writable: 1, value: 0 }), Object.defineProperty(this, "isReconnecting", { enumerable: 1, configurable: 1, writable: 1, value: 0 }), Object.defineProperty(this, "reconnectAttempt", { enumerable: 1, configurable: 1, writable: 1, value: 0 }), Object.defineProperty(this, "connectionOptions", { enumerable: 1, configurable: 1, writable: 1, value: {} }), Object.defineProperty(this, "boundControllerChangeHandler", { enumerable: 1, configurable: 1, writable: 1, value: null }), Object.defineProperty(this, "boundStateChangeHandler", { enumerable: 1, configurable: 1, writable: 1, value: null }), this.isWorkerSide = (t2 == null ? void 0 : t2.isWorkerSide) ?? 0, this.isWorkerSide) {
        if ("string" != typeof e2) throw new Error("Service Worker 端必须传入 clientId 字符串");
        this.clientId = e2, this.baseKey = i("sw_");
      } else {
        if (!e2 || "string" == typeof e2) throw new Error("页面端必须传入有效的 ServiceWorker 实例");
        this.worker = e2, this.swContainer = navigator.serviceWorker, this.baseKey = i("page_");
      }
      this.log("log", "baseKey", this.baseKey, this.isWorkerSide ? "worker" : "page"), this.registerInGlobalRouter(), this.init();
    }
    setupMessageListener() {
      var _a;
      if (this.isWorkerSide) {
        if (G.useGlobalRouting) return void (G.globalListenerSetup || (self.addEventListener("message", G.globalMessageHandler), G.globalListenerSetup = 1));
        self.addEventListener("message", this.bindOnMessage);
      } else (_a = this.swContainer) == null ? void 0 : _a.addEventListener("message", this.bindOnMessage);
    }
    removeMessageListener() {
      var _a;
      if (this.unregisterFromGlobalRouter(), this.isWorkerSide) {
        if (G.useGlobalRouting) return;
        self.removeEventListener("message", this.bindOnMessage);
      } else (_a = this.swContainer) == null ? void 0 : _a.removeEventListener("message", this.bindOnMessage);
    }
    sendRawMessage(e2, i2) {
      var _a, _b;
      try {
        const s = t(e2);
        this.isWorkerSide ? this.sendToClient(s, i2) : i2 && i2.length > 0 ? (_a = this.worker) == null ? void 0 : _a.postMessage(s, i2) : (_b = this.worker) == null ? void 0 : _b.postMessage(s);
      } catch (t2) {
        this.log("error", "sendMessage error", t2, e2);
      }
    }
    async sendToClient(e2, t2) {
      const i2 = this.clientId;
      if (i2) try {
        const s = await self.clients.get(i2);
        s ? t2 && t2.length > 0 ? s.postMessage(e2, t2) : s.postMessage(e2) : this.log("warn", "Client not found:", i2);
      } catch (e3) {
        this.log("error", "sendToClient error", e3);
      }
      else this.log("error", "No clientId available");
    }
    isValidSource(e2) {
      if (this.isWorkerSide) {
        const t2 = e2.source;
        return (t2 == null ? void 0 : t2.id) === this.clientId;
      }
      return 1;
    }
    log(e2, ...t2) {
      var _a, _b;
      const i2 = this.isWorkerSide ? "worker" : "page";
      (_b = (_a = this.console) == null ? void 0 : _a[e2]) == null ? void 0 : _b.call(_a, `[ServiceWorkerChannel](${i2}): `, ...t2);
    }
    getClientId() {
      return this.clientId;
    }
    isWorkerAvailable() {
      var _a;
      return this.isWorkerSide || "activated" === ((_a = this.worker) == null ? void 0 : _a.state);
    }
    async refreshWorker() {
      if (this.isWorkerSide) throw new Error("refreshWorker() can only be called on page side");
      const e2 = (await navigator.serviceWorker.ready).active || navigator.serviceWorker.controller;
      e2 ? (this.worker = e2, this.peerKey = "", this.isReady = 0, this.sendMessage({ requestId: this.baseKey + this.reqTime, msg: "ready", _senderKey: this.baseKey })) : console.warn("[ServiceWorkerChannel] No active Service Worker found during refresh");
    }
    get connectionState() {
      return this.l;
    }
    get isConnected() {
      return "connected" === this.l;
    }
    updateLastMessageTime() {
      this.lastSuccessfulMessageTime = Date.now();
    }
    setConnectionState(e2, t2) {
      if (this.l === e2) return;
      const i2 = this.l;
      switch (this.l = e2, this.log("log", `Connection state: ${i2} -> ${e2}`), e2) {
        case "connected":
          this.missedHeartbeatCount = 0, this.reconnectAttempt = 0, this.emit("connected", { isReconnect: "reconnecting" === i2 });
          break;
        case "disconnected":
          this.emit("disconnected", { reason: (t2 == null ? void 0 : t2.reason) || "error", error: t2 == null ? void 0 : t2.error });
          break;
        case "reconnecting":
          this.emit("reconnecting", { attempt: (t2 == null ? void 0 : t2.attempt) || this.reconnectAttempt, maxAttempts: this.connectionOptions.maxReconnectAttempts || 5, nextRetryIn: (t2 == null ? void 0 : t2.nextRetryIn) || 0 });
      }
    }
    startHeartbeat() {
      if (this.isWorkerSide) return;
      const e2 = this.connectionOptions.heartbeatInterval ?? 3e4;
      e2 <= 0 || (this.stopHeartbeat(), this.heartbeatIntervalId = setInterval(() => {
        this.performHeartbeat();
      }, e2), this.log("log", `Heartbeat started with interval ${e2}ms`));
    }
    stopHeartbeat() {
      this.heartbeatIntervalId && (clearInterval(this.heartbeatIntervalId), this.heartbeatIntervalId = null);
    }
    async performHeartbeat() {
      const e2 = this.connectionOptions.heartbeatInterval ?? 3e4;
      if (0 != this.connectionOptions.smartHeartbeat && this.lastSuccessfulMessageTime > 0 && Date.now() - this.lastSuccessfulMessageTime < e2) return this.missedHeartbeatCount = 0, void this.emit("heartbeat", { success: 1, missedCount: 0 });
      const t2 = this.connectionOptions.heartbeatTimeout ?? 5e3, i2 = Date.now();
      try {
        if ((await this.publish("__ping__", {}, { timeout: t2 })).ret === o.Success) {
          const e3 = Date.now() - i2;
          this.missedHeartbeatCount = 0, this.updateLastMessageTime(), this.emit("heartbeat", { success: 1, latencyMs: e3, missedCount: 0 }), "reconnecting" === this.l && this.setConnectionState("connected");
        } else this.handleHeartbeatFailure();
      } catch (e3) {
        this.handleHeartbeatFailure(e3 instanceof Error ? e3 : void 0);
      }
    }
    handleHeartbeatFailure(e2) {
      this.missedHeartbeatCount++;
      const t2 = this.connectionOptions.maxMissedHeartbeats ?? 3;
      this.emit("heartbeat", { success: 0, missedCount: this.missedHeartbeatCount }), this.log("warn", `Heartbeat failed (${this.missedHeartbeatCount}/${t2})`), this.missedHeartbeatCount >= t2 && (this.log("error", "Connection lost: heartbeat threshold exceeded"), this.setConnectionState("disconnected", { reason: "heartbeat_failed", error: e2 || new l("Heartbeat detection failed", c.HeartbeatFailed, { missedCount: this.missedHeartbeatCount }) }), 0 != this.connectionOptions.autoReconnect && this.attemptReconnect());
    }
    async attemptReconnect() {
      if (this.isReconnecting || this.isDestroyed) return;
      const e2 = this.connectionOptions.maxReconnectAttempts ?? 5;
      if (e2 <= 0) return;
      this.isReconnecting = 1, this.reconnectAttempt = 0;
      const t2 = this.connectionOptions.reconnectBaseDelay ?? 1e3, i2 = this.connectionOptions.maxReconnectDelay ?? 3e4;
      for (; this.reconnectAttempt < e2 && !this.isDestroyed; ) {
        this.reconnectAttempt++;
        const e3 = Math.min(t2 * Math.pow(2, this.reconnectAttempt - 1), i2);
        if (this.setConnectionState("reconnecting", { attempt: this.reconnectAttempt, nextRetryIn: e3 }), await this.delay(e3), this.isDestroyed) break;
        try {
          return await this.refreshWorker(), this.isReady || await this.waitForReady(this.connectionOptions.handshakeTimeout ?? 1e4), (this.connectionOptions.appType || this.connectionOptions.appName) && await this.publish("__register__", { appType: this.connectionOptions.appType, appName: this.connectionOptions.appName }), this.missedHeartbeatCount = 0, this.setConnectionState("connected"), this.updateLastMessageTime(), this.isReconnecting = 0, void this.log("log", "Reconnection successful");
        } catch (e4) {
          this.log("warn", `Reconnection attempt ${this.reconnectAttempt} failed:`, e4);
        }
      }
      this.isReconnecting = 0, this.emit("reconnect:failed", { attempts: this.reconnectAttempt, lastError: new l("All reconnection attempts failed", c.ReconnectFailed, { attempts: this.reconnectAttempt }) });
    }
    waitForReady(e2) {
      return new Promise((t2, i2) => {
        if (this.isReady) return void t2();
        const s = setTimeout(() => {
          this.off("ready", n2), i2(new l("Handshake timeout", c.HandshakeFailed));
        }, e2), n2 = () => {
          clearTimeout(s), t2();
        };
        this.once("ready", n2);
      });
    }
    delay(e2) {
      return new Promise((t2) => setTimeout(t2, e2));
    }
    setupSwLifecycleListeners() {
      this.isWorkerSide || "undefined" == typeof navigator || (this.boundControllerChangeHandler = () => {
        this.log("log", "Service Worker controller changed"), this.handleControllerChange();
      }, navigator.serviceWorker.addEventListener("controllerchange", this.boundControllerChangeHandler), this.worker && (this.boundStateChangeHandler = () => {
        var _a;
        this.handleStateChange((_a = this.worker) == null ? void 0 : _a.state);
      }, this.worker.addEventListener("statechange", this.boundStateChangeHandler)));
    }
    removeSwLifecycleListeners() {
      var _a;
      this.boundControllerChangeHandler && ((_a = navigator.serviceWorker) == null ? void 0 : _a.removeEventListener("controllerchange", this.boundControllerChangeHandler), this.boundControllerChangeHandler = null), this.boundStateChangeHandler && this.worker && (this.worker.removeEventListener("statechange", this.boundStateChangeHandler), this.boundStateChangeHandler = null);
    }
    handleControllerChange() {
      "connected" === this.l && this.setConnectionState("disconnected", { reason: "controller_changed" }), 0 != this.connectionOptions.autoReconnect && this.attemptReconnect();
    }
    handleStateChange(e2) {
      this.log("log", "Service Worker state changed:", e2), "redundant" === e2 && ("connected" === this.l && this.setConnectionState("disconnected", { reason: "sw_terminated" }), 0 != this.connectionOptions.autoReconnect && this.attemptReconnect());
    }
    static async createFromPage(e2) {
      if (!("serviceWorker" in navigator)) throw new Error("Service Worker is not supported in this browser");
      if (e2 == null ? void 0 : e2.swUrl) try {
        const t3 = {};
        e2.swScope && (t3.scope = e2.swScope), await navigator.serviceWorker.register(e2.swUrl, t3);
      } catch (e3) {
        throw console.error("[ServiceWorkerChannel] Failed to register Service Worker:", e3), e3;
      }
      const t2 = (await navigator.serviceWorker.ready).active || navigator.serviceWorker.controller;
      if (!t2) throw new Error("No active Service Worker found");
      const i2 = new G(t2, e2);
      i2.connectionOptions = e2 || {};
      const s = (e2 == null ? void 0 : e2.appType) || (e2 == null ? void 0 : e2.appName);
      let n2 = 0, r2 = 0;
      const a2 = async () => {
        if (!r2) {
          r2 = 1;
          try {
            await i2.publish("__register__", { appType: e2 == null ? void 0 : e2.appType, appName: e2 == null ? void 0 : e2.appName }), n2 = 1, i2.updateLastMessageTime();
          } catch (e3) {
            console.warn("[ServiceWorkerChannel] Auto-registration failed:", e3);
          } finally {
            r2 = 0;
          }
        }
      }, o2 = () => {
        i2.setConnectionState("connected"), i2.updateLastMessageTime(), i2.startHeartbeat(), i2.setupSwLifecycleListeners();
      };
      return s ? i2.isReady ? (a2(), o2()) : i2.once("ready", () => {
        a2(), o2();
      }) : i2.isReady ? o2() : i2.once("ready", o2), 0 != (e2 == null ? void 0 : e2.autoReconnect) && i2.onBroadcast("__sw-activated__", async ({ data: e3 }) => {
        i2.emit("sw-activated", { version: e3 == null ? void 0 : e3.version }), i2.setConnectionState("disconnected", { reason: "controller_changed" }), s && (await i2.refreshWorker(), n2 = 0, await a2()), i2.setConnectionState("connected"), i2.updateLastMessageTime();
      }), i2.on("message:received", ({ isResponse: e3 }) => {
        e3 && i2.updateLastMessageTime();
      }), i2;
    }
    static createFromWorker(e2, t2) {
      return new G(e2, { ...t2, isWorkerSide: 1 });
    }
    static createFromEvent(e2, t2) {
      const i2 = e2.source;
      if (!(i2 == null ? void 0 : i2.id)) throw new Error("Invalid message event: no client source");
      return G.createFromWorker(i2.id, t2);
    }
    destroy() {
      this.stopHeartbeat(), this.removeSwLifecycleListeners(), "connected" !== this.l && "reconnecting" !== this.l || (this.l = "disconnected"), super.destroy();
    }
  }
  Object.defineProperty(G, "channelsByClientId", { enumerable: 1, configurable: 1, writable: 1, value: /* @__PURE__ */ new Map() }), Object.defineProperty(G, "globalListenerSetup", { enumerable: 1, configurable: 1, writable: 1, value: 0 }), Object.defineProperty(G, "unknownClientCallback", { enumerable: 1, configurable: 1, writable: 1, value: null }), Object.defineProperty(G, "useGlobalRouting", { enumerable: 1, configurable: 1, writable: 1, value: 1 }), Object.defineProperty(G, "clientMeta", { enumerable: 1, configurable: 1, writable: 1, value: /* @__PURE__ */ new Map() }), Object.defineProperty(G, "globalSubscribeMap", { enumerable: 1, configurable: 1, writable: 1, value: /* @__PURE__ */ new Map() }), Object.defineProperty(G, "hubInitialized", { enumerable: 1, configurable: 1, writable: 1, value: 0 }), Object.defineProperty(G, "hubOptions", { enumerable: 1, configurable: 1, writable: 1, value: {} }), Object.defineProperty(G, "cleanupIntervalId", { enumerable: 1, configurable: 1, writable: 1, value: null }), Object.defineProperty(G, "globalMessageHandler", { enumerable: 1, configurable: 1, writable: 1, value: (e2) => {
    const t2 = e2.source, i2 = t2 == null ? void 0 : t2.id;
    if (!i2) return;
    const s = G.channelsByClientId.get(i2);
    s ? s.handleMessage(e2) : G.unknownClientCallback && G.unknownClientCallback(i2, e2);
  } });
  function withTimeout$1(promise, timeoutMs, defaultValue) {
    return Promise.race([
      promise,
      new Promise(
        (resolve) => setTimeout(() => resolve(defaultValue), timeoutMs)
      )
    ]);
  }
  const RPC_METHODS = {
    // 活跃的 RPC
    THUMBNAIL_GENERATE: "thumbnail:generate",
    CRASH_SNAPSHOT: "crash:snapshot",
    CRASH_HEARTBEAT: "crash:heartbeat",
    CONSOLE_REPORT: "console:report",
    // Debug
    DEBUG_GET_STATUS: "debug:getStatus",
    DEBUG_ENABLE: "debug:enable",
    DEBUG_DISABLE: "debug:disable",
    DEBUG_GET_LOGS: "debug:getLogs",
    DEBUG_CLEAR_LOGS: "debug:clearLogs",
    DEBUG_GET_CONSOLE_LOGS: "debug:getConsoleLogs",
    DEBUG_CLEAR_CONSOLE_LOGS: "debug:clearConsoleLogs",
    DEBUG_GET_POSTMESSAGE_LOGS: "debug:getPostMessageLogs",
    DEBUG_CLEAR_POSTMESSAGE_LOGS: "debug:clearPostMessageLogs",
    DEBUG_GET_CRASH_SNAPSHOTS: "debug:getCrashSnapshots",
    DEBUG_CLEAR_CRASH_SNAPSHOTS: "debug:clearCrashSnapshots",
    DEBUG_GET_LLM_API_LOGS: "debug:getLLMApiLogs",
    DEBUG_GET_LLM_API_LOG_BY_ID: "debug:getLLMApiLogById",
    DEBUG_CLEAR_LLM_API_LOGS: "debug:clearLLMApiLogs",
    DEBUG_DELETE_LLM_API_LOGS: "debug:deleteLLMApiLogs",
    DEBUG_GET_CACHE_ENTRIES: "debug:getCacheEntries",
    DEBUG_GET_CACHE_STATS: "debug:getCacheStats",
    DEBUG_EXPORT_LOGS: "debug:exportLogs",
    // CDN
    CDN_GET_STATUS: "cdn:getStatus",
    CDN_RESET_STATUS: "cdn:resetStatus",
    CDN_HEALTH_CHECK: "cdn:healthCheck",
    // Upgrade
    UPGRADE_GET_STATUS: "upgrade:getStatus",
    UPGRADE_FORCE: "upgrade:force",
    // Cache management
    CACHE_DELETE: "cache:delete",
    // Health check
    PING: "ping"
  };
  const SW_EVENTS = {
    // Cache events
    CACHE_IMAGE_CACHED: "cache:imageCached",
    CACHE_IMAGE_CACHE_FAILED: "cache:imageCacheFailed",
    CACHE_DELETED: "cache:deleted",
    CACHE_QUOTA_WARNING: "cache:quotaWarning",
    // SW status events
    SW_NEW_VERSION_READY: "sw:newVersionReady",
    SW_ACTIVATED: "sw:activated",
    SW_UPDATED: "sw:updated",
    // Console events
    CONSOLE_LOG: "console:log",
    // Debug events
    DEBUG_LOG: "debug:log",
    DEBUG_LLM_LOG: "debug:llmLog",
    DEBUG_STATUS_CHANGED: "debug:statusChanged",
    DEBUG_NEW_CRASH_SNAPSHOT: "debug:newCrashSnapshot",
    POSTMESSAGE_LOG_BATCH: "postmessage:logBatch"
  };
  let runtimeBridge = {};
  function setSwRuntimeBridge(bridge) {
    runtimeBridge = {
      ...runtimeBridge,
      ...bridge
    };
  }
  function getSwRuntimeBridge() {
    return runtimeBridge;
  }
  const _SWChannelManager = class _SWChannelManager {
    constructor(sw3) {
      this.channels = /* @__PURE__ */ new Map();
      this.onDebugClientCountChanged = null;
      this.postMessageLogBuffer = [];
      this.postMessageLogTimer = null;
      this.POSTMESSAGE_LOG_BATCH_INTERVAL = 500;
      this.sw = sw3;
      this.channels.clear();
      G.enableGlobalRouting((clientId, event) => {
        var _a;
        this.ensureChannel(clientId);
        const channel = (_a = this.channels.get(clientId)) == null ? void 0 : _a.channel;
        if (channel) {
          channel.handleMessage(event);
        }
      });
      setInterval(() => {
        this.cleanupDisconnectedClients().catch(() => void 0);
        this.cleanupStalePendingRequests().catch(() => void 0);
      }, 6e4);
    }
    /**
     * 清理过期的待处理请求（超过 1 小时的请求）
     */
    async cleanupStalePendingRequests() {
      try {
        await taskQueueStorage.cleanupStalePendingToolRequests();
      } catch (error) {
        console.warn(
          "[ChannelManager] Failed to cleanup stale pending requests:",
          error
        );
      }
    }
    /**
     * 设置调试客户端数量变化回调
     * 用于自动启用/禁用调试模式
     */
    setDebugClientCountChangedCallback(callback) {
      this.onDebugClientCountChanged = callback;
    }
    /**
     * 获取当前调试客户端数量
     */
    getDebugClientCount() {
      let count = 0;
      for (const client of this.channels.values()) {
        if (client.isDebugClient) {
          count++;
        }
      }
      return count;
    }
    /**
     * 检测客户端是否是调试页面
     */
    async isDebugClient(clientId) {
      try {
        const client = await this.sw.clients.get(clientId);
        if (client && client.url) {
          return client.url.includes("sw-debug");
        }
      } catch {
      }
      return false;
    }
    /**
     * 获取单例实例
     */
    static getInstance(sw3) {
      if (!_SWChannelManager.instance) {
        _SWChannelManager.instance = new _SWChannelManager(sw3);
      }
      return _SWChannelManager.instance;
    }
    /**
     * 确保客户端通道存在
     * 使用 createFromWorker 创建通道，通道会自动监听来自该客户端的消息
     */
    ensureChannel(clientId) {
      let clientChannel = this.channels.get(clientId);
      if (!clientChannel) {
        const channel = G.createFromWorker(clientId, {
          timeout: 12e4,
          subscribeMap: this.createSubscribeMap(clientId),
          log: {
            log: () => void 0,
            warn: () => void 0,
            error: () => void 0
          }
        });
        clientChannel = {
          channel,
          clientId,
          createdAt: Date.now(),
          isDebugClient: false
          // 初始设为 false，异步检测后更新
        };
        this.channels.set(clientId, clientChannel);
        this.checkAndUpdateDebugClient(clientId);
      }
      return clientChannel.channel;
    }
    /**
     * 异步检测并更新调试客户端状态
     */
    async checkAndUpdateDebugClient(clientId) {
      var _a;
      const isDebug = await this.isDebugClient(clientId);
      const clientChannel = this.channels.get(clientId);
      if (clientChannel && isDebug) {
        clientChannel.isDebugClient = true;
        (_a = this.onDebugClientCountChanged) == null ? void 0 : _a.call(this, this.getDebugClientCount());
      }
    }
    /**
     * Check if there are any active client channels
     */
    hasAnyClientChannel() {
      return this.channels.size > 0;
    }
    /**
     * 创建 RPC 订阅映射
     * 处理器直接返回响应值（Promise 或同步值）
     */
    /**
     * 解包 RPC 数据
     * postmessage-duplex 的 subscribeMap 回调接收的是完整的请求对象:
     * { requestId, cmdname, data: <实际参数>, time, t }
     * 我们需要提取 data 字段作为实际参数
     */
    unwrapRpcData(rawData) {
      if (rawData && typeof rawData === "object" && "cmdname" in rawData) {
        return rawData.data;
      }
      return rawData;
    }
    /**
     * 广播 PostMessage 日志到调试面板
     */
    broadcastPostMessageLog(logId) {
      if (!logId) return;
      const logs2 = getAllLogs();
      const entry = logs2.find((l2) => l2.id === logId);
      if (entry) {
        this.sendPostMessageLog(entry);
      }
    }
    /**
     * 包装 RPC 处理器，添加日志记录
     * 将 postmessage-duplex 的 RPC 调用记录到 postmessage-logger
     */
    wrapRpcHandler(methodName, clientId, handler) {
      return async (rawData) => {
        var _a;
        const data = this.unwrapRpcData(rawData);
        const startTime = Date.now();
        const requestId = rawData == null ? void 0 : rawData.requestId;
        const shouldLog = isPostMessageLoggerDebugMode() && !(((_a = this.channels.get(clientId)) == null ? void 0 : _a.isDebugClient) ?? false);
        if (shouldLog) {
          const logId = logReceivedMessage(
            `RPC:${methodName}`,
            { params: data, requestId },
            clientId
          );
          this.broadcastPostMessageLog(logId);
        }
        try {
          const result = await handler(data);
          try {
            JSON.stringify(result);
          } catch (serializeError) {
            console.error(
              `[SW wrapRpcHandler] ${methodName} result serialization failed:`,
              serializeError
            );
            throw new Error(`Result serialization failed: ${serializeError}`);
          }
          if (shouldLog && requestId) {
            const logId = updateRequestWithResponse(
              requestId,
              { result },
              Date.now() - startTime
            );
            if (logId) {
              this.broadcastPostMessageLog(logId);
            }
          }
          return result;
        } catch (error) {
          console.error(`[SW wrapRpcHandler] ${methodName} error:`, error);
          if (shouldLog && requestId) {
            const logId = updateRequestWithResponse(
              requestId,
              null,
              Date.now() - startTime,
              String(error)
            );
            if (logId) {
              this.broadcastPostMessageLog(logId);
            }
          }
          throw error;
        }
      };
    }
    createSubscribeMap(clientId) {
      return {
        // ============================================================================
        // RPC Handlers
        // ============================================================================
        // Thumbnail (图片缩略图，由 SW 生成)
        [RPC_METHODS.THUMBNAIL_GENERATE]: this.wrapRpcHandler(
          RPC_METHODS.THUMBNAIL_GENERATE,
          clientId,
          (data) => this.handleThumbnailGenerate(data)
        ),
        // Crash monitoring (不记录日志，避免死循环)
        [RPC_METHODS.CRASH_SNAPSHOT]: async (rawData) => {
          const data = this.unwrapRpcData(rawData);
          return this.handleCrashSnapshot(data);
        },
        [RPC_METHODS.CRASH_HEARTBEAT]: async (rawData) => {
          const data = this.unwrapRpcData(rawData);
          return this.handleHeartbeat(data);
        },
        // Console (不记录日志，避免死循环)
        [RPC_METHODS.CONSOLE_REPORT]: async (rawData) => {
          const data = this.unwrapRpcData(rawData);
          return this.handleConsoleReport(data);
        },
        // Debug
        [RPC_METHODS.DEBUG_GET_STATUS]: async () => this.handleDebugGetStatus(),
        [RPC_METHODS.DEBUG_ENABLE]: async () => this.handleDebugEnable(),
        [RPC_METHODS.DEBUG_DISABLE]: async () => this.handleDebugDisable(),
        [RPC_METHODS.DEBUG_GET_LOGS]: async (rawData) => {
          const data = this.unwrapRpcData(rawData);
          return this.handleDebugGetLogs(data);
        },
        [RPC_METHODS.DEBUG_CLEAR_LOGS]: async () => this.handleDebugClearLogs(),
        [RPC_METHODS.DEBUG_GET_CONSOLE_LOGS]: async (rawData) => {
          const data = this.unwrapRpcData(rawData);
          return this.handleDebugGetConsoleLogs(data);
        },
        [RPC_METHODS.DEBUG_CLEAR_CONSOLE_LOGS]: async () => this.handleDebugClearConsoleLogs(),
        [RPC_METHODS.DEBUG_GET_POSTMESSAGE_LOGS]: async (rawData) => {
          const data = this.unwrapRpcData(rawData);
          return this.handleDebugGetPostMessageLogs(data);
        },
        [RPC_METHODS.DEBUG_CLEAR_POSTMESSAGE_LOGS]: async () => this.handleDebugClearPostMessageLogs(),
        [RPC_METHODS.DEBUG_GET_CRASH_SNAPSHOTS]: async () => this.handleDebugGetCrashSnapshots(),
        [RPC_METHODS.DEBUG_CLEAR_CRASH_SNAPSHOTS]: async () => this.handleDebugClearCrashSnapshots(),
        [RPC_METHODS.DEBUG_GET_LLM_API_LOGS]: async (rawData) => {
          const data = this.unwrapRpcData(rawData);
          return this.handleDebugGetLLMApiLogs(data);
        },
        [RPC_METHODS.DEBUG_GET_LLM_API_LOG_BY_ID]: async (rawData) => {
          const data = this.unwrapRpcData(rawData);
          return this.handleDebugGetLLMApiLogById(data == null ? void 0 : data.logId);
        },
        [RPC_METHODS.DEBUG_CLEAR_LLM_API_LOGS]: async () => this.handleDebugClearLLMApiLogs(),
        [RPC_METHODS.DEBUG_DELETE_LLM_API_LOGS]: async (rawData) => {
          const data = this.unwrapRpcData(rawData);
          return this.handleDebugDeleteLLMApiLogs(data);
        },
        [RPC_METHODS.DEBUG_GET_CACHE_ENTRIES]: async (rawData) => {
          const data = this.unwrapRpcData(rawData);
          return this.handleDebugGetCacheEntries(data);
        },
        [RPC_METHODS.DEBUG_GET_CACHE_STATS]: async () => this.handleDebugGetCacheStats(),
        [RPC_METHODS.DEBUG_EXPORT_LOGS]: async () => this.handleDebugExportLogs(),
        // CDN
        [RPC_METHODS.CDN_GET_STATUS]: async () => this.handleCDNGetStatus(),
        [RPC_METHODS.CDN_RESET_STATUS]: async () => this.handleCDNResetStatus(),
        [RPC_METHODS.CDN_HEALTH_CHECK]: async () => this.handleCDNHealthCheck(),
        // Upgrade
        [RPC_METHODS.UPGRADE_GET_STATUS]: async () => this.handleUpgradeGetStatus(),
        [RPC_METHODS.UPGRADE_FORCE]: async () => this.handleUpgradeForce(),
        // Cache management
        [RPC_METHODS.CACHE_DELETE]: async (rawData) => {
          const data = this.unwrapRpcData(rawData);
          return this.handleCacheDelete(data);
        },
        // Ping
        [RPC_METHODS.PING]: async () => this.handlePing()
      };
    }
    // ============================================================================
    // RPC 处理器（直接返回响应值）
    // ============================================================================
    // ============================================================================
    // Thumbnail RPC 处理器
    // ============================================================================
    async handleThumbnailGenerate(data) {
      try {
        const { url, mediaType, blob, mimeType, sizes } = data;
        const { generateThumbnailAsync: generateThumbnailAsync2 } = await Promise.resolve().then(() => thumbnailUtils);
        const mediaBlob = new Blob([blob], {
          type: mimeType || (mediaType === "video" ? "video/mp4" : "image/png")
        });
        generateThumbnailAsync2(mediaBlob, url, mediaType, sizes);
        return { success: true };
      } catch (error) {
        console.error("[SWChannelManager] Thumbnail generation failed:", error);
        return { success: false, error: error.message };
      }
    }
    // ============================================================================
    // Crash monitoring RPC 处理器
    // ============================================================================
    async handleCrashSnapshot(data) {
      var _a, _b;
      try {
        await ((_b = (_a = getSwRuntimeBridge()).saveCrashSnapshot) == null ? void 0 : _b.call(_a, data.snapshot));
        return { success: true };
      } catch (error) {
        console.error("[SWChannelManager] Crash snapshot save failed:", error);
        return { success: false, error: error.message };
      }
    }
    async handleHeartbeat(data) {
      return { success: true };
    }
    // ============================================================================
    // Console RPC 处理器
    // ============================================================================
    /**
     * 将单个日志参数序列化为字符串，避免对象显示为 [object Object]
     */
    serializeLogArg(arg) {
      if (arg === null) return "null";
      if (arg === void 0) return "undefined";
      if (typeof arg === "object") {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }
    async handleConsoleReport(data) {
      var _a, _b;
      try {
        const logArgs = data.logArgs ?? [];
        const parts = Array.isArray(logArgs) ? logArgs.map((a2) => this.serializeLogArg(a2)) : [this.serializeLogArg(logArgs)];
        const logMessage = parts.join(" ");
        (_b = (_a = getSwRuntimeBridge()).addConsoleLog) == null ? void 0 : _b.call(_a, {
          logLevel: data.logLevel,
          logMessage: logMessage || "-"
        });
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
    // ============================================================================
    // Debug RPC 处理器
    // ============================================================================
    async handleDebugGetStatus() {
      var _a;
      try {
        const runtime = getSwRuntimeBridge();
        const status = ((_a = runtime.getDebugStatus) == null ? void 0 : _a.call(runtime)) || {};
        const cacheStats = runtime.getCacheStats ? await runtime.getCacheStats() : void 0;
        return { ...status, enabled: status.debugModeEnabled, cacheStats };
      } catch {
        return { debugModeEnabled: false };
      }
    }
    async handleDebugEnable() {
      var _a, _b;
      try {
        const runtime = getSwRuntimeBridge();
        await ((_a = runtime.enableDebugMode) == null ? void 0 : _a.call(runtime));
        const status = ((_b = runtime.getDebugStatus) == null ? void 0 : _b.call(runtime)) || {};
        this.sendDebugStatusChanged(true);
        return { success: true, status };
      } catch (error) {
        return { success: false };
      }
    }
    async handleDebugDisable() {
      var _a, _b;
      try {
        const runtime = getSwRuntimeBridge();
        await ((_a = runtime.disableDebugMode) == null ? void 0 : _a.call(runtime));
        const status = ((_b = runtime.getDebugStatus) == null ? void 0 : _b.call(runtime)) || {};
        this.sendDebugStatusChanged(false);
        return { success: true, status };
      } catch (error) {
        return { success: false };
      }
    }
    async handleDebugGetLogs(data) {
      var _a, _b;
      try {
        const runtime = getSwRuntimeBridge();
        const { limit = 100, offset = 0, filter } = data || {};
        const internalLogs = (((_a = runtime.getInternalFetchLogs) == null ? void 0 : _a.call(runtime)) || []).map((log) => ({
          ...log,
          type: "fetch"
        }));
        const debugLogs2 = ((_b = runtime.getDebugLogs) == null ? void 0 : _b.call(runtime)) || [];
        const logMap = /* @__PURE__ */ new Map();
        for (const log of debugLogs2) {
          const id = log.id;
          if (typeof id === "string") {
            logMap.set(id, log);
          }
        }
        for (const log of internalLogs) {
          const id = log.id;
          if (typeof id === "string") {
            logMap.set(id, log);
          }
        }
        let logs2 = Array.from(logMap.values()).sort(
          (a2, b) => b.timestamp - a2.timestamp
        );
        if (filter) {
          if (filter.type) {
            logs2 = logs2.filter((l2) => l2.type === filter.type);
          }
          if (filter.status) {
            logs2 = logs2.filter((l2) => l2.status === filter.status);
          }
        }
        const paginatedLogs = logs2.slice(offset, offset + limit);
        return { logs: paginatedLogs, total: logs2.length, offset, limit };
      } catch {
        return {
          logs: [],
          total: 0,
          offset: (data == null ? void 0 : data.offset) || 0,
          limit: (data == null ? void 0 : data.limit) || 100
        };
      }
    }
    async handleDebugClearLogs() {
      var _a, _b;
      try {
        (_b = (_a = getSwRuntimeBridge()).clearDebugLogs) == null ? void 0 : _b.call(_a);
        return { success: true };
      } catch {
        return { success: false };
      }
    }
    async handleDebugGetConsoleLogs(data) {
      var _a, _b;
      try {
        const { limit = 500, offset = 0, filter } = data || {};
        let logs2 = await (((_b = (_a = getSwRuntimeBridge()).loadConsoleLogsFromDB) == null ? void 0 : _b.call(_a)) || Promise.resolve([]));
        if (filter) {
          if (filter.logLevel) {
            logs2 = logs2.filter((l2) => l2.logLevel === filter.logLevel);
          }
          if (filter.search) {
            const search = filter.search.toLowerCase();
            logs2 = logs2.filter(
              (l2) => {
                var _a2, _b2;
                return ((_a2 = l2.logMessage) == null ? void 0 : _a2.toLowerCase().includes(search)) || ((_b2 = l2.logStack) == null ? void 0 : _b2.toLowerCase().includes(search));
              }
            );
          }
        }
        const paginatedLogs = logs2.slice(offset, offset + limit);
        return { logs: paginatedLogs, total: logs2.length, offset, limit };
      } catch (error) {
        return {
          logs: [],
          total: 0,
          offset: (data == null ? void 0 : data.offset) || 0,
          limit: (data == null ? void 0 : data.limit) || 500,
          error: String(error)
        };
      }
    }
    async handleDebugClearConsoleLogs() {
      var _a, _b;
      try {
        const runtime = getSwRuntimeBridge();
        (_a = runtime.clearConsoleLogs) == null ? void 0 : _a.call(runtime);
        await ((_b = runtime.clearAllConsoleLogs) == null ? void 0 : _b.call(runtime));
        return { success: true };
      } catch {
        return { success: false };
      }
    }
    async handleDebugGetPostMessageLogs(data) {
      try {
        const { getAllLogs: getAllLogs2, getLogStats: getLogStats2 } = await Promise.resolve().then(() => postmessageLogger);
        const { limit = 200, offset = 0, filter } = data || {};
        let logs2 = getAllLogs2();
        if (filter) {
          if (filter.direction) {
            logs2 = logs2.filter((l2) => l2.direction === filter.direction);
          }
          if (filter.messageType) {
            const search = filter.messageType.toLowerCase();
            logs2 = logs2.filter(
              (l2) => {
                var _a;
                return (_a = l2.messageType) == null ? void 0 : _a.toLowerCase().includes(search);
              }
            );
          }
        }
        const paginatedLogs = logs2.slice(offset, offset + limit);
        return {
          logs: paginatedLogs,
          total: logs2.length,
          offset,
          limit,
          stats: getLogStats2()
        };
      } catch {
        return {
          logs: [],
          total: 0,
          offset: (data == null ? void 0 : data.offset) || 0,
          limit: (data == null ? void 0 : data.limit) || 200
        };
      }
    }
    async handleDebugClearPostMessageLogs() {
      try {
        const { clearLogs: clearLogs2 } = await Promise.resolve().then(() => postmessageLogger);
        clearLogs2();
        return { success: true };
      } catch {
        return { success: false };
      }
    }
    async handleDebugGetCrashSnapshots() {
      var _a, _b;
      try {
        const snapshots = await (((_b = (_a = getSwRuntimeBridge()).getCrashSnapshots) == null ? void 0 : _b.call(_a)) || Promise.resolve([]));
        return { snapshots, total: snapshots.length };
      } catch (error) {
        return { snapshots: [], total: 0, error: String(error) };
      }
    }
    async handleDebugClearCrashSnapshots() {
      var _a, _b;
      try {
        await ((_b = (_a = getSwRuntimeBridge()).clearCrashSnapshots) == null ? void 0 : _b.call(_a));
        return { success: true };
      } catch {
        return { success: false };
      }
    }
    async handleDebugGetLLMApiLogs(params) {
      try {
        const page = typeof (params == null ? void 0 : params.page) === "number" ? params.page : Number(params == null ? void 0 : params.page) || 1;
        const pageSize = typeof (params == null ? void 0 : params.pageSize) === "number" ? params.pageSize : Number(params == null ? void 0 : params.pageSize) || 20;
        const filter = {
          taskType: typeof (params == null ? void 0 : params.taskType) === "string" ? params.taskType : void 0,
          status: typeof (params == null ? void 0 : params.status) === "string" ? params.status : void 0
        };
        const { getLLMApiLogsPaginated: getLLMApiLogsPaginated2 } = await Promise.resolve().then(() => llmApiLogger);
        const result = await getLLMApiLogsPaginated2(page, pageSize, filter);
        return result;
      } catch (error) {
        console.error(
          "[SWChannelManager] handleDebugGetLLMApiLogs error:",
          error
        );
        return {
          logs: [],
          total: 0,
          page: 1,
          pageSize: 20,
          totalPages: 0,
          error: String(error)
        };
      }
    }
    async handleDebugGetLLMApiLogById(logId) {
      try {
        if (!logId) {
          return { log: null, error: "Missing logId" };
        }
        const { getLLMApiLogById: getLLMApiLogById2 } = await Promise.resolve().then(() => llmApiLogger);
        const log = await getLLMApiLogById2(logId);
        return { log };
      } catch (error) {
        console.error(
          "[SWChannelManager] handleDebugGetLLMApiLogById error:",
          error
        );
        return { log: null, error: String(error) };
      }
    }
    async handleDebugClearLLMApiLogs() {
      try {
        const { clearAllLLMApiLogs: clearAllLLMApiLogs2 } = await Promise.resolve().then(() => llmApiLogger);
        await clearAllLLMApiLogs2();
        return { success: true };
      } catch {
        return { success: false };
      }
    }
    async handleDebugDeleteLLMApiLogs(params) {
      try {
        if (!(params == null ? void 0 : params.logIds) || params.logIds.length === 0) {
          return { success: false, deletedCount: 0 };
        }
        const { deleteLLMApiLogs: deleteLLMApiLogs2 } = await Promise.resolve().then(() => llmApiLogger);
        const deletedCount = await deleteLLMApiLogs2(params.logIds);
        return { success: true, deletedCount };
      } catch {
        return { success: false, deletedCount: 0 };
      }
    }
    async handleDebugGetCacheEntries(data) {
      var _a, _b;
      try {
        const {
          cacheName = ((_b = (_a = getSwRuntimeBridge()).getImageCacheName) == null ? void 0 : _b.call(_a)) || "drawnix-images",
          limit = 50,
          offset = 0
        } = data || {};
        const cache = await caches.open(cacheName);
        const requests = await cache.keys();
        const entries = [];
        for (let i2 = offset; i2 < Math.min(offset + limit, requests.length); i2++) {
          const request = requests[i2];
          const response = await cache.match(request);
          if (response) {
            const cacheDate = response.headers.get("sw-cache-date");
            const cacheCreatedAt = response.headers.get("sw-cache-created-at") || cacheDate;
            const size = response.headers.get("sw-image-size") || response.headers.get("content-length");
            entries.push({
              url: request.url,
              cacheDate: cacheDate ? parseInt(cacheDate) : void 0,
              cacheCreatedAt: cacheCreatedAt ? parseInt(cacheCreatedAt) : void 0,
              size: size ? parseInt(size) : void 0
            });
          }
        }
        return { cacheName, entries, total: requests.length, offset, limit };
      } catch (error) {
        return {
          cacheName: (data == null ? void 0 : data.cacheName) || "",
          entries: [],
          total: 0,
          offset: (data == null ? void 0 : data.offset) || 0,
          limit: (data == null ? void 0 : data.limit) || 50,
          error: String(error)
        };
      }
    }
    async handleDebugGetCacheStats() {
      try {
        const cacheNames = await caches.keys();
        const cacheStats = [];
        let totalCount = 0;
        let totalSize = 0;
        for (const name of cacheNames) {
          const cache = await caches.open(name);
          const requests = await cache.keys();
          let cacheSize = 0;
          for (const request of requests) {
            const response = await cache.match(request);
            if (response) {
              const size = response.headers.get("content-length");
              if (size) {
                cacheSize += parseInt(size);
              }
            }
          }
          cacheStats.push({ name, count: requests.length, size: cacheSize });
          totalCount += requests.length;
          totalSize += cacheSize;
        }
        return {
          stats: { caches: cacheStats, totalCount, totalSize }
        };
      } catch (error) {
        return {
          stats: { caches: [], totalCount: 0, totalSize: 0 },
          error: String(error)
        };
      }
    }
    async handleDebugExportLogs() {
      var _a, _b, _c, _d;
      try {
        const runtime = getSwRuntimeBridge();
        const { getAllLogs: getAllLogs2 } = await Promise.resolve().then(() => postmessageLogger);
        const allConsoleLogs = await (((_a = runtime.loadConsoleLogsFromDB) == null ? void 0 : _a.call(runtime)) || Promise.resolve([]));
        const postmessageLogs = getAllLogs2();
        const debugLogs2 = ((_b = runtime.getDebugLogs) == null ? void 0 : _b.call(runtime)) || [];
        return {
          exportTime: (/* @__PURE__ */ new Date()).toISOString(),
          swVersion: ((_c = runtime.getAppVersion) == null ? void 0 : _c.call(runtime)) || "unknown",
          status: ((_d = runtime.getDebugStatus) == null ? void 0 : _d.call(runtime)) || {},
          fetchLogs: debugLogs2,
          consoleLogs: allConsoleLogs,
          postmessageLogs
        };
      } catch {
        return {
          exportTime: (/* @__PURE__ */ new Date()).toISOString(),
          swVersion: "unknown",
          status: {},
          fetchLogs: [],
          consoleLogs: [],
          postmessageLogs: []
        };
      }
    }
    // ============================================================================
    // CDN RPC 处理器
    // ============================================================================
    async handleCDNGetStatus() {
      var _a, _b;
      try {
        return { status: ((_b = (_a = getSwRuntimeBridge()).getCDNStatusReport) == null ? void 0 : _b.call(_a)) || {} };
      } catch {
        return { status: {} };
      }
    }
    async handleCDNResetStatus() {
      var _a, _b;
      try {
        (_b = (_a = getSwRuntimeBridge()).resetCDNStatus) == null ? void 0 : _b.call(_a);
        return { success: true };
      } catch {
        return { success: false };
      }
    }
    async handleCDNHealthCheck() {
      var _a;
      try {
        const runtime = getSwRuntimeBridge();
        const results = runtime.performHealthCheck ? await runtime.performHealthCheck(((_a = runtime.getAppVersion) == null ? void 0 : _a.call(runtime)) || "unknown") : /* @__PURE__ */ new Map();
        return { results: Object.fromEntries(results) };
      } catch {
        return { results: {} };
      }
    }
    // ============================================================================
    // Upgrade RPC 处理器
    // ============================================================================
    async handleUpgradeGetStatus() {
      var _a, _b;
      try {
        return { version: ((_b = (_a = getSwRuntimeBridge()).getAppVersion) == null ? void 0 : _b.call(_a)) || "unknown" };
      } catch {
        return { version: "unknown" };
      }
    }
    async handleUpgradeForce() {
      var _a, _b;
      try {
        const sw3 = self;
        sw3.skipWaiting();
        this.sendSWUpdated(((_b = (_a = getSwRuntimeBridge()).getAppVersion) == null ? void 0 : _b.call(_a)) || "unknown");
        return { success: true };
      } catch {
        return { success: false };
      }
    }
    // ============================================================================
    // Cache RPC 处理器
    // ============================================================================
    async handleCacheDelete(data) {
      var _a, _b;
      try {
        await ((_b = (_a = getSwRuntimeBridge()).deleteCacheByUrl) == null ? void 0 : _b.call(_a, data.url));
        this.sendCacheDeleted(data.url);
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
    /**
     * 健康检查 - 用于检测 SW 是否可用
     */
    async handlePing() {
      return { success: true };
    }
    // ============================================================================
    // 事件推送方法（SW 主动推送给客户端）
    // ============================================================================
    /**
     * 广播给所有客户端（fire-and-forget 模式）
     * 使用 postmessage-duplex 的 broadcast() 方法，不等待响应
     */
    broadcastToAll(event, data) {
      this.channels.forEach((clientChannel) => {
        clientChannel.channel.broadcast(event, data);
      });
    }
    /**
     * 广播给除指定客户端外的所有客户端（fire-and-forget 模式）
     */
    broadcastToOthers(event, data, excludeClientId) {
      this.channels.forEach((clientChannel) => {
        if (clientChannel.clientId !== excludeClientId) {
          clientChannel.channel.broadcast(event, data);
        }
      });
    }
    /**
     * 发送给特定客户端（fire-and-forget 模式）
     */
    publishToClient(clientId, event, data) {
      const clientChannel = this.channels.get(clientId);
      if (clientChannel) {
        clientChannel.channel.broadcast(event, data);
      }
    }
    // ============================================================================
    // 缓存事件发送方法
    // ============================================================================
    /**
     * 发送图片缓存完成事件
     */
    sendCacheImageCached(url, size, thumbnailUrl) {
      this.broadcastToAll(SW_EVENTS.CACHE_IMAGE_CACHED, {
        url,
        size,
        thumbnailUrl
      });
    }
    /**
     * 发送图片缓存失败事件
     */
    sendCacheImageCacheFailed(url, error) {
      this.broadcastToAll(SW_EVENTS.CACHE_IMAGE_CACHE_FAILED, {
        url,
        error
      });
    }
    /**
     * 发送缓存删除事件
     */
    sendCacheDeleted(url) {
      this.broadcastToAll(SW_EVENTS.CACHE_DELETED, { url });
    }
    /**
     * 发送缓存配额警告事件
     */
    sendCacheQuotaWarning(usage, quota, percentUsed) {
      this.broadcastToAll(SW_EVENTS.CACHE_QUOTA_WARNING, {
        usage,
        quota,
        percentUsed
      });
    }
    // ============================================================================
    // SW 状态事件发送方法
    // ============================================================================
    /**
     * 发送新版本就绪事件
     */
    sendSWNewVersionReady(version) {
      this.broadcastToAll(SW_EVENTS.SW_NEW_VERSION_READY, { version });
    }
    /**
     * 发送 SW 激活事件
     */
    sendSWActivated(version) {
      this.broadcastToAll(SW_EVENTS.SW_ACTIVATED, { version });
    }
    /**
     * 发送 SW 更新事件
     */
    sendSWUpdated(version) {
      this.broadcastToAll(SW_EVENTS.SW_UPDATED, { version });
    }
    // ============================================================================
    // 调试事件发送方法
    // ============================================================================
    /**
     * 发送调试状态变更事件
     */
    sendDebugStatusChanged(enabled) {
      this.broadcastToAll(SW_EVENTS.DEBUG_STATUS_CHANGED, { enabled });
    }
    /**
     * 发送调试日志事件（SW 内部 API 日志）
     */
    sendDebugLog(entry) {
      this.broadcastToAll(SW_EVENTS.DEBUG_LOG, { entry });
    }
    /**
     * 发送控制台日志事件
     */
    sendConsoleLog(entry) {
      this.broadcastToAll(SW_EVENTS.CONSOLE_LOG, { entry });
    }
    /**
     * 发送 LLM API 日志事件
     */
    sendDebugLLMLog(log) {
      this.broadcastToAll(SW_EVENTS.DEBUG_LLM_LOG, { log });
    }
    // 500ms 批量发送间隔
    /**
     * 发送 PostMessage 日志事件（批量发送以避免速率限制）
     */
    sendPostMessageLog(entry) {
      this.postMessageLogBuffer.push(entry);
      if (!this.postMessageLogTimer) {
        this.postMessageLogTimer = setTimeout(() => {
          this.flushPostMessageLogs();
        }, this.POSTMESSAGE_LOG_BATCH_INTERVAL);
      }
    }
    /**
     * 刷新 PostMessage 日志缓冲区
     */
    flushPostMessageLogs() {
      this.postMessageLogTimer = null;
      if (this.postMessageLogBuffer.length === 0) {
        return;
      }
      const entries = this.postMessageLogBuffer;
      this.postMessageLogBuffer = [];
      this.broadcastToAll(SW_EVENTS.POSTMESSAGE_LOG_BATCH, { entries });
    }
    /**
     * 发送新崩溃快照事件
     */
    sendNewCrashSnapshot(snapshot) {
      this.broadcastToAll(SW_EVENTS.DEBUG_NEW_CRASH_SNAPSHOT, { snapshot });
    }
    // ============================================================================
    // 工具方法
    // ============================================================================
    /**
     * 请求主线程生成视频缩略图
     * @param url 视频 URL
     * @param timeoutMs 超时时间（毫秒）
     * @returns 缩略图 Data URL，失败返回 null
     */
    async requestVideoThumbnail(url, timeoutMs = 3e4, maxSize) {
      const candidateChannels = Array.from(this.channels.values()).sort(
        (left, right) => {
          if (left.isDebugClient === right.isDebugClient) {
            return right.createdAt - left.createdAt;
          }
          return left.isDebugClient ? 1 : -1;
        }
      );
      if (candidateChannels.length === 0) {
        return null;
      }
      for (const clientChannel of candidateChannels) {
        try {
          const response = await withTimeout$1(
            clientChannel.channel.call("thumbnail:generate", { url, maxSize }),
            timeoutMs,
            "Video thumbnail generation timeout"
          );
          if (!response || response.ret !== 0) {
            continue;
          }
          const data = response.data;
          if (data == null ? void 0 : data.error) {
            continue;
          }
          if (!(data == null ? void 0 : data.thumbnailUrl)) {
            continue;
          }
          return data.thumbnailUrl;
        } catch {
          continue;
        }
      }
      return null;
    }
    /**
     * 获取连接的客户端列表
     */
    getConnectedClients() {
      return Array.from(this.channels.keys());
    }
    /**
     * 获取连接的客户端数量
     */
    getConnectedClientCount() {
      return this.channels.size;
    }
    /**
     * 清理断开的客户端
     */
    async cleanupDisconnectedClients() {
      var _a;
      const clients = await this.sw.clients.matchAll({ type: "window" });
      const activeClientIds = new Set(clients.map((c2) => c2.id));
      let debugClientRemoved = false;
      for (const [clientId, clientChannel] of this.channels) {
        if (!activeClientIds.has(clientId)) {
          if (clientChannel.isDebugClient) {
            debugClientRemoved = true;
          }
          this.channels.delete(clientId);
        }
      }
      if (debugClientRemoved) {
        (_a = this.onDebugClientCountChanged) == null ? void 0 : _a.call(this, this.getDebugClientCount());
      }
    }
  };
  _SWChannelManager.instance = null;
  let SWChannelManager = _SWChannelManager;
  let channelManagerInstance = null;
  function initChannelManager(sw3) {
    if (!channelManagerInstance) {
      channelManagerInstance = SWChannelManager.getInstance(sw3);
    }
    return channelManagerInstance;
  }
  function getChannelManager() {
    return channelManagerInstance;
  }
  function setDebugMode(enabled) {
    setPostMessageLoggerDebugMode(enabled);
  }
  const internalFetchLogs = [];
  const MAX_INTERNAL_LOGS = 100;
  let debugModeEnabled$1 = false;
  let broadcastCallback$1 = null;
  function setDebugFetchEnabled(enabled) {
    debugModeEnabled$1 = enabled;
  }
  function isDebugFetchEnabled() {
    return debugModeEnabled$1;
  }
  function setDebugFetchBroadcast(callback) {
    broadcastCallback$1 = callback;
  }
  function getInternalFetchLogs() {
    return [...internalFetchLogs];
  }
  function clearInternalFetchLogs() {
    internalFetchLogs.length = 0;
  }
  function updateLogResponseBody(logId, responseBody) {
    const log = internalFetchLogs.find((l2) => l2.id === logId);
    if (log) {
      log.responseBody = responseBody.length > 5e3 ? responseBody.substring(0, 5e3) + "...(truncated)" : responseBody;
      if (broadcastCallback$1) {
        broadcastCallback$1({ ...log });
      }
    }
  }
  async function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  async function parseFormData(formData) {
    const fields = [];
    for (const [name, value] of formData.entries()) {
      if (value instanceof Blob) {
        const field = {
          name,
          value: `[${value.type || "binary"}] ${value.size} bytes`,
          isFile: true,
          mimeType: value.type
        };
        if (value.type.startsWith("image/") && value.size < 5 * 1024 * 1024) {
          try {
            field.dataUrl = await blobToDataUrl(value);
          } catch {
          }
        }
        if (value instanceof File) {
          field.fileName = value.name;
        }
        fields.push(field);
      } else {
        fields.push({
          name,
          value: String(value).length > 500 ? String(value).substring(0, 500) + "..." : String(value)
        });
      }
    }
    return fields;
  }
  async function debugFetch(input, init, options) {
    if (!debugModeEnabled$1) {
      return fetch(input, init);
    }
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init == null ? void 0 : init.method) || "GET";
    const startTime = Date.now();
    const id = Math.random().toString(36).substring(2, 10);
    let requestBody;
    let formData;
    let base64Images;
    if (init == null ? void 0 : init.body) {
      if (init.body instanceof FormData) {
        try {
          formData = await parseFormData(init.body);
        } catch {
          requestBody = "[FormData - unable to parse]";
        }
      } else if (options == null ? void 0 : options.logRequestBody) {
        try {
          const bodyStr = typeof init.body === "string" ? init.body : JSON.stringify(init.body);
          const imageRegex = /data:image\/([^;]+);base64,([A-Za-z0-9+/=]+)/g;
          let match;
          let imageIndex = 0;
          base64Images = [];
          while ((match = imageRegex.exec(bodyStr)) !== null) {
            const mimeType = `image/${match[1]}`;
            const base64Data = match[2];
            if (base64Data.length > 1e3) {
              base64Images.push({
                key: `image[${imageIndex}]`,
                dataUrl: `data:${mimeType};base64,${base64Data}`,
                mimeType,
                size: Math.round(base64Data.length * 0.75 / 1024)
              });
              imageIndex++;
            }
          }
          if (base64Images.length === 0) {
            base64Images = void 0;
          }
          let displayBody = bodyStr.replace(
            /data:image\/([^;]+);base64,[A-Za-z0-9+/=]+/g,
            (_2, mimeType) => `[📷 image/${mimeType}]`
          );
          displayBody = sanitizeRequestBody(displayBody);
          const isChatEndpoint = url.includes("/chat/completions");
          requestBody = !isChatEndpoint && displayBody.length > 3e3 ? displayBody.substring(0, 3e3) + "...(truncated)" : displayBody;
        } catch {
          requestBody = "[unable to serialize body]";
        }
      }
    }
    const log = {
      id,
      timestamp: startTime,
      url,
      method,
      requestType: "sw-internal",
      details: (options == null ? void 0 : options.label) || `SW Internal: ${method} ${new URL(url).pathname}`,
      requestBody,
      formData,
      base64Images,
      isStreaming: options == null ? void 0 : options.isStreaming
    };
    internalFetchLogs.unshift(log);
    if (internalFetchLogs.length > MAX_INTERNAL_LOGS) {
      internalFetchLogs.pop();
    }
    if (broadcastCallback$1) {
      broadcastCallback$1({ ...log });
    }
    try {
      const response = await fetch(input, init);
      log.status = response.status;
      log.statusText = response.statusText;
      log.duration = Date.now() - startTime;
      if (options == null ? void 0 : options.isStreaming) {
        log.responseBody = "[流式响应 - 数据通过 SSE/Stream 实时传输，无法捕获完整响应体]";
      } else if (options == null ? void 0 : options.logResponseBody) {
        try {
          const contentType = response.headers.get("content-type") || "";
          if (contentType.includes("application/json") || contentType.includes("text/")) {
            const clone = response.clone();
            const text = await clone.text();
            log.responseBody = text.length > 2e3 ? text.substring(0, 2e3) + "...(truncated)" : text;
          }
        } catch {
        }
      }
      if (broadcastCallback$1) {
        broadcastCallback$1({ ...log });
      }
      response.__debugLogId = id;
      return response;
    } catch (error) {
      const errorMessage = error.message || String(error);
      let errorType = "NETWORK_ERROR";
      if (errorMessage.includes("ERR_CONNECTION_CLOSED")) {
        errorType = "ERR_CONNECTION_CLOSED";
      } else if (errorMessage.includes("ERR_CONNECTION_REFUSED")) {
        errorType = "ERR_CONNECTION_REFUSED";
      } else if (errorMessage.includes("ERR_CONNECTION_RESET")) {
        errorType = "ERR_CONNECTION_RESET";
      } else if (errorMessage.includes("ERR_CONNECTION_TIMED_OUT") || errorMessage.includes("timeout")) {
        errorType = "ERR_TIMEOUT";
      } else if (errorMessage.includes("ERR_NAME_NOT_RESOLVED")) {
        errorType = "ERR_DNS_FAILED";
      } else if (errorMessage.includes("ERR_INTERNET_DISCONNECTED")) {
        errorType = "ERR_OFFLINE";
      } else if (errorMessage.includes("ERR_SSL") || errorMessage.includes("certificate")) {
        errorType = "ERR_SSL";
      } else if (errorMessage.includes("Failed to fetch")) {
        errorType = "FETCH_FAILED";
      } else if (errorMessage.includes("AbortError") || errorMessage.includes("aborted")) {
        errorType = "ABORTED";
      }
      log.status = 0;
      log.statusText = errorType;
      log.error = errorMessage;
      log.duration = Date.now() - startTime;
      if (broadcastCallback$1) {
        broadcastCallback$1({ ...log });
      }
      throw error;
    }
  }
  const debugFetch$1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    clearInternalFetchLogs,
    debugFetch,
    getInternalFetchLogs,
    isDebugFetchEnabled,
    setDebugFetchBroadcast,
    setDebugFetchEnabled,
    updateLogResponseBody
  }, Symbol.toStringTag, { value: "Module" }));
  const isDevelopment$1 = typeof location !== "undefined" && (location.hostname === "localhost" || location.hostname === "127.0.0.1");
  const CDN_CONFIG = {
    packageName: "aitu-app",
    healthCheckInterval: 5 * 60 * 1e3,
    degradeTimeout: 60 * 1e3,
    failThreshold: 3,
    fetchTimeout: 1500,
    backgroundFetchTimeout: 8e3,
    localFetchTimeout: 5e3,
    preferenceCacheExpiry: 60 * 60 * 1e3,
    preferenceCacheName: "drawnix-cdn-v1",
    preferenceCacheKey: typeof location !== "undefined" ? new URL("/__sw__/cdn-preference", location.origin).href : "https://opentu.local/__sw__/cdn-preference"
  };
  const CDN_DEGRADE_POLICIES = {
    jsdelivr: {
      baseTimeout: 60 * 1e3,
      maxTimeout: 5 * 60 * 1e3
    }
  };
  const CDN_SOURCES = [
    {
      name: "jsdelivr",
      urlTemplate: "https://cdn.jsdelivr.net/npm/aitu-app@{version}/{path}",
      healthCheckPath: "version.json",
      enabled: true,
      priority: 1
    }
  ];
  const cdnHealthStatus = /* @__PURE__ */ new Map();
  let persistedCDNPreference = null;
  let hasLoadedPersistedPreference = false;
  let loadPreferencePromise = null;
  function initHealthStatus(forceReset = false) {
    if (forceReset) {
      cdnHealthStatus.clear();
    }
    CDN_SOURCES.forEach((source) => {
      if (!cdnHealthStatus.has(source.name)) {
        cdnHealthStatus.set(source.name, {
          name: source.name,
          isHealthy: true,
          lastCheckTime: 0,
          failCount: 0,
          lastSuccessTime: Date.now()
        });
      }
    });
  }
  initHealthStatus();
  function isCDNName(value) {
    return value === "jsdelivr" || value === "local";
  }
  function sanitizeCDNPreference(value) {
    if (!value || typeof value !== "object") {
      return null;
    }
    const record = value;
    const cdn = record["cdn"];
    const version = record["version"];
    if (!isCDNName(cdn) || typeof version !== "string" || version.trim() === "") {
      return null;
    }
    const latency = Number(record["latency"]);
    const timestamp = Number(record["timestamp"]);
    return {
      cdn,
      version: version.trim(),
      latency: Number.isFinite(latency) && latency >= 0 ? latency : 0,
      timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now()
    };
  }
  function isFreshPreference(preference, version) {
    if (!preference) {
      return false;
    }
    if (version && preference.version !== version) {
      return false;
    }
    return Date.now() - preference.timestamp <= CDN_CONFIG.preferenceCacheExpiry;
  }
  async function readPersistedPreference() {
    if (typeof caches === "undefined") {
      return null;
    }
    try {
      const cache = await caches.open(CDN_CONFIG.preferenceCacheName);
      const response = await cache.match(CDN_CONFIG.preferenceCacheKey);
      if (!(response == null ? void 0 : response.ok)) {
        return null;
      }
      return sanitizeCDNPreference(await response.json());
    } catch (error) {
      console.warn(
        "[CDN Fallback] Failed to read persisted CDN preference:",
        error
      );
      return null;
    }
  }
  async function ensureCDNPreferenceLoaded() {
    if (hasLoadedPersistedPreference) {
      return;
    }
    if (!loadPreferencePromise) {
      loadPreferencePromise = (async () => {
        persistedCDNPreference = await readPersistedPreference();
        hasLoadedPersistedPreference = true;
        loadPreferencePromise = null;
      })();
    }
    await loadPreferencePromise;
  }
  async function setCDNPreference(preference) {
    persistedCDNPreference = sanitizeCDNPreference(preference);
    hasLoadedPersistedPreference = true;
    if (typeof caches === "undefined") {
      return;
    }
    try {
      const cache = await caches.open(CDN_CONFIG.preferenceCacheName);
      if (!persistedCDNPreference) {
        await cache.delete(CDN_CONFIG.preferenceCacheKey);
        return;
      }
      await cache.put(
        CDN_CONFIG.preferenceCacheKey,
        new Response(JSON.stringify(persistedCDNPreference), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
          }
        })
      );
    } catch (error) {
      console.warn("[CDN Fallback] Failed to persist CDN preference:", error);
    }
  }
  function getCDNPreference() {
    return persistedCDNPreference;
  }
  function markCDNSuccess(cdnName) {
    const status = cdnHealthStatus.get(cdnName);
    if (status) {
      status.isHealthy = true;
      status.failCount = 0;
      status.lastSuccessTime = Date.now();
      status.lastCheckTime = Date.now();
      status.lastFailureReason = void 0;
    }
  }
  function markCDNFailure(cdnName, reason) {
    const status = cdnHealthStatus.get(cdnName);
    if (status) {
      status.failCount++;
      status.lastCheckTime = Date.now();
      status.lastFailureReason = reason;
      if (status.failCount >= CDN_CONFIG.failThreshold) {
        status.isHealthy = false;
        const cooldown = getCDNCooldownSnapshot(status);
        console.warn(
          `[CDN Fallback] ${cdnName} marked as unhealthy after ${status.failCount} failures, cooldown=${cooldown.cooldownMs}ms, reason=${reason ?? "unknown"}`
        );
      } else {
        console.warn(
          `[CDN Fallback] ${cdnName} failure count=${status.failCount}, reason=${reason ?? "unknown"}`
        );
      }
    }
  }
  function getCDNDegradeTimeout(cdnName, failCount) {
    const policy = CDN_DEGRADE_POLICIES[cdnName] ?? {
      baseTimeout: CDN_CONFIG.degradeTimeout,
      maxTimeout: CDN_CONFIG.degradeTimeout
    };
    const consecutiveFailures = Math.max(0, failCount - CDN_CONFIG.failThreshold);
    const multiplier = 2 ** consecutiveFailures;
    return Math.min(policy.baseTimeout * multiplier, policy.maxTimeout);
  }
  function getCDNCooldownSnapshot(status) {
    const cooldownMs = getCDNDegradeTimeout(status.name, status.failCount);
    const cooldownUntil = status.lastCheckTime + cooldownMs;
    return {
      cooldownMs,
      cooldownUntil,
      remainingCooldownMs: Math.max(0, cooldownUntil - Date.now())
    };
  }
  function isCDNAvailable(cdnName, options = {}) {
    const status = cdnHealthStatus.get(cdnName);
    if (!status) return false;
    if (status.isHealthy) return true;
    if (options.ignoreCooldown) {
      return true;
    }
    const now = Date.now();
    const degradeTimeout = getCDNDegradeTimeout(cdnName, status.failCount);
    if (now - status.lastCheckTime > degradeTimeout) {
      return true;
    }
    return false;
  }
  function getPreferredCDNName(version, options = {}) {
    const preference = persistedCDNPreference;
    if (!preference || !isFreshPreference(preference, version) || preference.cdn === "local") {
      return null;
    }
    return isCDNAvailable(preference.cdn, options) ? preference.cdn : null;
  }
  function getAvailableCDNs(version, options = {}) {
    const preferredName = version ? getPreferredCDNName(version, options) : null;
    return CDN_SOURCES.filter(
      (source) => source.enabled && isCDNAvailable(source.name, options)
    ).sort((a2, b) => {
      if (preferredName && a2.name === preferredName && b.name !== preferredName) {
        return -1;
      }
      if (preferredName && b.name === preferredName && a2.name !== preferredName) {
        return 1;
      }
      return a2.priority - b.priority;
    });
  }
  function cleanResourcePath(resourcePath) {
    const rawPath = String(resourcePath || "").trim();
    if (!rawPath) {
      return rawPath;
    }
    let normalizedPath = rawPath;
    try {
      if (/^https?:\/\//i.test(normalizedPath)) {
        const absoluteUrl = new URL(normalizedPath);
        normalizedPath = `${absoluteUrl.pathname}${absoluteUrl.search}`;
      }
    } catch {
    }
    normalizedPath = normalizedPath.replace(/^\/?npm\/aitu-app@[^/]+\//, "/").replace(/^\/?aitu-app@[^/]+\//, "/");
    return normalizedPath;
  }
  function extractVersionFromCDNPath(resourcePath) {
    const match = resourcePath.match(/(?:^|\/)(?:npm\/)?aitu-app@([^/]+)\//);
    return match ? match[1] : null;
  }
  function buildThirdPartyCDNUrl(source, resourcePath) {
    const rawPath = String(resourcePath || "").trim();
    if (!rawPath) {
      return null;
    }
    let normalizedPath = rawPath;
    try {
      if (/^https?:\/\//i.test(normalizedPath)) {
        const absoluteUrl = new URL(normalizedPath);
        normalizedPath = `${absoluteUrl.pathname}${absoluteUrl.search}`;
      }
    } catch {
    }
    const packagePath = normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;
    if (!/^\/npm\/(?!aitu-app@)[^/]+@[^/]+\//.test(packagePath)) {
      return null;
    }
    if (source.name === "jsdelivr") {
      return `https://cdn.jsdelivr.net${packagePath}`;
    }
    return null;
  }
  function buildCDNUrl(source, version, resourcePath) {
    const thirdPartyCDNUrl = buildThirdPartyCDNUrl(source, resourcePath);
    if (thirdPartyCDNUrl) {
      return thirdPartyCDNUrl;
    }
    const cleanPath = cleanResourcePath(resourcePath);
    return source.urlTemplate.replace("{version}", version).replace(
      "{path}",
      cleanPath.startsWith("/") ? cleanPath.slice(1) : cleanPath
    );
  }
  async function fetchWithTimeout(url, timeout = CDN_CONFIG.fetchTimeout) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(url, {
        signal: controller.signal,
        cache: "no-store"
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }
  function getLocalUrl(localOrigin, resourcePath) {
    const cleanPath = cleanResourcePath(resourcePath);
    return `${localOrigin}/${cleanPath.startsWith("/") ? cleanPath.slice(1) : cleanPath}`;
  }
  async function tryFetchFromLocalOrigin(resourcePath, localOrigin, timeout) {
    try {
      const localUrl = getLocalUrl(localOrigin, resourcePath);
      const response = await fetchWithTimeout(localUrl, timeout);
      if (!response.ok) {
        console.warn(`[CDN Fallback] Local server returned ${response.status}`);
        return null;
      }
      return { response, source: "local" };
    } catch (error) {
      console.warn("[CDN Fallback] Local server failed:", error);
      return null;
    }
  }
  async function tryFetchFromCDNList(cdnList, version, resourcePath, timeout) {
    for (const cdn of cdnList) {
      const url = buildCDNUrl(cdn, version, resourcePath);
      try {
        const response = await fetchWithTimeout(url, timeout);
        if (!response.ok) {
          markCDNFailure(cdn.name, `status:${response.status}`);
          console.warn(`[CDN Fallback] ${cdn.name} returned ${response.status}`);
          continue;
        }
        if (!await isValidCDNResponse(response, cdn.name)) {
          continue;
        }
        markCDNSuccess(cdn.name);
        return { response, source: cdn.name, targetUrl: url };
      } catch (error) {
        const reason = error instanceof Error && error.name === "AbortError" ? "timeout" : "network-error";
        markCDNFailure(cdn.name, reason);
        console.warn(`[CDN Fallback] ${cdn.name} failed:`, error);
      }
    }
    return null;
  }
  async function isValidCDNResponse(response, cdnName) {
    var _a;
    const contentType = response.headers.get("Content-Type") || "";
    const isValidContentType = contentType.includes("javascript") || contentType.includes("css") || contentType.includes("json") || contentType.includes("font") || contentType.includes("image") || contentType.includes("woff") || contentType.includes("application/octet-stream");
    if (!isValidContentType) {
      markCDNFailure(cdnName, `invalid-content-type:${contentType}`);
      console.warn(
        `[CDN Fallback] ${cdnName} invalid Content-Type: ${contentType}`
      );
      return false;
    }
    const contentLength = parseInt(
      response.headers.get("Content-Length") || "0",
      10
    );
    const isTextResource = contentType.includes("javascript") || contentType.includes("css") || contentType.includes("json");
    if (isTextResource && contentLength > 0 && contentLength < 50) {
      markCDNFailure(cdnName, `response-too-small:${contentLength}`);
      console.warn(
        `[CDN Fallback] ${cdnName} response too small: ${contentLength} bytes`
      );
      return false;
    }
    const clonedResponse = response.clone();
    try {
      const reader = (_a = clonedResponse.body) == null ? void 0 : _a.getReader();
      if (reader) {
        const { value } = await reader.read();
        reader.cancel();
        if (value) {
          const textSample = new TextDecoder().decode(value.slice(0, 200));
          const looksLikeHtml = textSample.includes("<!DOCTYPE") || textSample.includes("<html") || textSample.includes("<HTML") || textSample.includes("Not Found") || textSample.includes("404");
          if (isTextResource && looksLikeHtml) {
            markCDNFailure(cdnName, "html-error-page");
            console.warn(
              `[CDN Fallback] ${cdnName} returned HTML instead of ${contentType}`
            );
            return false;
          }
        }
      }
    } catch {
    }
    return true;
  }
  async function fetchFromCDNWithFallback(resourcePath, version, localOrigin, options = {}) {
    if (isDevelopment$1) {
      return null;
    }
    await ensureCDNPreferenceLoaded();
    const {
      preferLocal = false,
      localTimeout = CDN_CONFIG.localFetchTimeout,
      requestKind = "interactive-runtime"
    } = options;
    const ignoreCooldown = requestKind === "background-prefetch";
    const effectiveCDNTimeout = options.cdnTimeout ?? (requestKind === "background-prefetch" ? CDN_CONFIG.backgroundFetchTimeout : CDN_CONFIG.fetchTimeout);
    if (preferLocal) {
      const localResult = await tryFetchFromLocalOrigin(
        resourcePath,
        localOrigin,
        localTimeout
      );
      if (localResult) {
        return {
          ...localResult,
          targetUrl: getLocalUrl(localOrigin, resourcePath)
        };
      }
    }
    const availableCDNs = getAvailableCDNs(version, { ignoreCooldown });
    const cdnResult = await tryFetchFromCDNList(
      availableCDNs,
      version,
      resourcePath,
      effectiveCDNTimeout
    );
    if (cdnResult) {
      return cdnResult;
    }
    if (!preferLocal) {
      const localResult = await tryFetchFromLocalOrigin(
        resourcePath,
        localOrigin,
        localTimeout
      );
      if (localResult) {
        return {
          ...localResult,
          targetUrl: getLocalUrl(localOrigin, resourcePath)
        };
      }
    }
    const recoveryCDNs = CDN_SOURCES.filter(
      (source) => source.enabled && !availableCDNs.some((candidate) => candidate.name === source.name)
    );
    if (recoveryCDNs.length > 0) {
      console.warn(
        `[CDN Fallback] Local origin failed, forcing CDN recovery probe for: ${resourcePath}`
      );
      const recoveryResult = await tryFetchFromCDNList(
        recoveryCDNs,
        version,
        resourcePath,
        effectiveCDNTimeout
      );
      if (recoveryResult) {
        return recoveryResult;
      }
    }
    console.error(`[CDN Fallback] All sources failed for: ${resourcePath}`);
    return null;
  }
  async function performHealthCheck(version) {
    await ensureCDNPreferenceLoaded();
    const results = /* @__PURE__ */ new Map();
    for (const source of CDN_SOURCES) {
      if (!source.enabled) continue;
      const url = buildCDNUrl(source, version, source.healthCheckPath);
      try {
        const response = await fetchWithTimeout(url, 5e3);
        const isHealthy = response.ok;
        results.set(source.name, isHealthy);
        if (isHealthy) {
          markCDNSuccess(source.name);
        } else {
          markCDNFailure(source.name, `status:${response.status}`);
        }
      } catch {
        results.set(source.name, false);
        markCDNFailure(source.name, "health-check-failed");
      }
    }
    return results;
  }
  function getCDNStatusReport() {
    const preferredName = isFreshPreference(persistedCDNPreference) ? persistedCDNPreference == null ? void 0 : persistedCDNPreference.cdn : null;
    return Array.from(cdnHealthStatus.entries()).map(([name, status]) => ({
      name,
      status,
      preferred: preferredName === name,
      ...getCDNCooldownSnapshot(status)
    }));
  }
  function resetCDNStatus() {
    initHealthStatus(true);
  }
  function getCDNConfig() {
    return {
      ...CDN_CONFIG,
      sources: CDN_SOURCES,
      preference: persistedCDNPreference
    };
  }
  const cdnFallback = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    buildCDNUrl,
    ensureCDNPreferenceLoaded,
    extractVersionFromCDNPath,
    fetchFromCDNWithFallback,
    getAvailableCDNs,
    getCDNConfig,
    getCDNPreference,
    getCDNStatusReport,
    isCDNAvailable,
    markCDNFailure,
    markCDNSuccess,
    performHealthCheck,
    resetCDNStatus,
    setCDNPreference
  }, Symbol.toStringTag, { value: "Module" }));
  function isRootPathname(pathname) {
    return pathname === "/" || pathname === "/index.html";
  }
  const ORIGIN_FIRST_PRELOAD_SUFFIXES = [
    "/version.json",
    "/manifest.json",
    "/sw.js",
    "/precache-manifest.json",
    "/idle-prefetch-manifest.json"
  ];
  const LAZY_CHUNK_RETRY_PARAM = "_lazy_chunk_retry";
  const LAZY_CHUNK_RETRY_TS_PARAM = "_t";
  const LAZY_CHUNK_RETRY_MAX_AGE_MS = 10 * 60 * 1e3;
  function shouldUseAppShellStrategy(requestMode, pathname) {
    if (isRootPathname(pathname)) {
      return true;
    }
    return requestMode === "navigate" && !pathname.endsWith(".html");
  }
  function shouldUseOriginFirstPreload(pathname) {
    if (isRootPathname(pathname)) {
      return true;
    }
    return ORIGIN_FIRST_PRELOAD_SUFFIXES.some(
      (suffix) => pathname.endsWith(suffix)
    );
  }
  function shouldUseCDNFirstPreload(pathname) {
    return !shouldUseOriginFirstPreload(pathname);
  }
  function shouldBypassAppShellCacheForLazyChunkRecovery(search, now = Date.now()) {
    const params = new URLSearchParams(search);
    if (params.get(LAZY_CHUNK_RETRY_PARAM) !== "1") {
      return false;
    }
    const retryAt = Number(params.get(LAZY_CHUNK_RETRY_TS_PARAM));
    if (!Number.isFinite(retryAt) || retryAt <= 0) {
      return true;
    }
    return now - retryAt <= LAZY_CHUNK_RETRY_MAX_AGE_MS;
  }
  const sw2 = self;
  const channelManager = initChannelManager(sw2);
  channelManager.setDebugClientCountChangedCallback(
    handleDebugClientCountChanged
  );
  const originalSWConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
  };
  function shouldFilterLog(args) {
    var _a;
    const message = ((_a = args[0]) == null ? void 0 : _a.toString()) || "";
    if (message.includes("[ServiceWorkerChannel]") || message.includes("[BaseChannel]") || message.includes("Invalid message structure") || message.includes("broadcast:") || message.includes("publish:") || message.includes("subscribe:")) {
      return true;
    }
    if (message.includes("[Main]") || message.includes("[SW Console Capture]")) {
      return true;
    }
    if (message.includes("[SWChannelManager]") && (message.includes("broadcast") || message.includes("sendConsoleLog"))) {
      return true;
    }
    return false;
  }
  function setupSWConsoleCapture() {
    console.log = (...args) => {
      originalSWConsole.log(...args);
      if (isDebugFetchEnabled() && !shouldFilterLog(args)) {
        forwardSWConsoleLog("log", args);
      }
    };
    console.info = (...args) => {
      originalSWConsole.info(...args);
      if (isDebugFetchEnabled() && !shouldFilterLog(args)) {
        forwardSWConsoleLog("info", args);
      }
    };
    console.warn = (...args) => {
      originalSWConsole.warn(...args);
      if (!shouldFilterLog(args)) {
        forwardSWConsoleLog("warn", args);
      }
    };
    console.error = (...args) => {
      originalSWConsole.error(...args);
      if (!shouldFilterLog(args)) {
        forwardSWConsoleLog("error", args);
      }
    };
  }
  function formatLogArgs(args) {
    let extractedStack;
    const parts = [];
    for (const arg of args) {
      try {
        const err = arg;
        if (arg instanceof Error || arg && typeof arg === "object" && typeof err.message === "string") {
          extractedStack = err.stack || extractedStack;
          parts.push(`${err.name || "Error"}: ${err.message || ""}`);
        } else if (typeof arg === "object" && arg !== null) {
          const str = JSON.stringify(arg);
          parts.push(str === "{}" ? String(arg) : str);
        } else {
          parts.push(String(arg));
        }
      } catch {
        parts.push(String(arg));
      }
    }
    const message = parts.join(" ") || "(empty)";
    return { message, stack: extractedStack };
  }
  function forwardSWConsoleLog(level, args) {
    try {
      const { message, stack } = formatLogArgs(args);
      const prefixedMessage = message.startsWith("[SW]") || message.startsWith("[SW-") ? message : `[SW] ${message}`;
      if (typeof addConsoleLogLater === "function") {
        addConsoleLogLater({
          logLevel: level,
          logMessage: prefixedMessage,
          logStack: stack,
          logSource: "service-worker"
        });
      }
    } catch (e2) {
      originalSWConsole.error(
        "[SW Console Capture] forwardSWConsoleLog failed:",
        e2
      );
    }
  }
  let addConsoleLogLater = null;
  setupSWConsoleCapture();
  setDebugFetchBroadcast((log) => {
    const cm = getChannelManager();
    if (cm) {
      cm.sendDebugLog({ ...log, type: "fetch" });
    }
  });
  Promise.resolve().then(() => llmApiLogger).then(({ setLLMApiLogBroadcast: setLLMApiLogBroadcast2 }) => {
    setLLMApiLogBroadcast2((log) => {
      const cm = getChannelManager();
      if (cm) {
        cm.sendDebugLLMLog(log);
      }
    });
  });
  const APP_VERSION = "0.9.6";
  const SW_SCOPE_BASE_URL = new URL("./", self.location.href);
  const SW_SCOPE_BASE_PATH = SW_SCOPE_BASE_URL.pathname;
  const CACHE_NAME = `drawnix-v${APP_VERSION}`;
  const IMAGE_CACHE_NAME = `drawnix-images`;
  const STATIC_CACHE_NAME = `drawnix-static-v${APP_VERSION}`;
  const FONT_CACHE_NAME = `drawnix-fonts`;
  const SW_CACHE_DATE_HEADER = "sw-cache-date";
  const SW_CACHE_CREATED_AT_HEADER = "sw-cache-created-at";
  const STATIC_SOURCE_HEADER = "x-sw-source";
  const STATIC_REVISION_HEADER = "x-sw-revision";
  const STATIC_APP_VERSION_HEADER = "x-sw-app-version";
  const STATIC_FETCH_TARGET_HEADER = "x-sw-fetch-target";
  const SERVICE_WORKER_DB_NAME = "ServiceWorkerDB";
  const SERVICE_WORKER_DB_VERSION = 2;
  setSwRuntimeBridge({
    saveCrashSnapshot,
    getDebugStatus,
    addConsoleLog,
    getDebugLogs,
    clearDebugLogs,
    clearConsoleLogs,
    enableDebugMode,
    disableDebugMode,
    loadConsoleLogsFromDB,
    clearAllConsoleLogs,
    getCrashSnapshots,
    clearCrashSnapshots,
    getCacheStats,
    deleteCacheByUrl,
    getInternalFetchLogs,
    getCDNStatusReport,
    resetCDNStatus,
    performHealthCheck,
    getAppVersion: () => APP_VERSION,
    getImageCacheName: () => IMAGE_CACHE_NAME,
    requestVideoThumbnail: async (url, timeoutMs, maxSize) => {
      const cm = getChannelManager();
      if (!cm || cm.getConnectedClientCount() === 0) {
        return null;
      }
      return cm.requestVideoThumbnail(url, timeoutMs, maxSize);
    }
  });
  const FAILED_DOMAINS_STORE = "failedDomains";
  const VERSION_STATE_STORE = "versionState";
  const VERSION_STATE_KEY = "app-version-state";
  const CACHE_URL_PREFIX = "/__aitu_cache__/";
  const AI_GENERATED_AUDIO_CACHE_PREFIX = "/__aitu_generated__/audio/";
  const ASSET_LIBRARY_PREFIX = "/asset-library/";
  const isDevelopment = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  function createScopeUrl(pathname) {
    return new URL(pathname.replace(/^\//, ""), SW_SCOPE_BASE_URL);
  }
  function getScopeRelativePathname(pathname) {
    if (SW_SCOPE_BASE_PATH !== "/" && pathname.startsWith(SW_SCOPE_BASE_PATH)) {
      return `/${pathname.slice(SW_SCOPE_BASE_PATH.length)}`;
    }
    return pathname;
  }
  const CORS_ALLOWED_DOMAINS = [
    {
      hostname: "google.datas.systems",
      pathPattern: "response_images",
      fallbackDomain: "cdn.i666.fun"
    },
    {
      hostname: "googlecdn2.datas.systems",
      pathPattern: "response_images",
      fallbackDomain: "googlecdn2.i666.fun"
    },
    {
      hostname: "filesystem.i666.fun",
      pathPattern: "response_images",
      fallbackDomain: "filesystem.i666.fun"
    }
  ];
  const IMAGE_EXTENSIONS_REGEX = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i;
  const VIDEO_EXTENSIONS_REGEX = /\.(mp4|webm|ogg|mov|avi|mkv|flv|wmv|m4v)$/i;
  const AUDIO_EXTENSIONS_REGEX = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i;
  const VOLATILE_CACHE_QUERY_PARAMS = /* @__PURE__ */ new Set([
    "_t",
    "cache_buster",
    "v",
    "timestamp",
    "nocache",
    "_cb",
    "t",
    "retry",
    "_retry",
    "_poster_retry",
    "rand",
    "_force",
    "bypass_sw",
    "direct_fetch",
    "thumbnail",
    "expires",
    "signature",
    "sig",
    "token",
    "policy",
    "x-amz-algorithm",
    "x-amz-credential",
    "x-amz-date",
    "x-amz-expires",
    "x-amz-security-token",
    "x-amz-signature",
    "x-amz-signedheaders",
    "x-goog-algorithm",
    "x-goog-credential",
    "x-goog-date",
    "x-goog-expires",
    "x-goog-signature",
    "x-goog-signedheaders",
    "ossaccesskeyid",
    "x-oss-security-token",
    "x-oss-signature-version",
    "x-oss-credential",
    "x-oss-date",
    "x-oss-expires",
    "x-oss-signature"
  ]);
  function buildNormalizedCacheUrl(input) {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const keys = Array.from(url.searchParams.keys());
    for (const key of keys) {
      if (VOLATILE_CACHE_QUERY_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    return url;
  }
  const pendingImageRequests = /* @__PURE__ */ new Map();
  const completedImageRequests = /* @__PURE__ */ new Map();
  const COMPLETED_REQUEST_CACHE_TTL = 30 * 1e3;
  const cacheFailureNotificationCache = /* @__PURE__ */ new Map();
  const CACHE_FAILURE_NOTIFICATION_TTL = 5 * 60 * 1e3;
  const MAX_CACHE_FAILURE_NOTIFICATION_CACHE_SIZE = 500;
  const pendingVideoRequests = /* @__PURE__ */ new Map();
  const videoBlobCache = /* @__PURE__ */ new Map();
  const VIDEO_BLOB_CACHE_TTL = 5 * 60 * 1e3;
  const VIDEO_BLOB_CACHE_MAX_SIZE = 10;
  const failedDomains = /* @__PURE__ */ new Set();
  const corsFailedDomains = /* @__PURE__ */ new Set();
  const CORS_FAILED_DOMAIN_TTL = 60 * 60 * 1e3;
  const corsFailedDomainTimestamps = /* @__PURE__ */ new Map();
  function markCorsFailedDomain(hostname) {
    corsFailedDomains.add(hostname);
    corsFailedDomainTimestamps.set(hostname, Date.now());
    console.warn(
      `Service Worker: 标记 ${hostname} 为 CORS 问题域名，后续请求将跳过 SW`
    );
  }
  function isCorsFailedDomain(hostname) {
    if (!corsFailedDomains.has(hostname)) return false;
    const timestamp = corsFailedDomainTimestamps.get(hostname);
    if (timestamp && Date.now() - timestamp > CORS_FAILED_DOMAIN_TTL) {
      corsFailedDomains.delete(hostname);
      corsFailedDomainTimestamps.delete(hostname);
      return false;
    }
    return true;
  }
  const consoleLogs = [];
  const CONSOLE_LOG_RETENTION_DAYS = 7;
  const debugLogs = [];
  const MAX_DEBUG_LOGS = 500;
  let debugModeEnabled = false;
  function addDebugLog(entry) {
    if (!debugModeEnabled) return "";
    const id = Math.random().toString(36).substring(2, 10);
    const logEntry = {
      ...entry,
      id,
      timestamp: Date.now()
    };
    debugLogs.unshift(logEntry);
    if (debugLogs.length > MAX_DEBUG_LOGS) {
      debugLogs.pop();
    }
    broadcastDebugLog(logEntry);
    return id;
  }
  function updateDebugLog(id, updates) {
    if (!debugModeEnabled || !id) return;
    const entry = debugLogs.find((e2) => e2.id === id);
    if (entry) {
      Object.assign(entry, updates);
      broadcastDebugLog(entry);
    }
  }
  function broadcastDebugLog(entry) {
    const cm = getChannelManager();
    if (cm) {
      cm.sendDebugLog(entry);
    }
  }
  function openConsoleLogDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("ConsoleLogDB", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains("logs")) {
          const store = db.createObjectStore("logs", { keyPath: "id" });
          store.createIndex("timestamp", "timestamp", { unique: false });
          store.createIndex("logLevel", "logLevel", { unique: false });
        }
      };
    });
  }
  async function saveConsoleLogToDB(logEntry) {
    try {
      const db = await openConsoleLogDB();
      const transaction = db.transaction(["logs"], "readwrite");
      const store = transaction.objectStore("logs");
      store.add(logEntry);
      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
      });
    } catch (error) {
      console.warn("Service Worker: 无法保存控制台日志:", error);
    }
  }
  async function loadConsoleLogsFromDB() {
    try {
      await cleanupExpiredConsoleLogs();
      const db = await openConsoleLogDB();
      const transaction = db.transaction(["logs"], "readonly");
      const store = transaction.objectStore("logs");
      const index = store.index("timestamp");
      const expirationTime = Date.now() - CONSOLE_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1e3;
      return new Promise((resolve, reject) => {
        const request = index.openCursor(null, "prev");
        const logs2 = [];
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            const entry = cursor.value;
            if (entry.timestamp >= expirationTime) {
              logs2.push(entry);
            }
            cursor.continue();
          } else {
            db.close();
            resolve(logs2);
          }
        };
        request.onerror = () => {
          db.close();
          reject(request.error);
        };
      });
    } catch (error) {
      console.warn("Service Worker: 无法加载控制台日志:", error);
      return [];
    }
  }
  async function cleanupExpiredConsoleLogs() {
    try {
      const db = await openConsoleLogDB();
      const transaction = db.transaction(["logs"], "readwrite");
      const store = transaction.objectStore("logs");
      const index = store.index("timestamp");
      const expirationTime = Date.now() - CONSOLE_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1e3;
      const range = IDBKeyRange.upperBound(expirationTime);
      return new Promise((resolve, reject) => {
        const request = index.openCursor(range);
        let deletedCount = 0;
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            cursor.delete();
            deletedCount++;
            cursor.continue();
          } else {
            db.close();
            if (deletedCount > 0) {
            }
            resolve(deletedCount);
          }
        };
        request.onerror = () => {
          db.close();
          reject(request.error);
        };
      });
    } catch (error) {
      console.warn("Service Worker: 无法清理过期日志:", error);
      return 0;
    }
  }
  async function clearAllConsoleLogs() {
    try {
      const db = await openConsoleLogDB();
      const transaction = db.transaction(["logs"], "readwrite");
      const store = transaction.objectStore("logs");
      store.clear();
      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
      });
    } catch (error) {
      console.warn("Service Worker: 无法清空控制台日志:", error);
    }
  }
  const MAX_CONSOLE_LOGS_MEMORY = 500;
  function addConsoleLog(entry) {
    const isWarnOrAbove = entry.logLevel === "warn" || entry.logLevel === "error";
    const shouldRecord = debugModeEnabled || isWarnOrAbove;
    if (!shouldRecord) {
      return;
    }
    const id = Math.random().toString(36).substring(2, 10);
    const logEntry = {
      id,
      timestamp: Date.now(),
      type: "console",
      ...entry
    };
    saveConsoleLogToDB(logEntry);
    consoleLogs.unshift(logEntry);
    if (consoleLogs.length > MAX_CONSOLE_LOGS_MEMORY) {
      consoleLogs.length = MAX_CONSOLE_LOGS_MEMORY;
    }
    if (debugModeEnabled) {
      broadcastConsoleLog(logEntry);
    }
  }
  addConsoleLogLater = addConsoleLog;
  function broadcastConsoleLog(entry) {
    const cm = getChannelManager();
    if (cm) {
      cm.sendConsoleLog(entry);
    }
  }
  function estimateVideoBlobCacheSize() {
    let totalSize = 0;
    videoBlobCache.forEach((entry) => {
      if (entry.blob) {
        totalSize += entry.blob.size;
      }
    });
    return totalSize;
  }
  function getDebugStatus() {
    return {
      version: APP_VERSION,
      cacheNames: [
        CACHE_NAME,
        IMAGE_CACHE_NAME,
        STATIC_CACHE_NAME,
        FONT_CACHE_NAME
      ],
      pendingImageRequests: pendingImageRequests.size,
      pendingVideoRequests: pendingVideoRequests.size,
      videoBlobCacheSize: videoBlobCache.size,
      videoBlobCacheTotalBytes: estimateVideoBlobCacheSize(),
      completedImageRequestsSize: completedImageRequests.size,
      failedDomainsCount: failedDomains.size,
      failedDomains: Array.from(failedDomains),
      corsFailedDomainsCount: corsFailedDomains.size,
      corsFailedDomains: Array.from(corsFailedDomains),
      debugLogsCount: debugLogs.length,
      consoleLogsCount: consoleLogs.length,
      debugModeEnabled,
      // 运行时内存统计
      memoryStats: {
        pendingRequestsMapSize: pendingImageRequests.size,
        completedRequestsMapSize: completedImageRequests.size,
        videoBlobCacheMapSize: videoBlobCache.size,
        failedDomainsSetSize: failedDomains.size,
        corsFailedDomainsSetSize: corsFailedDomains.size,
        debugLogsArraySize: debugLogs.length,
        consoleLogsArraySize: consoleLogs.length
      }
    };
  }
  function getDebugLogs() {
    return debugLogs;
  }
  function clearDebugLogs() {
    debugLogs.length = 0;
  }
  function clearConsoleLogs() {
    consoleLogs.length = 0;
  }
  function enableDebugMode() {
    if (debugModeEnabled) return;
    debugModeEnabled = true;
    setDebugFetchEnabled(true);
    setDebugMode(true);
    originalSWConsole.log(
      "Service Worker: Debug mode enabled (debug page connected)"
    );
  }
  function disableDebugMode() {
    if (!debugModeEnabled) return;
    debugModeEnabled = false;
    setDebugFetchEnabled(false);
    setDebugMode(false);
    consoleLogs.length = 0;
    debugLogs.length = 0;
    originalSWConsole.log("Service Worker: Debug mode disabled (no debug pages)");
  }
  function handleDebugClientCountChanged(count) {
    if (count > 0) {
      enableDebugMode();
    } else {
      disableDebugMode();
    }
  }
  function shouldHandleCORS(url) {
    for (const domain of CORS_ALLOWED_DOMAINS) {
      if (url.hostname === domain.hostname && url.pathname.includes(domain.pathPattern)) {
        return domain;
      }
    }
    return null;
  }
  function isImageRequest(url, request) {
    return IMAGE_EXTENSIONS_REGEX.test(url.pathname) || request.destination === "image" || shouldHandleCORS(url) !== null;
  }
  function isVideoRequest(url, request) {
    return VIDEO_EXTENSIONS_REGEX.test(url.pathname) || request.destination === "video" || url.pathname.includes("/video/") || url.hash.startsWith("#merged-video-") || // 合并视频的特殊标识
    url.hash.includes("video");
  }
  function isAudioRequest(url, request) {
    return AUDIO_EXTENSIONS_REGEX.test(url.pathname) || request.destination === "audio" || url.pathname.includes("/audio/");
  }
  function isFontRequest(url, request) {
    if (url.hostname === "fonts.googleapis.com") {
      return true;
    }
    if (url.hostname === "fonts.gstatic.com") {
      return true;
    }
    const fontExtensions = /\.(woff|woff2|ttf|otf|eot)$/i;
    return fontExtensions.test(url.pathname) || request.destination === "font";
  }
  function isGenerateContentRequest(url) {
    return url.pathname.includes(":generateContent") || url.pathname.includes(":streamGenerateContent");
  }
  function getStaticCacheName(version) {
    return `drawnix-static-v${version}`;
  }
  function createDefaultVersionState() {
    return {
      committedVersion: APP_VERSION,
      pendingVersion: null,
      pendingReadyAt: null,
      upgradeState: "idle",
      updatedAt: Date.now()
    };
  }
  function normalizeVersionState(value) {
    const raw = value || {};
    const committedVersion = typeof raw.committedVersion === "string" && raw.committedVersion ? raw.committedVersion : APP_VERSION;
    const pendingVersion = typeof raw.pendingVersion === "string" && raw.pendingVersion ? raw.pendingVersion : null;
    const pendingReadyAt = typeof raw.pendingReadyAt === "number" && Number.isFinite(raw.pendingReadyAt) ? raw.pendingReadyAt : null;
    const upgradeState = raw.upgradeState === "prewarming" || raw.upgradeState === "ready" || raw.upgradeState === "committing" ? raw.upgradeState : "idle";
    return {
      committedVersion,
      pendingVersion,
      pendingReadyAt,
      upgradeState,
      updatedAt: typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now()
    };
  }
  function openServiceWorkerDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(
        SERVICE_WORKER_DB_NAME,
        SERVICE_WORKER_DB_VERSION
      );
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(FAILED_DOMAINS_STORE)) {
          db.createObjectStore(FAILED_DOMAINS_STORE, { keyPath: "domain" });
        }
        if (!db.objectStoreNames.contains(VERSION_STATE_STORE)) {
          db.createObjectStore(VERSION_STATE_STORE, { keyPath: "key" });
        }
      };
    });
  }
  async function readVersionState() {
    try {
      const db = await openServiceWorkerDB();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction([VERSION_STATE_STORE], "readonly");
        const store = transaction.objectStore(VERSION_STATE_STORE);
        const request = store.get(VERSION_STATE_KEY);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const result = request.result;
          resolve(
            normalizeVersionState((result == null ? void 0 : result.state) || createDefaultVersionState())
          );
        };
      });
    } catch (error) {
      console.warn("Service Worker: 无法读取版本状态:", error);
      return createDefaultVersionState();
    }
  }
  async function writeVersionState(state) {
    const normalized = normalizeVersionState(state);
    try {
      const db = await openServiceWorkerDB();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction([VERSION_STATE_STORE], "readwrite");
        const store = transaction.objectStore(VERSION_STATE_STORE);
        store.put({
          key: VERSION_STATE_KEY,
          state: normalized
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } catch (error) {
      console.warn("Service Worker: 无法写入版本状态:", error);
    }
    return normalized;
  }
  async function updateVersionState(patch) {
    const current = await readVersionState();
    const nextPatch = typeof patch === "function" ? patch(current) : patch;
    return writeVersionState({
      ...current,
      ...nextPatch,
      updatedAt: Date.now()
    });
  }
  async function postVersionState(target) {
    const state = await readVersionState();
    const payload = {
      type: "SW_VERSION_STATE",
      ...state,
      swVersion: APP_VERSION
    };
    if (target) {
      target.postMessage(payload);
      return state;
    }
    const clients = await sw2.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });
    for (const client of clients) {
      client.postMessage(payload);
    }
    return state;
  }
  async function loadFailedDomains() {
    try {
      const db = await openServiceWorkerDB();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction([FAILED_DOMAINS_STORE], "readonly");
        const store = transaction.objectStore(FAILED_DOMAINS_STORE);
        const getAllRequest = store.getAll();
        getAllRequest.onsuccess = () => {
          const domains = getAllRequest.result;
          domains.forEach((item) => failedDomains.add(item.domain));
          resolve();
        };
        getAllRequest.onerror = () => reject(getAllRequest.error);
      });
    } catch (error) {
      console.warn("Service Worker: 无法加载失败域名列表:", error);
    }
  }
  async function saveFailedDomain(domain) {
    try {
      const db = await openServiceWorkerDB();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction([FAILED_DOMAINS_STORE], "readwrite");
        const store = transaction.objectStore(FAILED_DOMAINS_STORE);
        store.put({ domain, timestamp: Date.now() });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } catch (error) {
      console.warn("Service Worker: 无法保存失败域名:", error);
    }
  }
  async function markNewVersionReady(isUpdate) {
    if (!isUpdate) {
      await updateVersionState({
        committedVersion: APP_VERSION,
        pendingVersion: null,
        pendingReadyAt: null,
        upgradeState: "idle"
      });
      await postVersionState();
      return;
    }
    await updateVersionState((current) => ({
      committedVersion: current.committedVersion || APP_VERSION,
      pendingVersion: APP_VERSION,
      pendingReadyAt: Date.now(),
      upgradeState: "ready"
    }));
    const cm = getChannelManager();
    if (cm) {
      cm.sendSWNewVersionReady(APP_VERSION);
    }
    await postVersionState();
  }
  const IDLE_PREFETCH_CONCURRENCY = 2;
  const IDLE_PREFETCH_RECENT_FETCH_WINDOW_MS = 1500;
  const IDLE_PREFETCH_SWEEP_DELAY_MS = 2500;
  const IDLE_PREFETCH_FETCH_RECHECK_INTERVAL_MS = 8e3;
  const IDLE_PREFETCH_FAILURE_RETRY_BASE_DELAY_MS = 5e3;
  const IDLE_PREFETCH_FAILURE_RETRY_MAX_DELAY_MS = 6e4;
  const IDLE_PREFETCH_MANIFEST_RETRY_DELAY_MS = 5e3;
  const UPDATE_FULL_PREWARM_TIMEOUT_MS = 10 * 60 * 1e3;
  const FOLLOW_UP_IDLE_PREFETCH_GROUPS = ["offline-static-assets"];
  let lastObservedClientFetchAt = 0;
  let lastIdlePrefetchFetchKickAt = 0;
  const completedIdlePrefetchEntries = /* @__PURE__ */ new Set();
  const activeIdlePrefetchEntries = /* @__PURE__ */ new Set();
  const completedIdlePrefetchGroups = /* @__PURE__ */ new Set();
  const idlePrefetchRetryState = /* @__PURE__ */ new Map();
  let idlePrefetchTaskQueue = Promise.resolve();
  let scheduledIdlePrefetchSweepTimer = null;
  let scheduledIdlePrefetchSweepAt = 0;
  let installingVersionIsUpdate = false;
  let shouldClaimClientsOnActivate = false;
  function logSWDebug(message, detail) {
    if (detail === void 0) {
      return;
    }
  }
  function getUnavailableCDNSnapshot() {
    return getCDNStatusReport().filter((item) => item.remainingCooldownMs > 0 && !item.status.isHealthy).map((item) => ({
      name: item.name,
      failCount: item.status.failCount,
      remainingCooldownMs: item.remainingCooldownMs,
      lastFailureReason: item.status.lastFailureReason
    }));
  }
  function logStatic503Decision(stage, request, detail) {
    console.warn("[SW Static 503]", {
      stage,
      requestUrl: request.url,
      destination: request.destination,
      mode: request.mode,
      unavailableCDNs: getUnavailableCDNSnapshot(),
      ...detail
    });
  }
  let swBootProgressState = {
    phase: "idle",
    percent: 0,
    completed: 0,
    total: 0,
    failed: 0,
    version: APP_VERSION,
    updatedAt: Date.now()
  };
  async function broadcastSWBootProgress(target) {
    const payload = {
      type: "SW_BOOT_PROGRESS",
      ...swBootProgressState
    };
    if (target) {
      target.postMessage(payload);
      return;
    }
    const clients = await sw2.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });
    for (const client of clients) {
      client.postMessage(payload);
    }
  }
  function setSWBootProgress(patch, target) {
    swBootProgressState = {
      ...swBootProgressState,
      ...patch,
      version: APP_VERSION,
      updatedAt: Date.now()
    };
    void broadcastSWBootProgress(target);
  }
  async function loadPrecacheManifest() {
    try {
      const response = await fetch(
        createScopeUrl("precache-manifest.json").href,
        {
          cache: "reload"
        }
      );
      if (!response.ok) {
        logSWDebug("loadPrecacheManifest: response not ok", {
          status: response.status,
          statusText: response.statusText
        });
        return null;
      }
      const manifest = await response.json();
      logSWDebug("loadPrecacheManifest: loaded", {
        version: manifest.version,
        fileCount: manifest.files.length
      });
      if (manifest.version && manifest.version !== APP_VERSION) {
        logSWDebug("loadPrecacheManifest: version mismatch", {
          manifestVersion: manifest.version,
          workerVersion: APP_VERSION
        });
        return null;
      }
      return manifest.files;
    } catch (error) {
      logSWDebug("loadPrecacheManifest: failed", {
        error: getSafeErrorMessage(error)
      });
      return null;
    }
  }
  let idlePrefetchManifestPromise = null;
  let idlePrefetchManifestLastFailureAt = 0;
  let idlePrefetchManifestTerminalFailureVersion = null;
  function isIdlePrefetchManifestDisabled() {
    return isDevelopment;
  }
  function markIdlePrefetchManifestTerminalFailure(reason) {
    idlePrefetchManifestTerminalFailureVersion = APP_VERSION;
    idlePrefetchManifestLastFailureAt = Date.now();
  }
  function clearIdlePrefetchManifestTerminalFailure() {
    idlePrefetchManifestTerminalFailureVersion = null;
  }
  function hasTerminalIdlePrefetchManifestFailure() {
    return idlePrefetchManifestTerminalFailureVersion === APP_VERSION;
  }
  async function readResponsePreview(response, maxChars = 200) {
    try {
      const text = (await response.text()).replace(/\s+/g, " ").trim();
      if (!text) {
        return void 0;
      }
      return text.slice(0, maxChars);
    } catch {
      return void 0;
    }
  }
  async function loadIdlePrefetchManifest() {
    if (isIdlePrefetchManifestDisabled()) {
      return null;
    }
    const manifestUrl = createScopeUrl("idle-prefetch-manifest.json").href;
    try {
      const response = await fetch(manifestUrl, {
        cache: "reload"
      });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok) {
        const preview2 = await readResponsePreview(response.clone());
        logSWDebug("loadIdlePrefetchManifest: response not ok", {
          manifestUrl,
          status: response.status,
          statusText: response.statusText,
          contentType,
          preview: preview2
        });
        if (response.status === 404 || response.status === 410) {
          markIdlePrefetchManifestTerminalFailure(`status:${response.status}`);
        }
        return null;
      }
      const manifestText = await response.text();
      const preview = manifestText.replace(/\s+/g, " ").trim().slice(0, 200);
      if (contentType.includes("text/html") || /<!DOCTYPE|<html|<HTML/i.test(preview)) {
        logSWDebug("loadIdlePrefetchManifest: html fallback detected", {
          manifestUrl,
          status: response.status,
          contentType,
          preview
        });
        markIdlePrefetchManifestTerminalFailure("html-fallback");
        return null;
      }
      let manifest;
      try {
        manifest = JSON.parse(manifestText);
      } catch (error) {
        logSWDebug("loadIdlePrefetchManifest: invalid json", {
          manifestUrl,
          contentType,
          error: getSafeErrorMessage(error),
          preview
        });
        markIdlePrefetchManifestTerminalFailure("invalid-json");
        return null;
      }
      if (!manifest || typeof manifest !== "object" || !manifest.groups) {
        logSWDebug("loadIdlePrefetchManifest: invalid manifest shape", {
          manifestUrl,
          contentType,
          preview
        });
        markIdlePrefetchManifestTerminalFailure("invalid-shape");
        return null;
      }
      if (manifest.version && manifest.version !== APP_VERSION) {
        logSWDebug("loadIdlePrefetchManifest: version mismatch", {
          manifestUrl,
          manifestVersion: manifest.version,
          workerVersion: APP_VERSION
        });
        markIdlePrefetchManifestTerminalFailure(
          `version-mismatch:${manifest.version}`
        );
        return null;
      }
      clearIdlePrefetchManifestTerminalFailure();
      logSWDebug("loadIdlePrefetchManifest: loaded", {
        manifestUrl,
        version: manifest.version,
        defaults: manifest.defaults || [],
        groupEntryCounts: Object.fromEntries(
          Object.entries(manifest.groups).map(([group, entries]) => [
            group,
            entries.length
          ])
        )
      });
      return manifest;
    } catch (error) {
      logSWDebug("loadIdlePrefetchManifest: failed", {
        error: getSafeErrorMessage(error)
      });
      return null;
    }
  }
  async function getIdlePrefetchManifest() {
    if (isIdlePrefetchManifestDisabled()) {
      idlePrefetchManifestLastFailureAt = 0;
      idlePrefetchManifestPromise = null;
      clearIdlePrefetchManifestTerminalFailure();
      return null;
    }
    const now = Date.now();
    if (hasTerminalIdlePrefetchManifestFailure()) {
      return null;
    }
    if (!idlePrefetchManifestPromise) {
      if (idlePrefetchManifestLastFailureAt > 0 && now - idlePrefetchManifestLastFailureAt < IDLE_PREFETCH_MANIFEST_RETRY_DELAY_MS) {
        return null;
      }
      idlePrefetchManifestPromise = loadIdlePrefetchManifest().then((manifest) => {
        if (!manifest) {
          const terminalFailure = hasTerminalIdlePrefetchManifestFailure();
          idlePrefetchManifestLastFailureAt = Date.now();
          idlePrefetchManifestPromise = terminalFailure ? Promise.resolve(null) : null;
          return null;
        }
        idlePrefetchManifestLastFailureAt = 0;
        clearIdlePrefetchManifestTerminalFailure();
        return manifest;
      }).catch((error) => {
        idlePrefetchManifestLastFailureAt = Date.now();
        getSafeErrorMessage(error);
        idlePrefetchManifestPromise = null;
        throw error;
      });
    }
    return idlePrefetchManifestPromise;
  }
  async function broadcastIdlePrefetchStatus(target) {
    const payload = {
      type: "SW_IDLE_PREFETCH_STATUS",
      completedGroups: Array.from(completedIdlePrefetchGroups),
      version: APP_VERSION,
      updatedAt: Date.now()
    };
    if (target) {
      logSWDebug("broadcast idle prefetch status to target client", {
        clientId: target.id,
        completedGroups: payload.completedGroups
      });
      target.postMessage(payload);
      return;
    }
    const clients = await sw2.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });
    for (const client of clients) {
      client.postMessage(payload);
    }
    logSWDebug("broadcast idle prefetch status to all clients", {
      clientCount: clients.length,
      completedGroups: payload.completedGroups
    });
  }
  function createIdlePrefetchEntryKey(url, revision) {
    return `${url}@${revision}`;
  }
  async function getCacheEntryCount(cache) {
    try {
      return (await cache.keys()).length;
    } catch {
      return -1;
    }
  }
  function enqueueIdlePrefetchTask(label, task) {
    const run = idlePrefetchTaskQueue.catch(() => void 0).then(async () => {
      try {
        await task();
      } finally {
      }
    });
    idlePrefetchTaskQueue = run.catch((error) => {
      console.warn("[SWDebug] idle prefetch task failed", {
        label,
        error: getSafeErrorMessage(error)
      });
    });
    return run;
  }
  function getIdlePrefetchRetryDelayMs(failureCount) {
    return Math.min(
      IDLE_PREFETCH_FAILURE_RETRY_MAX_DELAY_MS,
      IDLE_PREFETCH_FAILURE_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, failureCount - 1)
    );
  }
  function getOrderedIdlePrefetchGroups(manifest, preferredGroups = []) {
    const ordered = [];
    const seen = /* @__PURE__ */ new Set();
    const push = (groupName) => {
      if (!groupName || seen.has(groupName) || (manifest.groups[groupName] || []).length === 0) {
        return;
      }
      seen.add(groupName);
      ordered.push(groupName);
    };
    preferredGroups.forEach(push);
    (manifest.defaults || []).forEach(push);
    FOLLOW_UP_IDLE_PREFETCH_GROUPS.forEach(push);
    Object.keys(manifest.groups).forEach(push);
    return ordered;
  }
  function resolveIdlePrefetchRunState(manifest, groupNames) {
    const now = Date.now();
    const files = /* @__PURE__ */ new Map();
    const completedGroups = [];
    const pendingGroups = [];
    let coolingEntries = 0;
    let nextRetryDelayMs = null;
    for (const groupName of groupNames) {
      const entries = manifest.groups[groupName] || [];
      if (entries.length === 0) {
        continue;
      }
      let groupPending = false;
      for (const entry of entries) {
        const entryKey = createIdlePrefetchEntryKey(entry.url, entry.revision);
        if (completedIdlePrefetchEntries.has(entryKey)) {
          continue;
        }
        groupPending = true;
        if (activeIdlePrefetchEntries.has(entryKey)) {
          continue;
        }
        const retryState = idlePrefetchRetryState.get(entryKey);
        if (retryState && retryState.nextRetryAt > now) {
          coolingEntries += 1;
          const retryDelayMs = Math.max(0, retryState.nextRetryAt - now);
          nextRetryDelayMs = nextRetryDelayMs === null ? retryDelayMs : Math.min(nextRetryDelayMs, retryDelayMs);
          continue;
        }
        files.set(entryKey, entry);
      }
      if (groupPending) {
        pendingGroups.push(groupName);
      } else {
        completedGroups.push(groupName);
      }
    }
    return {
      completedGroups,
      pendingGroups,
      queue: Array.from(files.entries()),
      coolingEntries,
      nextRetryDelayMs
    };
  }
  function scheduleIdlePrefetchSweep(reason, delayMs = IDLE_PREFETCH_SWEEP_DELAY_MS) {
    const safeDelayMs = Math.max(0, Math.round(delayMs));
    const targetAt = Date.now() + safeDelayMs;
    if (scheduledIdlePrefetchSweepTimer !== null) {
      if (scheduledIdlePrefetchSweepAt <= targetAt) {
        return;
      }
      clearTimeout(scheduledIdlePrefetchSweepTimer);
      scheduledIdlePrefetchSweepTimer = null;
      scheduledIdlePrefetchSweepAt = 0;
    }
    scheduledIdlePrefetchSweepAt = targetAt;
    scheduledIdlePrefetchSweepTimer = self.setTimeout(() => {
      scheduledIdlePrefetchSweepTimer = null;
      scheduledIdlePrefetchSweepAt = 0;
      void enqueueIdlePrefetchTask(`idle-sweep:${reason}`, async () => {
        await prefetchPendingIdleGroups(`scheduled:${reason}`);
      });
    }, safeDelayMs);
  }
  function shouldDeferIdlePrefetch() {
    if (lastObservedClientFetchAt === 0) {
      return false;
    }
    return Date.now() - lastObservedClientFetchAt < IDLE_PREFETCH_RECENT_FETCH_WINDOW_MS;
  }
  function waitForIdlePrefetchWindow() {
    if (lastObservedClientFetchAt === 0) {
      return Promise.resolve();
    }
    const elapsed = Date.now() - lastObservedClientFetchAt;
    const waitMs = Math.max(0, IDLE_PREFETCH_RECENT_FETCH_WINDOW_MS - elapsed) + 100;
    return new Promise((resolve) => {
      setTimeout(resolve, waitMs);
    });
  }
  function shouldKickIdlePrefetchFromFetch(event, url) {
    if (hasTerminalIdlePrefetchManifestFailure()) {
      return false;
    }
    const scopeRelativePathname = getScopeRelativePathname(url.pathname);
    if (event.request.method !== "GET" || !event.clientId || url.origin !== self.location.origin) {
      return false;
    }
    if (url.pathname.startsWith(CACHE_URL_PREFIX) || url.pathname.startsWith(AI_GENERATED_AUDIO_CACHE_PREFIX) || scopeRelativePathname === "/sw.js" || scopeRelativePathname === "/precache-manifest.json" || scopeRelativePathname === "/idle-prefetch-manifest.json") {
      return false;
    }
    const now = Date.now();
    if (now - lastIdlePrefetchFetchKickAt < IDLE_PREFETCH_FETCH_RECHECK_INTERVAL_MS) {
      return false;
    }
    lastIdlePrefetchFetchKickAt = now;
    return true;
  }
  function isOriginFirstStaticPath(pathname) {
    return shouldUseOriginFirstPreload(getScopeRelativePathname(pathname));
  }
  function isVersionedStaticResource(request, url) {
    if (isDevelopment || request.method !== "GET") {
      return false;
    }
    if (request.mode === "navigate" || request.destination === "document") {
      return false;
    }
    if (isOriginFirstStaticPath(url.pathname)) {
      return false;
    }
    return Boolean(
      url.pathname.match(
        /\.(js|css|png|jpg|jpeg|gif|webp|svg|woff|woff2|ttf|eot|json|ico)$/i
      ) || request.destination === "script" || request.destination === "style" || request.destination === "image" || request.destination === "font"
    );
  }
  function normalizeAituPackageResourcePath(pathnameWithSearch) {
    const [pathname, search = ""] = pathnameWithSearch.split(/([?#].*)/, 2);
    const normalizedPathname = pathname.replace(/^\/npm\/aitu-app@[^/]+\//, "/").replace(/^\/aitu-app@[^/]+\//, "/");
    return `${normalizedPathname}${search}`;
  }
  function normalizeScopedResourcePath(pathnameWithSearch) {
    const [pathname, search = ""] = pathnameWithSearch.split(/([?#].*)/, 2);
    return `${getScopeRelativePathname(pathname)}${search}`;
  }
  function resolveStaticResourceFetchTargets(inputUrl) {
    const requestUrl = new URL(inputUrl, self.location.origin);
    const resourcePath = normalizeAituPackageResourcePath(
      normalizeScopedResourcePath(`${requestUrl.pathname}${requestUrl.search}`)
    );
    const normalizedResourceUrl = createScopeUrl(resourcePath);
    return {
      requestUrl,
      resourcePath,
      cacheKey: normalizedResourceUrl.href,
      // 源站兜底始终回到当前 origin，避免被上游传入的绝对 URL 带偏。
      originFetchUrl: normalizedResourceUrl.href
    };
  }
  function isStaticHtmlFallbackResponse(request, url, response) {
    const contentType = response.headers.get("Content-Type") || "";
    return response.status === 200 && contentType.includes("text/html") && isVersionedStaticResource(request, url);
  }
  function decorateStaticCacheResponse(response, metadata) {
    const headers = new Headers(response.headers);
    headers.set(STATIC_SOURCE_HEADER, metadata.source);
    headers.set(STATIC_REVISION_HEADER, metadata.revision);
    headers.set(STATIC_APP_VERSION_HEADER, metadata.appVersion || APP_VERSION);
    if (metadata.fetchTarget) {
      headers.set(STATIC_FETCH_TARGET_HEADER, metadata.fetchTarget);
    }
    headers.set("x-sw-cached-at", (/* @__PURE__ */ new Date()).toISOString());
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
  async function cacheStaticResponse(cache, request, response, metadata) {
    const cachedResponse = decorateStaticCacheResponse(response, metadata);
    await cache.put(request, cachedResponse.clone());
    return cachedResponse;
  }
  async function findStaticResponseInOldCaches(request, fallbackKeys = []) {
    const normalizedFallbackKeys = fallbackKeys.filter(
      (key) => Boolean(key) && key !== request.url
    );
    const allCacheNames = await caches.keys();
    for (const cacheName of allCacheNames) {
      if (cacheName.startsWith("drawnix-static-v")) {
        try {
          const oldCache = await caches.open(cacheName);
          const oldCachedResponse = await oldCache.match(request);
          if (oldCachedResponse) {
            return oldCachedResponse;
          }
          for (const fallbackKey of normalizedFallbackKeys) {
            const fallbackResponse = await oldCache.match(fallbackKey);
            if (fallbackResponse) {
              logSWDebug("findStaticResponseInOldCaches: normalized key hit", {
                cacheName,
                requestUrl: request.url,
                normalizedCacheKey: fallbackKey
              });
              return fallbackResponse;
            }
          }
        } catch {
        }
      }
    }
    return null;
  }
  async function findStaticResponseInBrowserCache(request, fallbackKeys = []) {
    const candidates = [request.url, ...fallbackKeys].filter(Boolean);
    for (const candidate of candidates) {
      try {
        const cachedResponse = await fetch(candidate, {
          cache: "only-if-cached",
          mode: "same-origin"
        });
        if (cachedResponse.ok) {
          return cachedResponse;
        }
      } catch {
      }
    }
    return null;
  }
  async function matchStaticCacheEntry(cache, request) {
    const normalizedCacheKey = resolveStaticResourceFetchTargets(
      request.url
    ).cacheKey;
    const directResponse = await cache.match(request);
    if (directResponse) {
      return {
        response: directResponse,
        normalizedCacheKey,
        matchedBy: "request"
      };
    }
    if (normalizedCacheKey !== request.url) {
      const normalizedResponse = await cache.match(normalizedCacheKey);
      if (normalizedResponse) {
        return {
          response: normalizedResponse,
          normalizedCacheKey,
          matchedBy: "normalized"
        };
      }
    }
    return {
      response: null,
      normalizedCacheKey,
      matchedBy: null
    };
  }
  async function deleteStaticCacheLookupKeys(cache, request, normalizedCacheKey) {
    await cache.delete(request);
    if (normalizedCacheKey !== request.url) {
      await cache.delete(normalizedCacheKey);
    }
  }
  async function cacheFile(cache, url, revision) {
    try {
      const targets = resolveStaticResourceFetchTargets(url);
      const cachedResponse = await cache.match(targets.cacheKey);
      if (cachedResponse) {
        const cachedRevision = cachedResponse.headers.get(STATIC_REVISION_HEADER);
        const cachedVersion = cachedResponse.headers.get(
          STATIC_APP_VERSION_HEADER
        );
        if (cachedRevision === revision && cachedVersion === APP_VERSION) {
          return { url, success: true, skipped: true };
        }
      }
      let response = null;
      let source = "server";
      let fetchTarget = targets.originFetchUrl;
      if (shouldUseCDNFirstPreload(
        getScopeRelativePathname(targets.requestUrl.pathname)
      )) {
        const cdnResult = await fetchFromCDNWithFallback(
          targets.resourcePath,
          APP_VERSION,
          SW_SCOPE_BASE_URL.href.replace(/\/$/, ""),
          {
            preferLocal: false,
            requestKind: "background-prefetch"
          }
        );
        if (cdnResult == null ? void 0 : cdnResult.response.ok) {
          response = cdnResult.response;
          source = cdnResult.source;
          fetchTarget = cdnResult.targetUrl;
        }
      }
      if (!response) {
        response = await fetch(targets.originFetchUrl, { cache: "reload" });
        source = "server";
        fetchTarget = targets.originFetchUrl;
      }
      if (response.ok && isStaticHtmlFallbackResponse(
        new Request(targets.cacheKey, { method: "GET" }),
        targets.requestUrl,
        response
      )) {
        return {
          url,
          success: false,
          status: 404,
          error: "html-fallback-for-static-resource"
        };
      }
      if (response.ok) {
        await cacheStaticResponse(cache, targets.cacheKey, response, {
          source,
          revision,
          fetchTarget,
          appVersion: APP_VERSION
        });
        if (targets.resourcePath === "/index.html") {
          const rootUrl = createScopeUrl("/").href;
          const rootResponse = await cache.match(targets.cacheKey);
          if (rootResponse) {
            await cache.put(rootUrl, rootResponse.clone());
          }
        }
        return { url, success: true, source };
      }
      return { url, success: false, status: response.status };
    } catch (error) {
      return { url, success: false, error: String(error) };
    }
  }
  async function precacheStaticFiles(cache, files) {
    const CONCURRENCY = 6;
    const allResults = [];
    const total = files.length;
    let completed = 0;
    let failed = 0;
    await getCacheEntryCount(cache);
    logSWDebug("precacheStaticFiles start", {
      sampleUrls: files.slice(0, 8).map((file) => file.url)
    });
    setSWBootProgress({
      phase: "precache",
      total,
      completed: 0,
      failed: 0,
      percent: total > 0 ? 0 : 100,
      message: total > 0 ? `正在预热启动资源（0/${total}）...` : "没有需要预热的启动资源"
    });
    for (let i2 = 0; i2 < files.length; i2 += CONCURRENCY) {
      const batch = files.slice(i2, i2 + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(({ url, revision }) => cacheFile(cache, url, revision))
      );
      const batchResults = [];
      for (const result of results) {
        if (result.status === "fulfilled") {
          const value = {
            url: result.value.url,
            success: result.value.success,
            skipped: result.value.skipped,
            source: result.value.source,
            status: result.value.status,
            error: result.value.error
          };
          allResults.push(value);
          batchResults.push(value);
          completed += 1;
          if (!result.value.success) {
            failed += 1;
          }
        } else {
          const failedValue = {
            success: false,
            error: String(result.reason)
          };
          allResults.push(failedValue);
          batchResults.push(failedValue);
          completed += 1;
          failed += 1;
        }
      }
      logSWDebug("precacheStaticFiles batch done", {
        batchSize: batch.length,
        batchSuccess: batchResults.filter((item) => item.success).length,
        batchSkipped: batchResults.filter((item) => item.skipped).length,
        batchFailed: batchResults.filter((item) => !item.success).length,
        batchSources: Object.fromEntries(
          Array.from(
            batchResults.reduce((acc, item) => {
              const key = item.source || "unknown";
              acc.set(key, (acc.get(key) || 0) + 1);
              return acc;
            }, /* @__PURE__ */ new Map())
          )
        ),
        batchErrors: batchResults.filter((item) => !item.success).slice(0, 5).map((item) => ({
          url: item.url,
          status: item.status,
          error: item.error
        }))
      });
      setSWBootProgress({
        phase: "precache",
        total,
        completed,
        failed,
        percent: total > 0 ? Math.round(completed / total * 100) : 100,
        message: total > 0 ? `正在预热启动资源（${completed}/${total}${failed > 0 ? `，${failed} 项回退` : ""}）...` : "没有需要预热的启动资源"
      });
    }
    const successCount = allResults.filter((r2) => r2.success).length;
    const failCount = allResults.length - successCount;
    const cdnCount = allResults.filter(
      (r2) => r2.success && r2.source && r2.source !== "server"
    ).length;
    const serverCount = allResults.filter(
      (r2) => r2.success && r2.source === "server"
    ).length;
    await getCacheEntryCount(cache);
    return {
      total,
      successCount,
      failCount,
      cdnCount,
      serverCount
    };
  }
  async function prefetchIdleGroups(groupNames) {
    if (groupNames.length === 0) {
      return {
        completedGroups: [],
        pendingGroups: [],
        queuedEntries: 0,
        coolingEntries: 0,
        nextRetryDelayMs: null
      };
    }
    const manifest = await getIdlePrefetchManifest();
    if (!manifest) {
      return {
        completedGroups: [],
        pendingGroups: [],
        queuedEntries: 0,
        coolingEntries: 0,
        nextRetryDelayMs: null
      };
    }
    logSWDebug("prefetchIdleGroups manifest summary", {
      groupEntryCounts: Object.fromEntries(
        groupNames.map((groupName) => {
          var _a;
          return [
            groupName,
            ((_a = manifest.groups[groupName]) == null ? void 0 : _a.length) || 0
          ];
        })
      ),
      defaults: manifest.defaults || []
    });
    const completedGroupsBeforeRun = new Set(completedIdlePrefetchGroups);
    const initialState = resolveIdlePrefetchRunState(manifest, groupNames);
    initialState.completedGroups.forEach(
      (groupName) => completedIdlePrefetchGroups.add(groupName)
    );
    if (initialState.queue.length === 0) {
      logSWDebug("prefetchIdleGroups no ready files", {
        completedEntries: completedIdlePrefetchEntries.size,
        activeEntries: activeIdlePrefetchEntries.size
      });
      return {
        completedGroups: initialState.completedGroups,
        pendingGroups: initialState.pendingGroups,
        queuedEntries: 0,
        coolingEntries: initialState.coolingEntries,
        nextRetryDelayMs: initialState.nextRetryDelayMs
      };
    }
    const cache = await caches.open(STATIC_CACHE_NAME);
    await getCacheEntryCount(cache);
    const queue = initialState.queue;
    logSWDebug("prefetchIdleGroups queue prepared", {
      totalCandidates: initialState.queue.length,
      queuedEntries: queue.length,
      sampleUrls: queue.slice(0, 8).map(([, entry]) => entry.url)
    });
    for (let index = 0; index < queue.length; index += IDLE_PREFETCH_CONCURRENCY) {
      while (shouldDeferIdlePrefetch()) {
        await waitForIdlePrefetchWindow();
      }
      const batch = queue.slice(index, index + IDLE_PREFETCH_CONCURRENCY);
      batch.forEach(([entryKey]) => activeIdlePrefetchEntries.add(entryKey));
      const results = await Promise.allSettled(
        batch.map(([, { url, revision }]) => cacheFile(cache, url, revision))
      );
      const batchResults = [];
      results.forEach((result, batchIndex) => {
        const [entryKey] = batch[batchIndex];
        activeIdlePrefetchEntries.delete(entryKey);
        if (result.status === "fulfilled" && result.value.success) {
          idlePrefetchRetryState.delete(entryKey);
          completedIdlePrefetchEntries.add(entryKey);
        } else {
          const previous = idlePrefetchRetryState.get(entryKey);
          const nextCount = ((previous == null ? void 0 : previous.count) || 0) + 1;
          const retryDelayMs = getIdlePrefetchRetryDelayMs(nextCount);
          idlePrefetchRetryState.set(entryKey, {
            count: nextCount,
            nextRetryAt: Date.now() + retryDelayMs,
            lastError: result.status === "fulfilled" ? result.value.error : String(result.reason),
            lastStatus: result.status === "fulfilled" ? result.value.status : void 0
          });
        }
        if (result.status === "fulfilled") {
          batchResults.push({
            url: result.value.url,
            success: result.value.success,
            skipped: result.value.skipped,
            source: result.value.source,
            status: result.value.status,
            error: result.value.error
          });
        } else {
          batchResults.push({
            success: false,
            error: String(result.reason)
          });
        }
      });
      logSWDebug("prefetchIdleGroups batch done", {
        batchSize: batch.length,
        batchSuccess: batchResults.filter((item) => item.success).length,
        batchSkipped: batchResults.filter((item) => item.skipped).length,
        batchFailed: batchResults.filter((item) => !item.success).length,
        batchSources: Object.fromEntries(
          Array.from(
            batchResults.reduce((acc, item) => {
              const key = item.source || "unknown";
              acc.set(key, (acc.get(key) || 0) + 1);
              return acc;
            }, /* @__PURE__ */ new Map())
          )
        ),
        batchErrors: batchResults.filter((item) => !item.success).slice(0, 5).map((item) => ({
          url: item.url,
          status: item.status,
          error: item.error
        })),
        completedEntries: completedIdlePrefetchEntries.size,
        activeEntries: activeIdlePrefetchEntries.size
      });
    }
    const finalState = resolveIdlePrefetchRunState(manifest, groupNames);
    const newlyCompletedGroups = finalState.completedGroups.filter(
      (groupName) => !completedGroupsBeforeRun.has(groupName)
    );
    newlyCompletedGroups.forEach(
      (groupName) => completedIdlePrefetchGroups.add(groupName)
    );
    await getCacheEntryCount(cache);
    logSWDebug("prefetchIdleGroups finished", {
      completedEntries: completedIdlePrefetchEntries.size,
      completedGroups: Array.from(completedIdlePrefetchGroups)
    });
    return {
      completedGroups: newlyCompletedGroups,
      pendingGroups: finalState.pendingGroups,
      queuedEntries: queue.length,
      coolingEntries: finalState.coolingEntries,
      nextRetryDelayMs: finalState.nextRetryDelayMs
    };
  }
  async function prefetchPendingIdleGroups(reason, preferredGroups = []) {
    if (isIdlePrefetchManifestDisabled()) {
      return {
        completedGroups: [],
        pendingGroups: [],
        queuedEntries: 0,
        coolingEntries: 0,
        nextRetryDelayMs: null
      };
    }
    const manifest = await getIdlePrefetchManifest();
    if (!manifest) {
      const isTerminalFailure = hasTerminalIdlePrefetchManifestFailure();
      if (!isTerminalFailure) {
        scheduleIdlePrefetchSweep(
          `${reason}:manifest-missing`,
          IDLE_PREFETCH_MANIFEST_RETRY_DELAY_MS
        );
      }
      return {
        completedGroups: [],
        pendingGroups: [],
        queuedEntries: 0,
        coolingEntries: 0,
        nextRetryDelayMs: isTerminalFailure ? null : IDLE_PREFETCH_MANIFEST_RETRY_DELAY_MS
      };
    }
    const orderedGroups = getOrderedIdlePrefetchGroups(manifest, preferredGroups);
    if (orderedGroups.length === 0) {
      return {
        completedGroups: [],
        pendingGroups: [],
        queuedEntries: 0,
        coolingEntries: 0,
        nextRetryDelayMs: null
      };
    }
    logSWDebug("prefetchPendingIdleGroups start", {
      groupEntryCounts: Object.fromEntries(
        orderedGroups.map((group) => {
          var _a;
          return [group, ((_a = manifest.groups[group]) == null ? void 0 : _a.length) || 0];
        })
      )
    });
    const summary = await prefetchIdleGroups(orderedGroups);
    if (summary.completedGroups.length > 0) {
      await broadcastIdlePrefetchStatus();
    }
    if (summary.pendingGroups.length > 0) {
      scheduleIdlePrefetchSweep(
        `${reason}:pending`,
        summary.nextRetryDelayMs ?? IDLE_PREFETCH_SWEEP_DELAY_MS
      );
    }
    return summary;
  }
  async function prefetchDefaultIdleGroups() {
    var _a;
    if (isIdlePrefetchManifestDisabled()) {
      return;
    }
    const manifest = await getIdlePrefetchManifest();
    if (!manifest) {
      const isTerminalFailure = hasTerminalIdlePrefetchManifestFailure();
      if (!isTerminalFailure) {
        scheduleIdlePrefetchSweep(
          "default-groups:manifest-missing",
          IDLE_PREFETCH_MANIFEST_RETRY_DELAY_MS
        );
      }
      return;
    }
    const defaultGroups = (_a = manifest == null ? void 0 : manifest.defaults) == null ? void 0 : _a.filter(
      (group) => typeof group === "string" && group.length > 0
    );
    if (!defaultGroups || defaultGroups.length === 0) {
      return;
    }
    await prefetchPendingIdleGroups("default-groups", defaultGroups);
  }
  async function prewarmAllIdlePrefetchGroupsForUpdateReady() {
    if (isIdlePrefetchManifestDisabled()) {
      return;
    }
    const startedAt = Date.now();
    let orderedGroups = null;
    while (true) {
      if (!orderedGroups) {
        const manifest = await getIdlePrefetchManifest();
        if (!manifest) {
          return;
        }
        orderedGroups = getOrderedIdlePrefetchGroups(manifest);
        if (orderedGroups.length === 0) {
          return;
        }
      }
      const summary = await prefetchIdleGroups(orderedGroups);
      if (summary.completedGroups.length > 0) {
        await broadcastIdlePrefetchStatus();
      }
      if (summary.pendingGroups.length === 0) {
        return;
      }
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= UPDATE_FULL_PREWARM_TIMEOUT_MS) {
        throw new Error(
          `idle-prefetch incomplete after ${elapsedMs}ms: pending groups ${summary.pendingGroups.join(
            ", "
          )}`
        );
      }
      const waitMs = Math.max(
        250,
        summary.nextRetryDelayMs ?? (summary.queuedEntries > 0 ? IDLE_PREFETCH_SWEEP_DELAY_MS : 1e3)
      );
      logSWDebug(
        "prewarmAllIdlePrefetchGroupsForUpdateReady waiting next round",
        {
          pendingGroups: summary.pendingGroups,
          coolingEntries: summary.coolingEntries,
          queuedEntries: summary.queuedEntries
        }
      );
      await new Promise((resolve) => {
        setTimeout(resolve, waitMs);
      });
    }
  }
  sw2.addEventListener("install", (event) => {
    installingVersionIsUpdate = Boolean(sw2.registration.active);
    shouldClaimClientsOnActivate = !installingVersionIsUpdate;
    if (!installingVersionIsUpdate) {
      sw2.skipWaiting();
    }
    setSWBootProgress({
      phase: "installing",
      percent: 0,
      completed: 0,
      total: 0,
      failed: 0,
      message: "正在读取启动资源清单..."
    });
    event.waitUntil(
      (async () => {
        await loadFailedDomains();
        await updateVersionState((current) => ({
          committedVersion: current.committedVersion || APP_VERSION,
          pendingVersion: installingVersionIsUpdate ? APP_VERSION : null,
          pendingReadyAt: null,
          upgradeState: installingVersionIsUpdate ? "prewarming" : "idle"
        }));
        await postVersionState();
        try {
          const files = await loadPrecacheManifest();
          if (files && files.length > 0) {
            const cache = await caches.open(STATIC_CACHE_NAME);
            const precacheSummary = await precacheStaticFiles(cache, files);
            if (installingVersionIsUpdate && precacheSummary.failCount > 0) {
              throw new Error(
                `precache incomplete: ${precacheSummary.failCount}/${precacheSummary.total} files failed`
              );
            }
          } else if (isDevelopment) {
            setSWBootProgress({
              phase: "development",
              percent: 100,
              completed: 0,
              total: 0,
              failed: 0,
              message: "开发模式下跳过静态预缓存"
            });
          }
          if (installingVersionIsUpdate) {
            void enqueueIdlePrefetchTask("update-ready-follow-up", async () => {
              await prewarmAllIdlePrefetchGroupsForUpdateReady();
            });
          }
          await markNewVersionReady(installingVersionIsUpdate);
        } catch (err) {
          await updateVersionState((current) => ({
            committedVersion: current.committedVersion || APP_VERSION,
            pendingVersion: null,
            pendingReadyAt: null,
            upgradeState: "idle"
          }));
          await postVersionState();
          setSWBootProgress({
            phase: "error",
            message: `启动资源预热失败：${getSafeErrorMessage(err)}`
          });
          console.warn("Service Worker: Precache failed:", err);
        }
      })()
    );
  });
  sw2.addEventListener("activate", (event) => {
    setSWBootProgress({
      phase: "activating",
      percent: 100,
      message: "启动缓存服务正在接管页面..."
    });
    event.waitUntil(
      (async () => {
        await readVersionState();
        await updateVersionState({
          committedVersion: APP_VERSION,
          pendingVersion: null,
          pendingReadyAt: null,
          upgradeState: "idle"
        });
        await postVersionState();
        try {
          const { ensureCDNPreferenceLoaded: ensureCDNPreferenceLoaded2 } = await Promise.resolve().then(() => cdnFallback);
          await ensureCDNPreferenceLoaded2();
        } catch (error) {
          console.warn("Failed to load persisted CDN preference:", error);
        }
        if (shouldClaimClientsOnActivate) {
          await sw2.clients.claim();
        }
        setTimeout(() => {
          void enqueueIdlePrefetchTask(
            "default-groups",
            async () => prefetchDefaultIdleGroups()
          );
        }, 800);
        const cm = getChannelManager();
        if (cm) {
          cm.sendSWActivated(APP_VERSION);
        }
        setSWBootProgress({
          phase: "activated",
          percent: 100,
          message: "启动缓存服务已就绪"
        });
      })()
    );
    event.waitUntil(
      caches.keys().then(async (cacheNames) => {
        const legacyImageCaches = cacheNames.filter(
          (name) => name.startsWith("drawnix-images-v") && name !== IMAGE_CACHE_NAME
        );
        if (legacyImageCaches.length > 0) {
          const newImageCache = await caches.open(IMAGE_CACHE_NAME);
          for (const legacyCacheName of legacyImageCaches) {
            try {
              const legacyCache = await caches.open(legacyCacheName);
              const requests = await legacyCache.keys();
              for (const request of requests) {
                const response = await legacyCache.match(request);
                if (response) {
                  await newImageCache.put(request, response);
                }
              }
              await caches.delete(legacyCacheName);
            } catch (error) {
              console.warn(`Failed to migrate cache ${legacyCacheName}:`, error);
            }
          }
        }
        const currentVersionState = await readVersionState();
        const committedStaticCacheName = getStaticCacheName(
          currentVersionState.committedVersion || APP_VERSION
        );
        const oldStaticCaches = cacheNames.filter(
          (name) => name.startsWith("drawnix-static-v") && name !== STATIC_CACHE_NAME && name !== committedStaticCacheName
        );
        const oldAppCaches = cacheNames.filter(
          (name) => name.startsWith("drawnix-v") && name !== CACHE_NAME && name !== IMAGE_CACHE_NAME && !name.startsWith("drawnix-static-v")
        );
        try {
          const currentStaticCache = await caches.open(STATIC_CACHE_NAME);
          await purgeSuspiciousStaticCacheEntries(currentStaticCache);
        } catch (error) {
          console.warn("Failed to purge suspicious static cache entries:", error);
        }
        if (oldStaticCaches.length > 0 || oldAppCaches.length > 0) {
          setTimeout(async () => {
            for (const cacheName of [...oldStaticCaches, ...oldAppCaches]) {
              try {
                await caches.delete(cacheName);
              } catch (error) {
                console.warn("Failed to delete old cache:", cacheName, error);
              }
            }
          }, 3e4);
        }
        cleanupExpiredConsoleLogs().catch((err) => {
          console.warn("Failed to cleanup expired console logs:", err);
        });
        taskQueueStorage.archiveOldTasks(100).catch((err) => {
          console.warn("Failed to archive old tasks:", err);
        });
      })
    );
  });
  function broadcastPostMessageLog(entry) {
    if (debugModeEnabled) {
      const cm = getChannelManager();
      if (cm) {
        cm.sendPostMessageLog(entry);
      }
    }
  }
  async function tryFetchStaticResourceFromCDN(cache, request, resourcePath, appVersion) {
    if (isDevelopment) {
      return null;
    }
    try {
      const targets = resolveStaticResourceFetchTargets(request.url);
      const cdnResult = await fetchFromCDNWithFallback(
        resourcePath,
        appVersion,
        SW_SCOPE_BASE_URL.href.replace(/\/$/, ""),
        {
          // 运行时 hash 资源优先走 CDN，失败后再回源站兜底。
          preferLocal: false,
          requestKind: "interactive-runtime"
        }
      );
      if (!(cdnResult == null ? void 0 : cdnResult.response.ok)) {
        console.warn(
          "[SW CDN] Static resource unavailable from all fallback sources",
          {
            requestUrl: request.url,
            resourcePath,
            appVersion,
            unavailableCDNs: getUnavailableCDNSnapshot()
          }
        );
        return null;
      }
      const requestUrl = new URL(request.url);
      if (isStaticHtmlFallbackResponse(request, requestUrl, cdnResult.response)) {
        return null;
      }
      const cachedResponse = await cacheStaticResponse(
        cache,
        targets.cacheKey,
        cdnResult.response,
        {
          source: cdnResult.source,
          revision: "runtime",
          fetchTarget: cdnResult.targetUrl,
          appVersion
        }
      );
      if (targets.cacheKey !== request.url) {
        logSWDebug("tryFetchStaticResourceFromCDN: cached under normalized key", {
          requestUrl: request.url,
          normalizedCacheKey: targets.cacheKey,
          resourcePath,
          source: cdnResult.source,
          fetchTarget: cdnResult.targetUrl
        });
      }
      return cachedResponse;
    } catch (cdnError) {
      console.warn("[SW CDN] CDN fallback failed:", cdnError);
      return null;
    }
  }
  function getStaticDebugMetadata(response) {
    const resourceSource = response.headers.get(STATIC_SOURCE_HEADER) || void 0;
    const resourceFetchTarget = response.headers.get(STATIC_FETCH_TARGET_HEADER) || void 0;
    return {
      resourceSource,
      resourceFetchTarget
    };
  }
  function isSuspiciousStaticCacheResponse(request, response, expectedVersion = APP_VERSION) {
    const sourceHeader = response.headers.get(STATIC_SOURCE_HEADER);
    const revisionHeader = response.headers.get(STATIC_REVISION_HEADER);
    const versionHeader = response.headers.get(STATIC_APP_VERSION_HEADER);
    if (!sourceHeader || !revisionHeader || !versionHeader) {
      const responseUrl = new URL(request.url);
      if (response.ok && !isStaticHtmlFallbackResponse(request, responseUrl, response)) {
        return false;
      }
      return true;
    }
    if (versionHeader !== expectedVersion) {
      return true;
    }
    if (sourceHeader !== "server" && sourceHeader !== "local" && sourceHeader !== "jsdelivr") {
      return true;
    }
    const requestUrl = new URL(request.url);
    return isStaticHtmlFallbackResponse(request, requestUrl, response);
  }
  async function purgeSuspiciousStaticCacheEntries(cache) {
    const requests = await cache.keys();
    for (const request of requests) {
      try {
        const response = await cache.match(request);
        if (response && isSuspiciousStaticCacheResponse(request, response)) {
          await cache.delete(request);
        }
      } catch (error) {
        console.warn(
          "Service Worker: Failed to inspect static cache entry:",
          error
        );
      }
    }
  }
  sw2.addEventListener("message", (event) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
    const messageType = ((_a = event.data) == null ? void 0 : _a.type) || ((_b = event.data) == null ? void 0 : _b.cmdname) || ((_d = (_c = event.data) == null ? void 0 : _c.req) == null ? void 0 : _d.cmdname) || "unknown";
    const clientId = ((_e = event.source) == null ? void 0 : _e.id) || "";
    const clientUrl = ((_f = event.source) == null ? void 0 : _f.url) || "";
    const isDuplexMessage = ((_g = event.data) == null ? void 0 : _g.cmdname) || ((_h = event.data) == null ? void 0 : _h.requestId) && ((_i = event.data) == null ? void 0 : _i.ret) !== void 0;
    let logId = "";
    if (isPostMessageLoggerDebugMode() && !isDuplexMessage) {
      logId = logReceivedMessage(
        messageType,
        event.data,
        clientId,
        clientUrl,
        (_j = event.data) == null ? void 0 : _j.__internal__
      );
      if (logId && debugModeEnabled) {
        const logs2 = getAllLogs();
        const entry = logs2.find((l2) => l2.id === logId);
        if (entry) {
          broadcastPostMessageLog(entry);
        }
      }
    }
    if (event.data && event.data.type === "GENERATE_THUMBNAIL") {
      const { url, mediaType, blob: arrayBuffer, mimeType } = event.data;
      if (url && mediaType && arrayBuffer) {
        const blob = new Blob([arrayBuffer], {
          type: mimeType || (mediaType === "video" ? "video/mp4" : "image/png")
        });
        (async () => {
          const { generateThumbnailAsync: generateThumbnailAsync2 } = await Promise.resolve().then(() => thumbnailUtils);
          generateThumbnailAsync2(blob, url, mediaType);
        })();
      }
      return;
    }
    if (event.data && event.data.type === "SW_CDN_SET_PREFERENCE") {
      event.waitUntil(
        setCDNPreference({
          cdn: event.data.cdn,
          latency: event.data.latency,
          timestamp: event.data.timestamp,
          version: event.data.version
        })
      );
      return;
    }
    if (event.data && event.data.type === "RECOVER_DYNAMIC_IMPORT_FAILURE") {
      event.waitUntil(
        caches.keys().then(
          (cacheNames) => Promise.all(
            cacheNames.filter((name) => name.startsWith("drawnix-static-v")).map((name) => caches.delete(name))
          ).then(() => {
            logSWDebug("message: RECOVER_DYNAMIC_IMPORT_FAILURE", {
              appVersion: event.data.appVersion,
              moduleKey: event.data.moduleKey
            });
          })
        )
      );
      return;
    }
    if (event.data && event.data.type === "SW_BOOT_PROGRESS_GET") {
      const client = event.source;
      logSWDebug("message: SW_BOOT_PROGRESS_GET", {
        clientId: (client == null ? void 0 : client.id) ?? null
      });
      void broadcastSWBootProgress(client);
      return;
    }
    if (event.data && event.data.type === "GET_VERSION_STATE") {
      const client = event.source;
      logSWDebug("message: GET_VERSION_STATE", { clientId: (client == null ? void 0 : client.id) ?? null });
      event.waitUntil(postVersionState(client));
      return;
    }
    if (event.data && event.data.type === "SW_IDLE_PREFETCH_STATUS_GET") {
      const client = event.source;
      logSWDebug("message: SW_IDLE_PREFETCH_STATUS_GET", {
        clientId: (client == null ? void 0 : client.id) ?? null
      });
      void broadcastIdlePrefetchStatus(client);
      return;
    }
    if (event.data && event.data.type === "SW_PREFETCH_GROUPS") {
      const groups = Array.isArray(event.data.groups) ? event.data.groups.filter(
        (group) => typeof group === "string"
      ) : [];
      event.waitUntil(
        enqueueIdlePrefetchTask(
          `message:${groups.join(",") || "empty"}`,
          async () => {
            await prefetchPendingIdleGroups(
              `message:${groups.join(",") || "empty"}`,
              groups
            );
          }
        )
      );
      return;
    }
    if (event.data && event.data.type === "CLAIM_CLIENTS") {
      event.waitUntil(sw2.clients.claim());
      return;
    }
    if (event.data && (event.data.type === "COMMIT_UPGRADE" || event.data.type === "SKIP_WAITING")) {
      const client = event.source;
      logSWDebug("message: COMMIT_UPGRADE", { clientId: (client == null ? void 0 : client.id) ?? null });
      event.waitUntil(
        (async () => {
          shouldClaimClientsOnActivate = true;
          await updateVersionState({
            committedVersion: APP_VERSION,
            pendingVersion: null,
            pendingReadyAt: null,
            upgradeState: "committing"
          });
          await postVersionState(client);
          sw2.skipWaiting();
          const cm = getChannelManager();
          if (cm) {
            cm.sendSWUpdated(APP_VERSION);
          }
        })()
      );
    } else if (event.data && event.data.type === "FORCE_UPGRADE") {
      event.waitUntil(
        (async () => {
          shouldClaimClientsOnActivate = true;
          await updateVersionState({
            committedVersion: APP_VERSION,
            pendingVersion: null,
            pendingReadyAt: null,
            upgradeState: "committing"
          });
          await postVersionState(event.source);
          sw2.skipWaiting();
          const cm = getChannelManager();
          if (cm) {
            cm.sendSWUpdated(APP_VERSION);
          }
        })()
      );
    } else if (event.data && event.data.type === "DELETE_CACHE") {
      const { url } = event.data;
      if (url) {
        deleteCacheByUrl(url).then(() => {
          const cm = getChannelManager();
          if (cm) {
            cm.sendCacheDeleted(url);
          }
        }).catch((error) => {
          console.error("Service Worker: Failed to delete cache:", error);
        });
      }
    } else if (event.data && event.data.type === "DELETE_CACHE_BATCH") {
      const { urls } = event.data;
      if (urls && Array.isArray(urls)) {
        deleteCacheBatch(urls).then(() => {
        }).catch((error) => {
          console.error(
            "Service Worker: Failed to batch delete caches:",
            error
          );
        });
      }
    } else if (event.data && event.data.type === "CLEAR_ALL_CACHE") {
      clearImageCache().then(() => {
      }).catch((error) => {
        console.error("Service Worker: Failed to clear all cache:", error);
      });
    } else if (event.data && event.data.type === "SW_DEBUG_ENABLE") {
      debugModeEnabled = true;
      setDebugFetchEnabled(true);
      setDebugMode(true);
      originalSWConsole.log("Service Worker: Debug mode enabled");
      if (event.source) {
        event.source.postMessage({ type: "SW_DEBUG_ENABLED" });
      }
      const cm = getChannelManager();
      if (cm) {
        cm.sendDebugStatusChanged(true);
      }
    } else if (event.data && event.data.type === "SW_DEBUG_DISABLE") {
      debugModeEnabled = false;
      setDebugFetchEnabled(false);
      setDebugMode(false);
      consoleLogs.length = 0;
      debugLogs.length = 0;
      originalSWConsole.log("Service Worker: Debug mode disabled");
      if (event.source) {
        event.source.postMessage({ type: "SW_DEBUG_DISABLED" });
      }
      const cm = getChannelManager();
      if (cm) {
        cm.sendDebugStatusChanged(false);
      }
    }
    if (event.data && event.data.type === "SW_DEBUG_GET_LLM_API_LOGS") {
      (async () => {
        try {
          const { getAllLLMApiLogs: getAllLLMApiLogs2 } = await Promise.resolve().then(() => llmApiLogger);
          const logs2 = await getAllLLMApiLogs2();
          const client = event.source;
          if (client) {
            client.postMessage({
              type: "SW_DEBUG_LLM_API_LOGS",
              logs: logs2
            });
          }
        } catch (error) {
          console.error("[SW] Failed to get LLM API logs:", error);
        }
      })();
      return;
    }
    if (event.data && event.data.type === "SW_DEBUG_CLEAR_LLM_API_LOGS") {
      (async () => {
        try {
          const { clearAllLLMApiLogs: clearAllLLMApiLogs2 } = await Promise.resolve().then(() => llmApiLogger);
          await clearAllLLMApiLogs2();
          const client = event.source;
          if (client) {
            client.postMessage({
              type: "SW_DEBUG_LLM_API_LOGS_CLEARED"
            });
          }
        } catch (error) {
          console.error("[SW] Failed to clear LLM API logs:", error);
        }
      })();
      return;
    }
    if (event.data && event.data.type === "SW_DEBUG_GET_STATUS") {
      const client = event.source;
      if (client) {
        client.postMessage({
          type: "SW_DEBUG_STATUS",
          debugModeEnabled,
          swVersion: APP_VERSION,
          logs: debugLogs.slice(-100),
          // 只发送最近 100 条
          consoleLogs: consoleLogs.slice(-100)
        });
      }
      return;
    }
    if (event.data && event.data.type === "SW_DEBUG_GET_LOGS") {
      (async () => {
        try {
          const { getInternalFetchLogs: getInternalFetchLogs2 } = await Promise.resolve().then(() => debugFetch$1);
          const logs2 = getDebugLogs();
          const internalLogs = getInternalFetchLogs2();
          const client = event.source;
          if (client) {
            client.postMessage({
              type: "SW_DEBUG_LOGS",
              logs: [
                ...logs2,
                ...internalLogs.map((l2) => ({ ...l2, type: "fetch" }))
              ]
            });
          }
        } catch (error) {
          console.error("[SW] Failed to get fetch logs:", error);
        }
      })();
      return;
    }
    if (event.data && event.data.type === "SW_DEBUG_GET_CONSOLE_LOGS") {
      (async () => {
        try {
          const client = event.source;
          if (client) {
            client.postMessage({
              type: "SW_DEBUG_CONSOLE_LOGS",
              logs: consoleLogs
            });
          }
        } catch (error) {
          console.error("[SW] Failed to get console logs:", error);
        }
      })();
      return;
    }
    if (event.data && event.data.type === "SW_DEBUG_GET_POSTMESSAGE_LOGS") {
      (async () => {
        try {
          const logs2 = getAllLogs();
          const client = event.source;
          if (client) {
            client.postMessage({
              type: "SW_DEBUG_POSTMESSAGE_LOGS",
              logs: logs2
            });
          }
        } catch (error) {
          console.error("[SW] Failed to get postmessage logs:", error);
        }
      })();
      return;
    }
  });
  const CRASH_SNAPSHOT_DB_NAME = "MemorySnapshotDB";
  const CRASH_SNAPSHOT_STORE = "snapshots";
  const MAX_CRASH_SNAPSHOTS = 50;
  async function openMemorySnapshotDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(CRASH_SNAPSHOT_DB_NAME, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(CRASH_SNAPSHOT_STORE)) {
          const store = db.createObjectStore(CRASH_SNAPSHOT_STORE, {
            keyPath: "id"
          });
          store.createIndex("timestamp", "timestamp", { unique: false });
          store.createIndex("type", "type", { unique: false });
        }
      };
    });
  }
  async function saveCrashSnapshot(snapshot) {
    try {
      const db = await openMemorySnapshotDB();
      const transaction = db.transaction(CRASH_SNAPSHOT_STORE, "readwrite");
      const store = transaction.objectStore(CRASH_SNAPSHOT_STORE);
      store.put(snapshot);
      const countRequest = store.count();
      countRequest.onsuccess = () => {
        const count = countRequest.result;
        if (count > MAX_CRASH_SNAPSHOTS) {
          const index = store.index("timestamp");
          const cursorRequest = index.openCursor();
          let deleted = 0;
          const toDelete = count - MAX_CRASH_SNAPSHOTS;
          cursorRequest.onsuccess = (e2) => {
            const cursor = e2.target.result;
            if (cursor && deleted < toDelete) {
              store.delete(cursor.value.id);
              deleted++;
              cursor.continue();
            }
          };
        }
      };
      await new Promise((resolve, reject) => {
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
      });
    } catch (error) {
      console.warn("[SW] Failed to save crash snapshot:", error);
    }
  }
  async function getCrashSnapshots() {
    try {
      const db = await openMemorySnapshotDB();
      const transaction = db.transaction(CRASH_SNAPSHOT_STORE, "readonly");
      const store = transaction.objectStore(CRASH_SNAPSHOT_STORE);
      const index = store.index("timestamp");
      return new Promise((resolve, reject) => {
        const request = index.getAll();
        request.onsuccess = () => {
          db.close();
          const snapshots = request.result.sort(
            (a2, b) => b.timestamp - a2.timestamp
          );
          resolve(snapshots);
        };
        request.onerror = () => {
          db.close();
          reject(request.error);
        };
      });
    } catch (error) {
      console.warn("[SW] Failed to get crash snapshots:", error);
      return [];
    }
  }
  async function clearCrashSnapshots() {
    try {
      const db = await openMemorySnapshotDB();
      const transaction = db.transaction(CRASH_SNAPSHOT_STORE, "readwrite");
      const store = transaction.objectStore(CRASH_SNAPSHOT_STORE);
      store.clear();
      await new Promise((resolve, reject) => {
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
      });
    } catch (error) {
      console.warn("[SW] Failed to clear crash snapshots:", error);
    }
  }
  const INDEXEDDB_NAMES = [
    "ConsoleLogDB",
    // SW 控制台日志
    "ServiceWorkerDB",
    // SW 失败域名
    "sw-task-queue",
    // SW 任务队列
    "aitu-workspace",
    // 工作空间存储
    "drawnix-unified-cache",
    // 统一缓存（媒体、URL等）
    "drawnix-kv-storage",
    // KV 存储
    "drawnix-prompts",
    // 提示词存储
    "drawnix-chat-db",
    // 聊天存储
    "MemorySnapshotDB"
    // 崩溃快照存储
  ];
  function estimateObjectSize(obj) {
    try {
      const str = JSON.stringify(obj);
      return new Blob([str]).size;
    } catch {
      return 0;
    }
  }
  async function getIndexedDBStats(dbName) {
    return new Promise((resolve) => {
      try {
        const request = indexedDB.open(dbName);
        request.onerror = () => resolve({ count: 0, totalSize: 0 });
        request.onsuccess = () => {
          const db = request.result;
          const storeNames = Array.from(db.objectStoreNames);
          if (storeNames.length === 0) {
            db.close();
            resolve({ count: 0, totalSize: 0 });
            return;
          }
          let totalCount = 0;
          let totalSampledSize = 0;
          let totalSampledCount = 0;
          let completedStores = 0;
          const SAMPLE_SIZE = 10;
          try {
            const transaction = db.transaction(storeNames, "readonly");
            for (const storeName of storeNames) {
              const store = transaction.objectStore(storeName);
              const countRequest = store.count();
              countRequest.onsuccess = () => {
                const storeCount = countRequest.result;
                totalCount += storeCount;
                if (storeCount > 0) {
                  const cursorRequest = store.openCursor();
                  let sampled = 0;
                  cursorRequest.onsuccess = (e2) => {
                    const cursor = e2.target.result;
                    if (cursor && sampled < SAMPLE_SIZE) {
                      totalSampledSize += estimateObjectSize(cursor.value);
                      totalSampledCount++;
                      sampled++;
                      cursor.continue();
                    } else {
                      completedStores++;
                      if (completedStores === storeNames.length) {
                        db.close();
                        const avgSize = totalSampledCount > 0 ? totalSampledSize / totalSampledCount : 0;
                        const estimatedTotal = Math.round(avgSize * totalCount);
                        resolve({ count: totalCount, totalSize: estimatedTotal });
                      }
                    }
                  };
                  cursorRequest.onerror = () => {
                    completedStores++;
                    if (completedStores === storeNames.length) {
                      db.close();
                      const avgSize = totalSampledCount > 0 ? totalSampledSize / totalSampledCount : 0;
                      const estimatedTotal = Math.round(avgSize * totalCount);
                      resolve({ count: totalCount, totalSize: estimatedTotal });
                    }
                  };
                } else {
                  completedStores++;
                  if (completedStores === storeNames.length) {
                    db.close();
                    resolve({ count: totalCount, totalSize: 0 });
                  }
                }
              };
              countRequest.onerror = () => {
                completedStores++;
                if (completedStores === storeNames.length) {
                  db.close();
                  const avgSize = totalSampledCount > 0 ? totalSampledSize / totalSampledCount : 0;
                  const estimatedTotal = Math.round(avgSize * totalCount);
                  resolve({ count: totalCount, totalSize: estimatedTotal });
                }
              };
            }
          } catch {
            db.close();
            resolve({ count: 0, totalSize: 0 });
          }
        };
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          db.close();
          try {
            indexedDB.deleteDatabase(dbName);
          } catch {
          }
          resolve({ count: 0, totalSize: 0 });
        };
      } catch {
        resolve({ count: 0, totalSize: 0 });
      }
    });
  }
  async function getCacheStats() {
    const stats = {};
    const cacheNames = [
      CACHE_NAME,
      IMAGE_CACHE_NAME,
      STATIC_CACHE_NAME,
      FONT_CACHE_NAME
    ];
    for (const cacheName of cacheNames) {
      try {
        const cache = await caches.open(cacheName);
        const requests = await cache.keys();
        let totalSize = 0;
        const sampleSize = Math.min(requests.length, 100);
        let sampledSize = 0;
        for (let i2 = 0; i2 < sampleSize; i2++) {
          const response = await cache.match(requests[i2]);
          if (response) {
            const size = response.headers.get("sw-image-size") || response.headers.get("content-length");
            if (size) {
              sampledSize += parseInt(size);
            }
          }
        }
        if (sampleSize > 0 && requests.length > sampleSize) {
          totalSize = Math.round(sampledSize / sampleSize * requests.length);
        } else {
          totalSize = sampledSize;
        }
        stats[cacheName] = { count: requests.length, totalSize, type: "cache" };
      } catch (error) {
        stats[cacheName] = { count: 0, totalSize: 0, type: "cache" };
      }
    }
    for (const dbName of INDEXEDDB_NAMES) {
      try {
        const dbStats = await getIndexedDBStats(dbName);
        if (dbStats.count > 0) {
          stats[`[IDB] ${dbName}`] = { ...dbStats, type: "indexeddb" };
        }
      } catch {
      }
    }
    return stats;
  }
  async function deleteCacheByUrl(url) {
    try {
      const cache = await caches.open(IMAGE_CACHE_NAME);
      await cache.delete(url);
    } catch (error) {
      console.error("Service Worker: Failed to delete cache entry:", url, error);
      throw error;
    }
  }
  async function deleteCacheBatch(urls) {
    try {
      const cache = await caches.open(IMAGE_CACHE_NAME);
      let deletedCount = 0;
      for (const url of urls) {
        try {
          await cache.delete(url);
          deletedCount++;
        } catch (error) {
          console.warn(
            "Service Worker: Failed to delete cache in batch:",
            url,
            error
          );
        }
      }
    } catch (error) {
      console.error("Service Worker: Failed to batch delete caches:", error);
      throw error;
    }
  }
  async function clearImageCache() {
    try {
      const cache = await caches.open(IMAGE_CACHE_NAME);
      const requests = await cache.keys();
      for (const request of requests) {
        await cache.delete(request);
      }
    } catch (error) {
      console.error("Service Worker: Failed to clear image cache:", error);
      throw error;
    }
  }
  async function notifyImageCached(url, size, mimeType) {
    try {
      const cm = getChannelManager();
      if (cm) {
        cm.sendCacheImageCached(url, size);
      }
    } catch (error) {
      console.warn("Service Worker: Failed to notify image cached:", error);
    }
  }
  function shouldNotifyCacheFailure(url) {
    const now = Date.now();
    const lastNotifiedAt = cacheFailureNotificationCache.get(url);
    if (lastNotifiedAt && now - lastNotifiedAt < CACHE_FAILURE_NOTIFICATION_TTL) {
      return false;
    }
    if (cacheFailureNotificationCache.size >= MAX_CACHE_FAILURE_NOTIFICATION_CACHE_SIZE) {
      for (const [key, timestamp] of cacheFailureNotificationCache) {
        if (now - timestamp > CACHE_FAILURE_NOTIFICATION_TTL) {
          cacheFailureNotificationCache.delete(key);
        }
      }
      if (cacheFailureNotificationCache.size >= MAX_CACHE_FAILURE_NOTIFICATION_CACHE_SIZE) {
        const entries = Array.from(cacheFailureNotificationCache.entries());
        entries.sort((a2, b) => a2[1] - b[1]);
        for (const [key] of entries.slice(0, Math.floor(entries.length / 2))) {
          cacheFailureNotificationCache.delete(key);
        }
      }
    }
    cacheFailureNotificationCache.set(url, now);
    return true;
  }
  async function notifyImageCacheFailed(url, error) {
    try {
      const normalizedUrl = buildNormalizedCacheUrl(
        new URL(url, self.location.origin)
      ).toString();
      if (!shouldNotifyCacheFailure(normalizedUrl)) {
        return;
      }
      const cm = getChannelManager();
      if (cm) {
        cm.sendCacheImageCacheFailed(normalizedUrl, error);
      }
    } catch (notifyError) {
      console.warn("Service Worker: Failed to notify image cache failure:", {
        url,
        error,
        notifyError
      });
    }
  }
  async function checkStorageQuota() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        const usage = estimate.usage || 0;
        const quota = estimate.quota || 0;
        const percentage = quota > 0 ? usage / quota * 100 : 0;
        if (percentage > 90) {
          console.warn("Service Worker: Storage quota warning:", {
            usage,
            quota,
            percentage
          });
          const cm = getChannelManager();
          if (cm) {
            cm.sendCacheQuotaWarning(usage, quota, percentage);
          }
        }
      }
    } catch (error) {
      console.warn("Service Worker: Failed to check storage quota:", error);
    }
  }
  const failedUrlCache = /* @__PURE__ */ new Map();
  const FAILED_URL_TTL = 5 * 60 * 1e3;
  const MAX_FAILED_URL_CACHE_SIZE = 500;
  function isLikelyExpiredUrl(url) {
    const datePathMatch = url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
    const dateCompactMatch = url.match(/\/(\d{4})(\d{2})(\d{2})\//);
    let urlDate = null;
    if (datePathMatch) {
      urlDate = new Date(
        parseInt(datePathMatch[1]),
        parseInt(datePathMatch[2]) - 1,
        parseInt(datePathMatch[3])
      );
    } else if (dateCompactMatch) {
      urlDate = new Date(
        parseInt(dateCompactMatch[1]),
        parseInt(dateCompactMatch[2]) - 1,
        parseInt(dateCompactMatch[3])
      );
    }
    if (!urlDate) {
      return false;
    }
    const today = /* @__PURE__ */ new Date();
    const isToday = urlDate.getFullYear() === today.getFullYear() && urlDate.getMonth() === today.getMonth() && urlDate.getDate() === today.getDate();
    return !isToday;
  }
  function isUrlRecentlyFailed(url) {
    const failedAt = failedUrlCache.get(url);
    if (!failedAt) return false;
    if (Date.now() - failedAt > FAILED_URL_TTL) {
      failedUrlCache.delete(url);
      return false;
    }
    return true;
  }
  function markUrlAsFailed(url) {
    if (!isLikelyExpiredUrl(url)) {
      return;
    }
    if (failedUrlCache.size >= MAX_FAILED_URL_CACHE_SIZE) {
      const now = Date.now();
      for (const [key, timestamp] of failedUrlCache) {
        if (now - timestamp > FAILED_URL_TTL) {
          failedUrlCache.delete(key);
        }
      }
      if (failedUrlCache.size >= MAX_FAILED_URL_CACHE_SIZE) {
        const entries = Array.from(failedUrlCache.entries());
        entries.sort((a2, b) => a2[1] - b[1]);
        const toDelete = entries.slice(0, Math.floor(entries.length / 2));
        for (const [key] of toDelete) {
          failedUrlCache.delete(key);
        }
      }
    }
    failedUrlCache.set(url, Date.now());
  }
  sw2.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    const startTime = Date.now();
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      addDebugLog({
        type: "fetch",
        url: event.request.url,
        method: event.request.method,
        requestType: "other",
        details: `Skipped: non-http protocol (${url.protocol})`,
        status: 0,
        duration: 0
      });
      return;
    }
    lastObservedClientFetchAt = startTime;
    if (shouldKickIdlePrefetchFromFetch(event, url)) {
      const clientPath = `${url.pathname}${url.search}`;
      logSWDebug("fetch: enqueue idle prefetch recheck", {
        clientId: event.clientId
      });
      event.waitUntil(
        enqueueIdlePrefetchTask(`fetch-recheck:${clientPath}`, async () => {
          await prefetchPendingIdleGroups(`fetch:${clientPath}`);
        })
      );
    }
    if (url.pathname.startsWith(CACHE_URL_PREFIX) || url.pathname.startsWith(AI_GENERATED_AUDIO_CACHE_PREFIX)) {
      const debugId = addDebugLog({
        type: "fetch",
        url: event.request.url,
        method: event.request.method,
        requestType: "cache-url",
        details: "Intercepting cache URL request"
      });
      event.respondWith(
        handleCacheUrlRequest(event.request).then((response) => {
          updateDebugLog(debugId, {
            status: response.status,
            statusText: response.statusText,
            responseType: response.type,
            duration: Date.now() - startTime,
            cached: response.status === 200
          });
          return response;
        }).catch((error) => {
          updateDebugLog(debugId, {
            error: String(error),
            duration: Date.now() - startTime
          });
          throw error;
        })
      );
      return;
    }
    if (url.pathname.startsWith(ASSET_LIBRARY_PREFIX)) {
      const debugId = addDebugLog({
        type: "fetch",
        url: event.request.url,
        method: event.request.method,
        requestType: "asset-library",
        details: "Intercepting asset library request"
      });
      event.respondWith(
        handleAssetLibraryRequest(event.request).then((response) => {
          updateDebugLog(debugId, {
            status: response.status,
            statusText: response.statusText,
            responseType: response.type,
            duration: Date.now() - startTime,
            cached: response.status === 200
          });
          return response;
        }).catch((error) => {
          updateDebugLog(debugId, {
            error: String(error),
            duration: Date.now() - startTime
          });
          throw error;
        })
      );
      return;
    }
    if (url.hostname.endsWith(".posthog.com")) {
      return;
    }
    if (url.hostname === "cdn.i666.fun") {
      addDebugLog({
        type: "fetch",
        url: event.request.url,
        method: event.request.method,
        requestType: "passthrough",
        details: "Passthrough: cdn.i666.fun (fallback domain)",
        status: 0,
        duration: 0
      });
      return;
    }
    if (url.hostname.endsWith(".volces.com") || url.hostname.endsWith(".volccdn.com")) {
      addDebugLog({
        type: "fetch",
        url: event.request.url,
        method: event.request.method,
        requestType: "passthrough",
        details: "Passthrough: Volcengine domain (no CORS)",
        status: 0,
        duration: 0
      });
      return;
    }
    if (url.hostname.endsWith(".aliyuncs.com")) {
      addDebugLog({
        type: "fetch",
        url: event.request.url,
        method: event.request.method,
        requestType: "passthrough",
        details: "Passthrough: Aliyun OSS domain (no CORS)",
        status: 0,
        duration: 0
      });
      return;
    }
    if (isCorsFailedDomain(url.hostname)) {
      addDebugLog({
        type: "fetch",
        url: event.request.url,
        method: event.request.method,
        requestType: "passthrough",
        details: `Passthrough: ${url.hostname} (CORS failed domain, auto-detected)`,
        status: 0,
        duration: 0
      });
      return;
    }
    if (url.hostname === "api.github.com") {
      return;
    }
    if (url.origin !== location.origin && isAudioRequest(url, event.request)) {
      const startTime2 = Date.now();
      const rangeHeader = event.request.headers.get("range");
      const debugId = addDebugLog({
        type: "fetch",
        url: event.request.url,
        method: event.request.method,
        requestType: "audio",
        headers: rangeHeader ? { range: rangeHeader } : void 0,
        details: rangeHeader ? `Audio Range request: ${rangeHeader}` : "External audio request"
      });
      event.respondWith(
        handleAudioRequest(event.request).then((response) => {
          updateDebugLog(debugId, {
            status: response.status,
            statusText: response.statusText,
            responseType: response.type,
            duration: Date.now() - startTime2,
            cached: response.headers.has(SW_CACHE_DATE_HEADER),
            responseHeaders: {
              "content-type": response.headers.get("content-type") || "",
              "content-length": response.headers.get("content-length") || "",
              "content-range": response.headers.get("content-range") || ""
            }
          });
          return response;
        }).catch((error) => {
          updateDebugLog(debugId, {
            error: String(error),
            duration: Date.now() - startTime2
          });
          throw error;
        })
      );
      return;
    }
    if (isVideoRequest(url, event.request)) {
      const startTime2 = Date.now();
      const rangeHeader = event.request.headers.get("range");
      const debugId = addDebugLog({
        type: "fetch",
        url: event.request.url,
        method: event.request.method,
        requestType: "video",
        headers: rangeHeader ? { range: rangeHeader } : void 0,
        details: rangeHeader ? `Video Range request: ${rangeHeader}` : "Video request"
      });
      event.respondWith(
        handleVideoRequest(event.request).then((response) => {
          updateDebugLog(debugId, {
            status: response.status,
            statusText: response.statusText,
            responseType: response.type,
            duration: Date.now() - startTime2,
            responseHeaders: {
              "content-type": response.headers.get("content-type") || "",
              "content-length": response.headers.get("content-length") || "",
              "content-range": response.headers.get("content-range") || ""
            }
          });
          return response;
        }).catch((error) => {
          updateDebugLog(debugId, {
            error: String(error),
            duration: Date.now() - startTime2
          });
          throw error;
        })
      );
      return;
    }
    if (isFontRequest(url, event.request)) {
      const startTime2 = Date.now();
      const debugId = addDebugLog({
        type: "fetch",
        url: event.request.url,
        method: event.request.method,
        requestType: "font",
        details: "Font request"
      });
      event.respondWith(
        handleFontRequest(event.request).then((response) => {
          updateDebugLog(debugId, {
            status: response.status,
            statusText: response.statusText,
            responseType: response.type,
            duration: Date.now() - startTime2,
            cached: response.headers.has("sw-cache-date")
          });
          return response;
        }).catch((error) => {
          updateDebugLog(debugId, {
            error: String(error),
            duration: Date.now() - startTime2
          });
          throw error;
        })
      );
      return;
    }
    if (url.origin !== location.origin && isImageRequest(url, event.request)) {
      if (isUrlRecentlyFailed(event.request.url)) {
        addDebugLog({
          type: "fetch",
          url: event.request.url,
          method: event.request.method,
          requestType: "image",
          details: "Skipped: recently failed URL (cached 404)",
          status: 404,
          duration: 0
        });
        event.respondWith(
          new Response("", { status: 404, statusText: "Not Found (cached)" })
        );
        return;
      }
      const startTime2 = Date.now();
      const debugId = addDebugLog({
        type: "fetch",
        url: event.request.url,
        method: event.request.method,
        requestType: "image",
        details: "External image request"
      });
      event.respondWith(
        handleImageRequest(event.request).then((response) => {
          if (response.status === 404) {
            markUrlAsFailed(event.request.url);
          }
          updateDebugLog(debugId, {
            status: response.status,
            statusText: response.statusText,
            responseType: response.type,
            duration: Date.now() - startTime2,
            cached: response.headers.has("sw-cache-date"),
            size: parseInt(response.headers.get("content-length") || "0")
          });
          return response;
        }).catch((error) => {
          markUrlAsFailed(event.request.url);
          updateDebugLog(debugId, {
            error: String(error),
            duration: Date.now() - startTime2
          });
          throw error;
        })
      );
      return;
    }
    if (event.request.method === "GET") {
      const isNavigationRequest = event.request.mode === "navigate";
      const isStaticResource = event.request.destination !== "";
      if (isNavigationRequest || isStaticResource) {
        const startTime2 = Date.now();
        const debugId = addDebugLog({
          type: "fetch",
          url: event.request.url,
          method: event.request.method,
          requestType: "static",
          details: isNavigationRequest ? "Navigation request" : `Static resource (${event.request.destination})`
        });
        event.respondWith(
          handleStaticRequest(event.request).then((response) => {
            const staticMetadata = getStaticDebugMetadata(response);
            updateDebugLog(debugId, {
              status: response.status,
              statusText: response.statusText,
              responseType: response.type,
              duration: Date.now() - startTime2,
              resourceSource: staticMetadata.resourceSource,
              resourceFetchTarget: staticMetadata.resourceFetchTarget,
              details: isNavigationRequest ? "Navigation request" : [
                `Static resource (${event.request.destination})`,
                staticMetadata.resourceSource ? `来源: ${staticMetadata.resourceSource}` : null,
                staticMetadata.resourceFetchTarget ? `实际拉取: ${staticMetadata.resourceFetchTarget}` : null
              ].filter(Boolean).join("\n")
            });
            return response;
          }).catch((error) => {
            updateDebugLog(debugId, {
              error: String(error),
              duration: Date.now() - startTime2
            });
            throw error;
          })
        );
        return;
      }
    }
    if (debugModeEnabled) {
      if (isGenerateContentRequest(url)) {
        addDebugLog({
          type: "fetch",
          url: event.request.url,
          method: event.request.method,
          requestType: "xhr",
          details: `Skipped SW debug interception for generateContent request (${event.request.method})`,
          duration: 0
        });
        return;
      }
      const debugId = addDebugLog({
        type: "fetch",
        url: event.request.url,
        method: event.request.method,
        requestType: "xhr",
        details: `XHR/API request (${event.request.method})`
      });
      event.respondWith(
        (async () => {
          try {
            const requestClone = event.request.clone();
            let requestBody;
            const requestHeaders = {};
            event.request.headers.forEach((value, key) => {
              requestHeaders[key] = value;
            });
            if (["POST", "PUT", "PATCH"].includes(event.request.method)) {
              try {
                const contentType = event.request.headers.get("content-type") || "";
                if (contentType.includes("application/json")) {
                  requestBody = await requestClone.text();
                  if (requestBody.length > 2e3) {
                    requestBody = requestBody.substring(0, 2e3) + "... (truncated)";
                  }
                } else if (contentType.includes("application/x-www-form-urlencoded")) {
                  requestBody = await requestClone.text();
                  if (requestBody.length > 2e3) {
                    requestBody = requestBody.substring(0, 2e3) + "... (truncated)";
                  }
                } else {
                  requestBody = `[${contentType || "binary data"}]`;
                }
              } catch {
                requestBody = "[unable to read body]";
              }
            }
            updateDebugLog(debugId, {
              headers: requestHeaders,
              details: requestBody ? `XHR/API request (${event.request.method})

Request Body:
${requestBody}` : `XHR/API request (${event.request.method})`
            });
            const response = await fetch(event.request);
            const responseClone = response.clone();
            let responseBody;
            const responseHeaders = {};
            response.headers.forEach((value, key) => {
              responseHeaders[key] = value;
            });
            try {
              const contentType = response.headers.get("content-type") || "";
              if (contentType.includes("application/json") || contentType.includes("text/")) {
                responseBody = await responseClone.text();
                if (responseBody.length > 5e3) {
                  responseBody = responseBody.substring(0, 5e3) + "... (truncated)";
                }
              } else {
                responseBody = `[${contentType || "binary data"}] (${response.headers.get("content-length") || "unknown"} bytes)`;
              }
            } catch {
              responseBody = "[unable to read response body]";
            }
            updateDebugLog(debugId, {
              status: response.status,
              statusText: response.statusText,
              responseType: response.type,
              duration: Date.now() - startTime,
              responseHeaders,
              size: parseInt(response.headers.get("content-length") || "0"),
              details: requestBody ? `XHR/API request (${event.request.method})

Request Body:
${requestBody}

Response Body:
${responseBody}` : `XHR/API request (${event.request.method})

Response Body:
${responseBody}`
            });
            return response;
          } catch (error) {
            updateDebugLog(debugId, {
              error: String(error),
              duration: Date.now() - startTime
            });
            throw error;
          }
        })()
      );
      return;
    }
  });
  async function handleFontRequest(request) {
    new URL(request.url);
    const requestId = Math.random().toString(36).substring(2, 10);
    try {
      const cache = await caches.open(FONT_CACHE_NAME);
      const cachedResponse = await cache.match(request);
      if (cachedResponse) {
        return cachedResponse;
      }
      const response = await fetch(request);
      if (response && response.status === 200) {
        const responseToCache = response.clone();
        const headers = new Headers(responseToCache.headers);
        const now = Date.now().toString();
        headers.set(SW_CACHE_DATE_HEADER, now);
        headers.set(SW_CACHE_CREATED_AT_HEADER, now);
        const cachedResponse2 = new Response(responseToCache.body, {
          status: responseToCache.status,
          statusText: responseToCache.statusText,
          headers
        });
        cache.put(request, cachedResponse2).catch((error) => {
          console.warn(
            `Service Worker [Font-${requestId}]: 缓存字体失败:`,
            error
          );
        });
      }
      return response;
    } catch (error) {
      console.error(`Service Worker [Font-${requestId}]: 字体请求失败:`, error);
      const cache = await caches.open(FONT_CACHE_NAME);
      const cachedResponse = await cache.match(request);
      if (cachedResponse) {
        return cachedResponse;
      }
      return new Response("Font loading failed", {
        status: 503,
        statusText: "Service Unavailable",
        headers: {
          "Content-Type": "text/plain"
        }
      });
    }
  }
  async function fetchQuick(request, fetchOptions = {}) {
    return fetch(request, fetchOptions);
  }
  function getVirtualMediaCacheKeys(request, url) {
    const canonicalUrl = buildNormalizedCacheUrl(request.url);
    const scopeRelativePathname = getScopeRelativePathname(url.pathname);
    return Array.from(
      /* @__PURE__ */ new Set([
        scopeRelativePathname,
        url.pathname,
        canonicalUrl.toString(),
        request.url
      ])
    );
  }
  async function hasCachedMediaResponse(cache, cacheKeys) {
    for (const cacheKey of cacheKeys) {
      const response = await cache.match(cacheKey);
      if (!response) continue;
      try {
        const blob = await response.clone().blob();
        if (blob.size > 0) {
          return true;
        }
      } catch {
        return true;
      }
    }
    return false;
  }
  async function handleCacheUrlRequest(request) {
    const requestId = Math.random().toString(36).substring(2, 10);
    const url = new URL(request.url);
    const rangeHeader = request.headers.get("range");
    const isAudio = url.pathname.includes("/audio/") || AUDIO_EXTENSIONS_REGEX.test(url.pathname);
    const isVideo = url.pathname.includes("/video/") || /\.(mp4|webm|mov)$/i.test(url.pathname);
    const bypassCache = url.searchParams.has("bypass_sw") || url.searchParams.has("direct_fetch");
    const isRetryRequest = url.searchParams.has("_retry");
    const isThumbnailRequest = url.searchParams.has("thumbnail") && !bypassCache && !isRetryRequest;
    if (isThumbnailRequest) {
      const thumbnailSize = url.searchParams.get("thumbnail") || "small";
      const originalUrlForCache = new URL(url.toString());
      originalUrlForCache.searchParams.delete("thumbnail");
      originalUrlForCache.searchParams.delete("bypass_sw");
      originalUrlForCache.searchParams.delete("direct_fetch");
      originalUrlForCache.searchParams.delete("_retry");
      const { findThumbnailWithFallback: findThumbnailWithFallback2, createThumbnailResponse: createThumbnailResponse2 } = await Promise.resolve().then(() => thumbnailUtils);
      const result = await findThumbnailWithFallback2(
        originalUrlForCache.toString(),
        thumbnailSize,
        [url.pathname]
        // 备用 key：pathname
      );
      if (result) {
        const cache = await caches.open(IMAGE_CACHE_NAME);
        const originalCacheKeys = getVirtualMediaCacheKeys(
          new Request(originalUrlForCache.toString()),
          originalUrlForCache
        );
        if (!await hasCachedMediaResponse(cache, originalCacheKeys)) {
          await notifyImageCacheFailed(
            originalUrlForCache.toString(),
            "thumbnail_exists_original_missing"
          );
        }
        const blob = await result.response.blob();
        return createThumbnailResponse2(blob);
      }
    }
    try {
      const cache = await caches.open(IMAGE_CACHE_NAME);
      let cachedResponse;
      for (const cacheKey of getVirtualMediaCacheKeys(request, url)) {
        cachedResponse = await cache.match(cacheKey);
        if (cachedResponse) {
          break;
        }
      }
      if (cachedResponse) {
        const blob = await cachedResponse.blob();
        if (isThumbnailRequest && !isVideo) {
          const { generateThumbnailAsync: generateThumbnailAsync2 } = await Promise.resolve().then(() => thumbnailUtils);
          generateThumbnailAsync2(blob, url.pathname, "image");
        }
        if (isVideo) {
          return createVideoResponse(blob, rangeHeader, requestId);
        }
        if (isAudio) {
          return createAudioResponse(blob, rangeHeader, requestId);
        }
        return new Response(blob, {
          status: 200,
          statusText: "OK",
          headers: {
            "Content-Type": blob.type || "image/png",
            "Content-Length": blob.size.toString(),
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "max-age=31536000"
            // 1年
          }
        });
      }
      return new Response("Media not found", {
        status: 404,
        statusText: "Not Found",
        headers: {
          "Content-Type": "text/plain"
        }
      });
    } catch (error) {
      console.error(`Service Worker: Error handling cache URL request:`, error);
      return new Response("Internal error", {
        status: 500,
        statusText: "Internal Server Error",
        headers: {
          "Content-Type": "text/plain"
        }
      });
    }
  }
  async function handleAssetLibraryRequest(request) {
    const requestId = Math.random().toString(36).substring(2, 10);
    const url = new URL(request.url);
    const rangeHeader = request.headers.get("range");
    const cacheKey = url.pathname;
    const bypassCache = url.searchParams.has("bypass_sw") || url.searchParams.has("direct_fetch");
    const isRetryRequest = url.searchParams.has("_retry");
    const isThumbnailRequest = url.searchParams.has("thumbnail") && !bypassCache && !isRetryRequest;
    if (isThumbnailRequest) {
      const thumbnailSize = url.searchParams.get("thumbnail") || "small";
      const { findThumbnailWithFallback: findThumbnailWithFallback2, createThumbnailResponse: createThumbnailResponse2 } = await Promise.resolve().then(() => thumbnailUtils);
      const result = await findThumbnailWithFallback2(
        cacheKey,
        thumbnailSize,
        [cacheKey]
        // 备用 key：cacheKey（pathname）
      );
      if (result) {
        const cache = await caches.open(IMAGE_CACHE_NAME);
        const originalCacheKeys = getVirtualMediaCacheKeys(
          new Request(url.toString(), { method: request.method }),
          url
        );
        if (!await hasCachedMediaResponse(cache, originalCacheKeys)) {
          await notifyImageCacheFailed(
            url.pathname,
            "thumbnail_exists_original_missing"
          );
        }
        const blob = await result.response.blob();
        return createThumbnailResponse2(blob);
      }
    }
    try {
      const cache = await caches.open(IMAGE_CACHE_NAME);
      let cachedResponse;
      for (const candidateKey of getVirtualMediaCacheKeys(request, url)) {
        cachedResponse = await cache.match(candidateKey);
        if (cachedResponse) {
          break;
        }
      }
      if (cachedResponse) {
        const blob = await cachedResponse.blob();
        const isVideo = url.pathname.match(/\.(mp4|webm|mov)$/i);
        const isAudio = AUDIO_EXTENSIONS_REGEX.test(url.pathname);
        if (isThumbnailRequest && !isVideo) {
          const { generateThumbnailAsync: generateThumbnailAsync2 } = await Promise.resolve().then(() => thumbnailUtils);
          generateThumbnailAsync2(blob, cacheKey, "image");
        }
        if (isVideo && rangeHeader) {
          return createVideoResponse(blob, rangeHeader, requestId);
        }
        if (isAudio) {
          return createAudioResponse(blob, rangeHeader, requestId);
        }
        return new Response(blob, {
          status: 200,
          statusText: "OK",
          headers: {
            "Content-Type": blob.type || "application/octet-stream",
            "Content-Length": blob.size.toString(),
            "Accept-Ranges": "bytes",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "max-age=31536000"
            // 1年
          }
        });
      }
      return new Response("Asset not found", {
        status: 404,
        statusText: "Not Found",
        headers: {
          "Content-Type": "text/plain"
        }
      });
    } catch (error) {
      console.error(
        `Service Worker [Asset-${requestId}]: Error handling asset library request:`,
        error
      );
      return new Response("Internal error", {
        status: 500,
        statusText: "Internal Server Error",
        headers: {
          "Content-Type": "text/plain"
        }
      });
    }
  }
  async function handleAudioRequest(request) {
    const url = new URL(request.url);
    const requestId = Math.random().toString(36).substring(2, 10);
    const rangeHeader = request.headers.get("range");
    const dedupeUrl = buildNormalizedCacheUrl(url);
    const dedupeKey = dedupeUrl.toString();
    try {
      const cache = await caches.open(IMAGE_CACHE_NAME);
      let cachedResponse = await cache.match(dedupeKey);
      if (!cachedResponse && dedupeKey !== request.url) {
        cachedResponse = await cache.match(request.url);
      }
      if (cachedResponse) {
        try {
          const cachedBlob = await cachedResponse.clone().blob();
          return createAudioResponse(cachedBlob, rangeHeader, requestId);
        } catch {
          return cachedResponse;
        }
      }
      const requestHeaders = new Headers(request.headers);
      requestHeaders.delete("range");
      const response = await fetch(dedupeKey, {
        method: "GET",
        headers: requestHeaders,
        mode: request.mode,
        credentials: request.credentials,
        cache: "no-store",
        referrerPolicy: request.referrerPolicy || "no-referrer"
      });
      if (!response.ok) {
        return response;
      }
      if (response.type === "opaque") {
        cache.put(dedupeKey, response.clone()).catch((error) => {
          console.warn(
            `Service Worker [Audio-${requestId}]: Failed to cache opaque audio response:`,
            error
          );
        });
        return response;
      }
      const blob = await response.blob();
      const mimeType = response.headers.get("Content-Type") || blob.type || "audio/mpeg";
      const now = Date.now().toString();
      const cacheResponse = new Response(blob, {
        status: 200,
        statusText: "OK",
        headers: {
          "Content-Type": mimeType,
          "Content-Length": blob.size.toString(),
          "Accept-Ranges": "bytes",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges, Content-Length",
          [SW_CACHE_DATE_HEADER]: now,
          [SW_CACHE_CREATED_AT_HEADER]: now,
          "sw-image-size": blob.size.toString()
        }
      });
      await cache.put(dedupeKey, cacheResponse.clone());
      return createAudioResponse(blob, rangeHeader, requestId, mimeType);
    } catch (error) {
      console.error(
        `Service Worker [Audio-${requestId}]: Audio loading failed:`,
        error
      );
      const cache = await caches.open(IMAGE_CACHE_NAME);
      let cachedResponse = await cache.match(dedupeKey);
      if (!cachedResponse && dedupeKey !== request.url) {
        cachedResponse = await cache.match(request.url);
      }
      if (cachedResponse) {
        try {
          const cachedBlob = await cachedResponse.clone().blob();
          return createAudioResponse(cachedBlob, rangeHeader, requestId);
        } catch {
          return cachedResponse;
        }
      }
      return new Response("Audio loading error", {
        status: 500,
        statusText: "Internal Server Error",
        headers: {
          "Content-Type": "text/plain"
        }
      });
    }
  }
  const VIDEO_LOAD_ERROR = Symbol("VIDEO_LOAD_ERROR");
  async function handleVideoRequest(request) {
    const url = new URL(request.url);
    const requestId = Math.random().toString(36).substring(2, 10);
    try {
      const rangeHeader = request.headers.get("range");
      const bypassCache = url.searchParams.has("bypass_sw") || url.searchParams.has("direct_fetch");
      const isRetryRequest = url.searchParams.has("_retry");
      const isThumbnailRequest = url.searchParams.has("thumbnail") && !bypassCache && !isRetryRequest;
      const dedupeUrl = buildNormalizedCacheUrl(url);
      const dedupeKey = dedupeUrl.toString();
      if (isThumbnailRequest) {
        const thumbnailSize = url.searchParams.get("thumbnail") || "small";
        const { findThumbnailWithFallback: findThumbnailWithFallback2, createThumbnailResponse: createThumbnailResponse2 } = await Promise.resolve().then(() => thumbnailUtils);
        const result = await findThumbnailWithFallback2(dedupeKey, thumbnailSize);
        if (result) {
          const blob = await result.response.blob();
          return createThumbnailResponse2(blob);
        }
        void (async () => {
          try {
            const { generateThumbnailAsync: generateThumbnailAsync2 } = await Promise.resolve().then(() => thumbnailUtils);
            generateThumbnailAsync2(
              new Blob([], { type: "video/mp4" }),
              dedupeKey,
              "video",
              [thumbnailSize]
            );
          } catch {
            return;
          }
        })();
        return new Response("Thumbnail not ready", {
          status: 404,
          statusText: "Thumbnail Not Ready",
          headers: {
            "Content-Type": "text/plain",
            "Cache-Control": "no-store"
          }
        });
      }
      const existingEntry = pendingVideoRequests.get(dedupeKey);
      if (existingEntry) {
        existingEntry.count = (existingEntry.count || 1) + 1;
        const videoBlob2 = await existingEntry.promise;
        if (videoBlob2 === VIDEO_LOAD_ERROR) {
          return new Response("Video loading error", {
            status: 500,
            statusText: "Internal Server Error",
            headers: { "Content-Type": "text/plain" }
          });
        }
        if (videoBlob2 === null) {
          const fetchOptions = {
            method: "GET",
            headers: new Headers(request.headers),
            mode: "cors",
            credentials: "omit"
          };
          return await fetch(url, fetchOptions);
        }
        return createVideoResponse(videoBlob2, rangeHeader, requestId);
      }
      if (videoBlobCache.has(dedupeKey)) {
        const cacheEntry = videoBlobCache.get(dedupeKey);
        if (cacheEntry) {
          cacheEntry.timestamp = Date.now();
          return createVideoResponse(cacheEntry.blob, rangeHeader, requestId);
        }
      }
      try {
        const cache = await caches.open(IMAGE_CACHE_NAME);
        const cachedResponse = await cache.match(dedupeKey);
        if (cachedResponse) {
          const videoBlob2 = await cachedResponse.blob();
          const videoSizeMB = videoBlob2.size / (1024 * 1024);
          if (videoSizeMB < 50) {
            videoBlobCache.set(dedupeKey, {
              blob: videoBlob2,
              timestamp: Date.now()
            });
          }
          return createVideoResponse(videoBlob2, rangeHeader, requestId);
        }
      } catch {
      }
      const downloadPromise = (async () => {
        try {
          const fetchOptions = {
            method: "GET",
            mode: "cors",
            credentials: "omit",
            cache: "default"
            // 使用浏览器默认缓存策略
          };
          const fetchUrl = new URL(dedupeUrl);
          const response = await fetch(fetchUrl, fetchOptions);
          if (!response.ok) {
            return VIDEO_LOAD_ERROR;
          }
          if (response.status === 206) {
            return null;
          }
          const videoBlob2 = await response.blob();
          const videoSizeMB = videoBlob2.size / (1024 * 1024);
          if (videoSizeMB < 50) {
            videoBlobCache.set(dedupeKey, {
              blob: videoBlob2,
              timestamp: Date.now()
            });
            try {
              const cache = await caches.open(IMAGE_CACHE_NAME);
              const cacheResponse = new Response(videoBlob2, {
                headers: {
                  "Content-Type": videoBlob2.type || "video/mp4",
                  "Content-Length": videoBlob2.size.toString(),
                  [SW_CACHE_DATE_HEADER]: Date.now().toString(),
                  [SW_CACHE_CREATED_AT_HEADER]: Date.now().toString(),
                  "sw-video-size": videoBlob2.size.toString()
                }
              });
              await cache.put(dedupeKey, cacheResponse);
              const { generateThumbnailAsync: generateThumbnailAsync2 } = await Promise.resolve().then(() => thumbnailUtils);
              generateThumbnailAsync2(videoBlob2, dedupeKey, "video");
            } catch {
            }
          }
          return videoBlob2;
        } catch {
          return VIDEO_LOAD_ERROR;
        }
      })();
      pendingVideoRequests.set(dedupeKey, {
        promise: downloadPromise,
        timestamp: Date.now(),
        count: 1,
        requestId
      });
      downloadPromise.finally(() => {
        const entry = pendingVideoRequests.get(dedupeKey);
        if (entry) {
          pendingVideoRequests.delete(dedupeKey);
        }
      });
      const videoBlob = await downloadPromise;
      if (videoBlob === VIDEO_LOAD_ERROR) {
        return new Response("Video loading error", {
          status: 500,
          statusText: "Internal Server Error",
          headers: { "Content-Type": "text/plain" }
        });
      }
      if (videoBlob === null) {
        const fetchOptions = {
          method: "GET",
          headers: new Headers(request.headers),
          mode: "cors",
          credentials: "omit"
        };
        return await fetch(url, fetchOptions);
      }
      return createVideoResponse(videoBlob, rangeHeader, requestId);
    } catch {
      return new Response("Video loading error", {
        status: 500,
        statusText: "Internal Server Error",
        headers: {
          "Content-Type": "text/plain"
        }
      });
    }
  }
  function createVideoResponse(videoBlob, rangeHeader, requestId) {
    return createBufferedMediaResponse(
      videoBlob,
      rangeHeader,
      requestId,
      videoBlob.type || "video/mp4"
    );
  }
  function createAudioResponse(audioBlob, rangeHeader, requestId, mimeType) {
    return createBufferedMediaResponse(
      audioBlob,
      rangeHeader,
      requestId,
      mimeType || audioBlob.type || "audio/mpeg"
    );
  }
  function createBufferedMediaResponse(mediaBlob, rangeHeader, _requestId, mimeType) {
    const mediaSize = mediaBlob.size;
    if (!rangeHeader) {
      return new Response(mediaBlob, {
        status: 200,
        statusText: "OK",
        headers: {
          "Content-Type": mimeType,
          "Content-Length": mediaSize.toString(),
          "Accept-Ranges": "bytes",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges, Content-Length"
        }
      });
    }
    const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (!rangeMatch) {
      return new Response(mediaBlob, {
        status: 200,
        statusText: "OK",
        headers: {
          "Content-Type": mimeType,
          "Accept-Ranges": "bytes"
        }
      });
    }
    const start = parseInt(rangeMatch[1], 10);
    const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : mediaSize - 1;
    const slicedBlob = mediaBlob.slice(start, end + 1);
    const contentLength = end - start + 1;
    return new Response(slicedBlob, {
      status: 206,
      statusText: "Partial Content",
      headers: {
        "Content-Type": mimeType,
        "Content-Range": `bytes ${start}-${end}/${mediaSize}`,
        "Content-Length": contentLength.toString(),
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges, Content-Length"
      }
    });
  }
  async function handleStaticRequest(request) {
    const url = new URL(request.url);
    const staticTargets = resolveStaticResourceFetchTargets(request.url);
    const normalizedCacheKey = staticTargets.cacheKey;
    const scopeRelativePathname = getScopeRelativePathname(url.pathname);
    const isAppShellRequest = shouldUseAppShellStrategy(
      request.mode,
      scopeRelativePathname
    );
    const versionState = await readVersionState();
    const committedVersion = versionState.committedVersion || APP_VERSION;
    const committedStaticCacheName = getStaticCacheName(committedVersion);
    const cache = await caches.open(committedStaticCacheName);
    if (isDevelopment) {
      try {
        const response = await fetchQuick(request);
        if (response && response.status === 200 && request.url.startsWith("http")) {
          cache.put(request, response.clone());
          return response;
        }
        if (!response.ok) {
          let cachedResponse2 = await cache.match(request);
          if (!cachedResponse2 && isAppShellRequest) {
            cachedResponse2 = await cache.match(createScopeUrl("/").href);
            if (!cachedResponse2) {
              cachedResponse2 = await cache.match(
                createScopeUrl("index.html").href
              );
            }
          }
          if (cachedResponse2) {
            return cachedResponse2;
          }
          return response;
        }
        return response;
      } catch (networkError) {
        let cachedResponse2 = await cache.match(request);
        if (!cachedResponse2 && isAppShellRequest) {
          cachedResponse2 = await cache.match(createScopeUrl("/").href);
          if (!cachedResponse2) {
            cachedResponse2 = await cache.match(createScopeUrl("index.html").href);
          }
        }
        if (cachedResponse2) {
          return cachedResponse2;
        }
        if (isAppShellRequest) {
          return createOfflinePage();
        }
        return new Response("Resource unavailable", { status: 503 });
      }
    }
    if (isAppShellRequest) {
      if (shouldBypassAppShellCacheForLazyChunkRecovery(url.search)) {
        try {
          const response = await fetchQuick(request, {
            cache: "reload"
          });
          if (response && response.status === 200 && request.url.startsWith("http")) {
            cache.put(request, response.clone());
            logSWDebug("handleStaticRequest: refreshed app shell for recovery", {
              requestUrl: request.url,
              committedVersion,
              workerVersion: APP_VERSION
            });
            return response;
          }
          if (response) {
            return response;
          }
        } catch (error) {
          logSWDebug("handleStaticRequest: recovery app shell refresh failed", {
            requestUrl: request.url,
            error: getSafeErrorMessage(error)
          });
        }
      }
      let cachedResponse2 = await cache.match(request);
      if (!cachedResponse2) {
        cachedResponse2 = await cache.match(createScopeUrl("/").href);
      }
      if (!cachedResponse2) {
        cachedResponse2 = await cache.match(createScopeUrl("index.html").href);
      }
      if (!cachedResponse2) {
        const allCacheNames = await caches.keys();
        for (const cacheName of allCacheNames) {
          if (cacheName.startsWith("drawnix-static-v")) {
            try {
              const oldCache = await caches.open(cacheName);
              cachedResponse2 = await oldCache.match(request) || await oldCache.match(createScopeUrl("/").href) || await oldCache.match(createScopeUrl("index.html").href);
              if (cachedResponse2) {
                break;
              }
            } catch {
            }
          }
        }
      }
      if (cachedResponse2) {
        return cachedResponse2;
      }
      try {
        const response = await fetchQuick(request, {
          cache: "reload"
        });
        if (response && response.status === 200 && request.url.startsWith("http") && committedVersion === APP_VERSION) {
          cache.put(request, response.clone());
          return response;
        }
        return response;
      } catch {
        return createOfflinePage();
      }
    }
    const { response: cachedResponse, matchedBy } = await matchStaticCacheEntry(
      cache,
      request
    );
    if (cachedResponse) {
      if (!isSuspiciousStaticCacheResponse(
        request,
        cachedResponse,
        committedVersion
      )) {
        if (matchedBy === "normalized") {
          logSWDebug("handleStaticRequest: normalized static cache hit", {
            requestUrl: request.url
          });
        }
        return cachedResponse;
      }
      await deleteStaticCacheLookupKeys(cache, request, normalizedCacheKey);
    }
    const resourcePath = staticTargets.resourcePath;
    const isSmartCDNResource = isVersionedStaticResource(request, url);
    if (isSmartCDNResource) {
      if (request.url !== normalizedCacheKey) {
        logSWDebug("handleStaticRequest: cross-origin static cache miss", {
          requestUrl: request.url
        });
      }
      const oldCachedResponse = await findStaticResponseInOldCaches(request, [
        normalizedCacheKey
      ]);
      if (oldCachedResponse) {
        return oldCachedResponse;
      }
      const browserCachedResponse = await findStaticResponseInBrowserCache(
        request,
        [normalizedCacheKey]
      );
      if (browserCachedResponse) {
        return browserCachedResponse;
      }
      const embeddedVersion = extractVersionFromCDNPath(url.pathname);
      const cdnVersion = embeddedVersion || committedVersion;
      const smartResponse = await tryFetchStaticResourceFromCDN(
        cache,
        request,
        resourcePath,
        cdnVersion
      );
      if (smartResponse) {
        return smartResponse;
      }
      logStatic503Decision("smart-cdn-resource-failed", request, {
        resourcePath,
        committedVersion,
        hasEmbeddedVersion: Boolean(embeddedVersion),
        attemptedVersion: cdnVersion
      });
      return new Response("Resource unavailable offline", {
        status: 503,
        statusText: "Service Unavailable",
        headers: { "Content-Type": "text/plain" }
      });
    }
    try {
      const response = await fetchQuick(request);
      const isInvalidResponse = isStaticHtmlFallbackResponse(
        request,
        url,
        response
      );
      if (isInvalidResponse) {
        console.warn(
          "Service Worker: HTML response for static resource (404 fallback), trying old caches:",
          request.url
        );
        const oldCachedResponse = await findStaticResponseInOldCaches(request, [
          normalizedCacheKey
        ]);
        if (oldCachedResponse) {
          return oldCachedResponse;
        }
        return new Response("Resource not found", {
          status: 404,
          statusText: "Not Found"
        });
      }
      if (response && response.status === 200 && request.url.startsWith("http") && committedVersion === APP_VERSION) {
        return await cacheStaticResponse(cache, request, response, {
          source: "server",
          revision: "runtime",
          appVersion: committedVersion
        });
      }
      if (response.status >= 400) {
        const oldCachedResponse = await findStaticResponseInOldCaches(request, [
          normalizedCacheKey
        ]);
        if (oldCachedResponse) {
          return oldCachedResponse;
        }
      }
      return response;
    } catch (networkError) {
      console.warn("[SW] Network failed, trying old caches:", request.url);
      const oldCachedResponse = await findStaticResponseInOldCaches(request, [
        normalizedCacheKey
      ]);
      if (oldCachedResponse) {
        return oldCachedResponse;
      }
      logStatic503Decision("origin-fetch-exception", request, {
        resourcePath,
        committedVersion
      });
      return new Response("Resource unavailable offline", {
        status: 503,
        statusText: "Service Unavailable",
        headers: { "Content-Type": "text/plain" }
      });
    }
  }
  function createOfflinePage() {
    return new Response(
      `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>离线 - Actum</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-align: center;
      padding: 20px;
    }
    h1 { font-size: 2rem; margin-bottom: 1rem; }
    p { font-size: 1.1rem; opacity: 0.9; max-width: 400px; }
    button {
      margin-top: 2rem;
      padding: 12px 24px;
      font-size: 1rem;
      border: none;
      border-radius: 8px;
      background: white;
      color: #667eea;
      cursor: pointer;
      transition: transform 0.2s;
    }
    button:hover { transform: scale(1.05); }
  </style>
</head>
<body>
  <h1>📡 无法连接到服务器</h1>
  <p>Actum 是一个以画布工作区为底座的 AI 应用平台，当前无法访问时请检查网络或稍后再试。</p>
  <button onclick="location.reload()">重试</button>
</body>
</html>`,
      {
        status: 503,
        statusText: "Service Unavailable",
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store"
        }
      }
    );
  }
  const IMAGE_REQUEST_TIMEOUT = 15e3;
  const STALE_REQUEST_THRESHOLD = 3e4;
  function withTimeout(promise, timeoutMs, timeoutMessage) {
    return Promise.race([
      promise,
      new Promise((_2, reject) => {
        setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      })
    ]);
  }
  function cleanupVideoBlobCache() {
    const now = Date.now();
    const staleKeys = [];
    videoBlobCache.forEach((entry, key) => {
      if (now - entry.timestamp > VIDEO_BLOB_CACHE_TTL) {
        staleKeys.push(key);
      }
    });
    if (staleKeys.length > 0) {
      staleKeys.forEach((key) => videoBlobCache.delete(key));
    }
    if (videoBlobCache.size > VIDEO_BLOB_CACHE_MAX_SIZE) {
      const entries = Array.from(videoBlobCache.entries()).sort(
        (a2, b) => a2[1].timestamp - b[1].timestamp
      );
      const toDeleteCount = videoBlobCache.size - VIDEO_BLOB_CACHE_MAX_SIZE;
      const toDelete = entries.slice(0, toDeleteCount);
      if (toDelete.length > 0) {
        toDelete.forEach(([key]) => videoBlobCache.delete(key));
      }
    }
  }
  function cleanupStaleRequests() {
    const now = Date.now();
    const stalePendingKeys = [];
    pendingImageRequests.forEach((entry, key) => {
      if (now - entry.timestamp > STALE_REQUEST_THRESHOLD) {
        stalePendingKeys.push(key);
      }
    });
    if (stalePendingKeys.length > 0) {
      console.warn(
        `Service Worker: 清理 ${stalePendingKeys.length} 个过期的 pending 请求`
      );
      stalePendingKeys.forEach((key) => pendingImageRequests.delete(key));
    }
    const staleCompletedKeys = [];
    completedImageRequests.forEach((entry, key) => {
      if (now - entry.timestamp > COMPLETED_REQUEST_CACHE_TTL) {
        staleCompletedKeys.push(key);
      }
    });
    if (staleCompletedKeys.length > 0) {
      staleCompletedKeys.forEach((key) => completedImageRequests.delete(key));
    }
    cleanupVideoBlobCache();
  }
  async function handleImageRequest(request) {
    try {
      const requestId = Math.random().toString(36).substring(2, 10);
      const originalUrl = new URL(request.url);
      const bypassCache = originalUrl.searchParams.has("bypass_sw") || originalUrl.searchParams.has("direct_fetch");
      const isRetryRequest = originalUrl.searchParams.has("_retry");
      const isThumbnailRequest = originalUrl.searchParams.has("thumbnail") && !bypassCache && !isRetryRequest;
      const thumbnailSize = isThumbnailRequest ? originalUrl.searchParams.get("thumbnail") || "small" : "small";
      const normalizedCacheUrl = buildNormalizedCacheUrl(originalUrl);
      const originalRequest = new Request(normalizedCacheUrl.toString(), {
        method: request.method,
        headers: request.headers,
        mode: request.mode,
        credentials: request.credentials
      });
      const dedupeKey = normalizedCacheUrl.toString();
      if (isThumbnailRequest) {
        const { findThumbnailWithFallback: findThumbnailWithFallback2, createThumbnailResponse: createThumbnailResponse2 } = await Promise.resolve().then(() => thumbnailUtils);
        const result = await findThumbnailWithFallback2(
          dedupeKey,
          thumbnailSize,
          [request.url, originalRequest.url]
          // 备用 key：兼容历史签名 URL 与 canonical key
        );
        if (result) {
          const blob = await result.response.blob();
          return createThumbnailResponse2(blob);
        }
      }
      const completedEntry = completedImageRequests.get(dedupeKey);
      if (completedEntry) {
        const elapsed = Date.now() - completedEntry.timestamp;
        if (elapsed < COMPLETED_REQUEST_CACHE_TTL) {
          return completedEntry.response.clone();
        } else {
          completedImageRequests.delete(dedupeKey);
        }
      }
      if (pendingImageRequests.has(dedupeKey)) {
        const existingEntry = pendingImageRequests.get(dedupeKey);
        if (existingEntry) {
          const elapsed = Date.now() - existingEntry.timestamp;
          if (elapsed > STALE_REQUEST_THRESHOLD) {
            console.warn(
              `Service Worker [${requestId}]: 发现过期的 pending 请求 (${elapsed}ms)，清理并重新发起:`,
              dedupeKey
            );
            pendingImageRequests.delete(dedupeKey);
          } else {
            existingEntry.count = (existingEntry.count || 1) + 1;
            existingEntry.duplicateRequestIds = existingEntry.duplicateRequestIds || [];
            existingEntry.duplicateRequestIds.push(requestId);
            try {
              const response = await withTimeout(
                existingEntry.promise,
                IMAGE_REQUEST_TIMEOUT,
                "Image request timeout"
              );
              return response && response.clone ? response.clone() : response;
            } catch (timeoutError) {
              if (timeoutError.message === "Image request timeout") {
                console.warn(
                  `Service Worker [${requestId}]: 重复请求等待超时，清理并返回超时响应让前端直接加载`
                );
                pendingImageRequests.delete(dedupeKey);
                return createTimeoutResponse(request.url, requestId);
              }
              throw timeoutError;
            }
          }
        }
      }
      cleanupStaleRequests();
      const requestPromise = handleImageRequestInternal(
        originalRequest,
        request.url,
        dedupeKey,
        requestId,
        bypassCache,
        isThumbnailRequest ? thumbnailSize : void 0
      );
      pendingImageRequests.set(dedupeKey, {
        promise: requestPromise,
        timestamp: Date.now(),
        count: 1,
        originalRequestId: requestId,
        duplicateRequestIds: []
      });
      requestPromise.then((response) => {
        if (response && response.ok) {
          completedImageRequests.set(dedupeKey, {
            response: response.clone(),
            timestamp: Date.now()
          });
        }
      }).catch(() => {
      }).finally(() => {
        const entry = pendingImageRequests.get(dedupeKey);
        if (entry) {
          pendingImageRequests.delete(dedupeKey);
        }
      });
      try {
        return await withTimeout(
          requestPromise,
          IMAGE_REQUEST_TIMEOUT,
          "Image request timeout"
        );
      } catch (timeoutError) {
        if (timeoutError.message === "Image request timeout") {
          console.warn(
            `Service Worker [${requestId}]: 图片请求超时(${IMAGE_REQUEST_TIMEOUT}ms)，清理并返回超时响应让前端直接加载:`,
            request.url
          );
          pendingImageRequests.delete(dedupeKey);
          return createTimeoutResponse(request.url, requestId);
        }
        throw timeoutError;
      }
    } catch (error) {
      throw error;
    }
  }
  function createTimeoutResponse(url, requestId) {
    return new Response("Image request timeout - use direct load", {
      status: 504,
      statusText: "Gateway Timeout",
      headers: {
        "Content-Type": "text/plain",
        "X-SW-Timeout": "true",
        "X-SW-Original-URL": url,
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
  async function handleImageRequestInternal(originalRequest, requestUrl, dedupeKey, requestId, bypassCache = false, requestedThumbnailSize) {
    try {
      const cache = await caches.open(IMAGE_CACHE_NAME);
      if (!bypassCache) {
        let cachedResponse = await cache.match(originalRequest);
        if (!cachedResponse) {
          cachedResponse = await cache.match(originalRequest.url);
        }
        if (!cachedResponse && requestUrl !== originalRequest.url) {
          cachedResponse = await cache.match(requestUrl);
        }
        if (!cachedResponse) {
          cachedResponse = await cache.match(dedupeKey);
        }
        if (cachedResponse) {
          const responseClone = cachedResponse.clone();
          const blob = await responseClone.blob();
          if (blob.size === 0) {
            console.warn(
              `Service Worker [${requestId}]: 检测到空缓存，删除并重新获取:`,
              requestUrl
            );
            await cache.delete(originalRequest);
          } else {
            if (requestedThumbnailSize) {
              const { generateThumbnailAsync: generateThumbnailAsync2 } = await Promise.resolve().then(() => thumbnailUtils);
              generateThumbnailAsync2(blob, originalRequest.url, "image");
            }
            const cacheDate = cachedResponse.headers.get(SW_CACHE_DATE_HEADER);
            if (cacheDate) {
              const now = Date.now();
              const cacheCreatedAt = cachedResponse.headers.get(SW_CACHE_CREATED_AT_HEADER) || cacheDate;
              const refreshedResponse = new Response(blob, {
                status: cachedResponse.status,
                statusText: cachedResponse.statusText,
                headers: {
                  ...Object.fromEntries(
                    cachedResponse.headers.entries()
                  ),
                  [SW_CACHE_DATE_HEADER]: now.toString(),
                  // 更新访问时间为当前时间
                  [SW_CACHE_CREATED_AT_HEADER]: cacheCreatedAt
                  // 保持首次缓存时间不变
                }
              });
              if (originalRequest.url.startsWith("http")) {
                await cache.put(dedupeKey, refreshedResponse.clone());
                if (requestUrl !== dedupeKey) {
                  await cache.delete(requestUrl);
                }
              }
              return refreshedResponse;
            } else {
              const refreshedResponse = new Response(blob, {
                status: cachedResponse.status,
                statusText: cachedResponse.statusText,
                headers: {
                  ...Object.fromEntries(
                    cachedResponse.headers.entries()
                  ),
                  [SW_CACHE_DATE_HEADER]: Date.now().toString(),
                  [SW_CACHE_CREATED_AT_HEADER]: Date.now().toString()
                }
              });
              if (originalRequest.url.startsWith("http")) {
                await cache.put(dedupeKey, refreshedResponse.clone());
                if (requestUrl !== dedupeKey) {
                  await cache.delete(requestUrl);
                }
              }
              return refreshedResponse;
            }
          }
        }
      } else {
      }
      const originalUrlObject = new URL(requestUrl);
      const domainConfig = shouldHandleCORS(originalUrlObject);
      let fallbackUrl = null;
      let shouldUseFallbackDirectly = false;
      if (domainConfig && domainConfig.fallbackDomain) {
        fallbackUrl = requestUrl.replace(
          domainConfig.hostname,
          domainConfig.fallbackDomain
        );
        if (failedDomains.has(domainConfig.hostname)) {
          shouldUseFallbackDirectly = true;
        } else {
        }
      }
      let response;
      const fetchOptions = [
        // 1. 优先尝试cors模式（可以缓存响应）
        {
          method: "GET",
          mode: "cors",
          cache: "no-cache",
          credentials: "omit",
          referrerPolicy: "no-referrer"
        },
        // 2. 尝试默认模式（可能支持缓存）
        {
          method: "GET",
          cache: "no-cache"
        },
        // 3. 最后尝试no-cors模式（可以绕过CORS限制，但会导致opaque响应无法缓存）
        {
          method: "GET",
          mode: "no-cors",
          cache: "no-cache",
          credentials: "omit",
          referrerPolicy: "no-referrer"
        }
      ];
      let urlsToTry;
      if (shouldUseFallbackDirectly) {
        urlsToTry = [fallbackUrl];
      } else {
        urlsToTry = [requestUrl];
        if (fallbackUrl) {
          urlsToTry.push(fallbackUrl);
        }
      }
      let finalError = null;
      for (let urlIndex = 0; urlIndex < urlsToTry.length; urlIndex++) {
        const currentUrl = urlsToTry[urlIndex];
        const isUsingFallback = urlIndex > 0;
        if (isUsingFallback) {
        }
        for (const options of fetchOptions) {
          try {
            let lastError;
            let isCORSError = false;
            for (let attempt = 0; attempt <= 2; attempt++) {
              try {
                response = await fetch(currentUrl, options);
                if (response && (response.status !== 0 || response.type === "opaque")) {
                  break;
                }
              } catch (fetchError) {
                lastError = fetchError;
                const errorMessage = fetchError.message || "";
                if (errorMessage.includes("CORS") || errorMessage.includes("cross-origin") || errorMessage.includes("Access-Control-Allow-Origin") || errorMessage.includes("Failed to fetch") || errorMessage.includes("NetworkError") || errorMessage.includes("TypeError")) {
                  isCORSError = true;
                  break;
                }
                if (attempt < 2) {
                  await new Promise(
                    (resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1e3)
                  );
                }
              }
            }
            if (isCORSError) {
              const problemHostname = new URL(currentUrl).hostname;
              markCorsFailedDomain(problemHostname);
              try {
                const opaqueResponse = await fetch(requestUrl, {
                  mode: "no-cors",
                  credentials: "omit",
                  referrerPolicy: "no-referrer"
                });
                if (opaqueResponse.type === "opaque") {
                  await notifyImageCacheFailed(requestUrl, "cors_opaque");
                  return opaqueResponse;
                }
              } catch (noCorsError) {
                console.warn(
                  `Service Worker [${requestId}]: no-cors 模式也失败:`,
                  noCorsError
                );
              }
              await notifyImageCacheFailed(requestUrl, "cors_fetch_failed");
              return new Response(null, {
                status: 200,
                headers: {
                  "Content-Type": "image/png",
                  "X-SW-CORS-Bypass": "true"
                }
              });
            }
            if (response && (response.status !== 0 || response.type === "opaque")) {
              break;
            }
            if (lastError) {
              finalError = lastError;
            }
          } catch (fetchError) {
            finalError = fetchError;
            continue;
          }
        }
        if (response && (response.status !== 0 || response.type === "opaque")) {
          break;
        } else {
          if (domainConfig && domainConfig.fallbackDomain && urlIndex === 0 && !shouldUseFallbackDirectly) {
            failedDomains.add(domainConfig.hostname);
            saveFailedDomain(domainConfig.hostname).catch((error) => {
              console.warn("Service Worker: 保存失败域名到数据库时出错:", error);
            });
          }
        }
      }
      if (!response || response.status === 0 && response.type !== "opaque") {
        let errorMessage = "All fetch attempts failed";
        if (domainConfig && domainConfig.fallbackDomain) {
          if (shouldUseFallbackDirectly) {
            errorMessage = `备用域名${domainConfig.fallbackDomain}也失败了`;
          } else {
            errorMessage = `All fetch attempts failed for both ${domainConfig.hostname} and ${domainConfig.fallbackDomain} domains`;
          }
        }
        console.error(
          `Service Worker [${requestId}]: ${errorMessage}`,
          finalError
        );
        await notifyImageCacheFailed(dedupeKey, errorMessage);
        return new Response("Image load failed after all attempts", {
          status: 404,
          statusText: "Image Not Found",
          headers: {
            "Content-Type": "text/plain",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET",
            "Access-Control-Allow-Headers": "*"
          }
        });
      }
      if (response.type === "opaque") {
        const problemHostname = new URL(requestUrl).hostname;
        markCorsFailedDomain(problemHostname);
        await notifyImageCacheFailed(dedupeKey, "cors_opaque");
        return response;
      }
      if (response.ok) {
        const responseClone = response.clone();
        const blob = await responseClone.blob();
        const imageSizeMB = blob.size / (1024 * 1024);
        const corsResponse = new Response(blob, {
          status: 200,
          statusText: "OK",
          headers: {
            "Content-Type": response.headers.get("Content-Type") || "image/png",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET",
            "Access-Control-Allow-Headers": "*",
            "Cache-Control": "max-age=3153600000",
            // 100年
            [SW_CACHE_DATE_HEADER]: Date.now().toString(),
            // 最后访问时间
            [SW_CACHE_CREATED_AT_HEADER]: Date.now().toString(),
            // 首次缓存生成时间
            "sw-image-size": blob.size.toString()
            // 添加图片大小信息
          }
        });
        try {
          if (originalRequest.url.startsWith("http")) {
            await cache.put(dedupeKey, corsResponse.clone());
            if (requestUrl !== dedupeKey) {
              await cache.delete(requestUrl);
            }
            await notifyImageCached(dedupeKey, blob.size, blob.type);
            await checkStorageQuota();
            const { generateThumbnailAsync: generateThumbnailAsync2 } = await Promise.resolve().then(() => thumbnailUtils);
            generateThumbnailAsync2(blob, dedupeKey, "image");
          }
        } catch (cacheError) {
          console.warn(
            `Service Worker: Failed to cache normal response (${imageSizeMB.toFixed(
              2
            )}MB, 可能超出存储限制):`,
            cacheError
          );
          await notifyImageCacheFailed(dedupeKey, String(cacheError));
        }
        return corsResponse;
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (error) {
      const errorUrl = new URL(requestUrl);
      const isSSLError = error.message.includes("SSL_PROTOCOL_ERROR") || error.message.includes("ERR_SSL_PROTOCOL_ERROR") || error.message.includes("net::ERR_CERT") || error.message.includes("ERR_INSECURE_RESPONSE");
      if (isSSLError) {
        console.warn(
          "Service Worker: 检测到SSL/证书错误，尝试跳过Service Worker处理"
        );
        return fetch(requestUrl, {
          method: "GET",
          mode: "no-cors",
          cache: "no-cache",
          credentials: "omit"
        }).catch(() => {
          return new Response("SSL Error - Image not accessible", {
            status: 404,
            statusText: "SSL Protocol Error",
            headers: {
              "Content-Type": "text/plain",
              "Access-Control-Allow-Origin": "*"
            }
          });
        });
      }
      if (errorUrl.pathname.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i) || errorUrl.searchParams.has("_t") || errorUrl.searchParams.has("cache_buster") || errorUrl.searchParams.has("timestamp")) {
        await notifyImageCacheFailed(requestUrl, String((error == null ? void 0 : error.message) || error));
        return new Response("Image not found", {
          status: 404,
          statusText: "Not Found",
          headers: {
            "Content-Type": "text/plain",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
      return new Response(`Network Error: ${error.message}`, {
        status: 500,
        statusText: "Internal Server Error",
        headers: {
          "Content-Type": "text/plain",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
  }
  const IMAGE_CACHE_NAME_THUMB = "drawnix-images-thumb";
  const THUMBNAIL_MAX_SIZE_SMALL = 128;
  const THUMBNAIL_MAX_SIZE_LARGE = 400;
  const THUMBNAIL_QUALITY = 0.8;
  function calculateThumbnailSize(originalWidth, originalHeight, maxSize) {
    const aspectRatio = originalWidth / originalHeight;
    let width = maxSize;
    let height = maxSize;
    if (aspectRatio > 1) {
      height = maxSize / aspectRatio;
    } else {
      width = maxSize * aspectRatio;
    }
    return {
      width: Math.round(width),
      height: Math.round(height)
    };
  }
  function getThumbnailCacheKey(originalUrl, size) {
    try {
      let url;
      try {
        url = new URL(originalUrl);
      } catch {
        url = new URL(originalUrl, self.location.origin);
      }
      url.searchParams.delete("thumbnail");
      url.searchParams.set("_thumb", size);
      return url.toString();
    } catch {
      const separator = originalUrl.includes("?") ? "&" : "?";
      const cleanUrl = originalUrl.replace(/[?&]thumbnail=[^&]*/g, "").replace(/thumbnail=[^&]*&?/, "");
      return `${cleanUrl}${separator}_thumb=${size}`;
    }
  }
  async function generateImageThumbnail(blob, originalUrl, sizes = ["small", "large"]) {
    try {
      for (const size of sizes) {
        await generateThumbnailForSize(blob, originalUrl, size);
      }
    } catch (error) {
      console.warn("[ThumbnailUtils] Failed to generate image thumbnail:", error);
    }
  }
  async function generateThumbnailForSize(blob, originalUrl, size) {
    try {
      const maxSize = size === "large" ? THUMBNAIL_MAX_SIZE_LARGE : THUMBNAIL_MAX_SIZE_SMALL;
      const cacheKey = getThumbnailCacheKey(originalUrl, size);
      const thumbCache = await caches.open(IMAGE_CACHE_NAME_THUMB);
      let existingThumbnail = await thumbCache.match(cacheKey);
      if (!existingThumbnail) {
        const request = new Request(cacheKey, { method: "GET" });
        existingThumbnail = await thumbCache.match(request);
      }
      if (!existingThumbnail) {
        try {
          const url = new URL(cacheKey);
          existingThumbnail = await thumbCache.match(url.pathname);
        } catch {
        }
      }
      if (existingThumbnail) {
        return;
      }
      if (blob.size === 0) return;
      const type = (blob.type || "").toLowerCase();
      if (!type.startsWith("image/") && type !== "") return;
      let imageBitmap;
      try {
        imageBitmap = await createImageBitmap(blob);
      } catch (decodeError) {
        if (decodeError instanceof Error && decodeError.name === "InvalidStateError") {
          return;
        }
        throw decodeError;
      }
      const { width, height } = calculateThumbnailSize(
        imageBitmap.width,
        imageBitmap.height,
        maxSize
      );
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        console.warn("[ThumbnailUtils] Failed to get canvas context");
        return;
      }
      try {
        ctx.drawImage(imageBitmap, 0, 0, width, height);
      } finally {
        imageBitmap.close();
      }
      const thumbnailBlob = await canvas.convertToBlob({
        type: "image/jpeg",
        quality: THUMBNAIL_QUALITY
      });
      const createResponse = () => new Response(thumbnailBlob, {
        headers: {
          "Content-Type": "image/jpeg",
          "Content-Length": thumbnailBlob.size.toString()
        }
      });
      const thumbnailRequest = new Request(cacheKey, { method: "GET" });
      await thumbCache.put(thumbnailRequest, createResponse());
      await thumbCache.put(cacheKey, createResponse());
      try {
        const url = new URL(cacheKey);
        if (url.pathname.startsWith("/__aitu_cache__/") || url.pathname.startsWith("/asset-library/")) {
          await thumbCache.put(cacheKey, createResponse());
        }
      } catch {
      }
    } catch (error) {
      console.warn("[ThumbnailUtils] Failed to generate image thumbnail:", error);
    }
  }
  async function generateVideoThumbnail(blob, originalUrl, sizes = ["small", "large"]) {
    try {
      for (const size of sizes) {
        await generateVideoThumbnailForSize(blob, originalUrl, size);
      }
    } catch (error) {
      console.warn("[ThumbnailUtils] Failed to generate video thumbnail:", error);
    }
  }
  async function generateVideoThumbnailForSize(blob, originalUrl, size) {
    try {
      const cacheKey = getThumbnailCacheKey(originalUrl, size);
      const thumbCache = await caches.open(IMAGE_CACHE_NAME_THUMB);
      let existingThumbnail = await thumbCache.match(cacheKey);
      if (!existingThumbnail) {
        const request = new Request(cacheKey, { method: "GET" });
        existingThumbnail = await thumbCache.match(request);
      }
      if (!existingThumbnail) {
        try {
          const url = new URL(cacheKey);
          existingThumbnail = await thumbCache.match(url.pathname);
        } catch {
        }
      }
      if (existingThumbnail) {
        return;
      }
      const maxSize = size === "large" ? THUMBNAIL_MAX_SIZE_LARGE : THUMBNAIL_MAX_SIZE_SMALL;
      const thumbnailBlob = await requestVideoThumbnailFromMainThread(originalUrl, blob, maxSize);
      if (!thumbnailBlob) {
        console.warn(`[ThumbnailUtils] Failed to generate ${size} video thumbnail from main thread`);
        return;
      }
      const createResponse = () => new Response(thumbnailBlob, {
        headers: {
          "Content-Type": "image/jpeg",
          "Content-Length": thumbnailBlob.size.toString()
        }
      });
      const thumbnailRequest = new Request(cacheKey, { method: "GET" });
      await thumbCache.put(thumbnailRequest, createResponse());
      await thumbCache.put(cacheKey, createResponse());
      try {
        const url = new URL(cacheKey);
        if (url.pathname.startsWith("/__aitu_cache__/") || url.pathname.startsWith("/asset-library/")) {
          await thumbCache.put(cacheKey, createResponse());
        }
      } catch {
      }
    } catch (error) {
      console.warn(`[ThumbnailUtils] ❌ Failed to generate ${size} video thumbnail:`, error);
    }
  }
  async function requestVideoThumbnailFromMainThread(url, _blob, maxSize = THUMBNAIL_MAX_SIZE_LARGE) {
    const requestVideoThumbnail = getSwRuntimeBridge().requestVideoThumbnail;
    if (!requestVideoThumbnail) {
      console.warn("[ThumbnailUtils] No connected clients for video thumbnail generation");
      return null;
    }
    const thumbnailUrl = await requestVideoThumbnail(url, 3e4, maxSize);
    if (!thumbnailUrl) {
      return null;
    }
    try {
      const response = await fetch(thumbnailUrl);
      return await response.blob();
    } catch (error) {
      console.warn("[ThumbnailUtils] Failed to convert thumbnail URL to blob:", error);
      return null;
    }
  }
  function getThumbnailUrl(originalUrl, size = "small") {
    try {
      const url = new URL(originalUrl, self.location.origin);
      url.searchParams.set("thumbnail", size);
      return url.toString();
    } catch {
      const separator = originalUrl.includes("?") ? "&" : "?";
      return `${originalUrl}${separator}thumbnail=${size}`;
    }
  }
  async function ensureThumbnail(originalUrl, type) {
    try {
      const cache = await caches.open("drawnix-images");
      const cachedResponse = await cache.match(originalUrl);
      if (cachedResponse) {
        const blob = await cachedResponse.blob();
        if (type === "image") {
          await generateImageThumbnail(blob, originalUrl, ["small", "large"]);
        } else {
          await generateVideoThumbnail(blob, originalUrl, ["small", "large"]);
        }
      }
    } catch (error) {
      console.warn("[ThumbnailUtils] Failed to generate thumbnail on demand:", error);
    }
    return getThumbnailUrl(originalUrl, "small");
  }
  async function findThumbnail(cacheKey, size, fallbackKeys) {
    try {
      const thumbCache = await caches.open(IMAGE_CACHE_NAME_THUMB);
      const thumbCacheKey = getThumbnailCacheKey(cacheKey, size);
      let thumbnailResponse = await thumbCache.match(thumbCacheKey);
      if (!thumbnailResponse) {
        const thumbnailRequest = new Request(thumbCacheKey, { method: "GET" });
        thumbnailResponse = await thumbCache.match(thumbnailRequest);
      }
      if (!thumbnailResponse && fallbackKeys) {
        for (const fallbackKey of fallbackKeys) {
          const fallbackResponse = await thumbCache.match(fallbackKey);
          if (fallbackResponse) {
            thumbnailResponse = fallbackResponse;
            break;
          }
        }
      }
      return thumbnailResponse ? thumbnailResponse : null;
    } catch (error) {
      console.warn("[ThumbnailUtils] Error finding thumbnail:", error);
      return null;
    }
  }
  async function findThumbnailWithFallback(cacheKey, requestedSize, fallbackKeys) {
    let thumbnailResponse = await findThumbnail(cacheKey, requestedSize, fallbackKeys);
    if (thumbnailResponse) {
      return { response: thumbnailResponse, size: requestedSize };
    }
    const fallbackSize = requestedSize === "small" ? "large" : "small";
    thumbnailResponse = await findThumbnail(cacheKey, fallbackSize, fallbackKeys);
    if (thumbnailResponse) {
      return { response: thumbnailResponse, size: fallbackSize };
    }
    return null;
  }
  function createThumbnailResponse(blob) {
    return new Response(blob, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": blob.size.toString(),
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "max-age=31536000"
      }
    });
  }
  function generateThumbnailAsync(blob, originalUrl, mediaType, sizes = ["small", "large"]) {
    (async () => {
      try {
        if (mediaType === "image") {
          await generateImageThumbnail(blob, originalUrl, sizes);
        } else {
          await generateVideoThumbnail(blob, originalUrl, sizes);
        }
      } catch (error) {
        console.warn(`[ThumbnailUtils] Failed to generate ${mediaType} thumbnail:`, error);
      }
    })();
  }
  const thumbnailUtils = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    IMAGE_CACHE_NAME_THUMB,
    createThumbnailResponse,
    ensureThumbnail,
    findThumbnail,
    findThumbnailWithFallback,
    generateImageThumbnail,
    generateThumbnailAsync,
    generateVideoThumbnail,
    getThumbnailUrl
  }, Symbol.toStringTag, { value: "Module" }));
  const memoryLogs = [];
  const MAX_MEMORY_LOGS = 50;
  const DB_NAME = "llm-api-logs";
  const DB_VERSION = 4;
  const STORE_NAME = "logs";
  const MAX_DB_LOGS = 1e3;
  const MAX_RESPONSE_BODY_LENGTH = 128 * 1024;
  let broadcastCallback = null;
  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        const oldVersion = event.oldVersion;
        let store;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("timestamp", "timestamp", { unique: false });
          store.createIndex("taskType", "taskType", { unique: false });
          store.createIndex("status", "status", { unique: false });
          store.createIndex("taskId", "taskId", { unique: false });
        } else {
          const tx = event.target.transaction;
          if (tx) {
            store = tx.objectStore(STORE_NAME);
            if (oldVersion < 4 && !store.indexNames.contains("taskId")) {
              store.createIndex("taskId", "taskId", { unique: false });
            }
          }
        }
      };
    });
  }
  async function saveLogToDB(log) {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(log);
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      try {
        const cleanTx = db.transaction(STORE_NAME, "readwrite");
        const cleanStore = cleanTx.objectStore(STORE_NAME);
        const countRequest = cleanStore.count();
        countRequest.onsuccess = () => {
          if (countRequest.result > MAX_DB_LOGS) {
            const index = cleanStore.index("timestamp");
            const deleteCount = countRequest.result - MAX_DB_LOGS;
            let deleted = 0;
            index.openCursor().onsuccess = (e2) => {
              const cursor = e2.target.result;
              if (cursor && deleted < deleteCount) {
                cursor.delete();
                deleted++;
                cursor.continue();
              }
            };
          }
        };
      } catch {
      }
    } catch (error) {
      console.warn("[LLMApiLogger] Failed to save log to DB:", error);
    }
  }
  async function updateLogInDB(log) {
    await saveLogToDB(log);
  }
  async function getAllLLMApiLogs() {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("timestamp");
      return new Promise((resolve, reject) => {
        const request = index.getAll();
        request.onsuccess = () => {
          const logs2 = request.result.reverse();
          resolve(logs2);
        };
        request.onerror = () => {
          reject(request.error);
        };
      });
    } catch (error) {
      console.warn("[LLMApiLogger] Failed to get logs from DB:", error);
      return memoryLogs;
    }
  }
  function compactLog(log) {
    return {
      id: log.id,
      timestamp: log.timestamp,
      endpoint: log.endpoint,
      model: log.model,
      taskType: log.taskType,
      taskId: log.taskId,
      prompt: log.prompt ? log.prompt.length > 200 ? log.prompt.substring(0, 200) + "..." : log.prompt : void 0,
      status: log.status,
      httpStatus: log.httpStatus,
      duration: log.duration,
      errorMessage: log.errorMessage,
      hasReferenceImages: log.hasReferenceImages,
      referenceImageCount: log.referenceImageCount,
      // 不传输 referenceImages 完整数据，只传数量
      resultType: log.resultType,
      resultCount: log.resultCount,
      resultUrl: log.resultUrl
      // 不传输 requestBody 和 responseBody
    };
  }
  function matchesTaskTypeFilter(log, taskType) {
    if (!taskType) return true;
    const isLyrics = log.taskType === "audio" && (log.resultType === "lyrics" || /\/lyrics(?:\/|$)/i.test(log.endpoint || ""));
    if (taskType === "lyrics") {
      return isLyrics;
    }
    if (taskType === "audio") {
      return log.taskType === "audio" && !isLyrics;
    }
    return log.taskType === taskType;
  }
  async function getLLMApiLogsPaginated(page = 1, pageSize = 20, filter) {
    let allLogs = await getAllLLMApiLogs();
    if (filter == null ? void 0 : filter.taskType) {
      allLogs = allLogs.filter(
        (log) => matchesTaskTypeFilter(log, filter.taskType)
      );
    }
    if (filter == null ? void 0 : filter.status) {
      allLogs = allLogs.filter((log) => log.status === filter.status);
    }
    const total = allLogs.length;
    const totalPages = Math.ceil(total / pageSize);
    const startIndex = (page - 1) * pageSize;
    const logs2 = allLogs.slice(startIndex, startIndex + pageSize).map(compactLog);
    return {
      logs: logs2,
      total,
      page,
      pageSize,
      totalPages
    };
  }
  async function getLLMApiLogById(logId) {
    const memoryLog = memoryLogs.find((l2) => l2.id === logId);
    if (memoryLog) return memoryLog;
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      return new Promise((resolve, reject) => {
        const request = store.get(logId);
        request.onsuccess = () => {
          resolve(request.result || null);
        };
        request.onerror = () => {
          reject(request.error);
        };
      });
    } catch (error) {
      console.warn("[LLMApiLogger] Failed to get log by id:", error);
      return null;
    }
  }
  async function findSuccessLogByTaskId(taskId) {
    const memoryLog = memoryLogs.find(
      (log) => log.taskId === taskId && log.status === "success" && log.resultUrl
    );
    if (memoryLog) {
      return memoryLog;
    }
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("taskId");
      return new Promise((resolve) => {
        const request = index.getAll(taskId);
        request.onsuccess = () => {
          const results = request.result;
          const successLog = results.filter((l2) => l2.status === "success" && l2.resultUrl).sort((a2, b) => b.timestamp - a2.timestamp)[0];
          resolve(successLog || null);
        };
        request.onerror = () => {
          resolve(null);
        };
      });
    } catch (error) {
      console.warn("[LLMApiLogger] Failed to find log by taskId:", error);
      return null;
    }
  }
  async function findLatestLogByTaskId(taskId) {
    const memoryLog = memoryLogs.find((log) => log.taskId === taskId);
    if (memoryLog) {
      return memoryLog;
    }
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      return new Promise((resolve) => {
        let request;
        let useIndex = false;
        if (store.indexNames.contains("taskId")) {
          const index = store.index("taskId");
          request = index.getAll(taskId);
          useIndex = true;
        } else {
          console.warn(
            "[LLMApiLogger] taskId index not found, falling back to full scan"
          );
          request = store.getAll();
        }
        request.onsuccess = () => {
          let results = request.result;
          if (!useIndex) {
            results = results.filter((log) => log.taskId === taskId);
          }
          const latestLog = results.sort((a2, b) => b.timestamp - a2.timestamp)[0];
          resolve(latestLog || null);
        };
        request.onerror = () => {
          resolve(null);
        };
      });
    } catch (error) {
      console.warn("[LLMApiLogger] Failed to find latest log by taskId:", error);
      return null;
    }
  }
  async function clearAllLLMApiLogs() {
    memoryLogs.length = 0;
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => {
          resolve();
        };
        tx.onerror = () => {
          reject(tx.error);
        };
      });
    } catch (error) {
      console.warn("[LLMApiLogger] Failed to clear logs from DB:", error);
    }
  }
  async function deleteLLMApiLogs(logIds) {
    if (!logIds || logIds.length === 0) return 0;
    const idsSet = new Set(logIds);
    const beforeCount = memoryLogs.length;
    for (let i2 = memoryLogs.length - 1; i2 >= 0; i2--) {
      if (idsSet.has(memoryLogs[i2].id)) {
        memoryLogs.splice(i2, 1);
      }
    }
    const deletedFromMemory = beforeCount - memoryLogs.length;
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      for (const id of logIds) {
        store.delete(id);
      }
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => {
          resolve();
        };
        tx.onerror = () => {
          reject(tx.error);
        };
      });
    } catch (error) {
      console.warn("[LLMApiLogger] Failed to delete logs from DB:", error);
    }
    return deletedFromMemory;
  }
  function setLLMApiLogBroadcast(callback) {
    broadcastCallback = callback;
  }
  function getMemoryLLMApiLogs() {
    return [...memoryLogs];
  }
  function startLLMApiLog(params) {
    const id = `llm-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const log = {
      id,
      timestamp: Date.now(),
      endpoint: params.endpoint,
      model: params.model,
      taskType: params.taskType,
      prompt: params.prompt ? truncatePrompt(params.prompt) : void 0,
      // 对请求体进行脱敏处理，过滤 API Key 等敏感信息
      requestBody: params.requestBody ? sanitizeRequestBody(params.requestBody) : void 0,
      hasReferenceImages: params.hasReferenceImages,
      referenceImageCount: params.referenceImageCount,
      referenceImages: params.referenceImages,
      status: "pending",
      taskId: params.taskId,
      workflowId: params.workflowId
    };
    memoryLogs.unshift(log);
    if (memoryLogs.length > MAX_MEMORY_LOGS) {
      memoryLogs.pop();
    }
    saveLogToDB(log);
    if (broadcastCallback) {
      broadcastCallback({ ...log });
    }
    return id;
  }
  function completeLLMApiLog(logId, params) {
    const log = memoryLogs.find((l2) => l2.id === logId);
    if (log) {
      log.status = "success";
      log.httpStatus = params.httpStatus;
      log.duration = params.duration;
      log.resultType = params.resultType;
      log.resultCount = params.resultCount;
      log.resultUrl = params.resultUrl;
      log.resultText = params.resultText ? truncateText(params.resultText, 1e3) : void 0;
      log.responseBody = params.responseBody ? truncateResponseBody(params.responseBody) : void 0;
      if (params.remoteId) log.remoteId = params.remoteId;
      updateLogInDB(log);
      if (broadcastCallback) {
        broadcastCallback({ ...log });
      }
    }
  }
  function updateLLMApiLogMetadata(logId, params) {
    const log = memoryLogs.find((l2) => l2.id === logId);
    if (log) {
      if (params.remoteId) log.remoteId = params.remoteId;
      if (params.responseBody)
        log.responseBody = truncateResponseBody(params.responseBody);
      if (params.httpStatus) log.httpStatus = params.httpStatus;
      updateLogInDB(log);
      if (broadcastCallback) {
        broadcastCallback({ ...log });
      }
    }
  }
  function failLLMApiLog(logId, params) {
    const log = memoryLogs.find((l2) => l2.id === logId);
    if (log) {
      log.status = "error";
      log.httpStatus = params.httpStatus;
      log.duration = params.duration;
      log.errorMessage = truncateError(params.errorMessage);
      log.responseBody = params.responseBody ? truncateResponseBody(params.responseBody) : void 0;
      if (params.remoteId) log.remoteId = params.remoteId;
      updateLogInDB(log);
      if (broadcastCallback) {
        broadcastCallback({ ...log });
      }
    }
  }
  function truncatePrompt(prompt) {
    if (prompt.length <= 2e3) return prompt;
    return prompt.substring(0, 2e3) + "...";
  }
  function truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  }
  function truncateResponseBody(text) {
    if (text.length <= MAX_RESPONSE_BODY_LENGTH) return text;
    return `${text.substring(
      0,
      MAX_RESPONSE_BODY_LENGTH
    )}
... [response truncated for log storage]`;
  }
  function truncateError(error) {
    if (error.length <= 500) return error;
    return error.substring(0, 500) + "...";
  }
  async function llmFetch(input, init, meta) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const endpoint = new URL(url).pathname;
    const startTime = Date.now();
    const logId = startLLMApiLog({
      endpoint,
      model: meta.model,
      taskType: meta.taskType,
      prompt: meta.prompt,
      hasReferenceImages: meta.hasReferenceImages,
      referenceImageCount: meta.referenceImageCount,
      referenceImages: meta.referenceImages,
      taskId: meta.taskId,
      workflowId: meta.workflowId
    });
    try {
      const response = await fetch(input, init);
      const duration = Date.now() - startTime;
      if (response.ok) {
        completeLLMApiLog(logId, {
          httpStatus: response.status,
          duration,
          resultType: meta.taskType === "image" ? "image" : meta.taskType === "video" ? "video" : "text",
          resultCount: 1
        });
      } else {
        const errorText = await response.clone().text().catch(() => "Unknown error");
        failLLMApiLog(logId, {
          httpStatus: response.status,
          duration,
          errorMessage: errorText
        });
      }
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      failLLMApiLog(logId, {
        duration,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
  const llmApiLogger = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    clearAllLLMApiLogs,
    completeLLMApiLog,
    deleteLLMApiLogs,
    failLLMApiLog,
    findLatestLogByTaskId,
    findSuccessLogByTaskId,
    getAllLLMApiLogs,
    getLLMApiLogById,
    getLLMApiLogsPaginated,
    getMemoryLLMApiLogs,
    llmFetch,
    setLLMApiLogBroadcast,
    startLLMApiLog,
    updateLLMApiLogMetadata
  }, Symbol.toStringTag, { value: "Module" }));
  exports.APP_VERSION = APP_VERSION;
  exports.IMAGE_CACHE_NAME = IMAGE_CACHE_NAME;
  exports.addConsoleLog = addConsoleLog;
  exports.clearAllConsoleLogs = clearAllConsoleLogs;
  exports.clearConsoleLogs = clearConsoleLogs;
  exports.clearCrashSnapshots = clearCrashSnapshots;
  exports.clearDebugLogs = clearDebugLogs;
  exports.deleteCacheByUrl = deleteCacheByUrl;
  exports.disableDebugMode = disableDebugMode;
  exports.enableDebugMode = enableDebugMode;
  exports.getCDNStatusReport = getCDNStatusReport;
  exports.getCacheStats = getCacheStats;
  exports.getCrashSnapshots = getCrashSnapshots;
  exports.getDebugLogs = getDebugLogs;
  exports.getDebugStatus = getDebugStatus;
  exports.getInternalFetchLogs = getInternalFetchLogs;
  exports.loadConsoleLogsFromDB = loadConsoleLogsFromDB;
  exports.performHealthCheck = performHealthCheck;
  exports.resetCDNStatus = resetCDNStatus;
  exports.saveCrashSnapshot = saveCrashSnapshot;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  return exports;
})({});
//# sourceMappingURL=sw.js.map
