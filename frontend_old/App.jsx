import React from "react";
import FileUploader from "./components/FileUploader";

function App() {
  return (
    <div style={{ padding: "20px", fontFamily: "Arial" }}>
      <h1>ExcelBridge - Import Excel</h1>
      <FileUploader />
    </div>
  );
}

export default App;
