// Isolated Chrome + disposable OPFS samples; never use real pattern folders.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

async function verifyAliases(page, artifactDirectory) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) errors.push(message.text());
  });
  const button = name => page.getByRole('button', { name, exact: true });
  const row = index => page.locator('#sortingList .sort-row').nth(index);
  const wait = predicate => page.waitForFunction(predicate);
  await page.goto((process.env.PDF_ORGANIZER_TEST_URL || 'http://127.0.0.1:8766/') + '?qa=1');
  assert.equal(await page.title(), 'PDF Organizer');
  await button('Prepare 200 samples').click();
  await wait(() => downloadFiles.length === 100 && !operationBusy);

  await page.evaluate(() => {
    designerAliases = {};
    renderAliasList();
    // Eligible empty reviews plus excluded, manually edited, and selected reviews.
    for (const index of [80, 81, 82, 83, 84, 85]) {
      Object.assign(downloadFiles[index], {
        destinationName: '', selectedFolder: null, sourceDesignerName: '',
        sourceDesignerTouched: false, patternManuallyEdited: false,
        patternFileName: downloadFiles[index].name, autoLinkedAlias: ''
      });
    }
    downloadFiles[82].excluded = true;
    downloadFiles[83].patternManuallyEdited = true;
    downloadFiles[83].patternFileName = 'Keep manual.pdf';
    downloadFiles[84].sourceDesignerTouched = true;
    downloadFiles[84].sourceDesignerName = 'Keep source';
    downloadFiles[85].destinationName = 'Keep destination';
    downloadFiles[85].selectedFolder = 'Keep destination';
    downloadFiles[20].categoryIds = ['cardigan'];
    downloadFiles[20].categorySource = 'manual';
    downloadFiles[20].attributeIds = ['texture'];
    renderSortingRows();
    window.qaProtectedReviews = JSON.stringify(downloadFiles.slice(82, 86).map(file =>
      Object.fromEntries(REVIEW_FIELDS.map(field => [field, file[field]]))));
  });

  const measurements = [];
  for (const width of [2048, 1280]) {
    await page.setViewportSize({ width, height: 1152 });
    for (const index of [0, 20, 99]) {
      await row(index).evaluate(element => window.scrollTo(0, element.getBoundingClientRect().top + scrollY - 16));
      // Opening without typing is transient UI state that must survive alias saving.
      await row(index).locator('.filename-editor').evaluate(element => { element.open = true; });
      await wait(() => !ReviewPreviews.stats.busy && !ReviewPreviews.stats.queued);
      await row(index).locator('.remember-button').focus();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const before = await row(index).evaluate(element => {
        window.qaAliasCard = element;
        window.qaAliasButton = element.querySelector('.remember-button');
        window.qaAliasCards = [...document.querySelectorAll('#sortingList .sort-row')];
        window.qaAliasCover = element.querySelector('.review-cover img');
        return { y: scrollY, top: element.getBoundingClientRect().top, src: qaAliasCover.src, previewJobs: ReviewPreviews.stats.jobs };
      });
      const remember = row(index).locator('.remember-button');
      if (width === 1280) await remember.press('Enter');
      else await remember.click();
      await wait(() => document.querySelector('#draftSaveStatus').textContent === 'Review saved');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const after = await row(index).evaluate(element => ({
        y: scrollY, top: element.getBoundingClientRect().top,
        sameCard: element === qaAliasCard,
        allCardsRetained: qaAliasCards.every((card, i) => card === downloadFiles[i].rowElement && card.isConnected),
        focused: document.activeElement === qaAliasButton,
        sameCover: element.querySelector('.review-cover img') === qaAliasCover,
        src: element.querySelector('.review-cover img').src,
        previewJobs: ReviewPreviews.stats.jobs,
        editorOpen: element.querySelector('.filename-editor').open,
        label: element.querySelector('.selected-label').textContent,
        font: parseFloat(getComputedStyle(element.querySelector('.text-input')).fontSize),
        controlsFit: [...element.querySelectorAll('input,button')].filter(control => control.getBoundingClientRect().width)
          .every(control => control.getBoundingClientRect().left >= 0 && control.getBoundingClientRect().right <= innerWidth),
        overflow: document.documentElement.scrollWidth > innerWidth
      }));
      assert.equal(after.sameCard, true, 'Saving an alias must retain the clicked review card');
      assert.equal(after.allCardsRetained, true);
      assert.equal(after.focused, true, 'Keep focus on Remember alias');
      assert.ok(Math.abs(after.y - before.y) <= 2, JSON.stringify({ before, after }));
      assert.ok(Math.abs(after.top - before.top) <= 2, JSON.stringify({ before, after }));
      assert.equal(after.sameCover, true);
      assert.equal(after.src, before.src);
      assert.equal(after.previewJobs, before.previewJobs);
      assert.equal(after.editorOpen, true);
      assert.equal(after.label, 'Alias matched: Designer → Designer');
      assert.ok(after.font >= 16);
      assert.equal(after.controlsFit, true);
      assert.equal(after.overflow, false);
      measurements.push({ width, index, scrollDelta: after.y - before.y, cardDelta: after.top - before.top });
      if (artifactDirectory && index === 20) {
        await page.screenshot({ path: path.join(artifactDirectory, `pdf-organizer-alias-${width}.png`) });
      }
    }
  }

  assert.deepEqual(await page.evaluate(() => downloadFiles.slice(80, 82).map(file => ({
    destination: file.destinationName, source: file.sourceDesignerName, filename: file.patternFileName,
    input: file.destinationInputElement.value, label: file.rowElement.querySelector('.selected-label').textContent,
    rememberEnabled: !file.rowElement.querySelector('.remember-button').disabled
  }))), [80, 81].map(index => ({ destination: 'Designer', source: 'Designer', filename: `Pattern_0${index}.pdf`,
    input: 'Designer', label: 'Alias matched: Designer → Designer', rememberEnabled: true })));
  assert.equal(await page.evaluate(() => JSON.stringify(downloadFiles.slice(82, 86).map(file =>
    Object.fromEntries(REVIEW_FIELDS.map(field => [field, file[field]])))) === qaProtectedReviews), true);
  assert.deepEqual(await page.evaluate(() => ({ categories: downloadFiles[20].categoryIds, attributes: downloadFiles[20].attributeIds })),
    { categories: ['cardigan'], attributes: ['texture'] });
  assert.equal(await page.evaluate(() => duplicateCheckComplete), false);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(ALIAS_STORAGE_KEY)).Designer), 'Designer');
  assert.equal(await page.evaluate(async () => JSON.parse(await (await (await libraryDirectoryHandle.getFileHandle(ALIAS_BACKUP_FILE_NAME)).getFile()).text()).Designer), 'Designer');
  await page.reload();
  await button('Resume review').click();
  await wait(() => !operationBusy && downloadFiles.length === 100);
  assert.equal(await row(80).locator('.selected-label').textContent(), 'Alias matched: Designer → Designer');
  assert.equal(await row(83).locator('.filename-editor input').inputValue(), 'Keep manual.pdf');
  await button('End sample session').click();
  assert.deepEqual(errors, []);
  return { result: 'PASS', measurements, unexpectedErrors: errors.length };
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 2048, height: 1152 }, deviceScaleFactor: 1 });
  try {
    console.log(JSON.stringify(await verifyAliases(await context.newPage(), process.env.PDF_ORGANIZER_ARTIFACT_DIR)));
  } finally {
    await context.close();
    await browser.close();
  }
}

module.exports = { verifyAliases };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
