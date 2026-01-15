/**
 * Azure App Service 备份服务器
 * 
 * 部署步骤：
 * 1. 在 Azure Portal 创建 App Service（Node.js）
 * 2. 配置应用设置：
 *    - STORAGE_ACCOUNT_NAME: 存储账户名称
 *    - STORAGE_ACCOUNT_KEY: 存储账户密钥
 *    - CONTAINER_NAME: 容器名称
 * 3. 使用 Azure DevOps 或 GitHub Actions 部署
 * 4. 或使用 VS Code Azure 扩展直接部署
 * 
 * package.json 依赖：
 * {
 *   "dependencies": {
 *     "express": "^4.18.0",
 *     "multer": "^1.4.5",
 *     "cors": "^2.8.5",
 *     "@azure/storage-blob": "^12.0.0"
 *   }
 * }
 */

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { BlobServiceClient } = require('@azure/storage-blob');
const sql = require('mssql');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;

// 创建 HTTP 服务器（用于 WebSocket）
const server = http.createServer(app);

// 启用 CORS
app.use(cors());
// 增加 JSON payload 大小限制到 10MB（避免 413 错误）
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 配置 multer（用于临时存储）
const upload = multer({ 
    dest: 'uploads/',
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB
    }
});

// 初始化 Azure Blob Storage
let blobServiceClient;
let containerClient;

function initializeBlobStorage() {
    const storageAccountName = process.env.STORAGE_ACCOUNT_NAME;
    const storageAccountKey = process.env.STORAGE_ACCOUNT_KEY;
    const containerName = process.env.CONTAINER_NAME || 'backups';

    if (!storageAccountName || !storageAccountKey) {
        console.error('Azure Storage not configured');
        return null;
    }

    const connectionString = `DefaultEndpointsProtocol=https;AccountName=${storageAccountName};AccountKey=${storageAccountKey};EndpointSuffix=core.windows.net`;
    blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    containerClient = blobServiceClient.getContainerClient(containerName);

    // 确保容器存在
    containerClient.createIfNotExists().then(() => {
        console.log(`Container ${containerName} ready`);
    }).catch(err => {
        console.error('Failed to create container:', err);
    });

    return containerClient;
}

// 初始化 SQL 连接池
let sqlPool = null;
let sqlConnectionError = null;

async function initializeSqlConnection() {
    const connectionString = process.env.SQL_CONNECTION_STRING;
    
    if (!connectionString) {
        const errorMsg = 'SQL connection string not configured, license validation will be disabled';
        console.warn(errorMsg);
        sqlConnectionError = errorMsg;
        return null;
    }

    try {
        console.log('Attempting to connect to SQL Database...');
        sqlPool = await sql.connect(connectionString);
        console.log('SQL Database connected successfully');
        sqlConnectionError = null;
        return sqlPool;
    } catch (error) {
        const errorMsg = `Failed to connect to SQL Database: ${error.message}`;
        console.error(errorMsg);
        console.error('Error details:', error);
        sqlConnectionError = errorMsg;
        sqlPool = null;
        return null;
    }
}

// 初始化
initializeBlobStorage();

// 等待数据库连接完成后再启动服务器
let serverStarted = false;

async function startServer() {
    if (serverStarted) return;
    
    // 尝试初始化数据库连接
    await initializeSqlConnection();
    
    // 即使数据库连接失败，也启动服务器（其他功能仍可使用）
    if (!sqlPool) {
        console.warn('Server starting without SQL Database connection. License validation endpoints will return 404.');
    }
    
    server.listen(PORT, () => {
        serverStarted = true;
        console.log(`Azure backup server running on port ${PORT}`);
        console.log(`Health check: http://localhost:${PORT}/health`);
        console.log(`Upload endpoint: http://localhost:${PORT}/backup/upload`);
        console.log(`License validate: http://localhost:${PORT}/license/validate`);
        console.log(`License authenticate: http://localhost:${PORT}/license/authenticate`);
        console.log(`License renew: http://localhost:${PORT}/license/renew`);
        console.log(`Sync pull: http://localhost:${PORT}/sync/pull`);
        console.log(`Sync push: http://localhost:${PORT}/sync/push`);
        console.log(`Sync hash: http://localhost:${PORT}/sync/hash`);
        console.log(`API customers: http://localhost:${PORT}/api/customers`);
        console.log(`API sessions: http://localhost:${PORT}/api/sessions`);
        console.log(`API weighings: http://localhost:${PORT}/api/weighings`);
        console.log(`API metalTypes: http://localhost:${PORT}/api/metalTypes`);
        console.log(`WebSocket: ws://localhost:${PORT}/ws?activationId=XXX`);
        if (!sqlPool) {
            console.log(`⚠️  SQL Database: NOT CONNECTED - License and API endpoints will be unavailable`);
        } else {
            console.log(`✅ SQL Database: CONNECTED`);
        }
    });
}

// ==================== WebSocket 服务器 ====================
// 存储所有连接的客户端（按 activationId 分组）
const wsClients = new Map(); // Map<activationId, Set<WebSocket>>

// 创建 WebSocket 服务器
const wss = new WebSocket.Server({ 
    server: server,
    path: '/ws'
});

wss.on('connection', (ws, req) => {
    // 从URL获取 activationId
    const url = new URL(req.url, `http://${req.headers.host}`);
    const activationId = url.searchParams.get('activationId');
    
    if (!activationId) {
        console.log('[WebSocket] Connection rejected: no activationId');
        ws.close(1008, 'activationId required');
        return;
    }
    
    const activationIdNum = parseInt(activationId);
    if (isNaN(activationIdNum)) {
        console.log('[WebSocket] Connection rejected: invalid activationId');
        ws.close(1008, 'invalid activationId');
        return;
    }
    
    // 添加到对应 activationId 的客户端列表
    if (!wsClients.has(activationIdNum)) {
        wsClients.set(activationIdNum, new Set());
    }
    wsClients.get(activationIdNum).add(ws);
    
    console.log(`[WebSocket] Client connected for activationId: ${activationIdNum} (total: ${wsClients.get(activationIdNum).size})`);
    
    // 发送连接确认
    ws.send(JSON.stringify({
        type: 'connected',
        message: 'WebSocket connection established'
    }));
    
    // 客户端断开时清理
    ws.on('close', () => {
        const clientSet = wsClients.get(activationIdNum);
        if (clientSet) {
            clientSet.delete(ws);
            if (clientSet.size === 0) {
                wsClients.delete(activationIdNum);
            } else {
                console.log(`[WebSocket] Client disconnected for activationId: ${activationIdNum} (remaining: ${clientSet.size})`);
            }
        }
    });
    
    ws.on('error', (error) => {
        console.error(`[WebSocket] Error for activationId ${activationIdNum}:`, error);
    });
});

/**
 * 向指定 activationId 的所有客户端广播消息
 */
function broadcastToActivation(activationId, message) {
    const clientSet = wsClients.get(activationId);
    if (clientSet && clientSet.size > 0) {
        const data = JSON.stringify(message);
        let sentCount = 0;
        clientSet.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(data);
                    sentCount++;
                } catch (error) {
                    console.error(`[WebSocket] Failed to send message to client:`, error);
                }
            }
        });
        console.log(`[WebSocket] Broadcasted "${message.type}" to ${sentCount}/${clientSet.size} clients for activationId: ${activationId}`);
    } else {
        console.log(`[WebSocket] No clients connected for activationId: ${activationId}`);
    }
}

// 启动服务器
startServer();

// 备份上传端点
app.post('/backup/upload', upload.fields([
    { name: 'database', maxCount: 1 },
    { name: 'manifest', maxCount: 1 },
    { name: 'files' }
]), async (req, res) => {
    try {
        if (!containerClient) {
            return res.status(500).json({
                success: false,
                message: 'Azure Storage not configured'
            });
        }

        const activationId = req.body.activationId;
        const timestamp = req.body.timestamp || new Date().toISOString();
        const version = req.body.version || 'unknown';

        if (!activationId) {
            return res.status(400).json({
                success: false,
                message: 'activationId is required'
            });
        }

        const backupId = `backup_${activationId}_${Date.now()}`;
        const backupPrefix = `${activationId}/${backupId}`;

        // 上传数据库文件
        if (req.files.database) {
            const dbFile = req.files.database[0];
            const dbContent = require('fs').readFileSync(dbFile.path);
            const blobName = `${backupPrefix}/database.json`;
            const blockBlobClient = containerClient.getBlockBlobClient(blobName);
            
            await blockBlobClient.upload(dbContent, dbContent.length, {
                blobHTTPHeaders: { blobContentType: 'application/json' }
            });
            
            // 清理临时文件
            require('fs').unlinkSync(dbFile.path);
        }

        // 上传清单文件
        if (req.files.manifest) {
            const manifestFile = req.files.manifest[0];
            const manifestContent = require('fs').readFileSync(manifestFile.path);
            const blobName = `${backupPrefix}/manifest.json`;
            const blockBlobClient = containerClient.getBlockBlobClient(blobName);
            
            await blockBlobClient.upload(manifestContent, manifestContent.length, {
                blobHTTPHeaders: { blobContentType: 'application/json' }
            });
            
            require('fs').unlinkSync(manifestFile.path);
        }

        // 上传文件
        let fileCount = 0;
        if (req.files.files) {
            for (const file of req.files.files) {
                const fileContent = require('fs').readFileSync(file.path);
                const fileName = file.originalname || `file_${fileCount}`;
                const blobName = `${backupPrefix}/files/${fileName}`;
                const blockBlobClient = containerClient.getBlockBlobClient(blobName);
                
                await blockBlobClient.upload(fileContent, fileContent.length, {
                    blobHTTPHeaders: { 
                        blobContentType: file.mimetype || 'application/octet-stream' 
                    }
                });
                
                require('fs').unlinkSync(file.path);
                fileCount++;
            }
        }

        // 保存元数据
        const metadata = {
            backupId,
            activationId: parseInt(activationId),
            timestamp,
            version,
            fileCount,
            createdAt: new Date().toISOString()
        };

        const metadataBlobName = `${backupPrefix}/metadata.json`;
        const metadataBlobClient = containerClient.getBlockBlobClient(metadataBlobName);
        const metadataContent = Buffer.from(JSON.stringify(metadata, null, 2));
        await metadataBlobClient.upload(metadataContent, metadataContent.length, {
            blobHTTPHeaders: { blobContentType: 'application/json' }
        });

        res.json({
            success: true,
            backupId,
            message: 'Backup uploaded successfully',
            timestamp: metadata.createdAt
        });
    } catch (error) {
        console.error('Backup error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Backup failed'
        });
    }
});

// 健康检查
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        storageConfigured: !!containerClient,
        sqlConfigured: !!sqlPool,
        sqlError: sqlConnectionError || null
    });
});

// 获取备份列表
app.get('/backup/list/:activationId', async (req, res) => {
    try {
        if (!containerClient) {
            return res.status(500).json({ error: 'Storage not configured' });
        }

        const { activationId } = req.params;
        const backups = [];

        // 列出该激活ID的所有备份
        for await (const blob of containerClient.listBlobsFlat({ prefix: `${activationId}/` })) {
            if (blob.name.endsWith('/metadata.json')) {
                const blobClient = containerClient.getBlockBlobClient(blob.name);
                const metadataContent = await blobClient.downloadToBuffer();
                const metadata = JSON.parse(metadataContent.toString());
                backups.push(metadata);
            }
        }

        backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        res.json({ backups });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== 许可证验证端点 ====================

// 验证许可证过期时间
app.post('/license/validate', async (req, res) => {
    try {
        const { activationCode } = req.body;

        if (!activationCode) {
            return res.status(400).json({
                expired: true,
                message: 'Activation code is required'
            });
        }

        if (!sqlPool) {
            // 如果 SQL 未配置，返回 404 让客户端回退到本地验证
            return res.status(404).json({
                success: false,
                message: 'License validation endpoint not available'
            });
        }

        // 查询激活码
        const result = await sqlPool.request()
            .input('activationCode', sql.NVarChar, activationCode)
            .query(`
                SELECT activation_code, expires_at, is_active
                FROM activations
                WHERE activation_code = @activationCode
            `);

        if (result.recordset.length === 0) {
            return res.status(200).json({
                expired: true,
                message: 'Activation code not found'
            });
        }

        const activation = result.recordset[0];
        
        if (!activation.is_active) {
            return res.status(200).json({
                expired: true,
                expiresAt: activation.expires_at,
                message: 'Activation code is disabled'
            });
        }

        const now = new Date();
        const expiresAt = new Date(activation.expires_at);
        const expired = now > expiresAt;

        res.json({
            expired,
            expiresAt: activation.expires_at,
            message: expired ? 'License has expired' : 'License is valid'
        });
    } catch (error) {
        console.error('License validation error:', error);
        res.status(500).json({
            expired: false,
            message: `Server error: ${error.message}`
        });
    }
});

// 用户登录验证（验证用户名、密码和激活码）
// 如果 activationCode 未提供，服务器会查找该用户名对应的激活码
app.post('/license/authenticate', async (req, res) => {
    try {
        const { username, password, activationCode } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Username and password are required'
            });
        }

        if (!sqlPool) {
            console.error('Authentication endpoint called but SQL pool is not initialized');
            console.error('SQL connection error:', sqlConnectionError);
            return res.status(404).json({
                success: false,
                message: 'Authentication endpoint not available',
                error: sqlConnectionError || 'SQL connection not configured'
            });
        }

        // 查询用户和激活码
        let result;
        if (activationCode) {
            // 如果提供了激活码，使用激活码查询
            result = await sqlPool.request()
                .input('activationCode', sql.NVarChar, activationCode)
                .input('username', sql.NVarChar, username)
                .query(`
                    SELECT 
                        u.id,
                        u.username,
                        u.password_hash,
                        u.role,
                        u.is_active as user_active,
                        a.id as activation_id,
                        a.activation_code,
                        a.company_name,
                        a.expires_at,
                        a.is_active as activation_active
                    FROM users u
                    INNER JOIN activations a ON u.activation_id = a.id
                    WHERE a.activation_code = @activationCode 
                        AND u.username = @username
                `);
        } else {
            // 如果没有提供激活码，只根据用户名查询（用于首次登录）
            result = await sqlPool.request()
                .input('username', sql.NVarChar, username)
                .query(`
                    SELECT 
                        u.id,
                        u.username,
                        u.password_hash,
                        u.role,
                        u.is_active as user_active,
                        a.id as activation_id,
                        a.activation_code,
                        a.company_name,
                        a.expires_at,
                        a.is_active as activation_active
                    FROM users u
                    INNER JOIN activations a ON u.activation_id = a.id
                    WHERE u.username = @username
                `);
        }

        if (result.recordset.length === 0) {
            return res.status(200).json({
                success: false,
                message: 'Invalid username, password or activation code'
            });
        }

        const user = result.recordset[0];

        // 检查用户和激活码是否激活
        if (!user.user_active || !user.activation_active) {
            return res.status(200).json({
                success: false,
                message: 'User or activation code is disabled'
            });
        }

        // 验证密码（使用 bcrypt）
        const bcrypt = require('bcryptjs');
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);

        if (!isPasswordValid) {
            return res.status(200).json({
                success: false,
                message: 'Invalid username, password or activation code'
            });
        }

        // 检查是否过期
        const now = new Date();
        const expiresAt = new Date(user.expires_at);
        const expired = now > expiresAt;

        if (expired) {
            return res.status(200).json({
                success: false,
                expired: true,
                message: 'Account has expired',
                expiresAt: user.expires_at
            });
        }

        // 验证成功，返回用户信息（不包含密码）
        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                activation_id: user.activation_id,
                activation_code: user.activation_code,
                company_name: user.company_name,
                expires_at: user.expires_at
            },
            message: 'Authentication successful'
        });
    } catch (error) {
        console.error('User authentication error:', error);
        res.status(500).json({
            success: false,
            message: `Server error: ${error.message}`
        });
    }
});

// 报告续费操作（更新激活码过期时间）
app.post('/license/renew', async (req, res) => {
    try {
        const { activationCode, expiresAt, username } = req.body;

        if (!activationCode || !expiresAt) {
            return res.status(400).json({
                success: false,
                message: 'Activation code and expiresAt are required'
            });
        }

        if (!sqlPool) {
            // 如果 SQL 未配置，返回成功（本地已更新）
            return res.status(200).json({
                success: true,
                message: 'Renewal completed locally (server endpoint not available)'
            });
        }

        // 验证激活码存在且未被使用
        const checkResult = await sqlPool.request()
            .input('activationCode', sql.NVarChar, activationCode)
            .query(`
                SELECT id, used_for_renewal 
                FROM activations 
                WHERE activation_code = @activationCode
            `);

        if (checkResult.recordset.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Activation code not found'
            });
        }

        const activation = checkResult.recordset[0];
        const activationId = activation.id;

        // 检查激活码是否已被用于续费
        if (activation.used_for_renewal === true || activation.used_for_renewal === 1) {
            return res.status(400).json({
                success: false,
                message: 'This activation code has already been used for renewal and cannot be used again'
            });
        }

        // 更新激活码过期时间并标记为已使用
        const updateResult = await sqlPool.request()
            .input('activationCode', sql.NVarChar, activationCode)
            .input('expiresAt', sql.DateTime2, new Date(expiresAt))
            .query(`
                UPDATE activations
                SET expires_at = @expiresAt,
                    used_for_renewal = 1,
                    updated_at = GETUTCDATE()
                WHERE activation_code = @activationCode
            `);

        if (updateResult.rowsAffected[0] > 0) {
            // 如果提供了用户名，将用户关联到该激活码（如果用户存在）
            if (username) {
                try {
                    const userCheckResult = await sqlPool.request()
                        .input('username', sql.NVarChar, username)
                        .query(`
                            SELECT id, activation_id FROM users WHERE username = @username AND is_active = 1
                        `);

                    if (userCheckResult.recordset.length > 0) {
                        const user = userCheckResult.recordset[0];
                        // 如果用户关联的激活码不同，更新用户关联到新激活码
                        if (user.activation_id !== activationId) {
                            await sqlPool.request()
                                .input('userId', sql.Int, user.id)
                                .input('activationId', sql.Int, activationId)
                                .query(`
                                    UPDATE users
                                    SET activation_id = @activationId,
                                        updated_at = GETUTCDATE()
                                    WHERE id = @userId
                                `);
                            console.log(`Updated user ${username} to use activation code ${activationCode}`);
                        }
                    }
                } catch (error) {
                    console.warn('Failed to update user activation association:', error);
                    // 不阻止续费成功
                }
            }

            res.json({
                success: true,
                message: 'Renewal recorded successfully',
                expiresAt: expiresAt
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to update expiration date'
            });
        }
    } catch (error) {
        console.error('License renewal error:', error);
        res.status(500).json({
            success: false,
            message: `Server error: ${error.message}`
        });
    }
});

// 根据用户名获取用户关联的激活码（用于激活功能）
app.post('/license/get-user-activation', async (req, res) => {
    try {
        const { username } = req.body;

        if (!username) {
            return res.status(400).json({
                success: false,
                message: 'Username is required'
            });
        }

        if (!sqlPool) {
            return res.status(404).json({
                success: false,
                message: 'Endpoint not available'
            });
        }

        // 查询用户关联的激活码
        const result = await sqlPool.request()
            .input('username', sql.NVarChar, username)
            .query(`
                SELECT 
                    a.activation_code,
                    a.expires_at,
                    a.is_active
                FROM users u
                INNER JOIN activations a ON u.activation_id = a.id
                WHERE u.username = @username AND u.is_active = 1
            `);

        if (result.recordset.length === 0) {
            return res.status(200).json({
                success: false,
                message: 'User not found'
            });
        }

        const activation = result.recordset[0];
        
        res.json({
            success: true,
            activationCode: activation.activation_code,
            expiresAt: activation.expires_at,
            isActive: activation.is_active
        });
    } catch (error) {
        console.error('Get user activation error:', error);
        res.status(500).json({
            success: false,
            message: `Server error: ${error.message}`
        });
    }
});

// ==================== 数据同步端点 ====================

// 从云端拉取同步数据
app.get('/sync/pull', async (req, res) => {
    try {
        if (!containerClient) {
            return res.status(500).json({
                success: false,
                message: 'Azure Storage not configured'
            });
        }

        const activationId = req.query.activationId;
        const since = req.query.since || '1970-01-01T00:00:00.000Z';

        if (!activationId) {
            return res.status(400).json({
                success: false,
                message: 'activationId is required'
            });
        }

        console.log(`[Sync] Pull request: activationId=${activationId}, since=${since}`);

        // 查找该激活ID的最新备份
        let latestBackup = null;
        let latestBackupTime = null;

        for await (const blob of containerClient.listBlobsFlat({ prefix: `${activationId}/` })) {
            if (blob.name.endsWith('/metadata.json')) {
                try {
                    const blobClient = containerClient.getBlockBlobClient(blob.name);
                    const metadataContent = await blobClient.downloadToBuffer();
                    const metadata = JSON.parse(metadataContent.toString());
                    
                    const backupTime = new Date(metadata.timestamp || metadata.createdAt);
                    if (!latestBackupTime || backupTime > latestBackupTime) {
                        latestBackupTime = backupTime;
                        latestBackup = {
                            prefix: blob.name.replace('/metadata.json', ''),
                            metadata: metadata
                        };
                    }
                } catch (error) {
                    console.error(`[Sync] Error reading backup metadata ${blob.name}:`, error);
                    // 继续查找下一个备份
                }
            }
        }

        if (!latestBackup) {
            // 没有找到备份，返回空数据
            console.log(`[Sync] No backup found for activationId ${activationId}`);
            return res.json({
                customers: [],
                weighingSessions: [],
                weighings: [],
                biometricData: [],
                vehicles: [],
                metalTypes: []
            });
        }

        // 下载数据库文件
        const databaseBlobName = `${latestBackup.prefix}/database.json`;
        const databaseBlobClient = containerClient.getBlockBlobClient(databaseBlobName);
        
        let databaseContent;
        try {
            databaseContent = await databaseBlobClient.downloadToBuffer();
        } catch (error) {
            console.error(`[Sync] Error downloading database.json:`, error);
            return res.status(500).json({
                success: false,
                message: 'Failed to download database backup'
            });
        }

        const databaseData = JSON.parse(databaseContent.toString());
        
        // 备份数据格式可能是两种：
        // 1. 新格式：{ tables: { customers: [...], weighing_sessions: [...] } }
        // 2. 旧格式：{ customers: [...], weighingSessions: [...] }
        
        let customers, weighingSessions, weighings, biometricData, vehicles, metalTypes;
        
        if (databaseData.tables) {
            // 新格式：从 tables 对象中提取数据
            customers = databaseData.tables.customers || [];
            weighingSessions = databaseData.tables.weighing_sessions || [];
            weighings = databaseData.tables.weighings || [];
            biometricData = databaseData.tables.biometric_data || [];
            vehicles = databaseData.tables.vehicles || [];
            metalTypes = databaseData.tables.metal_types || [];
        } else {
            // 旧格式：直接使用
            customers = databaseData.customers || [];
            weighingSessions = databaseData.weighingSessions || databaseData.weighing_sessions || [];
            weighings = databaseData.weighings || [];
            biometricData = databaseData.biometricData || databaseData.biometric_data || [];
            vehicles = databaseData.vehicles || [];
            metalTypes = databaseData.metalTypes || databaseData.metal_types || [];
        }
        
        // 过滤数据：只返回 since 时间之后更新的数据
        const sinceDate = new Date(since);
        const filterByDate = (items, useCreatedAt = false) => {
            if (!items || !Array.isArray(items)) return [];
            return items.filter(item => {
                // weighings 表只有 created_at，没有 updated_at
                const updatedAt = useCreatedAt 
                    ? (item.created_at || item.weighing_time)
                    : (item.updated_at || item.created_at || item.session_time);
                if (!updatedAt) return false;
                const itemDate = new Date(updatedAt);
                return itemDate >= sinceDate;
            });
        };

        // 返回过滤后的数据（使用同步服务期望的格式）
        // weighings 表只有 created_at，没有 updated_at，所以使用 useCreatedAt = true
        const response = {
            customers: filterByDate(customers),
            weighingSessions: filterByDate(weighingSessions),
            weighings: filterByDate(weighings, true), // weighings 使用 created_at
            biometricData: filterByDate(biometricData),
            vehicles: filterByDate(vehicles),
            metalTypes: filterByDate(metalTypes)
        };

        console.log(`[Sync] Returning data: customers=${response.customers.length}, sessions=${response.weighingSessions.length}, weighings=${response.weighings.length}`);

        res.json(response);
    } catch (error) {
        console.error('[Sync] Pull error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to pull sync data'
        });
    }
});

// 推送数据到云端（用于同步）
app.post('/sync/push', async (req, res) => {
    try {
        if (!containerClient) {
            return res.status(500).json({
                success: false,
                message: 'Azure Storage not configured'
            });
        }

        const { activationId, data } = req.body;

        if (!activationId || !data) {
            return res.status(400).json({
                success: false,
                message: 'activationId and data are required'
            });
        }

        // 将同步数据保存为备份
        const backupId = `sync_${activationId}_${Date.now()}`;
        const backupPrefix = `${activationId}/${backupId}`;

        // 保存数据库数据
        const databaseBlobName = `${backupPrefix}/database.json`;
        const databaseBlobClient = containerClient.getBlockBlobClient(databaseBlobName);
        const databaseContent = Buffer.from(JSON.stringify(data, null, 2));
        await databaseBlobClient.upload(databaseContent, databaseContent.length, {
            blobHTTPHeaders: { blobContentType: 'application/json' }
        });

        // 保存元数据
        const metadata = {
            backupId,
            activationId: parseInt(activationId),
            timestamp: new Date().toISOString(),
            type: 'sync',
            createdAt: new Date().toISOString()
        };

        const metadataBlobName = `${backupPrefix}/metadata.json`;
        const metadataBlobClient = containerClient.getBlockBlobClient(metadataBlobName);
        const metadataContent = Buffer.from(JSON.stringify(metadata, null, 2));
        await metadataBlobClient.upload(metadataContent, metadataContent.length, {
            blobHTTPHeaders: { blobContentType: 'application/json' }
        });

        res.json({
            success: true,
            message: 'Sync data pushed successfully',
            backupId
        });
    } catch (error) {
        console.error('[Sync] Push error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to push sync data'
        });
    }
});

// 获取数据哈希值（用于比较）
app.get('/sync/hash', async (req, res) => {
    try {
        if (!containerClient) {
            return res.status(500).json({
                success: false,
                message: 'Azure Storage not configured'
            });
        }

        const activationId = req.query.activationId;

        if (!activationId) {
            return res.status(400).json({
                success: false,
                message: 'activationId is required'
            });
        }

        // 查找最新备份
        let latestBackup = null;
        let latestBackupTime = null;

        for await (const blob of containerClient.listBlobsFlat({ prefix: `${activationId}/` })) {
            if (blob.name.endsWith('/metadata.json')) {
                try {
                    const blobClient = containerClient.getBlockBlobClient(blob.name);
                    const metadataContent = await blobClient.downloadToBuffer();
                    const metadata = JSON.parse(metadataContent.toString());
                    
                    const backupTime = new Date(metadata.timestamp || metadata.createdAt);
                    if (!latestBackupTime || backupTime > latestBackupTime) {
                        latestBackupTime = backupTime;
                        latestBackup = metadata;
                    }
                } catch (error) {
                    // 继续查找
                }
            }
        }

        if (!latestBackup) {
            return res.json({
                hash: null,
                lastUpdate: null
            });
        }

        // 下载数据库文件来计算基于数据内容的哈希值
        const databaseBlobName = `${latestBackup.prefix}/database.json`;
        const databaseBlobClient = containerClient.getBlockBlobClient(databaseBlobName);
        
        let databaseContent;
        try {
            databaseContent = await databaseBlobClient.downloadToBuffer();
        } catch (error) {
            console.error(`[Sync] Error downloading database.json for hash:`, error);
            // 如果无法下载数据库文件，回退到使用备份元数据
            const crypto = require('crypto');
            const hashData = JSON.stringify({
                backupId: latestBackup.backupId,
                timestamp: latestBackup.timestamp || latestBackup.createdAt
            });
            const hash = crypto.createHash('md5').update(hashData).digest('hex');
            return res.json({
                hash,
                lastUpdate: latestBackup.timestamp || latestBackup.createdAt
            });
        }

        const databaseData = JSON.parse(databaseContent.toString());
        
        // 提取数据（支持新旧格式）
        let customers, weighingSessions, weighings;
        if (databaseData.tables) {
            customers = databaseData.tables.customers || [];
            weighingSessions = databaseData.tables.weighing_sessions || [];
            weighings = databaseData.tables.weighings || [];
        } else {
            customers = databaseData.customers || [];
            weighingSessions = databaseData.weighingSessions || databaseData.weighing_sessions || [];
            weighings = databaseData.weighings || [];
        }

        // 计算基于数据内容的哈希值（与客户端保持一致）
        // 获取最后更新时间
        let lastUpdate = '1970-01-01T00:00:00.000Z';
        const allDates = [];
        
        // 从客户数据中获取最后更新时间
        customers.forEach(c => {
            const date = c.updated_at || c.created_at;
            if (date) allDates.push(new Date(date).getTime());
        });
        
        // 从会话数据中获取最后更新时间
        weighingSessions.forEach(s => {
            const date = s.updated_at || s.created_at || s.session_time;
            if (date) allDates.push(new Date(date).getTime());
        });
        
        // 从称重数据中获取最后更新时间
        weighings.forEach(w => {
            const date = w.created_at || w.weighing_time;
            if (date) allDates.push(new Date(date).getTime());
        });
        
        if (allDates.length > 0) {
            lastUpdate = new Date(Math.max(...allDates)).toISOString();
        }

        // 计算哈希值（与客户端逻辑一致）
        const crypto = require('crypto');
        const hashData = JSON.stringify({
            lastUpdate: lastUpdate,
            counts: {
                customers: customers.length,
                sessions: weighingSessions.length,
                weighings: weighings.length
            }
        });
        const hash = crypto.createHash('md5').update(hashData).digest('hex');

        res.json({
            hash,
            lastUpdate: lastUpdate
        });
    } catch (error) {
        console.error('[Sync] Hash error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to get hash'
        });
    }
});

// ==================== 数据库 API 端点 ====================
// 注意：这些端点需要 SQL Server 数据库连接

// 获取所有客户
app.get('/api/customers', async (req, res) => {
    try {
        if (!sqlPool) {
            return res.status(503).json({
                success: false,
                message: 'Database not available'
            });
        }

        const activationId = req.query.activationId;
        if (!activationId) {
            return res.status(400).json({
                success: false,
                message: 'activationId is required'
            });
        }

        const result = await sqlPool.request()
            .input('activationId', sql.Int, activationId)
            .query(`
                SELECT 
                    c.*,
                    (SELECT MAX(ws.session_time)
                     FROM weighing_sessions ws
                     WHERE ws.customer_id = c.id AND ws.activation_id = @activationId
                    ) as last_transaction_time
                FROM customers c
                WHERE c.activation_id = @activationId
                ORDER BY 
                    CASE WHEN (SELECT MAX(ws.session_time) FROM weighing_sessions ws WHERE ws.customer_id = c.id AND ws.activation_id = @activationId) IS NOT NULL THEN 0 ELSE 1 END,
                    (SELECT MAX(ws.session_time) FROM weighing_sessions ws WHERE ws.customer_id = c.id AND ws.activation_id = @activationId) DESC,
                    c.created_at DESC
            `);

        res.json({
            success: true,
            data: result.recordset
        });
    } catch (error) {
        console.error('[API] Get customers error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to get customers'
        });
    }
});

// 创建客户
app.post('/api/customers', async (req, res) => {
    try {
        if (!sqlPool) {
            return res.status(503).json({
                success: false,
                message: 'Database not available'
            });
        }

        const { activationId, name, phone, address, license_number, license_photo_path, id_expiration, height, weight, hair_color, customer_number } = req.body;

        if (!activationId || !name) {
            return res.status(400).json({
                success: false,
                message: 'activationId and name are required'
            });
        }

        // 如果没有提供编号，自动生成
        let finalCustomerNumber = customer_number;
        if (!finalCustomerNumber) {
            const countResult = await sqlPool.request()
                .input('activationId', sql.Int, activationId)
                .query('SELECT COUNT(*) as count FROM customers WHERE activation_id = @activationId');
            const count = countResult.recordset[0].count;
            finalCustomerNumber = `C${String(count + 1).padStart(4, '0')}${Date.now().toString().slice(-4)}`;
        }

        const result = await sqlPool.request()
            .input('activationId', sql.Int, activationId)
            .input('name', sql.NVarChar, name)
            .input('phone', sql.NVarChar, phone || null)
            .input('address', sql.NVarChar, address || null)
            .input('license_number', sql.NVarChar, license_number || null)
            .input('license_photo_path', sql.NVarChar, license_photo_path || null)
            .input('id_expiration', sql.NVarChar, id_expiration || null)
            .input('height', sql.NVarChar, height || null)
            .input('weight', sql.NVarChar, weight || null)
            .input('hair_color', sql.NVarChar, hair_color || null)
            .input('customer_number', sql.NVarChar, finalCustomerNumber)
            .query(`
                INSERT INTO customers 
                (activation_id, name, phone, address, license_number, license_photo_path, id_expiration, height, weight, hair_color, customer_number, created_at, updated_at)
                OUTPUT INSERTED.*
                VALUES 
                (@activationId, @name, @phone, @address, @license_number, @license_photo_path, @id_expiration, @height, @weight, @hair_color, @customer_number, GETDATE(), GETDATE())
            `);

        const customerData = result.recordset[0];
        
        // 通过 WebSocket 广播新客户创建
        broadcastToActivation(activationId, {
            type: 'new_customer',
            customerId: customerData.id,
            activationId: activationId,
            timestamp: new Date().toISOString()
        });
        
        res.json({
            success: true,
            data: customerData
        });
    } catch (error) {
        console.error('[API] Create customer error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create customer'
        });
    }
});

// 批量创建客户
app.post('/api/customers/batch', async (req, res) => {
    try {
        if (!sqlPool) {
            return res.status(503).json({
                success: false,
                message: 'Database not available'
            });
        }

        const { activationId, customers } = req.body;

        if (!activationId || !Array.isArray(customers) || customers.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'activationId and customers array are required'
            });
        }

        // 获取当前客户数量（用于生成编号）
        const countResult = await sqlPool.request()
            .input('activationId', sql.Int, activationId)
            .query('SELECT COUNT(*) as count FROM customers WHERE activation_id = @activationId');
        let currentCount = countResult.recordset[0].count;

        // 获取现有客户编号和姓名+地址组合（用于去重）
        const existingResult = await sqlPool.request()
            .input('activationId', sql.Int, activationId)
            .query(`
                SELECT customer_number, name, address 
                FROM customers 
                WHERE activation_id = @activationId
            `);
        
        const existingNumbers = new Set(existingResult.recordset.map(r => r.customer_number).filter(Boolean));
        const existingNameAddress = new Set(
            existingResult.recordset.map(r => `${r.name}|${r.address || ''}`).filter(Boolean)
        );

        let created = 0;
        const errors = [];
        const transaction = new sql.Transaction(sqlPool);
        
        await transaction.begin();
        
        try {
            for (const customer of customers) {
                try {
                    // 检查重复
                    if (customer.customer_number && existingNumbers.has(customer.customer_number)) {
                        continue; // 跳过重复的编号
                    }
                    
                    const nameAddressKey = `${customer.name}|${customer.address || ''}`;
                    if (existingNameAddress.has(nameAddressKey)) {
                        continue; // 跳过重复的姓名+地址
                    }

                    // 生成客户编号（如果没有提供）
                    let finalCustomerNumber = customer.customer_number;
                    if (!finalCustomerNumber) {
                        currentCount++;
                        finalCustomerNumber = `C${String(currentCount).padStart(4, '0')}${Date.now().toString().slice(-4)}`;
                    }

                    // 添加到已存在集合（避免同一批次内重复）
                    existingNumbers.add(finalCustomerNumber);
                    existingNameAddress.add(nameAddressKey);

                    // 为每个客户创建新的 request（避免参数重复声明）
                    const request = new sql.Request(transaction);
                    await request
                        .input('activationId', sql.Int, activationId)
                        .input('name', sql.NVarChar, customer.name)
                        .input('phone', sql.NVarChar, customer.phone || null)
                        .input('address', sql.NVarChar, customer.address || null)
                        .input('license_number', sql.NVarChar, customer.license_number || null)
                        .input('license_photo_path', sql.NVarChar, customer.license_photo_path || null)
                        .input('id_expiration', sql.NVarChar, customer.id_expiration || null)
                        .input('height', sql.NVarChar, customer.height || null)
                        .input('weight', sql.NVarChar, customer.weight || null)
                        .input('hair_color', sql.NVarChar, customer.hair_color || null)
                        .input('customer_number', sql.NVarChar, finalCustomerNumber)
                        .query(`
                            INSERT INTO customers 
                            (activation_id, name, phone, address, license_number, license_photo_path, id_expiration, height, weight, hair_color, customer_number, created_at, updated_at)
                            VALUES 
                            (@activationId, @name, @phone, @address, @license_number, @license_photo_path, @id_expiration, @height, @weight, @hair_color, @customer_number, GETDATE(), GETDATE())
                        `);
                    
                    created++;
                } catch (error) {
                    errors.push(`Failed to import ${customer.name}: ${error.message}`);
                }
            }
            
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }

        res.json({
            success: true,
            created,
            errors,
            message: `Successfully imported ${created} customers`
        });
    } catch (error) {
        console.error('[API] Batch create customers error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create customers batch',
            created: 0,
            errors: [error.message]
        });
    }
});

// 更新客户
app.put('/api/customers/:id', async (req, res) => {
    try {
        if (!sqlPool) {
            return res.status(503).json({
                success: false,
                message: 'Database not available'
            });
        }

        const { id } = req.params;
        const { activationId, name, phone, address, license_number, license_photo_path, id_expiration, height, weight, hair_color } = req.body;

        if (!activationId) {
            return res.status(400).json({
                success: false,
                message: 'activationId is required'
            });
        }

        const result = await sqlPool.request()
            .input('id', sql.Int, id)
            .input('activationId', sql.Int, activationId)
            .input('name', sql.NVarChar, name)
            .input('phone', sql.NVarChar, phone || null)
            .input('address', sql.NVarChar, address || null)
            .input('license_number', sql.NVarChar, license_number || null)
            .input('license_photo_path', sql.NVarChar, license_photo_path || null)
            .input('id_expiration', sql.NVarChar, id_expiration || null)
            .input('height', sql.NVarChar, height || null)
            .input('weight', sql.NVarChar, weight || null)
            .input('hair_color', sql.NVarChar, hair_color || null)
            .query(`
                UPDATE customers 
                SET name = @name, phone = @phone, address = @address, 
                    license_number = @license_number, license_photo_path = @license_photo_path,
                    id_expiration = @id_expiration, height = @height, weight = @weight, 
                    hair_color = @hair_color, updated_at = GETDATE()
                OUTPUT INSERTED.*
                WHERE id = @id AND activation_id = @activationId
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Customer not found'
            });
        }

        const customerData = result.recordset[0];
        
        // 通过 WebSocket 广播客户更新
        broadcastToActivation(activationId, {
            type: 'updated_customer',
            customerId: customerData.id,
            activationId: activationId,
            timestamp: new Date().toISOString()
        });

        res.json({
            success: true,
            data: customerData
        });
    } catch (error) {
        console.error('[API] Update customer error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to update customer'
        });
    }
});

// 获取称重会话（分页）
app.get('/api/sessions', async (req, res) => {
    try {
        if (!sqlPool) {
            return res.status(503).json({
                success: false,
                message: 'Database not available'
            });
        }

        const activationId = req.query.activationId;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;
        const customerName = req.query.customerName;
        const offset = (page - 1) * limit;

        if (!activationId) {
            return res.status(400).json({
                success: false,
                message: 'activationId is required'
            });
        }

        let whereClause = 'WHERE ws.activation_id = @activationId';
        const request = sqlPool.request().input('activationId', sql.Int, activationId);

        if (startDate && endDate) {
            whereClause += ' AND ws.session_time >= @startDate AND ws.session_time <= @endDate';
            request.input('startDate', sql.DateTime, new Date(startDate));
            request.input('endDate', sql.DateTime, new Date(endDate));
        }

        if (customerName) {
            whereClause += ' AND c.name LIKE @customerName';
            request.input('customerName', sql.NVarChar, `%${customerName}%`);
        }

        // 获取总数
        const countResult = await request.query(`
            SELECT COUNT(*) as total
            FROM weighing_sessions ws
            LEFT JOIN customers c ON ws.customer_id = c.id AND c.activation_id = @activationId
            ${whereClause}
        `);
        const total = countResult.recordset[0].total;

        // 获取数据
        const dataResult = await request
            .input('limit', sql.Int, limit)
            .input('offset', sql.Int, offset)
            .query(`
                SELECT ws.*, c.name as customer_name
                FROM weighing_sessions ws
                LEFT JOIN customers c ON ws.customer_id = c.id AND c.activation_id = @activationId
                ${whereClause}
                ORDER BY ws.session_time DESC
                OFFSET @offset ROWS
                FETCH NEXT @limit ROWS ONLY
            `);

        res.json({
            success: true,
            data: dataResult.recordset,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('[API] Get sessions error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to get sessions'
        });
    }
});

// 创建称重会话
app.post('/api/sessions', async (req, res) => {
    try {
        if (!sqlPool) {
            return res.status(503).json({
                success: false,
                message: 'Database not available'
            });
        }

        const { activationId, customer_id, session_time, notes, total_amount } = req.body;

        if (!activationId) {
            return res.status(400).json({
                success: false,
                message: 'activationId is required'
            });
        }

        const result = await sqlPool.request()
            .input('activationId', sql.Int, activationId)
            .input('customer_id', sql.Int, customer_id || null)
            .input('session_time', sql.DateTime, session_time ? new Date(session_time) : new Date())
            .input('notes', sql.NVarChar, notes || null)
            .input('total_amount', sql.Decimal(10, 2), total_amount || 0)
            .query(`
                INSERT INTO weighing_sessions 
                (activation_id, customer_id, session_time, notes, total_amount, created_at, updated_at)
                OUTPUT INSERTED.*
                VALUES 
                (@activationId, @customer_id, @session_time, @notes, @total_amount, GETDATE(), GETDATE())
            `);

        const sessionData = result.recordset[0];
        
        // 通过 WebSocket 广播新会话创建
        broadcastToActivation(activationId, {
            type: 'new_session',
            sessionId: sessionData.id,
            activationId: activationId,
            timestamp: new Date().toISOString()
        });
        
        res.json({
            success: true,
            data: sessionData
        });
    } catch (error) {
        console.error('[API] Create session error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create session'
        });
    }
});

// 创建称重记录
app.post('/api/weighings', async (req, res) => {
    try {
        if (!sqlPool) {
            return res.status(503).json({
                success: false,
                message: 'Database not available'
            });
        }

        const { activationId, session_id, waste_type_id, weight, unit_price, total_amount, weighing_time, product_photo_path } = req.body;

        if (!activationId || !session_id || !weight || !unit_price || !total_amount) {
            return res.status(400).json({
                success: false,
                message: 'activationId, session_id, weight, unit_price, and total_amount are required'
            });
        }

        const result = await sqlPool.request()
            .input('activationId', sql.Int, activationId)
            .input('session_id', sql.Int, session_id)
            .input('waste_type_id', sql.Int, waste_type_id || null)
            .input('weight', sql.Decimal(10, 3), weight)
            .input('unit_price', sql.Decimal(10, 2), unit_price)
            .input('total_amount', sql.Decimal(10, 2), total_amount)
            .input('weighing_time', sql.DateTime, weighing_time ? new Date(weighing_time) : new Date())
            .input('product_photo_path', sql.NVarChar, product_photo_path || null)
            .query(`
                INSERT INTO weighings 
                (activation_id, session_id, waste_type_id, weight, unit_price, total_amount, weighing_time, product_photo_path, created_at)
                OUTPUT INSERTED.*
                VALUES 
                (@activationId, @session_id, @waste_type_id, @weight, @unit_price, @total_amount, @weighing_time, @product_photo_path, GETDATE())
            `);

        const weighingData = result.recordset[0];
        
        // 通过 WebSocket 广播新称重记录创建
        broadcastToActivation(activationId, {
            type: 'new_weighing',
            weighingId: weighingData.id,
            sessionId: session_id,
            activationId: activationId,
            timestamp: new Date().toISOString()
        });
        
        res.json({
            success: true,
            data: weighingData
        });
    } catch (error) {
        console.error('[API] Create weighing error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create weighing'
        });
    }
});

// 获取金属类型
app.get('/api/metalTypes', async (req, res) => {
    try {
        if (!sqlPool) {
            return res.status(503).json({
                success: false,
                message: 'Database not available'
            });
        }

        const activationId = req.query.activationId;
        if (!activationId) {
            return res.status(400).json({
                success: false,
                message: 'activationId is required'
            });
        }

        const result = await sqlPool.request()
            .input('activationId', sql.Int, activationId)
            .query(`
                SELECT * FROM metal_types 
                WHERE activation_id = @activationId AND is_active = 1
                ORDER BY symbol ASC
            `);

        res.json({
            success: true,
            data: result.recordset
        });
    } catch (error) {
        console.error('[API] Get metal types error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to get metal types'
        });
    }
});

// 创建金属类型
app.post('/api/metalTypes', async (req, res) => {
    try {
        if (!sqlPool) {
            return res.status(503).json({
                success: false,
                message: 'Database not available'
            });
        }

        const { activationId, symbol, name, price_per_unit, unit } = req.body;

        if (!activationId || !symbol || !name || price_per_unit === undefined) {
            return res.status(400).json({
                success: false,
                message: 'activationId, symbol, name, and price_per_unit are required'
            });
        }

        // 检查是否已存在相同的 symbol
        const existingCheck = await sqlPool.request()
            .input('activationId', sql.Int, activationId)
            .input('symbol', sql.NVarChar, symbol)
            .query(`
                SELECT id FROM metal_types 
                WHERE activation_id = @activationId AND symbol = @symbol
            `);

        if (existingCheck.recordset.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Metal type with symbol "${symbol}" already exists`
            });
        }

        const result = await sqlPool.request()
            .input('activationId', sql.Int, activationId)
            .input('symbol', sql.NVarChar, symbol)
            .input('name', sql.NVarChar, name)
            .input('price_per_unit', sql.Decimal(10, 2), price_per_unit)
            .input('unit', sql.NVarChar, unit || 'lb')
            .query(`
                INSERT INTO metal_types 
                (activation_id, symbol, name, price_per_unit, unit, is_active, created_at, updated_at)
                OUTPUT INSERTED.*
                VALUES 
                (@activationId, @symbol, @name, @price_per_unit, @unit, 1, GETDATE(), GETDATE())
            `);

        const metalTypeData = result.recordset[0];
        
        // 通过 WebSocket 广播新金属类型创建
        broadcastToActivation(activationId, {
            type: 'new_metal_type',
            metalTypeId: metalTypeData.id,
            activationId: activationId,
            timestamp: new Date().toISOString()
        });
        
        res.json({
            success: true,
            data: metalTypeData
        });
    } catch (error) {
        console.error('[API] Create metal type error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create metal type'
        });
    }
});

// 获取会话详情
app.get('/api/sessions/:id', async (req, res) => {
    try {
        if (!sqlPool) {
            return res.status(503).json({
                success: false,
                message: 'Database not available'
            });
        }

        const { id } = req.params;
        const activationId = req.query.activationId;

        if (!activationId) {
            return res.status(400).json({
                success: false,
                message: 'activationId is required'
            });
        }

        const result = await sqlPool.request()
            .input('id', sql.Int, id)
            .input('activationId', sql.Int, activationId)
            .query(`
                SELECT ws.*, c.name as customer_name
                FROM weighing_sessions ws
                LEFT JOIN customers c ON ws.customer_id = c.id AND c.activation_id = @activationId
                WHERE ws.id = @id AND ws.activation_id = @activationId
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Session not found'
            });
        }

        res.json({
            success: true,
            data: result.recordset[0]
        });
    } catch (error) {
        console.error('[API] Get session error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to get session'
        });
    }
});

// 更新会话
app.put('/api/sessions/:id', async (req, res) => {
    try {
        if (!sqlPool) {
            return res.status(503).json({
                success: false,
                message: 'Database not available'
            });
        }

        const { id } = req.params;
        const { activationId, notes, total_amount, status } = req.body;

        if (!activationId) {
            return res.status(400).json({
                success: false,
                message: 'activationId is required'
            });
        }

        const updates = [];
        const request = sqlPool.request()
            .input('id', sql.Int, id)
            .input('activationId', sql.Int, activationId);

        if (notes !== undefined) {
            updates.push('notes = @notes');
            request.input('notes', sql.NVarChar, notes);
        }
        if (total_amount !== undefined) {
            updates.push('total_amount = @total_amount');
            request.input('total_amount', sql.Decimal(10, 2), total_amount);
        }
        if (status !== undefined) {
            updates.push('status = @status');
            request.input('status', sql.NVarChar, status);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No fields to update'
            });
        }

        updates.push('updated_at = GETDATE()');

        const result = await request.query(`
            UPDATE weighing_sessions 
            SET ${updates.join(', ')}
            OUTPUT INSERTED.*
            WHERE id = @id AND activation_id = @activationId
        `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Session not found'
            });
        }

        const sessionData = result.recordset[0];
        
        // 通过 WebSocket 广播会话更新
        broadcastToActivation(activationId, {
            type: 'updated_session',
            sessionId: sessionData.id,
            activationId: activationId,
            timestamp: new Date().toISOString()
        });

        res.json({
            success: true,
            data: sessionData
        });
    } catch (error) {
        console.error('[API] Update session error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to update session'
        });
    }
});

// 删除称重会话
app.delete('/api/sessions/:id', async (req, res) => {
    try {
        if (!sqlPool) {
            return res.status(503).json({
                success: false,
                message: 'Database not available'
            });
        }

        const sessionId = parseInt(req.params.id);
        const activationId = req.query.activationId;

        if (!activationId) {
            return res.status(400).json({
                success: false,
                message: 'activationId is required'
            });
        }

        // 先删除该session的所有weighings（因为有外键约束）
        await sqlPool.request()
            .input('activationId', sql.Int, activationId)
            .input('sessionId', sql.Int, sessionId)
            .query(`
                DELETE FROM weighings 
                WHERE activation_id = @activationId AND session_id = @sessionId
            `);

        // 然后删除session
        const result = await sqlPool.request()
            .input('activationId', sql.Int, activationId)
            .input('sessionId', sql.Int, sessionId)
            .query(`
                DELETE FROM weighing_sessions 
                WHERE activation_id = @activationId AND id = @sessionId
            `);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                message: 'Session not found'
            });
        }

        // 通过 WebSocket 广播会话删除
        broadcastToActivation(parseInt(activationId), {
            type: 'deleted_session',
            sessionId: sessionId,
            activationId: parseInt(activationId),
            timestamp: new Date().toISOString()
        });

        res.json({
            success: true,
            message: 'Session deleted successfully'
        });
    } catch (error) {
        console.error('[API] Delete session error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to delete session'
        });
    }
});

// 获取会话的称重记录
app.get('/api/weighings', async (req, res) => {
    try {
        if (!sqlPool) {
            return res.status(503).json({
                success: false,
                message: 'Database not available'
            });
        }

        const activationId = req.query.activationId;
        const sessionId = req.query.sessionId;

        if (!activationId) {
            return res.status(400).json({
                success: false,
                message: 'activationId is required'
            });
        }

        let query = `
            SELECT w.*, mt.symbol as waste_type_symbol, mt.name as waste_type_name
            FROM weighings w
            LEFT JOIN metal_types mt ON w.waste_type_id = mt.id AND mt.activation_id = @activationId
            WHERE w.activation_id = @activationId
        `;

        const request = sqlPool.request().input('activationId', sql.Int, activationId);

        if (sessionId) {
            query += ' AND w.session_id = @sessionId';
            request.input('sessionId', sql.Int, sessionId);
        }

        query += ' ORDER BY w.created_at DESC';

        const result = await request.query(query);

        res.json({
            success: true,
            data: result.recordset
        });
    } catch (error) {
        console.error('[API] Get weighings error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to get weighings'
        });
    }
});

// 删除指定会话的所有称重记录
app.delete('/api/weighings', async (req, res) => {
    try {
        if (!sqlPool) {
            return res.status(503).json({
                success: false,
                message: 'Database not available'
            });
        }

        const activationId = req.query.activationId;
        const sessionId = req.query.sessionId;

        if (!activationId || !sessionId) {
            return res.status(400).json({
                success: false,
                message: 'activationId and sessionId are required'
            });
        }

        const result = await sqlPool.request()
            .input('activationId', sql.Int, activationId)
            .input('sessionId', sql.Int, sessionId)
            .query(`
                DELETE FROM weighings 
                WHERE activation_id = @activationId AND session_id = @sessionId
            `);

        // 通过 WebSocket 广播称重记录删除
        broadcastToActivation(parseInt(activationId), {
            type: 'deleted_weighings',
            sessionId: parseInt(sessionId),
            activationId: parseInt(activationId),
            deletedCount: result.rowsAffected[0],
            timestamp: new Date().toISOString()
        });

        res.json({
            success: true,
            message: 'Weighings deleted successfully',
            deleted: result.rowsAffected[0]
        });
    } catch (error) {
        console.error('[API] Delete weighings error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to delete weighings'
        });
    }
});

// 更新金属类型
app.put('/api/metalTypes/:id', async (req, res) => {
    try {
        if (!sqlPool) {
            return res.status(503).json({
                success: false,
                message: 'Database not available'
            });
        }

        const { id } = req.params;
        const { activationId, name, price_per_unit, unit } = req.body;

        if (!activationId) {
            return res.status(400).json({
                success: false,
                message: 'activationId is required'
            });
        }

        const updates = [];
        const request = sqlPool.request()
            .input('id', sql.Int, id)
            .input('activationId', sql.Int, activationId);

        if (name !== undefined) {
            updates.push('name = @name');
            request.input('name', sql.NVarChar, name);
        }
        if (price_per_unit !== undefined) {
            updates.push('price_per_unit = @price_per_unit');
            request.input('price_per_unit', sql.Decimal(10, 2), price_per_unit);
        }
        if (unit !== undefined) {
            updates.push('unit = @unit');
            request.input('unit', sql.NVarChar, unit);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No fields to update'
            });
        }

        updates.push('updated_at = GETDATE()');

        const result = await request.query(`
            UPDATE metal_types 
            SET ${updates.join(', ')}
            OUTPUT INSERTED.*
            WHERE id = @id AND activation_id = @activationId
        `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Metal type not found'
            });
        }

        const metalTypeData = result.recordset[0];
        
        // 通过 WebSocket 广播金属类型更新
        broadcastToActivation(activationId, {
            type: 'updated_metal_type',
            metalTypeId: metalTypeData.id,
            activationId: activationId,
            timestamp: new Date().toISOString()
        });

        res.json({
            success: true,
            data: metalTypeData
        });
    } catch (error) {
        console.error('[API] Update metal type error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to update metal type'
        });
    }
});

// 删除金属类型（软删除）
app.delete('/api/metalTypes/:id', async (req, res) => {
    try {
        if (!sqlPool) {
            return res.status(503).json({
                success: false,
                message: 'Database not available'
            });
        }

        const { id } = req.params;
        const activationId = req.query.activationId;

        if (!activationId) {
            return res.status(400).json({
                success: false,
                message: 'activationId is required'
            });
        }

        const result = await sqlPool.request()
            .input('id', sql.Int, id)
            .input('activationId', sql.Int, activationId)
            .query(`
                UPDATE metal_types 
                SET is_active = 0, updated_at = GETDATE()
                WHERE id = @id AND activation_id = @activationId
            `);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                message: 'Metal type not found'
            });
        }

        res.json({
            success: true,
            message: 'Metal type deleted successfully'
        });
    } catch (error) {
        console.error('[API] Delete metal type error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to delete metal type'
        });
    }
});

// 服务器启动已移至 startServer() 函数




