// Shared application state is initialized in app.js after these function definitions load.

function initializeNavigation() {
  document.getElementById("libraryTab").addEventListener("click", () => setActiveView("library"));
  document.getElementById("organizeTab").addEventListener("click", () => setActiveView("organize"));
}

function setActiveView(view) {
  activeView = view;
  document.querySelector('.download-panel').classList.toggle('hidden', view === 'library');
  document.querySelector('.folder-setup').classList.toggle('library-active', view === 'library');
  for (const name of ["library", "organize"]) {
    const active = name === view;
    document.getElementById(`${name}View`).classList.toggle("hidden", !active);
    const tab = document.getElementById(`${name}Tab`);
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-pressed", String(active));
  }
  scheduleDraftSave();
  if(view==='library'){ReviewPreviews.suspend();renderLibraryPatterns();}
  else{GalleryPreviews.suspend();ReviewPreviews.resume();}
}

function openReviewPdf(file) {
  const viewer = window.open("about:blank", "_blank");
  if (!viewer) {
    pdfOpenStatus("Allow pop-ups for this site to open PDFs.");
    return;
  }
  viewer.opener = null;
  file.handle.getFile().then(pdf => {
    const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
    viewer.location.replace(url);
    // The native viewer has time to read the blob; URL references do not accumulate.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }).catch(error => {
    viewer.close();
    pdfOpenStatus(`Could not open PDF: ${error.message}`);
  });
}

function pdfOpenStatus(message){
  const status=activeView==='library'?document.getElementById('previewStatus'):executeStatus;status.textContent=message;
  if(activeView==='library')status.dataset.override='true';
}

async function reloadLibraryData() {
  favoriteDesignerStatus('');
  designerFolders = [];
  singlesPdfNames = [];
  singlesDirectoryHandle = null;

  for await (const entry of libraryDirectoryHandle.values()) {
    if (entry.kind !== "directory") {
      continue;
    }

    if (entry.name === SINGLES_FOLDER_NAME) {
      singlesDirectoryHandle = entry;
      continue;
    }

    if (!entry.name.startsWith("!")) {
      designerFolders.push(entry.name);
    }
  }

  designerFolders.sort((a, b) =>
    a.localeCompare(b, "ko")
  );

  if (singlesDirectoryHandle) {
    for await (const entry of singlesDirectoryHandle.values()) {
      if (
        entry.kind === "file" &&
        entry.name.toLowerCase().endsWith(".pdf")
      ) {
        singlesPdfNames.push(entry.name);
      }
    }

    singlesPdfNames.sort((a, b) =>
      a.localeCompare(b, "ko")
    );

    singlesFileCount.textContent =
      `${singlesPdfNames.length} PDFs in ${SINGLES_FOLDER_NAME}`;
  } else {
    singlesFileCount.textContent =
      `${SINGLES_FOLDER_NAME} does not exist yet. It will be created when organizing files.`;
  }

  designerFolderCount.textContent =
    `Designer folders: ${designerFolders.length}`;

  designerSearch.disabled = false;

  renderAliasList();
  await loadLibraryCatalog();
}
