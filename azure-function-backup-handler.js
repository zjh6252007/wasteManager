/**
 * Azure Functions: 处理备份上传
 * 
 * 部署步骤：
 * 1. 在 Azure Portal 创建 Function App
 * 2. 创建 HTTP Trigger 函数
 * 3. 粘贴此代码
 * 4. 配置应用设置：
 *    - STORAGE_ACCOUNT_NAME: 你的存储账户名称
 *    - STORAGE_ACCOUNT_KEY: 存储账户密钥（或使用 Managed Identity）
 *    - CONTAINER_NAME: 容器名称（默认：backups）
 * 5. 安装依赖（在 Function App 的 Kudu 控制台或使用 VS Code）：
 *    npm install @azure/storage-blob
 * 6. 配置 CORS（在 Function App 设置中）
 */

const { BlobServiceClient } = require('@azure/storage-blob');
const { v4: uuidv4 } = require('uuid');

module.exports = async function (context, req) {
    context.log('Backup request received');

    try {
        // 获取配置
        const storageAccountName = process.env.STORAGE_ACCOUNT_NAME;
        const storageAccountKey = process.env.STORAGE_ACCOUNT_KEY;
        const containerName = process.env.CONTAINER_NAME || 'backups';

        if (!storageAccountName) {
            return {
                status: 400,
                body: {
                    success: false,
                    message: 'Storage account not configured'
                }
            };
        }

        // 创建 Blob Service Client
        const connectionString = `DefaultEndpointsProtocol=https;AccountName=${storageAccountName};AccountKey=${storageAccountKey};EndpointSuffix=core.windows.net`;
        const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
        const containerClient = blobServiceClient.getContainerClient(containerName);

        // 确保容器存在
        await containerClient.createIfNotExists();

        // 解析请求数据
        const activationId = req.body?.activationId || req.query?.activationId;
        const timestamp = req.body?.timestamp || new Date().toISOString();
        const version = req.body?.version || 'unknown';

        if (!activationId) {
            return {
                status: 400,
                body: {
                    success: false,
                    message: 'activationId is required'
                }
            };
        }

        const backupId = `backup_${activationId}_${Date.now()}`;
        const backupPrefix = `${activationId}/${backupId}`;

        // 处理 multipart/form-data
        // 注意：Azure Functions 的 multipart 处理需要特殊配置
        // 这里假设使用 HTTP Trigger 的 body 解析

        let fileCount = 0;

        // 上传数据库文件
        if (req.body?.database) {
            const databaseBlobName = `${backupPrefix}/database.json`;
            const blockBlobClient = containerClient.getBlockBlobClient(databaseBlobName);
            
            const databaseContent = typeof req.body.database === 'string' 
                ? req.body.database 
                : JSON.stringify(req.body.database);
            
            await blockBlobClient.upload(databaseContent, databaseContent.length, {
                blobHTTPHeaders: { blobContentType: 'application/json' }
            });
            context.log(`Database file uploaded: ${databaseBlobName}`);
        }

        // 上传清单文件
        if (req.body?.manifest) {
            const manifestBlobName = `${backupPrefix}/manifest.json`;
            const blockBlobClient = containerClient.getBlockBlobClient(manifestBlobName);
            
            const manifestContent = typeof req.body.manifest === 'string'
                ? req.body.manifest
                : JSON.stringify(req.body.manifest);
            
            await blockBlobClient.upload(manifestContent, manifestContent.length, {
                blobHTTPHeaders: { blobContentType: 'application/json' }
            });
            context.log(`Manifest file uploaded: ${manifestBlobName}`);
        }

        // 上传文件（如果有）
        if (req.body?.files && Array.isArray(req.body.files)) {
            for (const file of req.body.files) {
                const fileName = file.filename || `file_${fileCount}`;
                const fileBlobName = `${backupPrefix}/files/${fileName}`;
                const blockBlobClient = containerClient.getBlockBlobClient(fileBlobName);
                
                const fileContent = file.content || file.data || '';
                await blockBlobClient.upload(fileContent, fileContent.length, {
                    blobHTTPHeaders: { blobContentType: file.contentType || 'application/octet-stream' }
                });
                
                fileCount++;
                context.log(`File uploaded: ${fileBlobName}`);
            }
        }

        // 保存备份元数据
        const metadata = {
            backupId,
            activationId: parseInt(activationId),
            timestamp,
            version,
            fileCount,
            createdAt: new Date().toISOString(),
            storageAccount: storageAccountName,
            container: containerName,
            prefix: backupPrefix
        };

        const metadataBlobName = `${backupPrefix}/metadata.json`;
        const metadataBlobClient = containerClient.getBlockBlobClient(metadataBlobName);
        await metadataBlobClient.upload(JSON.stringify(metadata, null, 2), JSON.stringify(metadata, null, 2).length, {
            blobHTTPHeaders: { blobContentType: 'application/json' }
        });

        context.log(`Backup completed: ${backupId}`);

        return {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: {
                success: true,
                backupId,
                message: 'Backup uploaded successfully',
                timestamp: metadata.createdAt
            }
        };
    } catch (error) {
        context.log.error('Backup error:', error);
        return {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: {
                success: false,
                message: error.message || 'Backup failed'
            }
        };
    }
};




