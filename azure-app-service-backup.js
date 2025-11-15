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
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 启用 CORS
app.use(cors());
app.use(express.json());

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

// 初始化
initializeBlobStorage();

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
        storageConfigured: !!containerClient
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

app.listen(PORT, () => {
    console.log(`Azure backup server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`Upload endpoint: http://localhost:${PORT}/backup/upload`);
});




