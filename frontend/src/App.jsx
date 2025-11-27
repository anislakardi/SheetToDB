import React from "react";
import FileUploader from "./components/FileUploader.jsx";

function App() {
  return (
    <div style={styles.container}>
      <h1>📤 Import Excel → Oracle DB</h1>
      <p>Choisir un fichier Excel (.xlsx) et l’envoyer au backend</p>
      <FileUploader />
    </div>
  );
}

const styles = {
  container: {
    fontFamily: "Arial, sans-serif",
    textAlign: "center",
    padding: "40px",
    background: "#f5f5f7",
    minHeight: "100vh",
  }
};

export default App;
