const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "3306"),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "legal123",
  database: process.env.DB_NAME || "legal_aid",
  charset: "utf8mb4",
  waitForConnections: true,
  connectionLimit: 10,
});

async function initDb() {
  const conn = await pool.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS applicants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        id_card VARCHAR(18) NOT NULL UNIQUE,
        gender ENUM('男','女') NOT NULL,
        phone VARCHAR(20),
        address VARCHAR(200),
        category ENUM('低保户','残疾人','老年人','未成年人','农民工','军人军属','其他') NOT NULL,
        income_level ENUM('无收入','低收入','一般'),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS lawyers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        license_no VARCHAR(30) NOT NULL UNIQUE,
        phone VARCHAR(20),
        firm VARCHAR(100) NOT NULL,
        speciality VARCHAR(50),
        status ENUM('可接案','案件中','休假') NOT NULL DEFAULT '可接案',
        case_count INT DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS cases (
        id INT AUTO_INCREMENT PRIMARY KEY,
        case_no VARCHAR(20) NOT NULL UNIQUE,
        applicant_id INT NOT NULL,
        lawyer_id INT,
        case_type ENUM('民事','刑事','行政','劳动争议','婚姻家庭','其他') NOT NULL,
        description TEXT,
        status ENUM('待审批','已批准','已指派','办理中','已结案','已驳回') NOT NULL DEFAULT '待审批',
        approve_reason VARCHAR(500),
        reject_reason VARCHAR(500),
        result TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (applicant_id) REFERENCES applicants(id),
        FOREIGN KEY (lawyer_id) REFERENCES lawyers(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS staff (
        id INT AUTO_INCREMENT PRIMARY KEY,
        staff_no VARCHAR(20) NOT NULL UNIQUE,
        name VARCHAR(50) NOT NULL,
        role ENUM('审核员','管理员') NOT NULL DEFAULT '审核员',
        current_count INT NOT NULL DEFAULT 0,
        last_assign_time DATETIME NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS work_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_no VARCHAR(30) NOT NULL UNIQUE,
        source ENUM('窗口','线上','热线') NOT NULL,
        priority ENUM('紧急','优先','普通') NOT NULL DEFAULT '普通',
        status ENUM('待分配','审核中','待补充','已转正','不予受理','已关闭') NOT NULL DEFAULT '待分配',
        applicant_name VARCHAR(50),
        id_card VARCHAR(18),
        phone VARCHAR(20),
        address VARCHAR(200),
        apply_reason TEXT,
        case_type ENUM('民事','刑事','行政','劳动争议','婚姻家庭','其他'),
        economic_status TEXT,
        has_low_income TINYINT(1) DEFAULT 0,
        has_disability TINYINT(1) DEFAULT 0,
        call_time DATETIME NULL,
        call_summary TEXT,
        hotline_urgency ENUM('一般','紧急') NULL,
        operator_no VARCHAR(20),
        info_missing TEXT,
        assigned_staff_id INT NULL,
        supplement_note TEXT,
        reject_reason TEXT,
        case_id INT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (assigned_staff_id) REFERENCES staff(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS work_order_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT NOT NULL,
        action VARCHAR(50) NOT NULL,
        operator VARCHAR(50),
        remark TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES work_orders(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    console.log("数据库表初始化完成");
  } finally {
    conn.release();
  }
}

module.exports = { pool, initDb };
