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
  if(view==='library')renderLibraryPatterns();else GalleryPreviews.suspend();
}

function openReviewPdf(file) {
  const viewer = window.open("about:blank", "_blank");
  if (!viewer) {
    pdfOpenStatus("PDF를 열려면 이 사이트의 팝업을 허용하세요.");
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
    pdfOpenStatus(`PDF를 열지 못했습니다: ${error.message}`);
  });
}

function pdfOpenStatus(message){
  const status=activeView==='library'?document.getElementById('previewStatus'):executeStatus;status.textContent=message;
  if(activeView==='library')status.dataset.override='true';
}

async function reloadLibraryData() {
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
      `${SINGLES_FOLDER_NAME} PDF 파일 ${singlesPdfNames.length}개`;
  } else {
    singlesFileCount.textContent =
      `${SINGLES_FOLDER_NAME} 폴더 없음 — 정리 실행 시 새로 생성됩니다.`;
  }

  designerFolderCount.textContent =
    `디자이너 폴더 ${designerFolders.length}개`;

  designerSearch.disabled = false;

  renderAliasList();
  await loadLibraryCatalog();
}
