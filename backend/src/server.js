// backend/src/server.js
import express from "express";
import cors from "cors";
import multer from "multer";
import * as XLSX from "xlsx";
import oracledb from "oracledb";
import dotenv from "dotenv";
import path from "path";

// Optionnel : garde dotenv si tu veux pouvoir surcharger depuis .env
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// -------------------- CONFIG (modifier ici) --------------------
// Tu peux modifier ces valeurs directement ici.
// Si tu veux utiliser .env plus tard, elles seront remplacées automatiquement.
const HARD_CODED_DB = {
  user: "messi",               // <-- change ici si besoin
  password: "123",           // <-- change ici si besoin
  connectString: "localhost/XEPDB1" // <-- change ici si besoin (ex: "localhost:1521/XEPDB1")
};

// Lecture depuis process.env si fournies, sinon fallback vers HARD_CODED_DB
const DB_USER = process.env.DB_USER || HARD_CODED_DB.user;
const DB_PASSWORD = process.env.DB_PASSWORD || HARD_CODED_DB.password;
const DB_CONNECT = process.env.DB_CONNECT || HARD_CODED_DB.connectString;
// ----------------------------------------------------------------

console.log("Using DB config:", {
  user: DB_USER,
  connectString: DB_CONNECT ? DB_CONNECT.replace(/:.+@/, "@") : DB_CONNECT
  // ne pas log le password pour la sécurité
});

// multer memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage });

// helper: sanitize column name or table name to valid Oracle identifier
function sanitizeName(name) {
  if (!name) return "DEFAULT";
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

// Helpers pour inférence de types
function inferColumnTypeAndSize(samples) {
  let isDate = true;
  let isNumber = true;
  let maxLength = 0;
  for (let val of samples) {
    if (val === null || val === undefined) continue;
    maxLength = Math.max(maxLength, String(val).length);
    if (isDate && !(val instanceof Date || !isNaN(Date.parse(val)))) isDate = false;
    if (isNumber && isNaN(parseFloat(val))) isNumber = false;
    if (!isDate && !isNumber) break;
  }
  if (isDate) return { type: 'DATE', size: null };
  if (isNumber) return { type: 'NUMBER', size: null };
  return { type: 'VARCHAR2', size: Math.max(1, Math.min(4000, maxLength * 2)) }; // *2 pour marge
}

function getBindType(oracleType) {
  if (oracleType === 'DATE') return oracledb.DATE;
  if (oracleType === 'NUMBER') return oracledb.NUMBER;
  return oracledb.STRING;
}

app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "Aucun fichier reçu" });

  try {
    const fileBuffer = req.file.buffer;
    const originalFileName = req.file.originalname;
    let baseTableName = sanitizeName(path.parse(originalFileName).name); // Nom sans extension

    if (!baseTableName) {
      return res.status(400).json({ message: "Nom de fichier invalide" });
    }

    // Parse avec cellDates pour dates
    const workbook = XLSX.read(fileBuffer, { type: "buffer", cellDates: true, raw: false });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    if (!rows || rows.length === 0) {
      return res.status(400).json({ message: "Fichier Excel vide" });
    }

    // Headers
    const rawHeaders = rows[0].map((h) => (h === undefined || h === null ? "COL" : h));
    const headers = rawHeaders.map(sanitizeName);

    // Inférer types et tailles (échantillon toutes les rows pour précision)
    const sampleRows = rows.slice(1);
    const columnDefs = headers.map((_, colIdx) => {
      const samples = sampleRows.map(row => row[colIdx]);
      return inferColumnTypeAndSize(samples);
    });

    // connect to oracle
    const connection = await oracledb.getConnection({
      user: DB_USER,
      password: DB_PASSWORD,
      connectString: DB_CONNECT,
    });

    let tableName = baseTableName;
    let exists = await checkTableExists(connection, tableName);
    let suffix = 1;

    if (exists) {
      // Récupérer les colonnes existantes (noms seulement, pas types pour simplicité)
      const existingCols = await getTableColumns(connection, tableName);
      // Comparer (triés pour ignorer l'ordre)
      const sortedHeaders = [...headers].sort();
      const sortedExisting = [...existingCols].sort();
      const columnsMatch = sortedHeaders.length === sortedExisting.length &&
                           sortedHeaders.every((val, idx) => val === sortedExisting[idx]);

      if (columnsMatch) {
        console.log(`Colonnes correspondent. Ajout à la table existante: ${tableName}`);
        // TODO: Pour robustesse, vérifier types matchent aussi, mais on assume OK
      } else {
        // Trouver un nouveau nom
        while (exists) {
          tableName = `${baseTableName}_${suffix}`;
          exists = await checkTableExists(connection, tableName);
          suffix++;
        }
        console.log(`Colonnes ne correspondent pas. Création d'une nouvelle table: ${tableName}`);
      }
    }

    if (!exists) {
      // Créer table avec types/tailles inférés
      const colsDef = headers.map((h, i) => {
        const def = columnDefs[i];
        return `"${h}" ${def.type}${def.size ? `(${def.size})` : ''}`;
      }).join(", ");
      const createSql = `CREATE TABLE "${tableName}" (${colsDef})`;
      await connection.execute(createSql);
      console.log("Table created:", tableName, "with defs:", columnDefs);
    } else {
      console.log("Table exists:", tableName);
    }

    // Prepare insert
    const colList = headers.map((h) => `"${h}"`).join(", ");
    const placeholders = headers.map((_, i) => `:${i + 1}`).join(", ");
    const insertSql = `INSERT INTO "${tableName}" (${colList}) VALUES (${placeholders})`;

    // Bind defs pour types
    const bindDefs = headers.map((_, i) => ({ type: getBindType(columnDefs[i].type) }));

    // Insert rows (skip header)
    const errors = [];
    let inserted = 0;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const binds = headers.map((_, i) => {
        let val = row[i] === undefined ? null : row[i];
        if (columnDefs[i].type === 'DATE' && !(val instanceof Date)) {
          val = new Date(val); // Convertir si string
        } else if (columnDefs[i].type === 'NUMBER' && typeof val === 'string') {
          val = parseFloat(val.replace(',', '.')); // Gérer virgule décimale
        }
        return val;
      });

      try {
        await connection.execute(insertSql, binds, { bindDefs });
        inserted++;
      } catch (err) {
        console.error(`Error inserting row ${r + 1}:`, err.message);
        errors.push({ row: r + 1, error: err.message });
      }
    }

    await connection.commit();
    await connection.close();

    res.json({
      message: `Import terminé dans ${tableName}`,
      inserted,
      total: rows.length - 1,
      errors,
    });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
});

// Helpers supplémentaires
async function checkTableExists(connection, tableName) {
  const check = await connection.execute(
    `SELECT COUNT(*) AS CNT FROM user_tables WHERE table_name = :tn`,
    [tableName.toUpperCase()]
  );
  return check.rows[0][0] > 0;
}

async function getTableColumns(connection, tableName) {
  const result = await connection.execute(
    `SELECT column_name FROM user_tab_columns WHERE table_name = :tn ORDER BY column_id`,
    [tableName.toUpperCase()]
  );
  return result.rows.map(row => row[0]);
}

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Backend running on http://localhost:${port}`));