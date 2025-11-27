import React, { useState } from "react";

function FileUploader() {
  const [fileName, setFileName] = useState("");

  const handleChange = (e) => {
    if (e.target.files.length > 0) {
      setFileName(e.target.files[0].name);
    }
  };

  const handleUpload = () => {
    alert(`Fichier "${fileName}" prêt à être envoyé !`);
  };

  return (
    <div style={{ marginTop: "20px" }}>
      <input type="file" accept=".xlsx" onChange={handleChange} />
      {fileName && <p>Fichier sélectionné : {fileName}</p>}
      <button onClick={handleUpload} disabled={!fileName}>
        Envoyer
      </button>
    </div>
  );
}

export default FileUploader;
