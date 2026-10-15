/* Review drafts stay on this browser; no PDF bytes are stored. */
window.ReviewDraftStore = (() => {
  let database;

  function open() {
    if (!database) {
      database = new Promise((resolve, reject) => {
        const request = indexedDB.open("pdfOrganizerReviewDrafts", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("drafts");
        request.onsuccess = () => {
          request.result.onversionchange = () => {
            request.result.close();
            database = null;
          };
          resolve(request.result);
        };
        request.onerror = () => { database = null; reject(request.error); };
        request.onblocked = () => { database = null; reject(new Error("다른 창에서 저장소를 사용 중입니다.")); };
      });
    }
    return database;
  }

  async function transact(mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("drafts", mode);
      const request = action(transaction.objectStore("drafts"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || new Error("검토 내용 저장이 중단되었습니다."));
      transaction.onerror = () => reject(transaction.error);
    });
  }

  return {
    load: () => transact("readonly", store => store.get("current")),
    save: draft => transact("readwrite", store => store.put(draft, "current"))
  };
})();
