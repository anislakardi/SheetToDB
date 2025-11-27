import React, { useState } from "react";
import * as XLSX from "xlsx";

function FileUploader() {
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);

  const handlePreview = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setFileName(file.name);
    setSelectedFile(file);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      setPreview(jsonData.slice(0, 10));
    };
    reader.readAsArrayBuffer(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return alert("❌ Aucun fichier !");

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const res = await fetch("http://localhost:5000/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      alert("✅ Upload réussi !");
      console.log(data);
    } catch (err) {
      console.error(err);
      alert("❌ Erreur upload backend");
    }
  };

  return (
    <div style={{ marginTop: "20px" }}>
      <input type="file" accept=".xlsx" onChange={handlePreview} />

      {fileName && <p>Fichier sélectionné : <b>{fileName}</b></p>}

      <button onClick={handleUpload} disabled={!fileName}>
        🚀 Envoyer au backend
      </button>

      {preview.length > 0 && (
        <table border="1" style={{ marginTop: 20, borderCollapse: "collapse" }}>
          <tbody>
            {preview.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j} style={{ padding: 5 }}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default FileUploader;
