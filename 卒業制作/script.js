// script.js
// 完全動作版：Auth + Firestore を使った課題・授業・出席・週間時間割管理
// 前提: ./firebase-config.js が `export { app, auth, db }` をしていること

// デバッグ用に auth を window に公開
window.auth = auth;
window.db = db; // Firestore も必要なら


import { app, auth, db } from "./firebase-config.js";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
  updateDoc,
  Timestamp,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

/* ===========================
   ユーティリティ / 初期処理
   =========================== */

// 画面切替

function showScreen(id) {
  // すべて非表示にする

  const screens = document.querySelectorAll(".screen");

  screens.forEach(s => {
    s.style.display = "none";
  });

  // 対象画面だけ表示
  const el = document.getElementById(id);
  if (el) el.style.display = "block";
}

// script.js の先頭で
let currentClassId = null;


// weekday order helper (for client-side sort)
const weekdayOrder = ["月曜","火曜","水曜","木曜","金曜","土曜","日曜"];

/* ===========================
   Auth (ログイン / ログアウト)
   =========================== */

document.getElementById("login-btn")?.addEventListener("click", async () => {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
    // onAuthStateChanged が継続処理を担当
  } catch (err) {
    console.error("ログイン失敗:", err);
    alert("ログインに失敗しました");
  }
});

document.getElementById("logout-btn")?.addEventListener("click", async () => {
  try {
    await signOut(auth);
    showScreen("login");
  } catch (err) {
    console.error("ログアウト失敗:", err);
  }
});

/* ===========================
   onAuth: ユーザー情報表示 / 初期ロード
   =========================== */
onAuthStateChanged(auth, async (user) => {
  if (user) {
    // ユーザー表示（右上）
    const nameEl = document.getElementById("user-name");
    const photoEl = document.getElementById("user-photo");
    if (nameEl) nameEl.textContent = user.displayName || "名無し";
    if (photoEl) {
      if (user.photoURL) photoEl.src = user.photoURL;
      else photoEl.src = "";
    }

    // 初期ロード：課題 / 授業 / 週間時間割
    await Promise.all([
      loadKadai(),    // 課題（未完了）
      loadDone(),     // 完了課題
      loadClasses(),  // 授業一覧
      //loadWeeklySchedule() // 週間時間割（表に反映）
    ]);

    showScreen("home");
  } else {
    // ログアウト状態
    showScreen("login");
  }
});

/* ===========================
   画像用 IndexedDB
   =========================== */
  //  function openImageDB() {
  //   return new Promise((resolve, reject) => {
  //     const request = indexedDB.open("ImageDB", 1);
  
  //     request.onupgradeneeded = () => {
  //       const db = request.result;
  //       if (!db.objectStoreNames.contains("images")) {
  //         db.createObjectStore("images", { keyPath: "classId" });
  //       }
  //     };
  
  //     request.onsuccess = () => resolve(request.result);
  //     request.onerror = () => reject(request.error);
  //   });
  // }
  
  // async function saveImagesToIndexedDB(classId, files) {
  //   const db = await openImageDB();
  //   const tx = db.transaction("images", "readwrite");
  //   const store = tx.objectStore("images");
  
  //   // ① 既存の画像データを取得
  //   const getReq = store.get(classId);
  
  //   return new Promise((resolve, reject) => {
  //     getReq.onsuccess = () => {
  //       const existing = getReq.result?.blobs || [];
  
  //       // ② 新しいファイルを追加
  //       const newBlobs = [...existing];
  //       for (const file of files) {
  //         newBlobs.push(file);
  //       }
  
  //       // ③ 結果を保存（既存+新規の全画像）
  //       store.put({ classId, blobs: newBlobs });
  
  //       tx.oncomplete = resolve;
  //       tx.onerror = reject;
  //     };
  
  //     getReq.onerror = reject;
  //   });
  // }  
  

/* ===========================
   画面遷移ボタン（固定）
   =========================== */
const addScreenListener = (id, screenId) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("click", () => showScreen(screenId));
};

document.addEventListener("DOMContentLoaded", () => {
 addScreenListener("kadai-btn", "kadai");
 addScreenListener("classes-btn", "classes");
 addScreenListener("weekly-btn", "weekly-schedule");
});

addScreenListener("back-btn", "home");
addScreenListener("back-from-classes-btn", "home");
addScreenListener("back-from-weekly-btn", "home");
addScreenListener("back-from-attendance-btn", "classes");

/* ===========================
   課題管理（kadai）部分
   Collection: "kadai" (top-level) with field uid
   =========================== */

const addForm = document.getElementById("add-form");
if (addForm) {
  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) return alert("ログインしてください");
    const title = document.getElementById("title").value.trim();
    const dueInput = document.getElementById("due").value;
    if (!title || !dueInput) return;

    const dueTs = Timestamp.fromDate(new Date(dueInput));
    try {
      await addDoc(collection(db, "kadai"), {
        title,
        due: dueTs,
        uid: user.uid,
        done: false,
        createdAt: Timestamp.now()
      });
      addForm.reset();
      await loadKadai();
    } catch (err) {
      console.error("課題追加失敗:", err);
    }
  });
}

async function loadKadai() {
  const user = auth.currentUser;
  const listEl = document.getElementById("kadai-list");
  if (!user || !listEl) return;

  listEl.innerHTML = ""; // 最初にクリア

  const q = query(
    collection(db, "kadai"),
    where("uid", "==", user.uid),
    where("done", "==", false),
    orderBy("due")
  );
  const snapshot = await getDocs(q);

  snapshot.forEach(docSnap => {
    const d = docSnap.data();
    const div = document.createElement("div");
    div.className = "kadai-item";

    const dueStr = d.due?.toDate ? d.due.toDate().toLocaleDateString() : "";

    // 締切日との差を計算して背景色を決める
    let bgColor = "#ffffff"; // デフォルト
    if (d.due?.toDate) {
      const dueDate = d.due.toDate();
      const today = new Date();
      const diffTime = dueDate - today;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays < 0) bgColor = "#ffcccc";       // 過ぎた課題は赤
      else if (diffDays <= 1) bgColor = "#ffe0b2"; // 今日まで or 明日までオレンジ
      else if (diffDays <= 3) bgColor = "#fff9c4"; // あと3日以内は黄色
    }

    div.innerHTML = `
      <p><strong>${escapeHtml(d.title)}</strong>（締切: ${dueStr}）</p>
      <div>
        <button class="done-btn" data-id="${docSnap.id}">完了</button>
        <button class="del-btn" data-id="${docSnap.id}">削除</button>
      </div>
    `;

    div.style.backgroundColor = bgColor; // 背景色を設定
    listEl.appendChild(div);
  });

  // ボタンイベント
  document.querySelectorAll(".done-btn").forEach(btn =>
    btn.addEventListener("click", async (e) => {
      const id = e.currentTarget.dataset.id;
      if (!id) return;
      await markAsDone(id);
    })
  );
  document.querySelectorAll(".del-btn").forEach(btn =>
    btn.addEventListener("click", async (e) => {
      const id = e.currentTarget.dataset.id;
      if (!id) return;
      await deleteKadai(id);
    })
  );
}

async function loadStudyLog() {
  const user = auth.currentUser;
  const listEl = document.getElementById("studylog-list");
  if (!user || !listEl) return;

  listEl.innerHTML = "読み込み中…";

  const q = query(
    collection(db, "studyLog"),
    where("uid", "==", user.uid),
    orderBy("date", "desc")
  );

  const snapshot = await getDocs(q);
  listEl.innerHTML = ""; // 読み込み中をクリア

  if (snapshot.empty) {
    listEl.innerHTML = "<p>まだ記録がありません。</p>";
    return;
  }

  snapshot.forEach(docSnap => {
    const data = docSnap.data();
    const div = document.createElement("div");
    div.className = "studylog-item";
    div.style.padding = "10px";
    div.style.borderBottom = "1px solid #ccc";

    const seconds = data.seconds || 0;

    div.innerHTML = `
      <p><strong>${data.subject}</strong></p>
      <p>${Math.floor(seconds/60)}分${seconds%60}秒</p>
      <p style="font-size:12px; color:#666;">${data.createdAt?.toDate().toLocaleString() ?? ""}</p>
      <button class="del-log-btn" data-id="${docSnap.id}">削除</button>
    `;

    // ここでボタンイベントを登録
    div.querySelector(".del-log-btn").addEventListener("click", async (e) => {
      const id = e.currentTarget.dataset.id;
      if (!id) return;
      if (!confirm("本当に削除しますか？")) return;

      await deleteDoc(doc(db, "studyLog", id));
      await loadStudyLog(); // 再読み込み
    });

    listEl.appendChild(div);
  });
}

async function markAsDone(id) {
  try {
    await updateDoc(doc(db, "kadai", id), { done: true, doneAt: Timestamp.now() });
    await loadKadai();
    await loadDone();
  } catch (err) {
    console.error("完了更新失敗:", err);
  }
}

async function deleteKadai(id) {
  try {
    await deleteDoc(doc(db, "kadai", id));
    await loadKadai();
    await loadDone();
  } catch (err) {
    console.error("課題削除失敗:", err);
  }
}

async function loadDone() {
  const user = auth.currentUser;
  const doneList = document.getElementById("done-list");
  if (!user || !doneList) return;
  doneList.innerHTML = "";

  const q = query(
    collection(db, "kadai"),
    where("uid", "==", user.uid),
    where("done", "==", true),
    orderBy("due")
  );
  const snapshot = await getDocs(q);
  snapshot.forEach(docSnap => {
    const d = docSnap.data();
    const div = document.createElement("div");
    div.className = "kadai-item";
    const dueStr = d.due?.toDate ? d.due.toDate().toLocaleDateString() : "";
    div.innerHTML = `
      <p>✅ <strong>${escapeHtml(d.title)}</strong>（締切: ${dueStr}）</p>
      <div>
        <button class="del-btn" data-id="${docSnap.id}">削除</button>
      </div>
    `;
    doneList.appendChild(div);
  });

  // 完了課題の削除ボタンイベント
  document.querySelectorAll("#done-list .del-btn").forEach(btn =>
    btn.addEventListener("click", async (e) => {
      const id = e.currentTarget.dataset.id;
      if (!id) return;
      await deleteKadai(id);
    })
  );
}


/* ===========================
   授業管理（classes）
   =========================== */

   const classesListEl = document.getElementById("classes-list");

   if (document.getElementById("add-class-form")) {
     document.getElementById("add-class-form").addEventListener("submit", async (e) => {
       e.preventDefault();
       const user = auth.currentUser;
       if (!user) return alert("ログインしてください");
   
       const name = document.getElementById("class-name").value.trim();
       if (!name) return alert("授業名を入力してください");
   
       try {
         await addDoc(collection(db, "classes"), {
           uid: user.uid,
           name,
           createdAt: Timestamp.now()
         });
         document.getElementById("add-class-form").reset();
         await loadClasses();
       } catch (err) {
         console.error("授業追加失敗:", err);
       }
     });
   }
   
   async function loadClasses() {
     const user = auth.currentUser;
     if (!user || !classesListEl) return;
     classesListEl.innerHTML = "";
   
     const q = query(collection(db, "classes"), where("uid", "==", user.uid));
     const snapshot = await getDocs(q);
   
     const arr = [];
     snapshot.forEach(snap => arr.push({ id: snap.id, ...(snap.data()) }));
   
     arr.sort((a, b) => a.name.localeCompare(b.name, "ja-JP", { sensitivity: "base" }));
   
     arr.forEach(cls => {
       const div = document.createElement("div");
       div.className = "class-item";
       div.innerHTML = `
         <p><strong>${escapeHtml(cls.name)}</strong></p>
         <div>
           <button class="memo-btn" data-id="${cls.id}" data-name="${escapeHtml(cls.name)}">メモ</button>
           <button class="del-class-btn" data-id="${cls.id}">削除</button>
         </div>
       `;
       classesListEl.appendChild(div);
     });
   
     // メモボタン
     document.querySelectorAll(".memo-btn").forEach(btn =>
       btn.addEventListener("click", (e) => {
         const id = e.currentTarget.dataset.id;
         const name = e.currentTarget.dataset.name;
         openMemo(id, name);
       })
     );
   
     // 授業削除
     document.querySelectorAll(".del-class-btn").forEach(btn =>
       btn.addEventListener("click", async (e) => {
         const id = e.currentTarget.dataset.id;
         if (!id) return;
         if (!confirm("この授業を削除しますか？")) return;
         try {
           await deleteDoc(doc(db, "classes", id));
           await loadClasses();
         } catch (err) {
           console.error("授業削除失敗:", err);
         }
       })
     );
   }
   
/* ===========================
   メモ関連
   =========================== */

   let currentMemoClassId = null;

   function openMemo(classId, className) {
     currentMemoClassId = classId;
   
     const classTitle = document.getElementById("class-title");
     if (classTitle) classTitle.textContent = className;
   
     showScreen("class-memo");
     loadClassMemo();
   }
   
   /* ===========================
      Firestore：テキストメモ読み込み
      =========================== */
   async function loadClassMemo() {
     if (!currentMemoClassId) return;
   
     const memoTextarea = document.getElementById("class-memo");
     const memoImagesContainer = document.getElementById("memo-images");
   
     memoTextarea.value = "";
     memoImagesContainer.innerHTML = "";
   
     // 🔹 Firestore メモ読み込み
     try {
       const snap = await getDoc(doc(db, "classes", currentMemoClassId));
       memoTextarea.value = snap.exists() ? snap.data().memo || "" : "";
     } catch (err) {
       console.error("メモ読み込み失敗:", err);
     }
   
     // 🔹 IndexedDB 画像読み込み
     loadMemoImages();
   }
   
   /* ===========================
      IndexedDB（画像保存用）
      =========================== */
   
   function openImageDB() {
     return new Promise((resolve, reject) => {
       const request = indexedDB.open("MemoImageDB", 1);
   
       request.onupgradeneeded = (e) => {
         const db = e.target.result;
         if (!db.objectStoreNames.contains("images")) {
           db.createObjectStore("images", { keyPath: "classId" });
         }
       };
   
       request.onsuccess = () => resolve(request.result);
       request.onerror = () => reject(request.error);
     });
   }
   
   /* ===========================
      保存ボタン（メモ＋画像）
      =========================== */
   document.getElementById("save-memo-btn")?.addEventListener("click", async () => {
     if (!currentMemoClassId) return alert("授業が選択されていません");
   
     const memoTextarea = document.getElementById("class-memo");
     const memoText = memoTextarea.value.trim();
   
     const files = document.getElementById("memo-image").files;
   
     try {
       // 🔹 Firestore にテキストメモ保存
       await setDoc(
         doc(db, "classes", currentMemoClassId),
         { memo: memoText },
         { merge: true }
       );
   
       // 🔹 画像保存
       await saveImagesToIndexedDB(currentMemoClassId, files);
   
       alert("メモと画像を保存しました！");
       loadClassMemo();
   
     } catch (err) {
       console.error("メモ保存エラー:", err);
       alert("保存に失敗しました");
     }
   });
   
   /* ===========================
      IndexedDB：画像保存
      =========================== */
      async function saveImagesToIndexedDB(classId, files) {
        // 1) files を全部 ArrayBuffer に変換（トランザクションの外で）
        const buffers = [];
        for (const file of files) {
          // ここは await してOK（トランザクションはまだ作らない）
          const buf = await file.arrayBuffer();
          buffers.push(buf);
        }
      
        // 2) IndexedDB を開いてトランザクション内で get -> put を行う
        const db = await openImageDB();
      
        return new Promise((resolve, reject) => {
          const tx = db.transaction("images", "readwrite");
          const store = tx.objectStore("images");
      
          const getReq = store.get(classId);
          getReq.onsuccess = () => {
            const existing = getReq.result || { classId, blobs: [] };
      
            // 既存 blobs が Array である前提で結合
            existing.blobs = existing.blobs.concat(buffers);
      
            const putReq = store.put(existing);
            putReq.onsuccess = () => {
              // nothing here — wait for tx.oncomplete
            };
            putReq.onerror = (e) => {
              console.error("put error", e.target.error);
              reject(e.target.error);
            };
          };
          getReq.onerror = (e) => {
            console.error("get error", e.target.error);
            reject(e.target.error);
          };
      
          tx.oncomplete = () => resolve();
          tx.onerror = (e) => reject(tx.error || e.target.error);
        });
      }
   
   /* ===========================
      IndexedDB：画像読み込み
      =========================== */
   async function loadMemoImages() {
     const memoImagesContainer = document.getElementById("memo-images");
     memoImagesContainer.innerHTML = "";
   
     const db = await openImageDB();
     const tx = db.transaction("images", "readonly");
     const store = tx.objectStore("images");
   
     const data = await new Promise((resolve, reject) => {
       const req = store.get(currentMemoClassId);
       req.onsuccess = () => resolve(req.result);
       req.onerror = () => reject(req.error);
     });
   
     if (!data?.blobs) return;
   
     data.blobs.forEach((buffer, index) => {
       const blob = new Blob([buffer]);
       const url = URL.createObjectURL(blob);
   
       const wrapper = document.createElement("div");
       wrapper.classList.add("memo-img-wrapper");
   
       const img = document.createElement("img");
       img.src = url;
       img.classList.add("memo-img");
   
       // ライトボックス
       img.addEventListener("click", () => {
         document.getElementById("lightbox-img").src = url;
         document.getElementById("lightbox").classList.remove("hidden");
       });
   
       // 削除ボタン
       const delBtn = document.createElement("button");
       delBtn.textContent = "✕";
       delBtn.classList.add("memo-img-delete-btn");
   
       delBtn.addEventListener("click", async (e) => {
         e.stopPropagation();
         await deleteSingleImage(currentMemoClassId, index);
         loadMemoImages();
       });
   
       wrapper.appendChild(img);
       wrapper.appendChild(delBtn);
       memoImagesContainer.appendChild(wrapper);
     });
   }
   
   /* ===========================
      画像削除
      =========================== */
      async function deleteSingleImage(classId, deleteIndex) {
        const db = await openImageDB();
      
        return new Promise((resolve, reject) => {
          const tx = db.transaction("images", "readwrite");
          const store = tx.objectStore("images");
      
          const req = store.get(classId);
          req.onsuccess = () => {
            const data = req.result;
            if (!data?.blobs) {
              resolve();
              return;
            }
            data.blobs.splice(deleteIndex, 1);
            const putReq = store.put(data);
            putReq.onsuccess = () => { /* wait for tx.oncomplete */ };
            putReq.onerror = (e) => {
              console.error("delete put error", e.target.error);
              reject(e.target.error);
            };
          };
          req.onerror = (e) => {
            console.error("delete get error", e.target.error);
            reject(e.target.error);
          };
      
          tx.oncomplete = () => resolve();
          tx.onerror = (e) => reject(tx.error || e.target.error);
        });
      }
      
   
   /* 戻るボタン */
   document.getElementById("back-from-memo-btn")?.addEventListener("click", () => {
     showScreen("classes");
   });
   
   

   
   // 出席情報読み込み（日付指定対応）
// 出席一覧を読み込む
async function loadAttendance(classId) {
  try {
    const attendanceList = document.getElementById("attendance-list");
    attendanceList.innerHTML = "読み込み中...";

    const studentsRef = collection(db, "classes", classId, "students");
    const studentsSnap = await getDocs(studentsRef);

    attendanceList.innerHTML = ""; // 初期化

    studentsSnap.forEach(async (studentDoc) => {
      const student = studentDoc.data();
      const studentId = studentDoc.id;

      // 1行の枠
      const row = document.createElement("div");
      row.classList.add("attendance-row");

      const name = document.createElement("span");
      name.textContent = student.name;

      // 出席ボタン
      const btnPresent = document.createElement("button");
      btnPresent.textContent = "出席";
      btnPresent.classList.add("mini-btn");
      btnPresent.addEventListener("click", () => {
        markAttendance(studentId, "present");
      });

      // 欠席ボタン
      const btnAbsent = document.createElement("button");
      btnAbsent.textContent = "欠席";
      btnAbsent.classList.add("mini-btn");
      btnAbsent.addEventListener("click", () => {
        markAttendance(studentId, "absent");
      });

      row.appendChild(name);
      row.appendChild(btnPresent);
      row.appendChild(btnAbsent);

      attendanceList.appendChild(row);
    });
  } catch (error) {
    console.error("出席読み込みエラー:", error);
  }
}


/* ===========================
   表示ボタン（日付選択 → 読み込み）
   =========================== */
   const showAttendanceBtn = document.getElementById("attendance-show-btn");

   if (showAttendanceBtn) {
     showAttendanceBtn.addEventListener("click", () => {
       if (!currentClassId) {
         alert("授業が選択されていません");
         return;
       }
   
       const dateInput = document.getElementById("attendance-date").value;
       if (!dateInput) {
         alert("日付を選択してください");
         return;
       }
   
       loadAttendance(currentClassId);
     });
   }
   
   
  //  /* ===========================
  //     IndexedDB 設定
  //     =========================== */
  //  const idbName = "KadaiAppDB";
  //  const memoStoreName = "classMemos";
   
  //  function openIndexedDB() {
  //    return new Promise((resolve, reject) => {
  //      const request = indexedDB.open(idbName, 1);
  //      request.onupgradeneeded = () => {
  //        const db = request.result;
  //        if (!db.objectStoreNames.contains(memoStoreName)) {
  //          db.createObjectStore(memoStoreName, { keyPath: "classId" });
  //        }
  //      };
  //      request.onsuccess = () => resolve(request.result);
  //      request.onerror = () => reject(request.error);
  //    });
  //  }
   
  //  /* ===========================
  //     メモ保存
  //     =========================== */
  //   const memoTextarea = document.getElementById("class-memo");
  //    const saveMemoBtn = document.getElementById("save-memo-btn");
      
  //   saveMemoBtn?.addEventListener("click", async () => {
  //     if (!currentClassId) return alert("授業が選択されていません");      
  //       const memo = memoTextarea.value.trim();
  //       const fileInput = document.getElementById("memo-image"); // ←★これを追加
  //       const files = fileInput.files;
      
  //       try {
  //         // === メモ保存 ===
  //         const db = await openIndexedDB();
  //         const tx = db.transaction(memoStoreName, "readwrite");
  //         const store = tx.objectStore(memoStoreName);
  //         store.put({ classId: currentClassId, memo });
      
  //         // === 画像保存 ===
  //         if (files.length > 0) {
  //           await saveImagesToIndexedDB(currentClassId, files);
  //         }
      
  //         alert("メモと画像を保存しました");
  //         loadClassMemo(); // 保存後に表示更新
      
  //       } catch (err) {
  //         console.error("IndexedDB 保存エラー:", err);
  //         alert("保存に失敗しました");
  //       }
  //    });

     // ===========================
     // 画像1枚削除
     // ===========================
  // async function deleteSingleImage(classId, deleteIndex) {
  //   const db = await openImageDB();
  //   const tx = db.transaction("images", "readwrite");
  //   const store = tx.objectStore("images");

  //   const record = await new Promise((resolve, reject) => {
  //   const req = store.get(classId);
  //     req.onsuccess = () => resolve(req.result);
  //     req.onerror = () => reject(req.error);
  //   });

  //   if (!record || !Array.isArray(record.blobs)) return;

  //   // 指定の index の画像を削除
  //   record.blobs.splice(deleteIndex, 1);

  //   // 更新して保存
  //   store.put(record);

  //   return new Promise((resolve, reject) => {
  //     tx.oncomplete = () => resolve();
  //     tx.onerror = () => reject(tx.error);
  //   });
  // }

      
  
   
  // async function loadClassMemo() {
  //   if (!currentClassId) return;
  
  //   const memoTextarea = document.getElementById("class-memo");
  //   if (!memoTextarea) return;
  
  //   // === メモ読み込み ===
  //   try {
  //     const db = await openIndexedDB();
  //     const tx = db.transaction(memoStoreName, "readonly");
  //     const store = tx.objectStore(memoStoreName);
  //     const request = store.get(currentClassId);
  
  //     request.onsuccess = () => {
  //       const data = request.result;
  //       memoTextarea.value = data?.memo || "";
  //     };
  
  //     request.onerror = () => console.error("IndexedDB 読み込みエラー:", request.error);
  //   } catch (err) {
  //     console.error("IndexedDB 開くエラー:", err);
  //   }
  
    // === 画像読み込み ===
    // try {
    //   const db = await openImageDB();
    //   const tx = db.transaction("images", "readonly");
    //   const store = tx.objectStore("images");
    //   const getReq = store.get(currentClassId);
  
    //   getReq.onsuccess = () => {
    //     const result = getReq.result;
    //     const memoImagesContainer = document.getElementById("memo-images");
    //     if (!memoImagesContainer) return;
  
    //     memoImagesContainer.innerHTML = "";
    //     if (result?.blobs?.length) {
    //       result.blobs.forEach((blob, index) => {
    //         const url = URL.createObjectURL(blob);
  
    //         const wrapper = document.createElement("div");
    //         wrapper.classList.add("memo-img-wrapper");
  
    //         const img = document.createElement("img");
    //         img.src = url;
    //         img.classList.add("memo-img");
    //         img.addEventListener("click", () => {
    //           document.getElementById("lightbox-img").src = url;
    //           document.getElementById("lightbox").classList.remove("hidden");
    //         });
  
    //         const delBtn = document.createElement("button");
    //         delBtn.textContent = "✕";
    //         delBtn.classList.add("memo-img-delete-btn");
    //         delBtn.addEventListener("click", async (e) => {
    //           e.stopPropagation();
    //           await deleteSingleImage(currentClassId, index);
    //           loadClassMemo();
    //         });
  
    //         wrapper.appendChild(img);
    //         wrapper.appendChild(delBtn);
    //         memoImagesContainer.appendChild(wrapper);
    //       });
    //     }
    //   };
  
    //   getReq.onerror = () => console.error("画像読み込みエラー:", getReq.error);
    // } catch (err) {
    //   console.error("画像DB読み込み失敗:", err);
    // }

  // }
  

   
/* ===========================
   週間時間割（weeklySchedule）
   - 保存: setDoc(doc(db,"weeklySchedule", user.uid), scheduleObj)
   - 読込: getDoc(...) and fill table inputs
   =========================== */

// generate schedule grid inputs (hours x days)
// =======================
// 週間時間割（授業選択＋出席率）
// =======================

const weeklyBtn = document.getElementById("weekly-btn");
const weeklyScreen = document.getElementById("weekly-schedule");
const backFromWeeklyBtn = document.getElementById("back-from-weekly-btn");
const scheduleBody = document.getElementById("schedule-body");
const saveScheduleBtn = document.getElementById("save-schedule");

// 時間・曜日の設定（自由に編集可）
let hours = ["9:00", "10:00", "11:00", "13:00", "14:00"];
const daysFull = ["月曜", "火曜", "水曜", "木曜", "金曜"];

// =======================
// 授業リストを Firestore から取得
// =======================
async function getClassList() {
  const user = auth.currentUser;
  if (!user) return [];
  const classRef = collection(db, "classes", user.uid, "userClasses");
  const snapshot = await getDocs(classRef);
  const classes = [];
  snapshot.forEach(doc => classes.push(doc.data().name));
  return classes;
}

// =======================
// 時間割グリッド生成
// =======================
async function generateScheduleGrid() {
  scheduleBody.innerHTML = "";

  // Firestoreから授業リストを取得
  const user = auth.currentUser;
  let classList = [];
  if (user) {
    const q = query(collection(db, "classes"), where("uid", "==", user.uid));
    const snapshot = await getDocs(q);

    console.log("Firestore snapshot size:", snapshot.size); // 何件取得できたか
    snapshot.forEach(doc => {
      console.log("Doc ID:", doc.id, "Data:", doc.data()); // ドキュメントの中身を確認
      classList.push(doc.data().name); // 授業名だけリストに追加
    });
  }

  hours.forEach((time, i) => {
    const row = document.createElement("tr");

    // 時間入力欄
    const timeCell = document.createElement("td");
    const timeInput = document.createElement("input");
    timeInput.type = "text";
    timeInput.value = time;
    timeInput.classList.add("time-input");
    timeInput.addEventListener("change", () => {
      hours[i] = timeInput.value;
    });
    timeCell.appendChild(timeInput);
    row.appendChild(timeCell);

    // 曜日列生成
    daysFull.forEach(day => {
      const cell = document.createElement("td");

      // 授業選択プルダウン
      const subjSelect = document.createElement("select");
      subjSelect.classList.add("subject-select");

      const emptyOpt = document.createElement("option");
      emptyOpt.value = "";
      emptyOpt.textContent = "選択なし";
      subjSelect.appendChild(emptyOpt);

      classList.sort((a, b) => a.localeCompare(b, "ja"));

      classList.forEach(name => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        subjSelect.appendChild(opt);
      });

      // 出席ボタン
      const presentBtn = document.createElement("button");
      presentBtn.textContent = "✅";
      presentBtn.classList.add("present-btn");
      const absentBtn = document.createElement("button");
      absentBtn.textContent = "❌";
      absentBtn.classList.add("absent-btn");

      presentBtn.addEventListener("click", () => {
        const subject = subjSelect.value; // ← プルダウンの値（授業名）を取得
        markClassAttendance(day, timeInput.value, "present", subject);
      });
      absentBtn.addEventListener("click", () => {
        const subject = subjSelect.value;
        markClassAttendance(day, timeInput.value, "absent", subject);
      });
      
      cell.appendChild(subjSelect);
      cell.appendChild(document.createElement("br"));
      cell.appendChild(presentBtn);
      cell.appendChild(absentBtn);
      row.appendChild(cell);
    });

    scheduleBody.appendChild(row);
  });
}


// =======================
// Firestoreへ時間割保存
// =======================
saveScheduleBtn.addEventListener("click", async () => {
  const uid = auth.currentUser.uid;
  const scheduleData = {};
  daysFull.forEach((day, dIndex) => {
    scheduleData[day] = {};
    hours.forEach((time, tIndex) => {
      const subjSelect = scheduleBody.rows[tIndex].cells[dIndex + 1].querySelector("select");
      scheduleData[day][time] = subjSelect.value;
    });
  });
  await setDoc(doc(db, "weeklySchedule", uid), { schedule: scheduleData }, { merge: true });
  alert("時間割を保存しました！");
});

// =======================
// 出席打刻
// =======================
async function markClassAttendance(day, time, status, subject) {
  if (!subject) return alert("授業を選択してください");
  const uid = auth.currentUser.uid;
  const docRef = doc(db, "weeklySchedule", uid);
  const snap = await getDoc(docRef);
  let data = snap.exists() ? snap.data() : { attendance: {} };

  if (!data.attendance) data.attendance = {};
  if (!data.attendance[subject]) data.attendance[subject] = { present: 0, absent: 0 };

  if (status === "present") data.attendance[subject].present++;
  if (status === "absent") data.attendance[subject].absent++;

  await setDoc(docRef, data, { merge: true });
  updateAttendanceBySubject(data.attendance);
}

// =======================
// 授業ごとの出席率表示
// =======================
function updateAttendanceBySubject(attendanceData) {
  // すでに表示中の info があれば削除して作り直す
  const oldInfo = document.getElementById("attendance-info");
  if (oldInfo) oldInfo.remove();

  const info = document.createElement("div");
  info.id = "attendance-info";
  info.innerHTML = "<h3>📊 授業別出席率</h3>";

  // 🔽 授業名を昇順にソート
  const subjects = Object.keys(attendanceData).sort((a, b) => a.localeCompare(b, "ja"));

  subjects.forEach(subject => {
    const p = attendanceData[subject].present || 0;
    const a = attendanceData[subject].absent || 0;
    const total = p + a;
    const rate = total ? ((p / total) * 100).toFixed(1) : 0;

    // 🔹1行（カード）を作成
    const card = document.createElement("div");
    card.classList.add("subject-card");
    card.innerHTML = `
      <div class="subject-info">
        <span class="subject-name">${subject}</span>
        <span class="subject-stats">出席 ${p} / 欠席 ${a} （出席率 ${rate}%）</span>
      </div>
    `;

    // 🔹リセットボタン
    const resetBtn = document.createElement("button");
    resetBtn.textContent = "リセット";
    resetBtn.classList.add("reset-btn");

    resetBtn.addEventListener("click", async () => {
      if (confirm(`${subject} の出席データをリセットしますか？`)) {
        const user = auth.currentUser;
        const ref = doc(db, "weeklySchedule", user.uid);
        const snap = await getDoc(ref);

        if (snap.exists()) {
          const data = snap.data();
          if (data.attendance && data.attendance[subject]) {
            data.attendance[subject].present = 0;
            data.attendance[subject].absent = 0;
            await setDoc(ref, data, { merge: true });
            updateAttendanceBySubject(data.attendance); // 再描画
          }
        }
      }
    });

    card.appendChild(resetBtn);
    info.appendChild(card);
  });

  // 週間時間割画面に追加
  const weeklyScreen = document.getElementById("weekly-schedule");
  weeklyScreen.appendChild(info);
}



async function modifyAttendance(subject, type) {
  const uid = auth.currentUser.uid;
  const docRef = doc(db, "weeklySchedule", uid);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return;

  const data = snap.data();
  if (!data.attendance || !data.attendance[subject]) return;

  if (type === "present") {
    data.attendance[subject].present++;
  } else if (type === "absent") {
    data.attendance[subject].absent++;
  }

  await setDoc(docRef, data, { merge: true });
  updateAttendanceBySubject(data.attendance);
}


async function resetAttendance(subject) {
  const uid = auth.currentUser.uid;
  const docRef = doc(db, "weeklySchedule", uid);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return;

  const data = snap.data();
  if (data.attendance && data.attendance[subject]) {
    delete data.attendance[subject];
  }

  await setDoc(docRef, data, { merge: true });
  updateAttendanceBySubject(data.attendance || {});
}

let studyChart = null; // グローバルで保持

async function drawStudyChart() {
  const user = auth.currentUser;
  if (!user) return;

  // Firestore から自分の勉強記録を取得（過去7日）
  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 6); // 今日含め7日分

  const q = query(
    collection(db, "studyLog"),
    where("uid", "==", user.uid),
    where("date", ">=", sevenDaysAgo),
    orderBy("date", "asc")
  );

  const snapshot = await getDocs(q);

  // 曜日ごとの合計時間（分）を初期化
  const weekData = { "月":0, "火":0, "水":0, "木":0, "金":0, "土":0, "日":0 };

  snapshot.forEach(docSnap => {
    const d = docSnap.data();
    if (!d.date?.toDate) return;
    const day = d.date.toDate().getDay(); // 0=日,1=月,...6=土
    const dayMap = ["日","月","火","水","木","金","土"];
    const dayStr = dayMap[day];
    weekData[dayStr] += (d.seconds || 0) / 60; // 分単位
  });

  const labels = ["月","火","水","木","金","土","日"];
  const data = labels.map(l => weekData[l]);

  const ctx = document.getElementById("study-graph").getContext("2d");

  // すでにグラフがある場合は破棄
  if (studyChart) studyChart.destroy();

  // Y軸の最大値を自動調整＋15分刻み
  const maxVal = Math.ceil(Math.max(...data)/15)*15 || 60; // 最大値を15分刻みに丸め、最低60分
  studyChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "勉強時間（分）",
        data,
        backgroundColor: "rgba(54, 162, 235, 0.5)",
        borderColor: "rgba(54, 162, 235, 1)",
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          max: maxVal,
          ticks: {
            stepSize: 15,
            callback: v => v + "分"
          }
        }
      }
    }
  });

  // グラフ表示
  document.getElementById("study-graph-container").style.display = "block";
}



// =======================
// Firestoreから読み込み
// =======================
async function loadWeeklySchedule() {
  const uid = auth.currentUser.uid;
  const docRef = doc(db, "weeklySchedule", uid);
  const snap = await getDoc(docRef);

  if (snap.exists()) {
    const data = snap.data();

    if (data.schedule) {
      daysFull.forEach((day, dIndex) => {
        hours.forEach((time, tIndex) => {
          const row = scheduleBody.rows[tIndex];
          if (!row) return; // 行が存在しないならスキップ

          const cell = row.cells[dIndex + 1];
          if (!cell) return; // セルが存在しないならスキップ

          const subjSelect = cell.querySelector("select");
          if (subjSelect) subjSelect.value = data.schedule[day]?.[time] || "";
        });
      });
    }

    if (data.attendance) updateAttendanceBySubject(data.attendance);
  }
}

// ============================
// 勉強タイマー用コード
// ============================

let timerInterval = null;
let elapsedTime = 0;
let isPaused = false;

// 表示更新
function updateTimerDisplay() {
  const display = document.getElementById("timer-display");
  const sec = Math.floor(elapsedTime / 1000);
  const h = String(Math.floor(sec / 3600)).padStart(2, "0");
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  display.textContent = `${h}:${m}:${s}`;
}

// --- スタート ---
document.getElementById("timer-start-btn").addEventListener("click", () => {
  if (timerInterval) return;
  isPaused = false;
  startTimerInterval();
});

function startTimerInterval() {
  timerInterval = setInterval(() => {
    if (!isPaused) {
      elapsedTime += 1000;
      updateTimerDisplay();
    }
  }, 1000);
}

// --- 一時停止 ---
document.getElementById("timer-pause-btn").addEventListener("click", () => {
  if (!timerInterval) return;
  isPaused = true;
});

// --- 再開 ---
document.getElementById("timer-resume-btn").addEventListener("click", () => {
  if (!timerInterval) return;
  isPaused = false;
});

// --- ストップ（記録） ---
document.getElementById("timer-stop-btn").addEventListener("click", async () => {
  if (!timerInterval) return;
  clearInterval(timerInterval);
  timerInterval = null;

  const user = auth.currentUser;
  if (!user) return;

  const subject = document.getElementById("study-subject").value || "未設定";

  // 秒で保存！
  const seconds = Math.floor(elapsedTime / 1000);

  await addDoc(collection(db, "studyLog"), {
    uid: user.uid,
    subject: subject,
    seconds: seconds,     // ← ここが重要
    date: new Date(),
    createdAt: serverTimestamp()
  });

  alert(`勉強時間 ${Math.floor(seconds/60)}分${seconds%60}秒 を記録しました！\n科目：${subject}`);

  // リセット
  elapsedTime = 0;
  updateTimerDisplay();
});


// ホームへ戻るボタン
document.getElementById("timer-back-btn").addEventListener("click", () => {
  showScreen("home");
});

// ホームの「タイマー」ボタン
document.getElementById("to-timer-btn").addEventListener("click", () => {
  showScreen("timer-screen");
});

document.getElementById("studylog-btn").addEventListener("click", () => {
  showScreen("studylog-screen");
  loadStudyLog();
});

document.getElementById("back-from-studylog-btn").addEventListener("click", () => {
  showScreen("home");
});

// 勉強グラフ表示ボタン
const showStudyGraphBtn = document.getElementById("show-study-graph-btn");
const studyGraphContainer = document.getElementById("study-graph-container");

const showGraphBtn = document.getElementById("show-study-graph-btn");
const graphContainer = document.getElementById("study-graph-container");

// =======================
// 画面切り替え
// =======================
weeklyBtn.addEventListener("click", async () => {
  showScreen("weekly-schedule");
  await generateScheduleGrid();
  await loadWeeklySchedule();
});

backFromWeeklyBtn.addEventListener("click", () => showScreen("home"));

/* ===========================
   補助: HTMLエスケープ（簡易）
   =========================== */
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ===========================
   初期ロード: 課題 / 授業 / 週間時間割 読込用の小さな wrapper
   call load functions when auth ready (onAuthStateChanged already does)
   but expose a manual reload for debugging
   =========================== */
window.appReload = async () => {
  await loadKadai();
  await loadDone();
  await loadClasses();
  await loadWeeklySchedule();
};

document.getElementById("show-study-graph-btn")
    ?.addEventListener("click", drawStudyChart);


document.getElementById("lightbox").addEventListener("click", () => {
  document.getElementById("lightbox").classList.add("hidden");
});
