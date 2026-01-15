/**
 * 数据库列检查辅助函数
 * 用于检查表是否有特定列，避免在列不存在时出错
 */

import { getDb } from '../db/connection';

/**
 * 检查表是否有指定列
 */
export function hasColumn(tableName: string, columnName: string): boolean {
  try {
    const db = getDb();
    const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all() as any[];
    return tableInfo.some(col => col.name === columnName);
  } catch (error) {
    console.error(`[ColumnHelper] Error checking column ${columnName} in ${tableName}:`, error);
    return false;
  }
}

/**
 * 获取安全的 UPDATE 语句（如果列不存在，不包含该列）
 */
export function getSafeUpdateSQL(
  tableName: string,
  columns: string[],
  whereClause: string
): string {
  const db = getDb();
  const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all() as any[];
  const existingColumns = tableInfo.map(col => col.name);
  
  const safeColumns = columns.filter(col => existingColumns.includes(col));
  
  if (safeColumns.length === 0) {
    throw new Error(`No valid columns found for table ${tableName}`);
  }
  
  const setClause = safeColumns.map(col => `${col} = ?`).join(', ');
  return `UPDATE ${tableName} SET ${setClause} WHERE ${whereClause}`;
}

/**
 * 获取安全的 INSERT 语句（如果列不存在，不包含该列）
 */
export function getSafeInsertSQL(
  tableName: string,
  columns: string[]
): { sql: string; placeholders: string[] } {
  const db = getDb();
  const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all() as any[];
  const existingColumns = tableInfo.map(col => col.name);
  
  const safeColumns = columns.filter(col => existingColumns.includes(col));
  
  if (safeColumns.length === 0) {
    throw new Error(`No valid columns found for table ${tableName}`);
  }
  
  const placeholders = safeColumns.map(() => '?').join(', ');
  const sql = `INSERT INTO ${tableName} (${safeColumns.join(', ')}) VALUES (${placeholders})`;
  
  return { sql, placeholders: safeColumns };
}




