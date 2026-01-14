// --- データ管理 ---
let memos = [];
let folders = [];
let settings = { fontSize: 'medium' }; 
const COLORS = ['#FF2D55', '#5856D6', '#007AFF', '#34C759', '#FF9500', '#AF52DE', '#FF3B30', '#8E8E93'];

let sortOrder = 'updated'; 
let currentTab = 'memo'; 
let currentFolderId = null; 
let isEditingList = false;
let selectedMemoIds = new Set();
let editingMemoId = null;
let inlineSearchQuery = '';
let editingFolderId = null; 

// ★ハイライト維持用の変数
let activeHighlightTerm = null;

document.addEventListener('DOMContentLoaded', () => {
    loadData();
    initColorPicker();
    applySettings(); 
    updateSortStatusText();
    restoreAppState();
    setupEvents();
    
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
});

const els = {
    headerTitle: document.getElementById('header-title'),
    backBtn: document.getElementById('back-btn'),
    editBtn: document.getElementById('edit-btn'),
    addBtn: document.getElementById('add-btn'),
    searchIconBtn: document.getElementById('search-icon-btn'),
    
    views: {
        memoList: document.getElementById('view-memo-list'),
        folderList: document.getElementById('view-folder-list'),
        folderDetail: document.getElementById('view-folder-detail'),
        editor: document.getElementById('view-editor'),
        search: document.getElementById('view-search'),
        settings: document.getElementById('view-settings'),
    },
    lists: {
        memo: document.getElementById('memo-list-ul'),
        folder: document.getElementById('folder-list-ul'),
        folderDetail: document.getElementById('folder-detail-ul'),
        search: document.getElementById('search-list-ul'),
    },
    editor: {
        textarea: document.getElementById('memo-editor'),
        backdrop: document.getElementById('editor-backdrop'),
        highlights: document.getElementById('editor-highlights'),
    },
    // ツールバーとパネル
    toolSearch: document.getElementById('tool-search'),
    toolReplace: document.getElementById('tool-replace'),
    toolBottom: document.getElementById('tool-bottom'),
    
    searchPanel: document.getElementById('editor-search-panel'),
    editorSearchInput: document.getElementById('editor-search-input'),
    editorSearchExec: document.getElementById('editor-search-exec'),
    panelCloseSearch: document.getElementById('editor-panel-close-search'),
    
    replacePanel: document.getElementById('editor-replace-panel'),
    editorReplaceTarget: document.getElementById('editor-replace-target'),
    editorReplaceWith: document.getElementById('editor-replace-with'),
    editorReplaceExec: document.getElementById('editor-replace-exec'),
    panelCloseReplace: document.getElementById('editor-panel-close-replace'),

    searchBars: {
        memo: document.getElementById('memo-search-bar'),
        folder: document.getElementById('folder-search-bar'),
        folderDetail: document.getElementById('folder-detail-search-bar'),
    },
    searchInput: document.getElementById('search-input'),
    tabBar: document.getElementById('tab-bar'),
    editActionBar: document.getElementById('edit-action-bar'),
    overlay: document.getElementById('modal-overlay'),
    folderModal: document.getElementById('folder-modal'),
    folderModalTitle: document.getElementById('folder-modal-title'),
    newFolderName: document.getElementById('new-folder-name'),
    modalSaveBtn: document.getElementById('modal-save'),
    colorPicker: document.getElementById('color-picker'),
    moveModal: document.getElementById('move-modal'),
    moveList: document.getElementById('move-target-list'),
};

// --- イベント設定 ---
function setupEvents() {
    // タブ
    els.tabBar.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (isEditingList) toggleEditMode();
            switchTab(btn.dataset.target);
            saveAppState(); 
        });
    });

    // ヘッダー検索ボタン
    els.searchIconBtn.addEventListener('click', () => {
        if (isEditingList) toggleEditMode();
        let targetBar = null;
        if (currentTab === 'memo') targetBar = els.searchBars.memo;
        else if (currentTab === 'folder') {
            if (currentFolderId) targetBar = els.searchBars.folderDetail;
            else targetBar = els.searchBars.folder;
        }

        if (targetBar) {
            targetBar.classList.toggle('active');
            if (targetBar.classList.contains('active')) {
                targetBar.querySelector('input').focus();
            } else {
                targetBar.querySelector('input').value = '';
                inlineSearchQuery = '';
                render();
            }
        } else {
            switchTab('search');
            saveAppState();
        }
    });

    // インライン検索
    Object.values(els.searchBars).forEach(bar => {
        bar.querySelector('input').addEventListener('input', (e) => {
            inlineSearchQuery = e.target.value;
            render();
        });
    });

    // 追加ボタン
    els.addBtn.addEventListener('click', () => {
        if (currentTab === 'memo' || currentTab === 'search') {
            openEditor(null);
        } else if (currentTab === 'folder') {
            if (currentFolderId === null) {
                openFolderModal();
            } else {
                openEditor(null, currentFolderId);
            }
        }
    });

    // 編集・戻る
    els.editBtn.addEventListener('click', toggleEditMode);
    els.backBtn.addEventListener('click', goBack);

    // エディタ入力（ここが重要：リスト再描画をしない + ハイライト維持）
    els.editor.textarea.addEventListener('input', () => {
        updateHeaderCountOrSelection();
        
        // ★文字を入力してもハイライト処理を再実行して維持する
        renderHighlights(activeHighlightTerm);
        
        saveCurrentMemoSilent(); // 保存のみ
    });
    
    // スクロール同期 (入力欄とハイライト層を合わせる)
    els.editor.textarea.addEventListener('scroll', () => {
        els.editor.backdrop.scrollTop = els.editor.textarea.scrollTop;
    });

    // 選択範囲変更時の文字数カウント（修正版）
    document.addEventListener('selectionchange', () => {
        // エディタが開いていれば、フォーカスに関わらずカウント更新を試みる
        if (els.views.editor.classList.contains('active')) {
            updateHeaderCountOrSelection();
        }
    });

// 選択中の文字数または全体文字数をヘッダーに表示
function updateHeaderCountOrSelection() {
    const ta = els.editor.textarea;
    // 選択範囲がある場合（開始位置と終了位置が違う場合）
    if (ta.selectionStart !== ta.selectionEnd) {
        const count = Math.abs(ta.selectionEnd - ta.selectionStart);
        els.headerTitle.textContent = `選択: ${count}文字`;
    } else {
        // 選択していない場合は全体文字数
        els.headerTitle.textContent = `計 ${ta.value.length}`;
    }
}

    // ツールバー機能
    els.toolBottom.addEventListener('click', () => {
        els.editor.textarea.scrollTop = els.editor.textarea.scrollHeight;
    });
    
    // エディタ検索
    els.toolSearch.addEventListener('click', () => {
        els.searchPanel.classList.remove('hidden');
        els.replacePanel.classList.add('hidden');
        els.editorSearchInput.focus();
    });
    els.panelCloseSearch.addEventListener('click', () => els.searchPanel.classList.add('hidden'));
    
    // 検索実行（ハイライトのみ）
    els.editorSearchExec.addEventListener('click', () => {
        const term = els.editorSearchInput.value;
        if(term) {
            activeHighlightTerm = term; // 検索語を記憶
            renderHighlights(term);
        }
    });

    // エディタ置換
    els.toolReplace.addEventListener('click', () => {
        els.replacePanel.classList.remove('hidden');
        els.searchPanel.classList.add('hidden');
        els.editorReplaceTarget.focus();
    });
    els.panelCloseReplace.addEventListener('click', () => els.replacePanel.classList.add('hidden'));
    
    // 一括置換実行
    els.editorReplaceExec.addEventListener('click', () => {
        const target = els.editorReplaceTarget.value;
        const withTxt = els.editorReplaceWith.value;
        if(target) replaceAllText(target, withTxt);
    });

    els.searchInput.addEventListener('input', (e) => performSearch(e.target.value));

    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    els.modalSaveBtn.addEventListener('click', saveFolder);
    els.overlay.addEventListener('click', closeModal);

    document.getElementById('action-delete').addEventListener('click', deleteSelected);
    document.getElementById('action-move').addEventListener('click', openMoveModal);
    document.getElementById('action-copy').addEventListener('click', copySelected);
    document.getElementById('action-export').addEventListener('click', exportSelectedToTxt);
    document.getElementById('move-cancel').addEventListener('click', closeModal);

    document.getElementById('sort-toggle').addEventListener('click', toggleSort);
    document.getElementById('force-update').addEventListener('click', forceUpdateApp);
}

// --- エディタ内 ハイライト・置換ロジック ---

// ハイライトを描画（termがnullならクリア）
function renderHighlights(term) {
    const text = els.editor.textarea.value;
    
    // HTMLエスケープ（タグがそのまま表示されないように）
    let html = escapeHtml(text);
    
    if (term) {
        // 検索語を <mark> タグで囲む
        // 特殊文字エスケープ
        const safeTerm = escapeRegExp(term);
        const regex = new RegExp(`(${safeTerm})`, 'g');
        html = html.replace(regex, '<mark>$1</mark>');
    }
    
    // 改行を <br> に変換して表示調整
    // 最後の改行が無視されないように工夫
    if (html.slice(-1) === '\n') {
        html += ' '; 
    }
    html = html.replace(/\n/g, '<br>');
    
    els.editor.highlights.innerHTML = html;
}

// 一括置換
function replaceAllText(target, withTxt) {
    if (!target) return;
    const text = els.editor.textarea.value;
    // 単純な全置換
    const newText = text.split(target).join(withTxt);
    
    if (text !== newText) {
        els.editor.textarea.value = newText;
        saveCurrentMemoSilent();
        
        // ★置換後の文字をハイライト対象にする
        if (withTxt) {
            activeHighlightTerm = withTxt;
            renderHighlights(withTxt);
        } else {
            activeHighlightTerm = null;
            renderHighlights(null);
        }
        
        els.headerTitle.textContent = `計 ${newText.length}`;
        alert('一括置換しました');
    } else {
        alert('対象が見つかりませんでした');
    }
}

// HTMLエスケープ
function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// 正規表現エスケープ
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- データ保存・読み込み (以下既存機能) ---
function loadData() {
    const m = localStorage.getItem('local_memos');
    const f = localStorage.getItem('local_folders');
    const s = localStorage.getItem('local_settings');
    const so = localStorage.getItem('local_sort'); 
    if (m) memos = JSON.parse(m);
    if (f) folders = JSON.parse(f);
    if (s) settings = JSON.parse(s);
    if (so) sortOrder = so;
}

function saveData() {
    localStorage.setItem('local_memos', JSON.stringify(memos));
    localStorage.setItem('local_folders', JSON.stringify(folders));
    localStorage.setItem('local_settings', JSON.stringify(settings));
    localStorage.setItem('local_sort', sortOrder);
    render();
}

function saveDataSilent() {
    localStorage.setItem('local_memos', JSON.stringify(memos));
}

function saveAppState() {
    const state = {
        tab: currentTab,
        folderId: currentFolderId,
        editingId: editingMemoId
    };
    localStorage.setItem('app_state', JSON.stringify(state));
}

function restoreAppState() {
    const raw = localStorage.getItem('app_state');
    if (!raw) {
        render();
        return; 
    }
    try {
        const state = JSON.parse(raw);
        if (state.editingId) {
            const m = memos.find(memo => memo.id === state.editingId);
            if (m) {
                currentTab = state.tab || 'memo'; 
                switchTab(currentTab);
                currentFolderId = state.folderId || null; 
                openEditor(state.editingId);
                return;
            }
        }
        if (state.tab === 'folder' && state.folderId) {
            const f = folders.find(folder => folder.id === state.folderId);
            if (f) {
                switchTab('folder');
                openFolderDetail(state.folderId);
                return;
            }
        }
        if (['memo', 'folder', 'search', 'settings'].includes(state.tab)) {
            switchTab(state.tab);
        } else {
            switchTab('memo');
        }
    } catch (e) {
        switchTab('memo');
    }
    render();
}

function changeFontSize(size) {
    settings.fontSize = size;
    saveData();
    applySettings();
}

function applySettings() {
    document.body.className = `fs-${settings.fontSize}`;
    ['small', 'medium', 'large'].forEach(s => {
        const btn = document.getElementById(`fs-btn-${s}`);
        if(btn) {
            if (s === settings.fontSize) btn.classList.add('active');
            else btn.classList.remove('active');
        }
    });
}

function switchTab(tab) {
    currentTab = tab;
    currentFolderId = null; 
    resetSearch();
    
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.tab-btn[data-target="${tab}"]`);
    if(btn) btn.classList.add('active');

    Object.values(els.views).forEach(v => v.classList.remove('active'));
    els.editBtn.classList.remove('hidden');
    els.addBtn.classList.remove('hidden');
    els.backBtn.classList.add('hidden');
    els.tabBar.classList.remove('hidden');
    els.searchIconBtn.classList.remove('hidden');

    if (tab === 'memo') {
        els.views.memoList.classList.add('active');
        renderMemoList();
    } else if (tab === 'folder') {
        els.views.folderList.classList.add('active');
        renderFolderList();
    } else if (tab === 'search') {
        els.views.search.classList.add('active');
        els.editBtn.classList.add('hidden');
        els.searchIconBtn.classList.add('hidden');
        els.searchInput.value = '';
        els.lists.search.innerHTML = '';
    } else if (tab === 'settings') {
        els.views.settings.classList.add('active');
        els.editBtn.classList.add('hidden');
        els.addBtn.classList.add('hidden');
        els.searchIconBtn.classList.add('hidden');
    }
}

function resetSearch() {
    inlineSearchQuery = ''; 
    document.querySelectorAll('.inline-search-bar input').forEach(i => i.value = '');
    document.querySelectorAll('.inline-search-bar').forEach(b => b.classList.remove('active'));
}

function goBack() {
    if (els.views.editor.classList.contains('active')) {
        const memo = memos.find(m => m.id === editingMemoId);
        if (memo) {
            if (!memo.text.trim()) {
                memos = memos.filter(m => m.id !== editingMemoId);
                saveData();
            } else {
                saveCurrentMemo();
                saveData();
            }
        }
        
        editingMemoId = null;
        // ★戻るときにハイライトをクリア
        activeHighlightTerm = null;
        renderHighlights(null);
        
        saveAppState(); 

        els.views.editor.classList.remove('active');
        els.tabBar.classList.remove('hidden');
        els.searchIconBtn.classList.remove('hidden');
        
        if (currentTab === 'memo') {
            els.views.memoList.classList.add('active');
            renderMemoList();
            els.addBtn.classList.remove('hidden');
            els.editBtn.classList.remove('hidden');
        } else if (currentTab === 'folder') {
            if (currentFolderId) {
                els.views.folderDetail.classList.add('active');
                renderFolderDetail();
                els.backBtn.classList.remove('hidden');
            } else {
                els.views.folderList.classList.add('active');
                els.backBtn.classList.add('hidden');
            }
            els.addBtn.classList.remove('hidden');
            els.editBtn.classList.remove('hidden');
        } else if (currentTab === 'search') {
            els.views.search.classList.add('active');
            els.editBtn.classList.add('hidden');
            els.addBtn.classList.remove('hidden');
            els.searchIconBtn.classList.add('hidden'); 
        }
        if(!currentFolderId || currentTab !== 'folder') els.backBtn.classList.add('hidden');

    } else if (currentFolderId) {
        currentFolderId = null;
        saveAppState(); 
        resetSearch(); 
        els.views.folderDetail.classList.remove('active');
        els.views.folderList.classList.add('active');
        els.backBtn.classList.add('hidden');
        renderFolderList();
    }
}

function render() {
    if(currentTab === 'memo') renderMemoList();
    else if(currentTab === 'folder') {
        if(currentFolderId) renderFolderDetail();
        else renderFolderList();
    }
}

function getSortedMemos(list) {
    return list.sort((a, b) => {
        if (sortOrder === 'updated') {
            return new Date(b.updatedAt) - new Date(a.updatedAt); 
        } else if (sortOrder === 'created') {
            const ca = a.createdAt || a.updatedAt;
            const cb = b.createdAt || b.updatedAt;
            return new Date(cb) - new Date(ca); 
        } else if (sortOrder === 'name') {
            return a.text.localeCompare(b.text);
        }
    });
}

function formatDateFull(isoString) {
    if(!isoString) return '-';
    const d = new Date(isoString);
    return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function renderList(ulElement, listData, append = false) {
    if (!append) ulElement.innerHTML = ''; 
    
    listData.forEach(item => {
        const li = document.createElement('li');
        li.className = 'list-item-container';
        
        const cDate = formatDateFull(item.createdAt || item.updatedAt);
        const uDate = formatDateFull(item.updatedAt);
        
        let firstLine = item.text.split('\n')[0] || '新しいメモ';
        if (firstLine.length > 20) firstLine = firstLine.substring(0, 20) + '...';
        
        let extraInfo = '';
        if(item.folderId && ulElement === els.lists.folder) {
             const f = folders.find(fd => fd.id === item.folderId);
             if(f) extraInfo = `<span style="font-size:10px; color:#888; margin-left:5px;">(${f.name})</span>`;
        }

        li.innerHTML = `
            <div class="list-item-bg-left"></div>
            <div class="swipe-btn copy" onclick="copyOne('${item.id}', event)">複製</div>
            <div class="swipe-btn delete" onclick="deleteOne('${item.id}', event)">削除</div>
            <div class="list-item-content-box">
                <div style="display:flex; align-items:center; width:100%;">
                    <input type="checkbox" class="edit-checkbox" data-id="${item.id}" data-type="memo">
                    <div class="memo-content">
                        <div class="memo-title">${firstLine}${extraInfo}</div>
                        <div class="memo-date">作成:${cDate}　更新:${uDate}</div>
                    </div>
                </div>
                <span class="memo-meta">${item.text.length}</span>
            </div>
        `;
        
        const contentBox = li.querySelector('.list-item-content-box');
        
        let startX = 0;
        let currentTranslate = 0;
        
        contentBox.addEventListener('touchstart', (e) => {
            if (isEditingList) return; 
            startX = e.touches[0].clientX;
            contentBox.style.transition = 'none';
        }, {passive: true});

        contentBox.addEventListener('touchmove', (e) => {
            if (isEditingList) return;
            const diff = e.touches[0].clientX - startX;
            if (diff > 80) currentTranslate = 80;
            else if (diff < -80) currentTranslate = -80;
            else currentTranslate = diff;
            contentBox.style.transform = `translateX(${currentTranslate}px)`;
        }, {passive: true});

        contentBox.addEventListener('touchend', () => {
            if (isEditingList) return;
            contentBox.style.transition = 'transform 0.2s ease-out';
            if (currentTranslate > 40) contentBox.style.transform = `translateX(80px)`;
            else if (currentTranslate < -40) contentBox.style.transform = `translateX(-80px)`;
            else contentBox.style.transform = `translateX(0)`;
        });

        contentBox.addEventListener('click', (e) => {
            if (Math.abs(currentTranslate) > 10) {
                currentTranslate = 0;
                contentBox.style.transform = `translateX(0)`;
                return;
            }
            if (isEditingList || e.target.type === 'checkbox') return;
            openEditor(item.id);
        });

        ulElement.appendChild(li);
    });
    
    if (isEditingList) document.body.classList.add('editing');
    else document.body.classList.remove('editing');
}

function deleteOne(id, e) {
    e.stopPropagation();
    if(confirm('削除しますか？')) {
        memos = memos.filter(m => m.id !== id);
        saveData();
    } else {
        render();
    }
}
function copyOne(id, e) {
    e.stopPropagation();
    const m = memos.find(memo => memo.id === id);
    if(m) {
        const copy = {
            ...m,
            id: Date.now().toString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        memos.unshift(copy);
        saveData();
    }
}

function renderMemoList() {
    let list = memos.filter(m => !m.folderId);
    if (inlineSearchQuery) {
        list = list.filter(m => m.text.includes(inlineSearchQuery));
    }
    list = getSortedMemos(list);
    renderList(els.lists.memo, list);
    updateHeaderCount(list);
}

function renderFolderList() {
    els.lists.folder.innerHTML = '';
    let targetFolders = folders;
    if (inlineSearchQuery) {
        targetFolders = folders.filter(f => f.name.includes(inlineSearchQuery));
    }
    
    if(sortOrder === 'updated' || sortOrder === 'created') {
        targetFolders.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)); 
    } else {
        targetFolders.sort((a,b) => a.name.localeCompare(b.name));
    }
    
    let totalChars = 0;
    
    targetFolders.forEach(f => {
        const count = memos.filter(m => m.folderId === f.id).length;
        const li = document.createElement('li');
        li.className = 'list-item-container folder-item';
        
        let colorPaletteHTML = '';
        COLORS.forEach(c => {
            colorPaletteHTML += `<div class="mini-swatch" style="background:${c}" onclick="changeFolderColor('${f.id}', '${c}', event)"></div>`;
        });

        const dateStr = formatDateFull(f.createdAt);

        li.innerHTML = `
            <div class="list-item-bg-left"></div>
            <div class="swipe-btn copy" onclick="copyFolderOne('${f.id}', event)">複製</div>
            <div class="swipe-btn delete" onclick="deleteFolderOne('${f.id}', event)">削除</div>
            <div class="list-item-content-box" style="background-color:${f.color}; color:#fff; font-weight:bold;">
                <div style="display:flex; align-items:center; width:100%;">
                    <input type="checkbox" class="edit-checkbox" data-id="${f.id}" data-type="folder">
                    <div style="flex:1;">
                        <span class="memo-content folder-name-span" data-id="${f.id}">${f.name}</span>
                        <div class="memo-date" style="color:rgba(255,255,255,0.7); font-weight:normal;">作成:${dateStr}</div>
                    </div>
                </div>
                <div style="display:flex; align-items:center;">
                    <span class="memo-meta" style="background:rgba(0,0,0,0.3)">${count}</span>
                    <div class="folder-edit-palette">${colorPaletteHTML}</div>
                </div>
            </div>
        `;
        
        const contentBox = li.querySelector('.list-item-content-box');
        
        let startX = 0;
        let currentTranslate = 0;
        
        contentBox.addEventListener('touchstart', (e) => {
            if (isEditingList) return; 
            startX = e.touches[0].clientX;
            contentBox.style.transition = 'none';
        }, {passive: true});

        contentBox.addEventListener('touchmove', (e) => {
            if (isEditingList) return;
            const diff = e.touches[0].clientX - startX;
            if (diff > 80) currentTranslate = 80;
            else if (diff < -80) currentTranslate = -80;
            else currentTranslate = diff;
            contentBox.style.transform = `translateX(${currentTranslate}px)`;
        }, {passive: true});

        contentBox.addEventListener('touchend', () => {
            if (isEditingList) return;
            contentBox.style.transition = 'transform 0.2s ease-out';
            if (currentTranslate > 40) contentBox.style.transform = `translateX(80px)`;
            else if (currentTranslate < -40) contentBox.style.transform = `translateX(-80px)`;
            else contentBox.style.transform = `translateX(0)`;
        });

        contentBox.onclick = (e) => {
            if (Math.abs(currentTranslate) > 10) {
                currentTranslate = 0;
                contentBox.style.transform = `translateX(0)`;
                return;
            }
            if (e.target.type === 'checkbox' || e.target.classList.contains('mini-swatch')) return;
            
            if (isEditingList) {
                openFolderRename(f.id, f.name);
            } else {
                openFolderDetail(f.id);
            }
        };
        els.lists.folder.appendChild(li);
    });

    if (inlineSearchQuery) {
        const matchedMemos = memos.filter(m => m.folderId && m.text.includes(inlineSearchQuery));
        if (matchedMemos.length > 0) {
            const sep = document.createElement('div');
            sep.className = 'list-section-header';
            sep.textContent = '一致したフォルダ内メモ';
            els.lists.folder.appendChild(sep);
            renderList(els.lists.folder, getSortedMemos(matchedMemos), true);
        }
    }
    
    memos.forEach(m => totalChars += m.text.length);
    if (!els.views.editor.classList.contains('active')) {
        els.headerTitle.textContent = `計 ${totalChars}`;
    }
    
    if (isEditingList) document.body.classList.add('editing');
    else document.body.classList.remove('editing');
}

function deleteFolderOne(id, e) {
    e.stopPropagation();
    if(confirm('フォルダを削除しますか？中身は未分類になります。')) {
        folders = folders.filter(f => f.id !== id);
        memos.forEach(m => {
            if (m.folderId === id) m.folderId = null;
        });
        saveData();
    } else {
        render();
    }
}

function copyFolderOne(id, e) {
    e.stopPropagation();
    const f = folders.find(folder => folder.id === id);
    if(f) {
        const newFolderId = Date.now().toString();
        const newFolder = {
            ...f,
            id: newFolderId,
            name: f.name + 'のコピー',
            createdAt: new Date().toISOString()
        };
        folders.push(newFolder);
        
        memos.forEach(m => {
            if(m.folderId === id) {
                const copyMemo = {
                    ...m,
                    id: Date.now().toString() + Math.random().toString().slice(2,5),
                    folderId: newFolderId,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                memos.push(copyMemo);
            }
        });
        saveData();
        render();
        alert(`フォルダ「${newFolder.name}」として複製しました`);
    }
}

function changeFolderColor(folderId, newColor, event) {
    event.stopPropagation(); 
    const folder = folders.find(f => f.id === folderId);
    if(folder) {
        folder.color = newColor;
        saveData(); 
    }
}

function renderFolderDetail() {
    let list = memos.filter(m => m.folderId === currentFolderId);
    if (inlineSearchQuery) {
        list = list.filter(m => m.text.includes(inlineSearchQuery));
    }
    list = getSortedMemos(list);
    renderList(els.lists.folderDetail, list);
    updateHeaderCount(list);
}

function performSearch(keyword) {
    const ul = els.lists.search;
    ul.innerHTML = '';
    if(!keyword) return;

    const hits = memos.filter(m => m.text.includes(keyword));
    hits.sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    hits.forEach(item => {
        const li = document.createElement('li');
        li.className = 'list-item-container'; 
        li.style.borderBottom = '1px solid #38383a';
        li.style.padding = '10px 16px';
        li.style.display = 'flex'; li.style.justifyContent = 'space-between'; li.style.alignItems='center';

        const cDate = formatDateFull(item.createdAt || item.updatedAt);
        let firstLine = item.text.split('\n')[0] || '新しいメモ';
        if (firstLine.length > 20) firstLine = firstLine.substring(0, 20) + '...';
        
        let folderName = '未分類';
        if (item.folderId) {
            const f = folders.find(fd => fd.id === item.folderId);
            if(f) folderName = f.name;
        }

        li.innerHTML = `
            <div class="memo-content">
                <div class="memo-title">${firstLine} <span style="font-size:10px; color:#888; font-weight:normal; margin-left:5px;">(${folderName})</span></div>
                <div class="memo-date">作成:${cDate}</div>
            </div>
            <span class="memo-meta">${item.text.length}</span>
        `;
        li.onclick = () => openEditor(item.id);
        ul.appendChild(li);
    });
    els.headerTitle.textContent = `${hits.length}件 ヒット`;
}

function updateHeaderCount(list) {
    if (els.views.editor.classList.contains('active')) return;
    const total = list.reduce((sum, item) => sum + item.text.length, 0);
    els.headerTitle.textContent = `計 ${total}`;
}

function openEditor(id, folderId = null) {
    editingMemoId = id;
    Object.values(els.views).forEach(v => v.classList.remove('active'));
    els.views.editor.classList.add('active');
    
    els.tabBar.classList.add('hidden');
    els.addBtn.classList.add('hidden');
    els.editBtn.classList.add('hidden');
    els.searchIconBtn.classList.add('hidden');
    els.backBtn.classList.remove('hidden');

    if (id) {
        const memo = memos.find(m => m.id === id);
        els.editor.textarea.value = memo.text;
    } else {
        els.editor.textarea.value = '';
        const newMemo = {
            id: Date.now().toString(),
            text: '',
            folderId: folderId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        memos.unshift(newMemo);
        editingMemoId = newMemo.id;
    }
    
    els.headerTitle.textContent = `計 ${els.editor.textarea.value.length}`;
    els.editor.textarea.scrollTop = 0;
    els.editor.textarea.blur(); 
    
    // ハイライト初期化
    renderHighlights(null);
    
    saveAppState(); 
}

function saveCurrentMemo() {
    if (!editingMemoId) return;
    const memo = memos.find(m => m.id === editingMemoId);
    if (memo) {
        memo.text = els.editor.textarea.value;
        memo.updatedAt = new Date().toISOString();
        saveData(); 
    }
}

function saveCurrentMemoSilent() {
    if (!editingMemoId) return;
    const memo = memos.find(m => m.id === editingMemoId);
    if (memo) {
        memo.text = els.editor.textarea.value;
        memo.updatedAt = new Date().toISOString();
        saveDataSilent();
    }
}

function toggleEditMode() {
    isEditingList = !isEditingList;
    selectedMemoIds.clear();
    if (isEditingList) {
        document.body.classList.add('editing');
        els.editBtn.textContent = '完了';
        els.editActionBar.classList.remove('hidden');
        els.tabBar.classList.add('hidden');
    } else {
        document.body.classList.remove('editing');
        els.editBtn.textContent = '編集';
        els.editActionBar.classList.add('hidden');
        els.tabBar.classList.remove('hidden');
        document.querySelectorAll('.edit-checkbox').forEach(cb => cb.checked = false);
    }
    render();
}

document.addEventListener('change', (e) => {
    if (e.target.classList.contains('edit-checkbox')) {
        const id = e.target.dataset.id;
        if (e.target.checked) selectedMemoIds.add(id);
        else selectedMemoIds.delete(id);
    }
});

function deleteSelected() {
    if (!confirm('選択した項目を削除しますか？')) return;
    if (currentTab === 'folder' && !currentFolderId) {
        folders = folders.filter(f => !selectedMemoIds.has(f.id));
        memos.forEach(m => {
            if (selectedMemoIds.has(m.folderId)) m.folderId = null;
        });
    } else {
        memos = memos.filter(m => !selectedMemoIds.has(m.id));
    }
    saveData();
    toggleEditMode();
}

function copySelected() {
    if (selectedMemoIds.size === 0) return;
    let copyCount = 0;
    const newMemos = [];
    memos.forEach(m => {
        if(selectedMemoIds.has(m.id)) {
            const copy = {
                ...m,
                id: Date.now().toString() + Math.random().toString().slice(2,5), 
                createdAt: new Date().toISOString(), 
                updatedAt: new Date().toISOString()
            };
            newMemos.push(copy);
            copyCount++;
        }
    });
    if(copyCount > 0) {
        memos = newMemos.concat(memos);
        saveData();
        alert(`${copyCount}件を複製しました`);
        toggleEditMode();
    }
}

async function exportSelectedToTxt() {
    if (selectedMemoIds.size === 0) return;
    
    let targets = [];
    if(currentTab === 'folder' && !currentFolderId) {
        const targetFolderIds = Array.from(selectedMemoIds).filter(id => folders.some(f => f.id === id));
        const folderMemos = memos.filter(m => targetFolderIds.includes(m.folderId));
        targets = targets.concat(folderMemos);
        const directMemos = memos.filter(m => selectedMemoIds.has(m.id));
        targets = targets.concat(directMemos);
        targets = [...new Set(targets)];
    } else {
        targets = memos.filter(m => selectedMemoIds.has(m.id));
    }

    if(targets.length === 0) {
        alert('書き出すメモがありません');
        return;
    }

    const files = targets.map(m => {
        let firstLine = m.text.split('\n')[0] || '';
        let filename = firstLine.trim();
        if (filename.length > 20) filename = filename.substring(0, 20) + '...';
        if (!filename) {
            const d = new Date(m.updatedAt);
            filename = `メモ_${d.getFullYear()}${(d.getMonth()+1).toString().padStart(2,'0')}${d.getDate().toString().padStart(2,'0')}`;
        }
        return new File([m.text || ''], filename + '.txt', { type: 'text/plain' });
    });

    if (navigator.canShare && navigator.canShare({ files: files })) {
        try {
            await navigator.share({ files: files });
        } catch (err) {
            if (err.name !== 'AbortError') files.forEach(f => downloadFileFallback(f));
        }
    } else {
        files.forEach(f => downloadFileFallback(f));
    }
    toggleEditMode();
}

function downloadFileFallback(file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
}

function initColorPicker() {
    els.colorPicker.innerHTML = '';
    let selectedColor = COLORS[0];
    COLORS.forEach(c => {
        const d = document.createElement('div');
        d.className = 'color-swatch';
        d.style.backgroundColor = c;
        if(c === selectedColor) d.classList.add('selected');
        d.onclick = () => {
            document.querySelectorAll('.color-swatch').forEach(el => el.classList.remove('selected'));
            d.classList.add('selected');
            selectedColor = c;
        };
        els.colorPicker.appendChild(d);
    });
}

function openFolderModal() {
    editingFolderId = null;
    els.folderModalTitle.textContent = '新規フォルダ';
    els.modalSaveBtn.textContent = '作成';
    els.newFolderName.value = '';
    
    els.overlay.classList.remove('hidden');
    els.folderModal.classList.remove('hidden');
    els.newFolderName.focus();
}

function openFolderRename(id, currentName) {
    editingFolderId = id;
    els.folderModalTitle.textContent = 'フォルダ名変更';
    els.modalSaveBtn.textContent = '変更';
    els.newFolderName.value = currentName;
    
    els.overlay.classList.remove('hidden');
    els.folderModal.classList.remove('hidden');
    els.newFolderName.focus();
}

function closeModal() {
    els.overlay.classList.add('hidden');
    els.folderModal.classList.add('hidden');
    els.moveModal.classList.add('hidden');
    els.replaceModal.classList.add('hidden');
    els.searchPanel.classList.add('hidden'); // パネルも閉じる
    // clearHighlights()は呼ばない（ハイライト維持のため）
}

function saveFolder() {
    const name = els.newFolderName.value.trim();
    if (!name) return;
    
    if (editingFolderId) {
        const f = folders.find(folder => folder.id === editingFolderId);
        if(f) f.name = name;
    } else {
        const color = document.querySelector('.color-swatch.selected').style.backgroundColor;
        folders.push({
            id: Date.now().toString(),
            name: name,
            color: color,
            createdAt: new Date().toISOString()
        });
    }
    saveData();
    closeModal();
}

function openFolderDetail(id) {
    currentFolderId = id;
    els.views.folderList.classList.remove('active');
    els.views.folderDetail.classList.add('active');
    els.backBtn.classList.remove('hidden');
    renderFolderDetail();
    saveAppState();
}

function openMoveModal() {
    if (selectedMemoIds.size === 0) return;
    els.overlay.classList.remove('hidden');
    els.moveModal.classList.remove('hidden');
    els.moveList.innerHTML = '';
    
    const liRoot = document.createElement('li');
    liRoot.textContent = '未分類 (フォルダなし)';
    liRoot.onclick = () => moveItems(null);
    els.moveList.appendChild(liRoot);

    folders.forEach(f => {
        const li = document.createElement('li');
        li.textContent = f.name;
        li.style.color = f.color;
        li.onclick = () => moveItems(f.id);
        els.moveList.appendChild(li);
    });
}

function moveItems(targetFolderId) {
    if (currentTab === 'folder' && !currentFolderId) {
        const targetFolders = folders.filter(f => selectedMemoIds.has(f.id));
        let moveCount = 0;
        targetFolders.forEach(srcFolder => {
            memos.forEach(m => {
                if (m.folderId === srcFolder.id) {
                    m.folderId = targetFolderId; 
                    moveCount++;
                }
            });
        });
        alert(`${moveCount}件のメモを移動しました`);
    } else {
        memos.forEach(m => {
            if (selectedMemoIds.has(m.id)) {
                m.folderId = targetFolderId;
                m.updatedAt = new Date().toISOString();
            }
        });
    }
    saveData();
    closeModal();
    toggleEditMode();
}

function toggleSort() {
    if (sortOrder === 'updated') sortOrder = 'created';
    else if (sortOrder === 'created') sortOrder = 'name';
    else sortOrder = 'updated';
    
    saveData();
    updateSortStatusText();
}

function updateSortStatusText() {
    const status = document.getElementById('sort-status');
    if(status) {
        if (sortOrder === 'updated') status.textContent = '更新日時順';
        else if (sortOrder === 'created') status.textContent = '作成日時順';
        else status.textContent = '名前順';
    }
}

function forceUpdateApp() {
    if(!confirm('アプリを最新版に更新し、再読み込みします。よろしいですか？')) return;
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function(registrations) {
            for(let registration of registrations) {
                registration.unregister();
            }
            window.location.reload(true);
        });
    } else {
        window.location.reload(true);
    }
}