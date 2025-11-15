-- 垃圾回收称重系统数据库结构

-- 客户表
CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 垃圾类型表
CREATE TABLE IF NOT EXISTS waste_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL, -- 单价（元/公斤）
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 称重记录表
CREATE TABLE IF NOT EXISTS weighings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER,
    waste_type_id INTEGER,
    weight DECIMAL(10,3) NOT NULL, -- 重量（公斤）
    unit_price DECIMAL(10,2) NOT NULL, -- 单价
    total_amount DECIMAL(10,2) NOT NULL, -- 总金额
    weighing_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    is_synced BOOLEAN DEFAULT 0, -- 是否已同步到服务器
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (waste_type_id) REFERENCES waste_types(id)
);

-- 插入默认垃圾类型
INSERT OR IGNORE INTO waste_types (name, unit_price) VALUES 
('废纸', 1.50),
('废塑料', 2.00),
('废金属', 3.50),
('废玻璃', 0.80),
('其他', 1.00);
