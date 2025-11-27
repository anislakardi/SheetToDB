// backend/src/server.js
import express from "express";
import cors from "cors";
import multer from "multer";
import * as XLSX from "xlsx";
import oracledb from "oracledb";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// multer memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage });

// read env
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_CONNECT = process.env.DB_CONNECT;
const DEFAULT_TABLE = process.env.TABLE_NAME || "DYNAMIC_TABLE";

// helper: sanitize column name to valid Oracle identifier (simple version)
function sanitizeColName(name) {
  if (!name) return "COL";
  // replace spaces and non-alphanumeric by underscore, uppercase
  return name
    .toString()
    .trim()
    .replace(/["'`]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .toUpperCase()
    .slice(0, 30);
}

app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "Aucun fichier reçu" });

  try {
    const fileBuffer = req.file.buffer;

    // parse workbook
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    if (!rows || rows.length === 0) {
      return res.status(400).json({ message: "Fichier Excel vide" });
    }

    // header = first row
    const rawHeaders = rows[0].map((h) => (h === undefined || h === null ? "COL" : h));
    const headers = rawHeaders.map(sanitizeColName);

    // choose table name (default or you can read from request)
    const tableName = (req.body.tableName || DEFAULT_TABLE).toUpperCase();

    // connect to oracle
    const connection = await oracledb.getConnection({
      user: DB_USER,
      password: DB_PASSWORD,
      connectString: DB_CONNECT,
    });

    // check if table exists in current schema (USER_TABLES)
    const check = await connection.execute(
      `SELECT COUNT(*) AS CNT FROM user_tables WHERE table_name = :tn`,
      [tableName]
    );

    const exists = check.rows[0][0] > 0;

    if (!exists) {
      // create table: all columns as VARCHAR2(4000)
      const colsDef = headers.map((h) => `"${h}" VARCHAR2(4000)`).join(", ");
      const createSql = `CREATE TABLE "${tableName}" (${colsDef})`;
      await connection.execute(createSql);
      console.log("Table created:", tableName);
    }

    // prepare insert SQL with bind placeholders
    const colList = headers.map((h) => `"${h}"`).join(", ");
    const placeholders = headers.map((_, i) => `:${i + 1}`).join(", ");
    const insertSql = `INSERT INTO "${tableName}" (${colList}) VALUES (${placeholders})`;

    // Insert rows (skip header)
    const errors = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      // make sure row length matches headers (pad with nulls)
      const binds = headers.map((_, i) => (row[i] === undefined ? null : String(row[i])));

      try {
        await connection.execute(insertSql, binds);
      } catch (err) {
        console.error(`Error inserting row ${r + 1}:`, err.message);
        errors.push({ row: r + 1, error: err.message });
      }
    }

    await connection.commit();
    await connection.close();

    res.json({
      message: `Import terminé dans ${tableName}`,
      inserted: rows.length - 1 - errors.length,
      total: rows.length - 1,
      errors,
    });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Backend running on http://localhost:${port}`));
