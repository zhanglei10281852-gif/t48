const { Router } = require("express");
const { pool } = require("../db");
const router = Router();

function generateOrderNo() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const r = String(Math.floor(Math.random() * 90000) + 10000);
  return `WO${y}${m}${d}${r}`;
}

function generateCaseNo() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const r = String(Math.floor(Math.random() * 9000) + 1000);
  return `FA${y}${m}${d}${r}`;
}

async function addLog(orderId, action, operator, remark, conn) {
  const db = conn || pool;
  await db.execute(
    "INSERT INTO work_order_logs (order_id, action, operator, remark) VALUES (?,?,?,?)",
    [orderId, action, operator || "系统", remark || null],
  );
}

function determineCategory(has_low_income, has_disability) {
  if (has_low_income) return "低保户";
  if (has_disability) return "残疾人";
  return "其他";
}

router.post("/online/apply", async (req, res) => {
  const {
    name,
    id_card,
    phone,
    address,
    apply_reason,
    case_type,
    economic_status,
    has_low_income,
    has_disability,
  } = req.body;

  if (!name || !id_card || !phone || !apply_reason || !case_type) {
    return res
      .status(400)
      .json({ error: "姓名、身份证号、电话、申请事由、案件类别为必填" });
  }

  const order_no = generateOrderNo();

  let priority = "普通";
  let info_missing = null;
  let status = "待分配";

  if (has_low_income || has_disability) {
    priority = "优先";
  }

  const missingFields = [];
  if (!economic_status) missingFields.push("家庭经济状况描述");
  if (!address) missingFields.push("家庭地址");

  if (missingFields.length > 0) {
    info_missing = missingFields.join("、");
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.execute(
      `INSERT INTO work_orders 
       (order_no, source, priority, status, applicant_name, id_card, phone, address, 
        apply_reason, case_type, economic_status, has_low_income, has_disability, info_missing)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        order_no,
        "线上",
        priority,
        status,
        name,
        id_card,
        phone,
        address || null,
        apply_reason,
        case_type,
        economic_status || null,
        has_low_income ? 1 : 0,
        has_disability ? 1 : 0,
        info_missing,
      ],
    );

    let remark = `线上申请提交，优先级：${priority}`;
    if (info_missing) remark += `，待补充：${info_missing}`;
    await addLog(result.insertId, "提交申请", "群众自助", remark, conn);

    await conn.commit();
    res.status(201).json({
      id: result.insertId,
      order_no,
      priority,
      status,
      info_missing,
      message: "申请提交成功",
    });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

router.post("/hotline/apply", async (req, res) => {
  const {
    caller_name,
    caller_phone,
    caller_id_card,
    call_time,
    call_summary,
    hotline_urgency,
    operator_no,
    case_type,
  } = req.body;

  if (
    !caller_name ||
    !caller_phone ||
    !call_summary ||
    !hotline_urgency ||
    !operator_no
  ) {
    return res.status(400).json({
      error: "来电人姓名、电话、来电内容摘要、紧急程度、话务员工号为必填",
    });
  }

  const order_no = generateOrderNo();
  const priority = hotline_urgency === "紧急" ? "紧急" : "普通";

  const missingFields = [];
  if (!caller_id_card) missingFields.push("身份证号");
  if (!case_type) missingFields.push("案件类别");
  const info_missing =
    missingFields.length > 0 ? missingFields.join("、") : null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.execute(
      `INSERT INTO work_orders 
       (order_no, source, priority, status, applicant_name, id_card, phone, 
        apply_reason, case_type, call_time, call_summary, hotline_urgency, operator_no, info_missing)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        order_no,
        "热线",
        priority,
        "待分配",
        caller_name,
        caller_id_card || null,
        caller_phone,
        call_summary,
        case_type || null,
        call_time || new Date(),
        call_summary,
        hotline_urgency,
        operator_no,
        info_missing,
      ],
    );

    await addLog(
      result.insertId,
      "热线转入",
      `话务员${operator_no}`,
      `12348热线转入，紧急程度：${hotline_urgency}`,
      conn,
    );

    await conn.commit();
    res.status(201).json({
      id: result.insertId,
      order_no,
      priority,
      status: "待分配",
      message: "热线工单录入成功",
    });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

router.post("/window/apply", async (req, res) => {
  const {
    name,
    id_card,
    phone,
    address,
    apply_reason,
    case_type,
    category,
    income_level,
    operator_name,
  } = req.body;

  if (!name || !id_card || !phone || !apply_reason || !case_type || !category) {
    return res
      .status(400)
      .json({ error: "姓名、身份证号、电话、申请事由、案件类别、类别为必填" });
  }

  const order_no = generateOrderNo();
  const priority =
    category === "低保户" || category === "残疾人" ? "优先" : "普通";

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const has_low_income = category === "低保户" ? 1 : 0;
    const has_disability = category === "残疾人" ? 1 : 0;

    const [result] = await conn.execute(
      `INSERT INTO work_orders 
       (order_no, source, priority, status, applicant_name, id_card, phone, address, 
        apply_reason, case_type, has_low_income, has_disability)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        order_no,
        "窗口",
        priority,
        "待分配",
        name,
        id_card,
        phone,
        address || null,
        apply_reason,
        case_type,
        has_low_income,
        has_disability,
      ],
    );

    await addLog(
      result.insertId,
      "窗口受理",
      operator_name || "窗口工作人员",
      `窗口受理申请，类别：${category}`,
      conn,
    );

    await conn.commit();
    res.status(201).json({
      id: result.insertId,
      order_no,
      priority,
      status: "待分配",
      message: "窗口受理成功",
    });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

router.get("/pool", async (req, res) => {
  const { source, status, priority, keyword, page = 1, size = 20 } = req.query;
  let conditions = [];
  let params = [];

  if (source) {
    conditions.push("source = ?");
    params.push(source);
  }
  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }
  if (priority) {
    conditions.push("priority = ?");
    params.push(priority);
  }
  if (keyword) {
    conditions.push(
      "(applicant_name LIKE ? OR order_no LIKE ? OR phone LIKE ?)",
    );
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
  const [[{ total }]] = await pool.execute(
    `SELECT COUNT(*) as total FROM work_orders${where}`,
    params,
  );

  const limit = parseInt(size);
  const offset = (parseInt(page) - 1) * limit;

  const priorityOrder = "FIELD(priority, '紧急', '优先', '普通')";

  const [data] = await pool.query(
    `SELECT wo.*, s.name as staff_name, s.staff_no 
     FROM work_orders wo 
     LEFT JOIN staff s ON wo.assigned_staff_id = s.id
     ${where} 
     ORDER BY ${priorityOrder}, wo.created_at ASC 
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  res.json({ total, page: parseInt(page), size: limit, data });
});

router.get("/:id", async (req, res) => {
  const [[row]] = await pool.execute(
    `SELECT wo.*, s.name as staff_name, s.staff_no 
     FROM work_orders wo 
     LEFT JOIN staff s ON wo.assigned_staff_id = s.id
     WHERE wo.id = ?`,
    [req.params.id],
  );
  if (!row) return res.status(404).json({ error: "工单不存在" });
  res.json(row);
});

router.post("/auto-assign", async (req, res) => {
  const { count = 10 } = req.body;
  const maxCount = parseInt(count);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [pendingOrders] = await conn.query(
      `SELECT id, priority, status FROM work_orders 
       WHERE status = '待分配' 
       ORDER BY FIELD(priority, '紧急', '优先', '普通'), created_at ASC 
       LIMIT ?`,
      [maxCount],
    );

    if (pendingOrders.length === 0) {
      await conn.commit();
      return res.json({ assigned: 0, message: "没有待分配工单" });
    }

    const [availableStaff] = await conn.query(
      `SELECT id, staff_no, name, current_count, last_assign_time 
       FROM staff 
       WHERE role = '审核员' AND current_count < 10 
       ORDER BY last_assign_time IS NULL DESC, last_assign_time ASC, id ASC`,
    );

    if (availableStaff.length === 0) {
      await conn.commit();
      return res.status(400).json({ error: "没有可用的审核人员" });
    }

    let assignedCount = 0;
    let staffIndex = 0;

    for (const order of pendingOrders) {
      let assigned = false;
      let attempts = 0;

      while (!assigned && attempts < availableStaff.length) {
        const staff = availableStaff[staffIndex % availableStaff.length];

        if (staff.current_count < 10) {
          await conn.execute(
            "UPDATE work_orders SET status = '审核中', assigned_staff_id = ? WHERE id = ?",
            [staff.id, order.id],
          );
          await conn.execute(
            "UPDATE staff SET current_count = current_count + 1, last_assign_time = NOW() WHERE id = ?",
            [staff.id],
          );
          await addLog(
            order.id,
            "自动分配",
            "系统",
            `分配给审核员：${staff.name}（${staff.staff_no}）`,
            conn,
          );

          staff.current_count++;
          assignedCount++;
          assigned = true;
        }

        staffIndex++;
        attempts++;
      }

      if (!assigned) {
        break;
      }
    }

    await conn.commit();
    res.json({
      assigned: assignedCount,
      message: `成功分配 ${assignedCount} 个工单`,
    });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

router.post("/:id/assign", async (req, res) => {
  const { staff_id, operator } = req.body;
  if (!staff_id) return res.status(400).json({ error: "工作人员ID为必填" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[order]] = await conn.execute(
      "SELECT id, status, assigned_staff_id FROM work_orders WHERE id = ?",
      [req.params.id],
    );
    if (!order) {
      await conn.rollback();
      return res.status(404).json({ error: "工单不存在" });
    }
    if (order.status !== "待分配" && order.status !== "待补充") {
      await conn.rollback();
      return res
        .status(400)
        .json({ error: "只有待分配或待补充状态的工单可以分配" });
    }

    const [[staff]] = await conn.execute(
      "SELECT id, name, staff_no, current_count FROM staff WHERE id = ?",
      [staff_id],
    );
    if (!staff) {
      await conn.rollback();
      return res.status(404).json({ error: "工作人员不存在" });
    }
    if (staff.current_count >= 10) {
      await conn.rollback();
      return res
        .status(400)
        .json({ error: "该工作人员在审工单已达上限（10个）" });
    }

    const oldStaffId = order.assigned_staff_id;

    await conn.execute(
      "UPDATE work_orders SET status = '审核中', assigned_staff_id = ? WHERE id = ?",
      [staff_id, req.params.id],
    );
    await conn.execute(
      "UPDATE staff SET current_count = current_count + 1, last_assign_time = NOW() WHERE id = ?",
      [staff_id],
    );

    if (oldStaffId) {
      await conn.execute(
        "UPDATE staff SET current_count = current_count - 1 WHERE id = ?",
        [oldStaffId],
      );
    }

    await addLog(
      req.params.id,
      "手动分配",
      operator || "管理员",
      `分配给审核员：${staff.name}（${staff.staff_no}）`,
      conn,
    );

    await conn.commit();
    res.json({ message: "工单分配成功" });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

router.post("/:id/approve", async (req, res) => {
  const { operator } = req.body;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[order]] = await conn.execute(
      "SELECT * FROM work_orders WHERE id = ?",
      [req.params.id],
    );
    if (!order) {
      await conn.rollback();
      return res.status(404).json({ error: "工单不存在" });
    }
    if (order.status !== "审核中") {
      await conn.rollback();
      return res.status(400).json({ error: "只有审核中状态可以转为正式案件" });
    }

    if (!order.id_card) {
      await conn.rollback();
      return res
        .status(400)
        .json({ error: "缺少身份证号，无法创建正式申请记录" });
    }
    if (!order.case_type) {
      await conn.rollback();
      return res.status(400).json({ error: "缺少案件类别，无法创建正式案件" });
    }

    let applicantId;
    const [[existingApplicant]] = await conn.execute(
      "SELECT id FROM applicants WHERE id_card = ?",
      [order.id_card],
    );

    if (existingApplicant) {
      applicantId = existingApplicant.id;
    } else {
      const category = determineCategory(
        order.has_low_income,
        order.has_disability,
      );
      const [appResult] = await conn.execute(
        "INSERT INTO applicants (name, id_card, gender, phone, address, category) VALUES (?,?,?,?,?,?)",
        [
          order.applicant_name,
          order.id_card,
          "男",
          order.phone,
          order.address,
          category,
        ],
      );
      applicantId = appResult.insertId;
    }

    const case_no = generateCaseNo();
    const [caseResult] = await conn.execute(
      "INSERT INTO cases (case_no, applicant_id, case_type, description, status) VALUES (?,?,?,?,?)",
      [case_no, applicantId, order.case_type, order.apply_reason, "待审批"],
    );

    await conn.execute(
      "UPDATE work_orders SET status = '已转正', case_id = ? WHERE id = ?",
      [caseResult.insertId, req.params.id],
    );

    if (order.assigned_staff_id) {
      await conn.execute(
        "UPDATE staff SET current_count = current_count - 1 WHERE id = ?",
        [order.assigned_staff_id],
      );
    }

    await addLog(
      req.params.id,
      "转为正式案件",
      operator || "审核员",
      `案件编号：${case_no}，申请人ID：${applicantId}`,
      conn,
    );

    await conn.commit();
    res.json({
      message: "已转为正式案件",
      case_id: caseResult.insertId,
      case_no,
      applicant_id: applicantId,
    });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

router.post("/:id/return-supplement", async (req, res) => {
  const { supplement_note, operator } = req.body;
  if (!supplement_note) {
    return res.status(400).json({ error: "请填写需要补充的材料说明" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[order]] = await conn.execute(
      "SELECT id, status, assigned_staff_id FROM work_orders WHERE id = ?",
      [req.params.id],
    );
    if (!order) {
      await conn.rollback();
      return res.status(404).json({ error: "工单不存在" });
    }
    if (order.status !== "审核中") {
      await conn.rollback();
      return res.status(400).json({ error: "只有审核中状态可以退回补充" });
    }

    await conn.execute(
      "UPDATE work_orders SET status = '待补充', supplement_note = ? WHERE id = ?",
      [supplement_note, req.params.id],
    );

    if (order.assigned_staff_id) {
      await conn.execute(
        "UPDATE staff SET current_count = current_count - 1 WHERE id = ?",
        [order.assigned_staff_id],
      );
    }

    await addLog(
      req.params.id,
      "退回补充",
      operator || "审核员",
      supplement_note,
      conn,
    );

    await conn.commit();
    res.json({ message: "已退回补充材料" });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

router.post("/:id/resubmit", async (req, res) => {
  const {
    name,
    id_card,
    phone,
    address,
    apply_reason,
    case_type,
    economic_status,
    has_low_income,
    has_disability,
  } = req.body;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[order]] = await conn.execute(
      "SELECT id, status FROM work_orders WHERE id = ?",
      [req.params.id],
    );
    if (!order) {
      await conn.rollback();
      return res.status(404).json({ error: "工单不存在" });
    }
    if (order.status !== "待补充") {
      await conn.rollback();
      return res.status(400).json({ error: "只有待补充状态可以重新提交" });
    }

    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push("applicant_name = ?");
      params.push(name);
    }
    if (id_card !== undefined) {
      updates.push("id_card = ?");
      params.push(id_card);
    }
    if (phone !== undefined) {
      updates.push("phone = ?");
      params.push(phone);
    }
    if (address !== undefined) {
      updates.push("address = ?");
      params.push(address);
    }
    if (apply_reason !== undefined) {
      updates.push("apply_reason = ?");
      params.push(apply_reason);
    }
    if (case_type !== undefined) {
      updates.push("case_type = ?");
      params.push(case_type);
    }
    if (economic_status !== undefined) {
      updates.push("economic_status = ?");
      params.push(economic_status);
    }
    if (has_low_income !== undefined) {
      updates.push("has_low_income = ?");
      params.push(has_low_income ? 1 : 0);
    }
    if (has_disability !== undefined) {
      updates.push("has_disability = ?");
      params.push(has_disability ? 1 : 0);
    }

    updates.push("status = ?");
    params.push("待分配");

    updates.push("supplement_note = ?");
    params.push(null);

    params.push(req.params.id);

    await conn.execute(
      `UPDATE work_orders SET ${updates.join(", ")} WHERE id = ?`,
      params,
    );

    await addLog(
      req.params.id,
      "重新提交",
      "群众自助",
      "补充材料后重新提交",
      conn,
    );

    await conn.commit();
    res.json({ message: "重新提交成功，已进入待分配池" });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

router.post("/:id/reject", async (req, res) => {
  const { reject_reason, operator } = req.body;
  if (!reject_reason) {
    return res.status(400).json({ error: "请填写不予受理理由" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[order]] = await conn.execute(
      "SELECT id, status, assigned_staff_id FROM work_orders WHERE id = ?",
      [req.params.id],
    );
    if (!order) {
      await conn.rollback();
      return res.status(404).json({ error: "工单不存在" });
    }
    if (order.status !== "审核中") {
      await conn.rollback();
      return res.status(400).json({ error: "只有审核中状态可以不予受理" });
    }

    await conn.execute(
      "UPDATE work_orders SET status = '不予受理', reject_reason = ? WHERE id = ?",
      [reject_reason, req.params.id],
    );

    if (order.assigned_staff_id) {
      await conn.execute(
        "UPDATE staff SET current_count = current_count - 1 WHERE id = ?",
        [order.assigned_staff_id],
      );
    }

    await addLog(
      req.params.id,
      "不予受理",
      operator || "审核员",
      reject_reason,
      conn,
    );

    await conn.commit();
    res.json({ message: "已不予受理" });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

router.get("/:id/logs", async (req, res) => {
  const [logs] = await pool.execute(
    "SELECT * FROM work_order_logs WHERE order_id = ? ORDER BY created_at ASC, id ASC",
    [req.params.id],
  );
  res.json({ data: logs });
});

router.get("/stats/overview", async (req, res) => {
  const [[{ total }]] = await pool.execute(
    "SELECT COUNT(*) as total FROM work_orders",
  );
  const [[{ pending }]] = await pool.execute(
    "SELECT COUNT(*) as pending FROM work_orders WHERE status = '待分配'",
  );
  const [[{ reviewing }]] = await pool.execute(
    "SELECT COUNT(*) as reviewing FROM work_orders WHERE status = '审核中'",
  );
  const [[{ supplement }]] = await pool.execute(
    "SELECT COUNT(*) as supplement FROM work_orders WHERE status = '待补充'",
  );
  const [[{ approved }]] = await pool.execute(
    "SELECT COUNT(*) as approved FROM work_orders WHERE status = '已转正'",
  );
  const [[{ rejected }]] = await pool.execute(
    "SELECT COUNT(*) as rejected FROM work_orders WHERE status = '不予受理'",
  );

  const [bySource] = await pool.execute(
    "SELECT source, COUNT(*) as count FROM work_orders GROUP BY source",
  );

  const [byPriority] = await pool.execute(
    "SELECT priority, COUNT(*) as count FROM work_orders GROUP BY priority",
  );

  res.json({
    total,
    pending,
    reviewing,
    supplement,
    approved,
    rejected,
    bySource,
    byPriority,
  });
});

router.get("/stats/source-ratio", async (req, res) => {
  const [[{ total }]] = await pool.execute(
    "SELECT COUNT(*) as total FROM work_orders",
  );
  const [bySource] = await pool.execute(
    "SELECT source, COUNT(*) as count FROM work_orders GROUP BY source",
  );

  const data = bySource.map((item) => ({
    source: item.source,
    count: item.count,
    ratio: total > 0 ? ((item.count / total) * 100).toFixed(2) + "%" : "0%",
  }));

  res.json({ total, data });
});

router.get("/stats/daily-by-source", async (req, res) => {
  const { days = 7 } = req.query;
  const [data] = await pool.query(
    `SELECT 
       DATE(created_at) as date,
       source,
       COUNT(*) as count
     FROM work_orders 
     WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(created_at), source
     ORDER BY date DESC, source`,
    [parseInt(days)],
  );

  res.json({ days: parseInt(days), data });
});

router.get("/stats/avg-process-time", async (req, res) => {
  const [[result]] = await pool.execute(
    `SELECT 
       AVG(TIMESTAMPDIFF(MINUTE, created_at, updated_at)) as avg_minutes,
       COUNT(*) as completed_count
     FROM work_orders 
     WHERE status IN ('已转正', '不予受理')`,
  );

  const avgHours = result.avg_minutes
    ? (result.avg_minutes / 60).toFixed(2)
    : 0;
  const avgDays = result.avg_minutes
    ? (result.avg_minutes / 60 / 24).toFixed(2)
    : 0;

  res.json({
    avg_minutes: result.avg_minutes ? Math.round(result.avg_minutes) : 0,
    avg_hours: parseFloat(avgHours),
    avg_days: parseFloat(avgDays),
    completed_count: result.completed_count || 0,
  });
});

router.get("/stats/approval-rate", async (req, res) => {
  const [[{ total }]] = await pool.execute(
    "SELECT COUNT(*) as total FROM work_orders WHERE status IN ('已转正', '不予受理')",
  );
  const [[{ approved }]] = await pool.execute(
    "SELECT COUNT(*) as approved FROM work_orders WHERE status = '已转正'",
  );
  const [[{ rejected }]] = await pool.execute(
    "SELECT COUNT(*) as rejected FROM work_orders WHERE status = '不予受理'",
  );

  const approvalRate =
    total > 0 ? ((approved / total) * 100).toFixed(2) + "%" : "0%";
  const rejectRate =
    total > 0 ? ((rejected / total) * 100).toFixed(2) + "%" : "0%";

  res.json({
    total_processed: total,
    approved,
    rejected,
    approval_rate: approvalRate,
    reject_rate: rejectRate,
  });
});

router.get("/stats/staff-ranking", async (req, res) => {
  const [data] = await pool.query(
    `SELECT 
       s.id,
       s.staff_no,
       s.name,
       s.current_count,
       COUNT(wo.id) as total_processed,
       SUM(CASE WHEN wo.status = '已转正' THEN 1 ELSE 0 END) as approved_count,
       SUM(CASE WHEN wo.status = '不予受理' THEN 1 ELSE 0 END) as rejected_count
     FROM staff s
     LEFT JOIN work_orders wo ON s.id = wo.assigned_staff_id AND wo.status IN ('已转正', '不予受理')
     WHERE s.role = '审核员'
     GROUP BY s.id, s.staff_no, s.name, s.current_count
     ORDER BY total_processed DESC, s.id ASC`,
  );

  res.json({ data });
});

module.exports = router;
