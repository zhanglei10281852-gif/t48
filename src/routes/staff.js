const { Router } = require("express");
const { pool } = require("../db");
const router = Router();

router.post("/", async (req, res) => {
  const { staff_no, name, role } = req.body;
  if (!staff_no || !name) {
    return res.status(400).json({ error: "工号和姓名为必填" });
  }
  try {
    const [result] = await pool.execute(
      "INSERT INTO staff (staff_no, name, role) VALUES (?,?,?)",
      [staff_no, name, role || "审核员"],
    );
    res.status(201).json({ id: result.insertId, message: "工作人员添加成功" });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY")
      return res.status(409).json({ error: "工号已存在" });
    res.status(500).json({ error: e.message });
  }
});

router.get("/", async (req, res) => {
  const { role, name, page = 1, size = 20 } = req.query;
  let conditions = [];
  let params = [];
  if (role) {
    conditions.push("role = ?");
    params.push(role);
  }
  if (name) {
    conditions.push("name LIKE ?");
    params.push(`%${name}%`);
  }
  const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
  const [[{ total }]] = await pool.execute(
    `SELECT COUNT(*) as total FROM staff${where}`,
    params,
  );
  const limit = parseInt(size);
  const offset = (parseInt(page) - 1) * limit;
  const [data] = await pool.query(
    `SELECT * FROM staff${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  res.json({ total, page: parseInt(page), size: limit, data });
});

router.get("/:id", async (req, res) => {
  const [[row]] = await pool.execute("SELECT * FROM staff WHERE id = ?", [
    req.params.id,
  ]);
  if (!row) return res.status(404).json({ error: "工作人员不存在" });
  res.json(row);
});

router.put("/:id", async (req, res) => {
  const [[existing]] = await pool.execute("SELECT id FROM staff WHERE id = ?", [
    req.params.id,
  ]);
  if (!existing) return res.status(404).json({ error: "工作人员不存在" });
  const fields = ["name", "role"];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      params.push(req.body[f]);
    }
  }
  if (!updates.length) return res.status(400).json({ error: "无更新字段" });
  params.push(req.params.id);
  await pool.execute(`UPDATE staff SET ${updates.join(", ")} WHERE id = ?`, params);
  res.json({ message: "更新成功" });
});

router.delete("/:id", async (req, res) => {
  const [[existing]] = await pool.execute(
    "SELECT id, current_count FROM staff WHERE id = ?",
    [req.params.id],
  );
  if (!existing) return res.status(404).json({ error: "工作人员不存在" });
  if (existing.current_count > 0) {
    return res.status(400).json({ error: "该工作人员仍有在审工单，无法删除" });
  }
  await pool.execute("DELETE FROM staff WHERE id = ?", [req.params.id]);
  res.json({ message: "删除成功" });
});

module.exports = router;
