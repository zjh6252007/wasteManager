import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { repo, getDb } from "../db/connection";

// 获取PDFKit字体文件路径
function getPDFKitFontPath(): string | null {
  try {
    const possiblePaths = [
      path.join(process.cwd(), 'node_modules', 'pdfkit', 'js', 'data'),
      path.join(process.resourcesPath || '', 'node_modules', 'pdfkit', 'js', 'data'),
      path.join(app.getAppPath(), 'node_modules', 'pdfkit', 'js', 'data'),
      path.resolve(__dirname, '..', '..', 'node_modules', 'pdfkit', 'js', 'data'),
      path.resolve(__dirname, '..', 'node_modules', 'pdfkit', 'js', 'data'),
      path.join(path.dirname(process.execPath), 'resources', 'app', 'node_modules', 'pdfkit', 'js', 'data'),
      path.join(path.dirname(process.execPath), 'node_modules', 'pdfkit', 'js', 'data'),
    ];

    for (const fontPath of possiblePaths) {
      const helveticaPath = path.join(fontPath, 'Helvetica.afm');
      if (fs.existsSync(helveticaPath)) {
        return fontPath;
      }
    }
    return null;
  } catch (error) {
    console.error('Failed to find PDFKit fonts:', error);
    return null;
  }
}

export class InventoryReportService {
  private activationId: number;

  constructor(activationId: number) {
    this.activationId = activationId;
  }

  /**
   * 生成Inventory Summary报告
   */
  async generateReport(startDate: string, endDate: string): Promise<string> {
    // 直接查询指定日期范围内的所有称重记录（不分组，直接查询weighings表）
    const db = getDb();
    
    // 构建查询条件
    let whereConditions = ['w.activation_id = ?'];
    let params: any[] = [this.activationId];

    if (startDate) {
      whereConditions.push('DATE(ws.session_time) >= ?');
      params.push(startDate);
    }

    if (endDate) {
      whereConditions.push('DATE(ws.session_time) <= ?');
      params.push(endDate);
    }

    const whereClause = whereConditions.join(' AND ');

    // 查询所有符合条件的称重记录
    const stmt = db.prepare(`
      SELECT 
        w.*,
        mt.name as waste_type_name,
        mt.symbol as metal_symbol,
        ws.session_time
      FROM weighings w
      INNER JOIN weighing_sessions ws ON w.session_id = ws.id AND ws.activation_id = w.activation_id
      LEFT JOIN metal_types mt ON w.waste_type_id = mt.id AND mt.activation_id = w.activation_id
      WHERE ${whereClause}
      ORDER BY mt.name ASC
    `);
    
    const allWeighings = stmt.all(...params) as any[];

    // 按产品分组统计
    const productMap = new Map<number, {
      name: string;
      symbol: string;
      totalPounds: number;
      totalPrice: number;
      count: number;
    }>();

    for (const weighing of allWeighings) {
      const metalTypeId = weighing.waste_type_id;
      if (!metalTypeId || !weighing.waste_type_name) continue;

      const weight = parseFloat(weighing.weight || '0');
      const totalAmount = parseFloat(weighing.total_amount || '0');

      if (productMap.has(metalTypeId)) {
        const existing = productMap.get(metalTypeId)!;
        existing.totalPounds += weight;
        existing.totalPrice += totalAmount;
        existing.count += 1;
      } else {
        productMap.set(metalTypeId, {
          name: weighing.waste_type_name,
          symbol: weighing.metal_symbol || '',
          totalPounds: weight,
          totalPrice: totalAmount,
          count: 1
        });
      }
    }

    // 转换为数组并按名称排序
    const products = Array.from(productMap.entries())
      .map(([id, data]) => ({
        id,
        ...data
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // 创建PDF文档
    const userDataPath = app.getPath("userData");
    const reportsDir = path.join(userDataPath, "reports");
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const fileName = `inventory_summary_${startDate}_${endDate}_${Date.now()}.pdf`;
    const filePath = path.join(reportsDir, fileName);

    // 设置字体路径
    const fontPath = getPDFKitFontPath();
    const buildDataDir = path.join(__dirname, 'data');
    
    if (fontPath) {
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
              fs.copyFileSync(sourceFile, destFile);
            }
          }
        }
      } catch (error) {
        console.error('Failed to setup font files:', error);
      }
    }

    const doc = new PDFDocument({ 
      size: "LETTER", 
      margin: 50
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // 标题
    doc.fontSize(16).text("OMP", 50, 50);
    const reportDate = new Date();
    const reportDateStr = reportDate.toLocaleDateString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const reportTimeStr = reportDate.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    doc.fontSize(10).text(`${reportDateStr} ${reportTimeStr}`, { align: "right" });
    
    doc.moveDown(1);
    doc.fontSize(18).text("Incoming Inventory Summary", { align: "center" });
    doc.moveDown(0.5);
    
    // 日期范围
    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate);
    const startDateFormatted = startDateObj.toLocaleDateString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const endDateFormatted = endDateObj.toLocaleDateString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    doc.fontSize(10).text(
      `[${startDateFormatted} 12:00 AM - ${endDateFormatted} 11:59 PM]`,
      { align: "center" }
    );
    doc.moveDown(2);

    // 表格
    const tableTop = doc.y;
    const tableLeft = 50;
    const colWidths = [200, 80, 80, 80, 100, 100];
    const rowHeight = 20;
    const headerHeight = 25;

    // 表头（蓝色背景）
    doc.rect(tableLeft, tableTop, 590, headerHeight)
      .fill("#1E88E5")
      .stroke();

    doc.fontSize(9).fillColor("white");
    doc.text("Product", tableLeft + 5, tableTop + 8);
    doc.text("Total Units", tableLeft + colWidths[0] + 5, tableTop + 8);
    doc.text("Total Tons", tableLeft + colWidths[0] + colWidths[1] + 5, tableTop + 8);
    doc.text("Total Pounds", tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + 5, tableTop + 8);
    doc.text("Avg. Price", tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 5, tableTop + 8);
    doc.text("Total Price", tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + 5, tableTop + 8);

    doc.fillColor("black");
    let currentY = tableTop + headerHeight;
    let productNumber = 1;

    // 数据行
    for (const product of products) {
      if (currentY > 700) {
        doc.addPage();
        currentY = 50;
        // 重新绘制表头
        doc.rect(tableLeft, currentY, 590, headerHeight)
          .fill("#1E88E5")
          .stroke();
        doc.fontSize(9).fillColor("white");
        doc.text("Product", tableLeft + 5, currentY + 8);
        doc.text("Total Units", tableLeft + colWidths[0] + 5, currentY + 8);
        doc.text("Total Tons", tableLeft + colWidths[0] + colWidths[1] + 5, currentY + 8);
        doc.text("Total Pounds", tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + 5, currentY + 8);
        doc.text("Avg. Price", tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 5, currentY + 8);
        doc.text("Total Price", tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + 5, currentY + 8);
        doc.fillColor("black");
        currentY += headerHeight;
      }

      // 行边框
      doc.rect(tableLeft, currentY, 590, rowHeight).stroke();

      const totalTons = product.totalPounds / 2000;
      const avgPrice = product.totalPounds > 0 ? product.totalPrice / product.totalPounds : 0;

      doc.fontSize(8).fillColor("black");
      doc.text(`${productNumber} - ${product.name}`, tableLeft + 5, currentY + 6);
      doc.text("0.00", tableLeft + colWidths[0] + 5, currentY + 6);
      doc.text(totalTons.toFixed(2), tableLeft + colWidths[0] + colWidths[1] + 5, currentY + 6);
      doc.text(product.totalPounds.toFixed(2), tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + 5, currentY + 6);
      doc.text(`${avgPrice.toFixed(3)} / lb`, tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 5, currentY + 6);
      // 格式化总价格为 $X,XXX.XX 格式
      const formattedPrice = product.totalPrice.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
      doc.text(`$${formattedPrice}`, tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + 5, currentY + 6);

      currentY += rowHeight;
      productNumber++;
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

