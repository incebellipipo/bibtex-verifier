// Shared file / paste input panel.
import { $ } from "./dom.js";

const uploadZone = $(".upload-zone");
const fileInput = $("#file-input");
const uploadStatus = $(".upload-status");
const btnVerify = $("#btn-verify");

export const bibPaste = $("#bib-paste");

export function focusBibtexInput() {
  bibPaste.focus({ preventScroll: true });
}

/**
 * @param {{ onContent: (content: string, statusMsg: string) => void }} handlers
 */
export function initInput({ onContent }) {
  async function handleFile(file) {
    if (!file.name.toLowerCase().endsWith(".bib")) {
      alert("Please choose a .bib file.");
      return;
    }

    try {
      bibPaste.value = await file.text();
      uploadStatus.textContent = `Loaded ${file.name}. You can edit it before verifying.`;
      uploadZone.classList.add("has-file");
    } catch {
      alert("That file could not be read. Please try again or paste its contents.");
    }
  }

  uploadZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadZone.classList.add("dragover");
  });
  uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("dragover"));
  uploadZone.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadZone.classList.remove("dragover");
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  btnVerify.addEventListener("click", () => {
    const content = bibPaste.value.trim();
    if (!content) { alert("Please paste BibTeX or choose a .bib file first."); return; }
    onContent(content, "Parsing BibTeX...");
  });
}
