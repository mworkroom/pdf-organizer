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
      const editor = file.rowElement?.querySelector('.filename-editor');
      if (editor) editor.open = true;
    }
  });

  const first = incompleteFiles[0];
  alert(
    `${incompleteFiles.length} files have missing details.\n\n` +
    `First incomplete file: ${first.name}\n` +
    `Select OK to go to that file.`
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
  downloadFileCount.textContent = `PDFs remaining: ${getAllReviewFiles().filter(file => !file.completed).length} · Up to ${BATCH_LIMIT} per batch`;
  downloadFileList.replaceChildren();
}
function renderDesignerFolders(folders) {
  designerFolderList.innerHTML = "";

  if (folders.length === 0) {
    designerFolderList.innerHTML =
      `<p class="empty">No results found.</p>`;
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
  renderReviewCards();
  updateBatchControls();
}
function renderReviewCards() {
  sortingList.innerHTML = "";

  for (const file of downloadFiles) {
    for (const field of ["rowElement", "destinationInputElement", "patternInputElement", "previewElement", "statusElement"]) file[field] = null;
  }
  if (!downloadFiles.length) {
    sortingList.innerHTML = '<p class="empty">Batch complete. Open the next batch or review deferred files.</p>';
    return;
  }

  downloadFiles.forEach((file) => {
    const row = document.createElement("div");
    row.className = file.excluded ? "sort-row excluded" : "sort-row";
    file.rowElement = row;
    row.dataset.reviewName = file.name;
    row.addEventListener('focusin', () => {
      if (selectedReviewName !== file.name) { selectedReviewName = file.name; scheduleDraftSave(); }
    });

    const sourceHeader = document.createElement("div");
    sourceHeader.className = "source-header";

    const sourceFile = document.createElement("div");
    sourceFile.className = "source-file";
    sourceFile.textContent = `Source file: ${file.name}`;

    const excludeLabel = document.createElement("label");
    excludeLabel.className = "exclude-label";

    const excludeCheckbox = document.createElement("input");
    excludeCheckbox.type = "checkbox";
    excludeCheckbox.checked = file.excluded;

    const excludeText = document.createElement("span");
    excludeText.textContent = "Exclude from this run";

    excludeLabel.appendChild(excludeCheckbox);
    excludeLabel.appendChild(excludeText);

    sourceHeader.appendChild(sourceFile);
    sourceHeader.appendChild(excludeLabel);
    const openButton = document.createElement("button");
    openButton.type = "button"; openButton.className = "secondary-button";
    openButton.textContent = "Open PDF";
    openButton.addEventListener("click", () => openReviewPdf(file));
    sourceHeader.appendChild(openButton);

    const grid = document.createElement("div");
    grid.className = "sort-grid";
    const body = document.createElement('div');
    body.className = 'review-card-body';

    const destinationField = document.createElement("div");
    destinationField.className = "field";

    const destinationLabel = document.createElement("label");
    destinationLabel.className = "field-label";
    destinationLabel.textContent =
      "Destination designer / search existing designers";

    const destinationInput = document.createElement("input");
    destinationInput.className = "text-input";
    destinationInput.type = "text";
    destinationInput.setAttribute('aria-label', `Destination designer for ${file.name}`);
    destinationInput.placeholder = "e.g. Knitree, Mayo, Namu Knitree";
    destinationInput.value = file.destinationName;
    destinationInput.disabled = file.excluded;
    file.destinationInputElement = destinationInput;

    const selectedLabel = document.createElement("div");
    selectedLabel.className = "selected-label";

    if (file.selectedFolder) {
      selectedLabel.textContent = file.autoLinkedAlias
        ? `Alias matched: ${file.autoLinkedAlias} → ${file.selectedFolder}`
        : `Existing designer selected: ${file.selectedFolder}`;
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
    sourceDesignerLabel.textContent = "Designer name in source filename";

    const sourceDesignerInput = document.createElement("input");
    sourceDesignerInput.className = "text-input";
    sourceDesignerInput.type = "text";
    sourceDesignerInput.setAttribute('aria-label', `Source designer for ${file.name}`);
    sourceDesignerInput.placeholder = "e.g. Knitree, Anna-Sofia Vintersol";
    sourceDesignerInput.value = file.sourceDesignerName;
    sourceDesignerInput.disabled = file.excluded;

    const sourceDesignerHint = document.createElement("div");
    sourceDesignerHint.className = "field-hint";
    const rememberButton = document.createElement("button");
    rememberButton.type = "button";
    rememberButton.className = "secondary-button remember-button";
    rememberButton.textContent = "Remember alias";
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
    patternLabel.textContent = "Filename";

    const patternInput = document.createElement("input");
    patternInput.className = "text-input";
    patternInput.type = "text";
    patternInput.setAttribute('aria-label', `Pattern filename for ${file.name}`);
    patternInput.placeholder = "e.g. summer_top.pdf";
    patternInput.value = file.patternFileName;
    patternInput.disabled = file.excluded;
    file.patternInputElement = patternInput;

    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.className = "secondary-button";
    resetButton.textContent = "Reset automatic filename";
    resetButton.disabled = file.excluded;

    patternField.appendChild(patternLabel);
    patternField.appendChild(patternInput);
    patternField.appendChild(resetButton);

    const previewField = document.createElement("div");
    previewField.className = "preview-area";

    const previewLabel = document.createElement("label");
    previewLabel.className = "field-label";
    previewLabel.textContent = "Destination preview";

    const preview = document.createElement("div");
    preview.className = "preview pending";

    const status = document.createElement("div");
    status.className = "row-status unchecked";
    status.textContent = "Duplicate check required";

    file.previewElement = preview;
    file.statusElement = status;

    previewField.appendChild(previewLabel);
    previewField.appendChild(preview);
    previewField.appendChild(status);
    const filenameEditor = document.createElement('details');
    filenameEditor.className = 'filename-editor';
    filenameEditor.open = file.patternManuallyEdited || !file.patternFileName.trim();
    const filenameSummary = document.createElement('summary');
    filenameSummary.textContent = 'Edit filename';
    filenameEditor.append(filenameSummary, patternField);
    previewField.appendChild(filenameEditor);

    grid.appendChild(destinationField);
    grid.appendChild(sourceDesignerField);

    grid.appendChild(previewField);

    row.appendChild(sourceHeader);
    body.append(grid, renderReviewCategories(file));
    row.appendChild(body);
    sortingList.appendChild(row);

    excludeCheckbox.addEventListener("change", () => {
      file.excluded = excludeCheckbox.checked;

      invalidateDuplicateCheck();
      row.classList.toggle('excluded', file.excluded);
      row.querySelectorAll('input, button').forEach(control => {
        if (control !== excludeCheckbox && control !== openButton) control.disabled = file.excluded;
      });
      rememberButton.disabled = file.excluded || !getExistingFolderName(file);
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
      "No existing designer. The destination depends on the number of Singles files.";
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
        `Existing designer selected: ${folderName}`;

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
      "Excluded from this run. The file stays in the download folder.";
    return;
  }

  const destinationName = file.destinationName.trim();
  const patternFileName = ensurePdfExtension(file.patternFileName.trim());
  const existingFolderName = getExistingFolderName(file);
  const specialOption = getSpecialFolderOption(file);

  if (!patternFileName) {
    preview.classList.add("pending");
    preview.textContent = "Enter a pattern filename.";
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
      "Enter a destination designer and pattern filename.";
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
      `New designer folder to create: ${destinationName}/\n` +
      `Move ${existingSingles.length} existing Singles files + ${countableIncoming.length} downloads\n` +
      `→ ${destinationName}/${patternFileName}`;
    return;
  }

  preview.classList.add("single");
  preview.textContent =
    `${SINGLES_FOLDER_NAME}/${destinationName}_${patternFileName}\n` +
    `Current total: ${existingSingles.length} existing Singles + ${countableIncoming.length} downloads = ${totalCount} files`;
}

function updateRowStatus(file) {
  const status = file.statusElement;

  if (!status) {
    return;
  }

  if (file.excluded) {
    status.className = "row-status excluded";
    status.textContent =
      "Excluded from this run. This file will not be checked or organized.";
    return;
  }

  if (!duplicateCheckComplete || file.analysis.action === "unchecked") {
    status.className = "row-status unchecked";
    status.textContent = "Duplicate check required";
    return;
  }

  if (file.analysis.action === "deleteDuplicate") {
    status.className = "row-status duplicate";
    status.textContent =
      `Exact duplicate. Only the new download will be deleted when organizing.\n` +
      `Existing file: ${file.analysis.matchPath}`;
    return;
  }

  if (file.analysis.action === "hold") {
    status.className = "row-status hold";
    status.textContent =
      `On hold — ${file.analysis.message}`;
    return;
  }

  status.className = "row-status move";
  status.textContent = "Ready to move";
}
