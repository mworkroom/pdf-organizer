// Shared application state is initialized in app.js after these function definitions load.

function invalidateDuplicateCheck() {
  duplicateCheckComplete = false;
  scheduleDraftSave();

  downloadFiles.forEach((file) => {
    file.analysis = {
      action: "unchecked",
      message: "",
      matchPath: ""
    };
  });

  executeStatus.className = "execute-status";
  executeStatus.textContent = "";

  updateAllPreviews();
}

function getIncompleteFiles() {
  return downloadFiles.filter((file) => {
    if (file.excluded) return false;

    const patternFileName = ensurePdfExtension(file.patternFileName.trim());
    return !patternFileName || !file.destinationName.trim();
  });
}

function hasIncompleteFiles() {
  return getIncompleteFiles().length > 0;
}

function clearIncompleteHighlights() {
  downloadFiles.forEach((file) => {
    file.rowElement?.classList.remove("incomplete");
    file.destinationInputElement?.classList.remove("incomplete-input");
    file.patternInputElement?.classList.remove("incomplete-input");
  });
}

function validateCompletenessAndFocus() {
  clearIncompleteHighlights();
  const incompleteFiles = getIncompleteFiles();

  if (incompleteFiles.length === 0) return true;
  selectReviewFile(incompleteFiles[0].name);

  incompleteFiles.forEach((file) => {
    file.rowElement?.classList.add("incomplete");
    if (!file.destinationName.trim()) {
      file.destinationInputElement?.classList.add("incomplete-input");
    }
    if (!ensurePdfExtension(file.patternFileName.trim())) {
      file.patternInputElement?.classList.add("incomplete-input");
    }
  });

  const first = incompleteFiles[0];
  alert(
    `입력하지 않은 파일이 ${incompleteFiles.length}개 있습니다.\n\n` +
    `첫 번째 누락: ${first.name}\n` +
    `확인을 누르면 해당 위치로 이동합니다.`
  );

  requestAnimationFrame(() => {
    first.rowElement?.scrollIntoView({ behavior: "smooth", block: "center" });
    const target = !first.destinationName.trim()
      ? first.destinationInputElement
      : first.patternInputElement;
    target?.focus({ preventScroll: true });
  });

  return false;
}

function renderDownloadFileList() {
  downloadFileCount.textContent = `폴더에 남은 PDF ${getAllReviewFiles().filter(file => !file.completed).length}개 · 한 번에 최대 ${BATCH_LIMIT}개`;
  downloadFileList.replaceChildren();
}
function renderDesignerFolders(folders) {
  designerFolderList.innerHTML = "";

  if (folders.length === 0) {
    designerFolderList.innerHTML =
      `<p class="empty">검색 결과가 없습니다.</p>`;
    return;
  }

  folders.forEach((folderName) => {
    const item = document.createElement("div");
    item.className = "designer-item";
    item.textContent = folderName;
    designerFolderList.appendChild(item);
  });
}

function renderSortingRows() {
  sortingPanel.classList.toggle("hidden", !getAllReviewFiles().length);
  if (!downloadFiles.some(file => file.name === selectedReviewName)) selectedReviewName = downloadFiles[0]?.name || "";
  renderReviewFileList();
  renderSelectedFile();
}
function renderSelectedFile() {
  sortingList.innerHTML = "";

  for (const file of downloadFiles) {
    for (const field of ["rowElement", "destinationInputElement", "patternInputElement", "previewElement", "statusElement"]) file[field] = null;
  }
  const selected = downloadFiles.find(file => file.name === selectedReviewName);
  if (!selected) {
    sortingList.innerHTML = '<p class="empty">검토할 파일을 선택하세요.</p>';
    return;
  }

  [selected].forEach((file) => {
    const row = document.createElement("div");
    row.className = file.excluded ? "sort-row excluded" : "sort-row";
    file.rowElement = row;

    const sourceHeader = document.createElement("div");
    sourceHeader.className = "source-header";

    const sourceFile = document.createElement("div");
    sourceFile.className = "source-file";
    sourceFile.textContent = `원본 파일: ${file.name}`;

    const excludeLabel = document.createElement("label");
    excludeLabel.className = "exclude-label";

    const excludeCheckbox = document.createElement("input");
    excludeCheckbox.type = "checkbox";
    excludeCheckbox.checked = file.excluded;

    const excludeText = document.createElement("span");
    excludeText.textContent = "이번 작업에서 제외";

    excludeLabel.appendChild(excludeCheckbox);
    excludeLabel.appendChild(excludeText);

    sourceHeader.appendChild(sourceFile);
    sourceHeader.appendChild(excludeLabel);
    const openButton = document.createElement("button");
    openButton.type = "button"; openButton.className = "secondary-button";
    openButton.textContent = "PDF 열기";
    openButton.addEventListener("click", () => openReviewPdf(file));
    sourceHeader.appendChild(openButton);

    const grid = document.createElement("div");
    grid.className = "sort-grid";

    const destinationField = document.createElement("div");
    destinationField.className = "field";

    const destinationLabel = document.createElement("label");
    destinationLabel.className = "field-label";
    destinationLabel.textContent =
      "저장 기준 디자이너명 / 기존 디자이너 검색";

    const destinationInput = document.createElement("input");
    destinationInput.className = "text-input";
    destinationInput.type = "text";
    destinationInput.placeholder = "예: Knitree, 마요, 나무 Knitree";
    destinationInput.value = file.destinationName;
    destinationInput.disabled = file.excluded;
    file.destinationInputElement = destinationInput;

    const selectedLabel = document.createElement("div");
    selectedLabel.className = "selected-label";

    if (file.selectedFolder) {
      selectedLabel.textContent = file.autoLinkedAlias
        ? `자동 연결됨: ${file.autoLinkedAlias} → ${file.selectedFolder}`
        : `기존 디자이너 선택됨: ${file.selectedFolder}`;
    }

    const suggestionsContainer = document.createElement("div");

    destinationField.appendChild(destinationLabel);
    destinationField.appendChild(destinationInput);
    destinationField.appendChild(selectedLabel);
    destinationField.appendChild(suggestionsContainer);

    const sourceDesignerField = document.createElement("div");
    sourceDesignerField.className = "field";

    const sourceDesignerLabel = document.createElement("label");
    sourceDesignerLabel.className = "field-label";
    sourceDesignerLabel.textContent = "파일명 속 디자이너 표기";

    const sourceDesignerInput = document.createElement("input");
    sourceDesignerInput.className = "text-input";
    sourceDesignerInput.type = "text";
    sourceDesignerInput.placeholder = "예: Knitree, Anna-Sofia Vintersol";
    sourceDesignerInput.value = file.sourceDesignerName;
    sourceDesignerInput.disabled = file.excluded;

    const sourceDesignerHint = document.createElement("div");
    sourceDesignerHint.className = "field-hint";
    sourceDesignerHint.textContent =
      "원본 파일명에서 제거할 이름입니다. 기존 디자이너를 선택한 뒤 이 표기를 연결로 저장할 수 있습니다.";

    const rememberButton = document.createElement("button");
    rememberButton.type = "button";
    rememberButton.className = "secondary-button remember-button";
    rememberButton.textContent = "이 연결 기억";
    rememberButton.disabled =
      file.excluded || !getExistingFolderName(file);

    sourceDesignerField.appendChild(sourceDesignerLabel);
    sourceDesignerField.appendChild(sourceDesignerInput);
    sourceDesignerField.appendChild(sourceDesignerHint);
    sourceDesignerField.appendChild(rememberButton);

    const patternField = document.createElement("div");
    patternField.className = "field";

    const patternLabel = document.createElement("label");
    patternLabel.className = "field-label";
    patternLabel.textContent = "정리 후 패턴 파일명";

    const patternInput = document.createElement("input");
    patternInput.className = "text-input";
    patternInput.type = "text";
    patternInput.placeholder = "예: summer_top.pdf";
    patternInput.value = file.patternFileName;
    patternInput.disabled = file.excluded;
    file.patternInputElement = patternInput;

    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.className = "secondary-button";
    resetButton.textContent = "자동 정리 다시 적용";
    resetButton.disabled = file.excluded;

    patternField.appendChild(patternLabel);
    patternField.appendChild(patternInput);
    patternField.appendChild(resetButton);

    const previewField = document.createElement("div");
    previewField.className = "preview-area";

    const previewLabel = document.createElement("label");
    previewLabel.className = "field-label";
    previewLabel.textContent = "저장 결과 미리보기";

    const preview = document.createElement("div");
    preview.className = "preview pending";

    const status = document.createElement("div");
    status.className = "row-status unchecked";
    status.textContent = "중복 검사 전";

    file.previewElement = preview;
    file.statusElement = status;

    previewField.appendChild(previewLabel);
    previewField.appendChild(preview);
    previewField.appendChild(status);

    grid.appendChild(destinationField);
    grid.appendChild(sourceDesignerField);
    grid.appendChild(patternField);

    grid.appendChild(previewField);

    row.appendChild(sourceHeader);
    row.appendChild(grid);
    row.appendChild(renderReviewCategories(file));
    sortingList.appendChild(row);

    excludeCheckbox.addEventListener("change", () => {
      file.excluded = excludeCheckbox.checked;

      invalidateDuplicateCheck();
      renderSortingRows();
    });

    rememberButton.addEventListener("click", () => {
      rememberConnection(file);
    });

    destinationInput.addEventListener("input", () => {
      file.destinationName = destinationInput.value.trim();
      file.selectedFolder = null;
      file.autoLinkedAlias = "";
      selectedLabel.textContent = "";

      if (!file.sourceDesignerTouched) {
        file.sourceDesignerName = file.destinationName;
        sourceDesignerInput.value = file.sourceDesignerName;

        if (!file.patternManuallyEdited) {
          file.patternFileName = suggestPatternFileName(
            file.name,
            file.sourceDesignerName
          );
          patternInput.value = file.patternFileName;
        }
      }

      rememberButton.disabled = true;

      renderSuggestions(
        file,
        suggestionsContainer,
        destinationInput,
        sourceDesignerInput,
        patternInput,
        selectedLabel,
        rememberButton
      );

      invalidateDuplicateCheck();
    });

    destinationInput.addEventListener("focus", () => {
      renderSuggestions(
        file,
        suggestionsContainer,
        destinationInput,
        sourceDesignerInput,
        patternInput,
        selectedLabel,
        rememberButton
      );
    });

    sourceDesignerInput.addEventListener("input", () => {
      file.sourceDesignerTouched = true;
      file.sourceDesignerName = sourceDesignerInput.value.trim();

      if (!file.patternManuallyEdited) {
        file.patternFileName = suggestPatternFileName(
          file.name,
          file.sourceDesignerName
        );
        patternInput.value = file.patternFileName;
      }

      invalidateDuplicateCheck();
    });

    patternInput.addEventListener("input", () => {
      file.patternFileName = patternInput.value.trim();
      file.patternManuallyEdited = true;
      invalidateDuplicateCheck();
    });

    patternInput.addEventListener("blur", () => {
      if (patternInput.value.trim()) {
        file.patternFileName = ensurePdfExtension(patternInput.value.trim());
        patternInput.value = file.patternFileName;
        invalidateDuplicateCheck();
      }
      row.querySelector('.review-categories')?.replaceWith(renderReviewCategories(file));
    });

    resetButton.addEventListener("click", () => {
      file.patternManuallyEdited = false;
      file.patternFileName = suggestPatternFileName(
        file.name,
        file.sourceDesignerName
      );
      patternInput.value = file.patternFileName;
      invalidateDuplicateCheck();
      row.querySelector('.review-categories')?.replaceWith(renderReviewCategories(file));
    });
  });

  updateAllPreviews();
  if (operationBusy) setOperationBusy(true);
}

function renderSuggestions(
  file,
  container,
  destinationInput,
  sourceDesignerInput,
  patternInput,
  selectedLabel,
  rememberButton
) {
  container.innerHTML = "";

  if (file.excluded) {
    return;
  }

  const searchTerm = file.destinationName.trim();
  const keyword = normalizeText(searchTerm);

  if (!keyword || designerFolders.length === 0) {
    return;
  }

  const matches = designerFolders
    .filter((folderName) =>
      normalizeText(folderName).includes(keyword)
    )
    .slice(0, 8);

  if (matches.length === 0) {
    const noMatch = document.createElement("div");
    noMatch.className = "no-match";
    noMatch.textContent =
      "기존 디자이너 없음 — Singles 파일 수에 따라 저장 위치를 계산합니다.";
    container.appendChild(noMatch);
    return;
  }

  const suggestionBox = document.createElement("div");
  suggestionBox.className = "suggestions";

  matches.forEach((folderName) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggestion";
    button.textContent = folderName;

    button.addEventListener("click", () => {
      const aliasUsedForSearch = searchTerm;

      file.selectedFolder = folderName;
      file.destinationName = folderName;
      file.autoLinkedAlias = "";
      destinationInput.value = folderName;

      selectedLabel.textContent =
        `기존 디자이너 선택됨: ${folderName}`;

      container.innerHTML = "";
      rememberButton.disabled = false;

      if (!file.sourceDesignerTouched) {
        file.sourceDesignerName = aliasUsedForSearch;
        sourceDesignerInput.value = aliasUsedForSearch;

        if (!file.patternManuallyEdited) {
          file.patternFileName = suggestPatternFileName(
            file.name,
            file.sourceDesignerName
          );
          patternInput.value = file.patternFileName;
        }
      }

      invalidateDuplicateCheck();
    });

    suggestionBox.appendChild(button);
  });

  container.appendChild(suggestionBox);
}

function updateAllPreviews() {
  downloadFiles.forEach((file) => {
    updatePreview(file);
    updateRowStatus(file);
    if (file.listDesignerElement) file.listDesignerElement.textContent = file.destinationName || "디자이너 미지정";
    if (file.listStatusElement) file.listStatusElement.textContent = reviewStatus(file);
  });
  updateBatchControls();
}

function updatePreview(file) {
  const preview = file.previewElement;

  if (!preview) {
    return;
  }

  preview.className = "preview";

  if (file.excluded) {
    preview.classList.add("excluded");
    preview.textContent =
      "이번 작업에서 제외 — 다운로드 폴더에 그대로 남깁니다.";
    return;
  }

  const destinationName = file.destinationName.trim();
  const patternFileName = ensurePdfExtension(file.patternFileName.trim());
  const existingFolderName = getExistingFolderName(file);
  const specialOption = getSpecialFolderOption(file);

  if (!patternFileName) {
    preview.classList.add("pending");
    preview.textContent = "패턴 파일명을 입력하세요.";
    return;
  }

  if (existingFolderName) {
    preview.classList.add("existing");
    preview.textContent =
      `${existingFolderName}/${patternFileName}`;
    return;
  }

  if (!destinationName) {
    preview.classList.add("pending");
    preview.textContent =
      "저장 기준 이름과 패턴 파일명을 입력하세요.";
    return;
  }

  if (file.specialFolderKey !== "singles") {
    preview.classList.add("single");
    preview.textContent =
      `${specialOption.folderName}/${getSpecialFolderTargetName(file)}`;
    return;
  }

  const existingSingles = findSinglesFiles(destinationName);
  const incomingFiles = findIncomingFilesForDesigner(destinationName);

  const countableIncoming = duplicateCheckComplete
    ? incomingFiles.filter(
        (incomingFile) => incomingFile.analysis.action === "move"
      )
    : incomingFiles;

  const totalCount =
    existingSingles.length + countableIncoming.length;

  if (totalCount >= 3) {
    preview.classList.add("promote");
    preview.textContent =
      `새 디자이너 폴더 생성 예정: ${destinationName}/\n` +
      `기존 Singles 파일 ${existingSingles.length}개 + 이번 다운로드 ${countableIncoming.length}개 이동\n` +
      `→ ${destinationName}/${patternFileName}`;
    return;
  }

  preview.classList.add("single");
  preview.textContent =
    `${SINGLES_FOLDER_NAME}/${destinationName}_${patternFileName}\n` +
    `현재 계산: 기존 Singles ${existingSingles.length}개 + 이번 다운로드 ${countableIncoming.length}개 = 총 ${totalCount}개`;
}

function updateRowStatus(file) {
  const status = file.statusElement;

  if (!status) {
    return;
  }

  if (file.excluded) {
    status.className = "row-status excluded";
    status.textContent =
      "이번 작업에서 제외 — 중복 검사 및 정리 실행 대상이 아닙니다.";
    return;
  }

  if (!duplicateCheckComplete || file.analysis.action === "unchecked") {
    status.className = "row-status unchecked";
    status.textContent = "중복 검사 전";
    return;
  }

  if (file.analysis.action === "deleteDuplicate") {
    status.className = "row-status duplicate";
    status.textContent =
      `완전 중복 파일 — 실행 시 새 다운로드본만 삭제\n` +
      `이미 보관된 파일: ${file.analysis.matchPath}`;
    return;
  }

  if (file.analysis.action === "hold") {
    status.className = "row-status hold";
    status.textContent =
      `보류 — ${file.analysis.message}`;
    return;
  }

  status.className = "row-status move";
  status.textContent = "이동 예정";
}
