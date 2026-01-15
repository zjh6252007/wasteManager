import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { repo, DataRepository } from "../db/connection";

// 获取PDFKit字体文件路径
function getPDFKitFontPath(): string | null {
  try {
    // 尝试多个可能的路径
    const possiblePaths = [
      path.join(process.cwd(), 'node_modules', 'pdfkit', 'js', 'data'),
      path.join(process.resourcesPath || '', 'node_modules', 'pdfkit', 'js', 'data'),
      path.join(app.getAppPath(), 'node_modules', 'pdfkit', 'js', 'data'),
      path.resolve(__dirname, '..', '..', 'node_modules', 'pdfkit', 'js', 'data'),
      path.resolve(__dirname, '..', 'node_modules', 'pdfkit', 'js', 'data'),
      // 打包后的路径
      path.join(path.dirname(process.execPath), 'resources', 'app', 'node_modules', 'pdfkit', 'js', 'data'),
      path.join(path.dirname(process.execPath), 'node_modules', 'pdfkit', 'js', 'data'),
    ];

    for (const fontPath of possiblePaths) {
      const helveticaPath = path.join(fontPath, 'Helvetica.afm');
      if (fs.existsSync(helveticaPath)) {
        console.log('Found PDFKit font path:', fontPath);
        return fontPath;
      }
    }
    
    console.warn('PDFKit font path not found');
    return null;
  } catch (error) {
    console.error('Failed to find PDFKit fonts:', error);
    return null;
  }
}

export class PoliceReportService {
  private activationId: number;
  private repo: DataRepository;

  constructor(activationId: number) {
    this.activationId = activationId;
    this.repo = repo;
  }

  /**
   * 获取符合条件的会话数量（用于确认对话框）
   * @param startDate 开始日期
   * @param endDate 结束日期
   * @param customerName 客户名称（可选）
   */
  async getBatchReportCount(
    startDate?: string,
    endDate?: string,
    customerName?: string
  ): Promise<number> {
    const options: any = {
      page: 1,
      limit: 10000, // 设置一个很大的限制，获取所有符合条件的会话
      startDate,
      endDate,
      customerName,
    };
    
    const result = this.repo.weighings.getPaginated(this.activationId, options);
    const sessions = result.data;
    
    // 确保去重（按ID）
    const uniqueSessions = Array.from(
      new Map(sessions.map((s: any) => [s.id, s])).values()
    );
    
    return uniqueSessions.length;
  }

  /**
   * 批量生成Police Report PDF - 生成一个包含所有会话的PDF
   * @param startDate 开始日期
   * @param endDate 结束日期
   * @param customerName 客户名称（可选）
   * @param onProgress 进度回调函数 (current, total, sessionId)
   */
  async generateReportsBatch(
    startDate?: string,
    endDate?: string,
    customerName?: string,
    onProgress?: (current: number, total: number, sessionId: number) => void
  ): Promise<string> {
    // 获取符合条件的会话列表
    const options: any = {
      page: 1,
      limit: 10000, // 设置一个很大的限制，获取所有符合条件的会话
      startDate,
      endDate,
      customerName,
    };
    
    console.log(`[Batch Report] Query options:`, options);
    
    const result = this.repo.weighings.getPaginated(this.activationId, options);
    const sessions = result.data;
    
    console.log(`[Batch Report] Found ${sessions.length} sessions (total: ${result.pagination.total})`);
    console.log(`[Batch Report] Sessions:`, sessions.map(s => ({ id: s.id, customer: s.customer_name, date: s.session_time })));
    
    if (sessions.length === 0) {
      throw new Error('No sessions found matching the criteria');
    }
    
    // 确保去重（按ID）
    const uniqueSessions = Array.from(
      new Map(sessions.map((s: any) => [s.id, s])).values()
    );
    
    console.log(`[Batch Report] After deduplication: ${uniqueSessions.length} unique sessions`);
    
    // 生成一个包含所有会话的PDF
    return await this.generateCombinedReport(uniqueSessions, onProgress);
  }

  /**
   * 生成包含多个会话的合并PDF
   */
  private async generateCombinedReport(
    sessions: any[],
    onProgress?: (current: number, total: number, sessionId: number) => void
  ): Promise<string> {
    // 创建PDF文档
    const userDataPath = app.getPath("userData");
    const reportsDir = path.join(userDataPath, "reports");
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const fileName = `police_report_batch_${Date.now()}.pdf`;
    const filePath = path.join(reportsDir, fileName);

    // 获取字体路径
    const fontPath = getPDFKitFontPath();
    const buildDataDir = path.join(__dirname, 'data');
    
    if (!fontPath) {
      throw new Error('Cannot find PDFKit font file path, please ensure pdfkit package is installed');
    }
    
    // 设置字体文件（复用单个报告的逻辑）
    try {
      if (!fs.existsSync(buildDataDir)) {
        fs.mkdirSync(buildDataDir, { recursive: true });
      }
      
      const helveticaDestPath = path.join(buildDataDir, 'Helvetica.afm');
      if (!fs.existsSync(helveticaDestPath)) {
        const fontFiles = fs.readdirSync(fontPath);
        for (const file of fontFiles) {
          if (file.endsWith('.afm') || file.endsWith('.icc')) {
            const sourceFile = path.join(fontPath, file);
            const destFile = path.join(buildDataDir, file);
            try {
              fs.copyFileSync(sourceFile, destFile);
            } catch (copyError) {
              console.error(`Failed to copy ${file}:`, copyError);
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Failed to setup font files:', error);
      throw new Error(`Failed to setup font files: ${error.message}`);
    }

    // 创建PDF文档
    const doc = new PDFDocument({ 
      size: "LETTER", 
      margin: 50
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const total = sessions.length;
    console.log(`[Batch Report] Starting to generate PDF with ${total} sessions`);

    // 为每个会话添加内容
    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i];
      console.log(`[Batch Report] Processing session ${i + 1}/${total}: Session #${session.id}`);
      
      try {
        // 如果不是第一页，添加分页
        if (i > 0) {
          doc.addPage();
        }

        // 添加会话内容
        await this.addSessionToPDF(doc, session);
        console.log(`[Batch Report] Completed session ${i + 1}/${total}: Session #${session.id}`);

        // 调用进度回调
        if (onProgress) {
          onProgress(i + 1, total, session.id);
        }
      } catch (error: any) {
        console.error(`[Batch Report] Failed to add session ${session.id} to PDF:`, error);
        // 继续处理其他会话，不中断整个流程
      }
    }
    
    console.log(`[Batch Report] Finished generating PDF with ${total} sessions`);

    // 完成PDF
    doc.end();

    // 等待PDF写入完成
    await new Promise<void>((resolve, reject) => {
      stream.on('finish', () => resolve());
      stream.on('error', reject);
    });

    return filePath;
  }

  /**
   * 将单个会话的内容添加到PDF中
   */
  private async addSessionToPDF(doc: PDFDocument, session: any): Promise<void> {
    console.log(`[addSessionToPDF] Processing session ID: ${session.id}, customer_id: ${session.customer_id}`);
    
    // 获取客户信息
    const customer = session.customer_id 
      ? this.repo.customers.getById(this.activationId, session.customer_id)
      : null;

    // 获取车辆信息
    const vehicle = customer?.id 
      ? this.repo.vehicles.getAll(this.activationId).find((v: any) => v.customer_id === customer.id)
      : null;

    // 获取称重记录
    const weighings = this.repo.weighings.getBySession(this.activationId, session.id);
    console.log(`[addSessionToPDF] Session ${session.id} has ${weighings.length} weighings`);

    // 获取生物识别数据
    const biometricData = customer?.id 
      ? this.repo.biometricData.getByCustomerId(this.activationId, customer.id)
      : null;

    // 标题
    doc.fontSize(20).text("Police Ticket and Image Report", { align: "center" });
    doc.moveDown();

    // 报告日期
    const reportDate = new Date(session.session_time);
    const dateStr = reportDate.toLocaleDateString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const timeStr = reportDate.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    doc.fontSize(12).text(`${dateStr} ${timeStr}`, { align: "right" });
    doc.fontSize(10).text(
      `${dateStr} 12:00 AM - ${dateStr} 11:59 PM`,
      { align: "center" }
    );
    doc.moveDown(2);

    // 客户信息区域
    doc.rect(50, doc.y, 500, 100).fill("#1E88E5").stroke("#1E88E5");
    
    const startY = doc.y + 10;
    doc.fillColor("white");

    // 左列
    doc.fontSize(10).text(`Ref. No.: ${vehicle?.id || "N/A"}`, 60, startY);
    doc.text(`Name: ${customer?.name || "N/A"}`, 60, startY + 15);
    doc.text(`Address: ${customer?.address || "N/A"}`, 60, startY + 30);
    doc.text(`City/State: ${customer?.address?.split(",")[1]?.trim() || "N/A"}`, 60, startY + 45);
    doc.text(`DL #: ${customer?.license_number || ""}`, 60, startY + 60);

    // 右列
    doc.text(`D.O.B.: ${customer?.license_number || ""}`, 300, startY);
    doc.text(`ID Expiration: ${customer?.id_expiration || ""}`, 300, startY + 15);
    doc.text(`Height: ${customer?.height || ""}`, 300, startY + 30);
    doc.text(`Weight: ${customer?.weight || ""}`, 300, startY + 45);
    doc.text(`Hair Color: ${customer?.hair_color || ""}`, 300, startY + 60);

    doc.fillColor("black");
    doc.moveDown(6);

    // 交易明细表格
    doc.fontSize(12).text("Transaction Details", { underline: true });
    doc.moveDown(0.5);

    // 表头
    const tableTop = doc.y;
    const tableLeft = 50;
    const colWidths = [80, 120, 100, 120, 80, 100]; // 增加Total列宽度，减少Product Name列宽度
    const rowHeight = 25;

    // 表头背景
    doc.rect(tableLeft, tableTop, 500, rowHeight)
      .fill("#E3F2FD")
      .stroke();

    doc.fontSize(9).fillColor("black");
    doc.text("Ticket No.", tableLeft + 5, tableTop + 8);
    doc.text("Date", tableLeft + colWidths[0] + 5, tableTop + 8);
    doc.text("License Plate", tableLeft + colWidths[0] + colWidths[1] + 5, tableTop + 8);
    doc.text("Product Name", tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + 5, tableTop + 8);
    doc.text("Net weight", tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 5, tableTop + 8);
    doc.text("Total", tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + 5, tableTop + 8);

    // 数据行
    let currentY = tableTop + rowHeight;
    weighings.forEach((weighing: any) => {
      if (currentY > 650) {
        doc.addPage();
        currentY = 50;
        // 重新绘制表头
        doc.rect(tableLeft, currentY, 500, rowHeight)
          .fill("#E3F2FD")
          .stroke();
        doc.text("Ticket No.", tableLeft + 5, currentY + 8);
        doc.text("Date", tableLeft + colWidths[0] + 5, currentY + 8);
        doc.text("License Plate", tableLeft + colWidths[0] + colWidths[1] + 5, currentY + 8);
        doc.text("Product Name", tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + 5, currentY + 8);
        doc.text("Net weight", tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 5, currentY + 8);
        doc.text("Total", tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + 5, currentY + 8);
        currentY += rowHeight;
      }

      // 行边框
      doc.rect(tableLeft, currentY, 500, rowHeight).stroke();

      const ticketDate = new Date(session.session_time);
      const ticketDateStr = ticketDate.toLocaleDateString("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const ticketTimeStr = ticketDate.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });

      doc.fontSize(8).fillColor("black");
      doc.text(`${session.id}`, tableLeft + 5, currentY + 8);
      doc.text(`${ticketDateStr} ${ticketTimeStr}`, tableLeft + colWidths[0] + 5, currentY + 8);
      doc.text(`${vehicle?.license_plate || "N/A"}`, tableLeft + colWidths[0] + colWidths[1] + 5, currentY + 8);
      doc.text(`${weighing.waste_type_name || "N/A"}`, tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + 5, currentY + 8);
      doc.text(`${parseFloat(weighing.weight).toFixed(0)}`, tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 5, currentY + 8);
      // 格式化Total金额，使用千位分隔符
      const totalAmount = parseFloat(weighing.total_amount);
      const formattedTotal = totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      doc.text(`$${formattedTotal}`, tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + 5, currentY + 8);

      currentY += rowHeight;
    });

    doc.moveDown(2);

    // 图片部分
    let imagesY = doc.y;
    const imageWidth = 150;
    const imageHeight = 120;
    const imageSpacing = 20;
    let imageX = tableLeft;
    let imageIndex = 0;

    // 客户照片
    if (biometricData?.face_image_path && fs.existsSync(biometricData.face_image_path)) {
      try {
        if (imagesY + imageHeight > 700) {
          doc.addPage();
          imagesY = 50;
          imageX = tableLeft;
        }
        doc.image(biometricData.face_image_path, imageX, imagesY, {
          width: imageWidth,
          height: imageHeight,
          fit: [imageWidth, imageHeight],
        });
        const imgDate = new Date(session.session_time);
        const imgDateStr = imgDate.toLocaleDateString("en-US", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        const imgTimeStr = imgDate.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        });
        doc.fontSize(7).fillColor("black");
        doc.text(`${imgDateStr} ${imgTimeStr}`, imageX, imagesY + imageHeight + 5);
        doc.text("Cam 1 NoScale", imageX, imagesY + imageHeight + 15);
        imageX += imageWidth + imageSpacing;
        imageIndex++;
      } catch (error) {
        console.error("Failed to add customer photo:", error);
      }
    }

    // 指纹
    if (biometricData?.fingerprint_image_path && fs.existsSync(biometricData.fingerprint_image_path)) {
      try {
        if (imageX + imageWidth > 550 || imagesY + imageHeight > 700) {
          if (imageX + imageWidth > 550) {
            imagesY += imageHeight + 30;
            imageX = tableLeft;
          }
          if (imagesY + imageHeight > 700) {
            doc.addPage();
            imagesY = 50;
            imageX = tableLeft;
          }
        }
        doc.image(biometricData.fingerprint_image_path, imageX, imagesY, {
          width: imageWidth,
          height: imageHeight,
          fit: [imageWidth, imageHeight],
        });
        const imgDate = new Date(session.session_time);
        const imgDateStr = imgDate.toLocaleDateString("en-US", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        const imgTimeStr = imgDate.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        });
        doc.fontSize(7).fillColor("black");
        doc.text(`${imgDateStr} ${imgTimeStr}`, imageX, imagesY + imageHeight + 5);
        doc.text("Cam 1 NoScale", imageX, imagesY + imageHeight + 15);
        imageX += imageWidth + imageSpacing;
        imageIndex++;
      } catch (error) {
        console.error("Failed to add fingerprint:", error);
      }
    }

    // 产品照片
    for (const weighing of weighings) {
      if (weighing.product_photo_path && fs.existsSync(weighing.product_photo_path)) {
        try {
          if (imageX + imageWidth > 550) {
            imagesY += imageHeight + 30;
            imageX = tableLeft;
          }
          if (imagesY + imageHeight > 700) {
            doc.addPage();
            imagesY = 50;
            imageX = tableLeft;
          }
          doc.image(weighing.product_photo_path, imageX, imagesY, {
            width: imageWidth,
            height: imageHeight,
            fit: [imageWidth, imageHeight],
          });
          const imgDate = new Date(session.session_time);
          const imgDateStr = imgDate.toLocaleDateString("en-US", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          });
          const imgTimeStr = imgDate.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          });
          doc.fontSize(7).fillColor("black");
          doc.text(`${imgDateStr} ${imgTimeStr}`, imageX, imagesY + imageHeight + 5);
          doc.text("Cam 1 NoScale", imageX, imagesY + imageHeight + 15);
          imageX += imageWidth + imageSpacing;
          imageIndex++;
        } catch (error) {
          console.error("Failed to add product photo:", error);
        }
      }
    }
  }

  /**
   * 生成Police Report PDF
   */
  async generateReport(sessionId: number): Promise<string> {
    // 获取session数据
    const session = this.repo.weighingSessions.getById(this.activationId, sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    // 获取客户信息
    const customer = session.customer_id 
      ? this.repo.customers.getById(this.activationId, session.customer_id)
      : null;

    // 获取车辆信息
    const vehicle = customer?.id 
      ? this.repo.vehicles.getAll(this.activationId).find((v: any) => v.customer_id === customer.id)
      : null;

    // 获取称重记录
    const weighings = this.repo.weighings.getBySession(this.activationId, sessionId);

    // 获取生物识别数据
    const biometricData = customer?.id 
      ? this.repo.biometricData.getByCustomerId(this.activationId, customer.id)
      : null;

    // 创建PDF文档
    const userDataPath = app.getPath("userData");
    const reportsDir = path.join(userDataPath, "reports");
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const fileName = `police_report_session_${sessionId}_${Date.now()}.pdf`;
    const filePath = path.join(reportsDir, fileName);

    // 获取字体路径并复制到构建目录（如果需要）
    const fontPath = getPDFKitFontPath();
    
    // PDFKit使用__dirname + '/data'来查找字体文件
    // 在打包环境中，__dirname指向.vite/build目录
    // 所以我们需要在.vite/build/data中放置字体文件
    const buildDataDir = path.join(__dirname, 'data');
    
    console.log('Font source path:', fontPath);
    console.log('Build data dir (where PDFKit looks):', buildDataDir);
    console.log('__dirname:', __dirname);
    
    if (!fontPath) {
      throw new Error('Cannot find PDFKit font file path, please ensure pdfkit package is installed');
    }
    
    try {
      // 确保data目录存在
      if (!fs.existsSync(buildDataDir)) {
        fs.mkdirSync(buildDataDir, { recursive: true });
        console.log('Created build data directory:', buildDataDir);
      }
      
      // 检查是否需要复制字体文件（每次都检查以确保文件存在）
      const helveticaDestPath = path.join(buildDataDir, 'Helvetica.afm');
      if (!fs.existsSync(helveticaDestPath)) {
        console.log('Copying font files to build directory...');
        // 复制所有字体文件到构建目录
        const fontFiles = fs.readdirSync(fontPath);
        let copiedCount = 0;
        for (const file of fontFiles) {
          if (file.endsWith('.afm') || file.endsWith('.icc')) {
            const sourceFile = path.join(fontPath, file);
            const destFile = path.join(buildDataDir, file);
            try {
              fs.copyFileSync(sourceFile, destFile);
              copiedCount++;
              console.log(`Copied ${file}`);
            } catch (copyError) {
              console.error(`Failed to copy ${file}:`, copyError);
            }
          }
        }
        console.log(`Successfully copied ${copiedCount} font files to ${buildDataDir}`);
      } else {
        console.log('Font files already exist in build directory');
      }
      
      // 再次验证关键文件是否存在
      if (!fs.existsSync(helveticaDestPath)) {
        throw new Error(`Font file copy failed, Helvetica.afm does not exist in ${buildDataDir}`);
      }
    } catch (error: any) {
      console.error('Failed to setup font files:', error);
      throw new Error(`Failed to setup font files: ${error.message}`);
    }

    // 创建PDF文档
    const doc = new PDFDocument({ 
      size: "LETTER", 
      margin: 50
    });

    // 将PDF写入文件
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // 标题
    doc.fontSize(20).text("Police Ticket and Image Report", { align: "center" });
    doc.moveDown();

    // 报告日期
    const reportDate = new Date(session.session_time);
    const dateStr = reportDate.toLocaleDateString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const timeStr = reportDate.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    doc.fontSize(12).text(`${dateStr} ${timeStr}`, { align: "right" });
    doc.fontSize(10).text(
      `${dateStr} 12:00 AM - ${dateStr} 11:59 PM`,
      { align: "center" }
    );
    doc.moveDown(2);

    // 客户信息区域（蓝色背景模拟）
    doc.rect(50, doc.y, 500, 100).fill("#1E88E5").stroke("#1E88E5");
    
    const startY = doc.y + 10;
    doc.fillColor("white");

    // 左列
    doc.fontSize(10).text(`Ref. No.: ${vehicle?.id || "N/A"}`, 60, startY);
    doc.text(`Name: ${customer?.name || "N/A"}`, 60, startY + 15);
    doc.text(`Address: ${customer?.address || "N/A"}`, 60, startY + 30);
    doc.text(`City/State: ${customer?.address?.split(",")[1]?.trim() || "N/A"}`, 60, startY + 45);
    doc.text(`DL #: ${customer?.license_number || ""}`, 60, startY + 60);

    // 右列
    doc.text(`D.O.B.: ${customer?.license_number || ""}`, 300, startY);
    doc.text(`ID Expiration: ${customer?.id_expiration || ""}`, 300, startY + 15);
    doc.text(`Height: ${customer?.height || ""}`, 300, startY + 30);
    doc.text(`Weight: ${customer?.weight || ""}`, 300, startY + 45);
    doc.text(`Hair Color: ${customer?.hair_color || ""}`, 300, startY + 60);

    doc.fillColor("black");
    doc.moveDown(6);

    // 交易明细表格
    doc.fontSize(12).text("Transaction Details", { underline: true });
    doc.moveDown(0.5);

    // 表头
    const tableTop = doc.y;
    const tableLeft = 50;
    const colWidths = [80, 120, 100, 120, 80, 100]; // 增加Total列宽度，减少Product Name列宽度
    const rowHeight = 25;

    // 表头背景
    doc.rect(tableLeft, tableTop, 500, rowHeight)
      .fill("#E3F2FD")
      .stroke();

    doc.fontSize(9).fillColor("black");
    doc.text("Ticket No.", tableLeft + 5, tableTop + 8);
    doc.text("Date", tableLeft + colWidths[0] + 5, tableTop + 8);
    doc.text("License Plate", tableLeft + colWidths[0] + colWidths[1] + 5, tableTop + 8);
    doc.text("Product Name", tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + 5, tableTop + 8);
    doc.text("Net weight", tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 5, tableTop + 8);
    doc.text("Total", tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + 5, tableTop + 8);

    // 数据行
    let currentY = tableTop + rowHeight;
    weighings.forEach((weighing: any) => {
      if (currentY > 650) {
        doc.addPage();
        currentY = 50;
        // 重新绘制表头
        doc.rect(tableLeft, currentY, 500, rowHeight)
          .fill("#E3F2FD")
          .stroke();
        doc.text("Ticket No.", tableLeft + 5, currentY + 8);
        doc.text("Date", tableLeft + colWidths[0] + 5, currentY + 8);
        doc.text("License Plate", tableLeft + colWidths[0] + colWidths[1] + 5, currentY + 8);
        doc.text("Product Name", tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + 5, currentY + 8);
        doc.text("Net weight", tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 5, currentY + 8);
        doc.text("Total", tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + 5, currentY + 8);
        currentY += rowHeight;
      }

      // 行边框
      doc.rect(tableLeft, currentY, 500, rowHeight).stroke();

      const ticketDate = new Date(session.session_time);
      const ticketDateStr = ticketDate.toLocaleDateString("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const ticketTimeStr = ticketDate.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });

      doc.fontSize(8).fillColor("black");
      doc.text(`${sessionId}`, tableLeft + 5, currentY + 8);
      doc.text(`${ticketDateStr} ${ticketTimeStr}`, tableLeft + colWidths[0] + 5, currentY + 8);
      doc.text(`${vehicle?.license_plate || "N/A"}`, tableLeft + colWidths[0] + colWidths[1] + 5, currentY + 8);
      doc.text(`${weighing.waste_type_name || "N/A"}`, tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + 5, currentY + 8);
      doc.text(`${parseFloat(weighing.weight).toFixed(0)}`, tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 5, currentY + 8);
      // 格式化Total金额，使用千位分隔符
      const totalAmount = parseFloat(weighing.total_amount);
      const formattedTotal = totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      doc.text(`$${formattedTotal}`, tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + 5, currentY + 8);

      currentY += rowHeight;
    });

    doc.moveDown(2);

    // 图片部分
    let imagesY = doc.y;
    const imageWidth = 150;
    const imageHeight = 120;
    const imageSpacing = 20;
    let imageX = tableLeft;
    let imageIndex = 0;

    // 客户照片
    if (biometricData?.face_image_path && fs.existsSync(biometricData.face_image_path)) {
      try {
        doc.image(biometricData.face_image_path, imageX, imagesY, {
          width: imageWidth,
          height: imageHeight,
          fit: [imageWidth, imageHeight],
        });
        const imgDate = new Date(session.session_time);
        const imgDateStr = imgDate.toLocaleDateString("en-US", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        const imgTimeStr = imgDate.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        });
        doc.fontSize(7).fillColor("black");
        doc.text(`${imgDateStr} ${imgTimeStr}`, imageX, imagesY + imageHeight + 5);
        doc.text("Cam 1 NoScale", imageX, imagesY + imageHeight + 15);
        imageX += imageWidth + imageSpacing;
        imageIndex++;
      } catch (error) {
        console.error("Failed to add customer photo:", error);
      }
    }

    // 指纹
    if (biometricData?.fingerprint_image_path && fs.existsSync(biometricData.fingerprint_image_path)) {
      try {
        if (imageX + imageWidth > 550) {
          doc.addPage();
          imagesY = 50;
          imageX = tableLeft;
        }
        doc.image(biometricData.fingerprint_image_path, imageX, imagesY, {
          width: imageWidth,
          height: imageHeight,
          fit: [imageWidth, imageHeight],
        });
        const imgDate = new Date(session.session_time);
        const imgDateStr = imgDate.toLocaleDateString("en-US", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        const imgTimeStr = imgDate.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        });
        doc.fontSize(7).fillColor("black");
        doc.text(`${imgDateStr} ${imgTimeStr}`, imageX, imagesY + imageHeight + 5);
        doc.text("Cam 1 NoScale", imageX, imagesY + imageHeight + 15);
        imageX += imageWidth + imageSpacing;
        imageIndex++;
      } catch (error) {
        console.error("Failed to add fingerprint:", error);
      }
    }

    // 产品照片
    for (const weighing of weighings) {
      if (weighing.product_photo_path && fs.existsSync(weighing.product_photo_path)) {
        try {
          if (imageX + imageWidth > 550) {
            doc.addPage();
            imagesY = 50;
            imageX = tableLeft;
          }
          doc.image(weighing.product_photo_path, imageX, imagesY, {
            width: imageWidth,
            height: imageHeight,
            fit: [imageWidth, imageHeight],
          });
          const imgDate = new Date(session.session_time);
          const imgDateStr = imgDate.toLocaleDateString("en-US", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          });
          const imgTimeStr = imgDate.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          });
          doc.fontSize(7).fillColor("black");
          doc.text(`${imgDateStr} ${imgTimeStr}`, imageX, imagesY + imageHeight + 5);
          doc.text("Cam 1 NoScale", imageX, imagesY + imageHeight + 15);
          imageX += imageWidth + imageSpacing;
          imageIndex++;
        } catch (error) {
          console.error("Failed to add product photo:", error);
        }
      }
    }

    // 完成PDF
    doc.end();

    // 等待文件写入完成
    await new Promise<void>((resolve, reject) => {
      stream.on("finish", resolve);
      stream.on("error", reject);
    });

    return filePath;
  }
}

