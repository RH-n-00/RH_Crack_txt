// ==UserScript==
// @name         RH 크랙 로그 저장 (v1.0)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  v1.0 (Glassmorphism)
// @author       RH
// @match        https://crack.wrtn.ai/stories/*/episodes/*
// @grant        GM_xmlhttpRequest
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    const API_BASE = "https://crack-api.wrtn.ai";

    // ===================================================================================
    // PART 1: 데이터 수집 
    // ===================================================================================
    function getCookie(name) {
        const value = `; ${document.cookie}`; const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return decodeURIComponent(parts.pop().split(';').shift());
        return null;
    }

    function apiRequest(url, token) {
        const wrtnId = getCookie('__w_id');
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET", url: url,
                headers: { 'Authorization': `Bearer ${token}`, 'platform': 'web', 'x-wrtn-id': wrtnId || '' },
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300) {
                        try { const data = JSON.parse(res.responseText); resolve(data.data !== undefined ? data.data : data); }
                        catch (e) { reject(new Error("JSON 파싱 실패")); }
                    } else { reject(new Error(`API 오류: ${res.status}`)); }
                },
                onerror: () => reject(new Error("네트워크 오류"))
            });
        });
    }

    function getUrlInfo() {
        const m = window.location.pathname.match(/\/stories\/([a-f0-9]+)\/episodes\/([a-f0-9]+)/);
        return m ? { chatroomId: m[2] } : {};
    }

    async function fetchAllChatData() {
        const token = getCookie('access_token');
        const { chatroomId } = getUrlInfo();
        if (!token || !chatroomId) throw new Error('페이지 로딩 후 다시 시도해주세요.');

        const [chatInfo, msgData] = await Promise.all([
            apiRequest(`${API_BASE}/crack-gen/v3/chats/${chatroomId}`, token),
            apiRequest(`${API_BASE}/crack-gen/v3/chats/${chatroomId}/messages?limit=2000`, token)
        ]);

        const charName = chatInfo?.story?.title || chatInfo?.title || 'Character';

        return {
            title: chatInfo?.story?.title || chatInfo?.title || 'Unknown Chat',
            userNote: chatInfo?.story?.userNote?.content || '',
            charName: charName,
            messages: (msgData?.messages || []).reverse().map(m => ({
                role: m.role === 'assistant' ? 'assistant' : 'user',
                content: m.content
            }))
        };
    }

    function downloadFile(content, filename) {
        const b = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }

    // ===================================================================================
    // PART 2: TXT 생성 
    // ===================================================================================
    function generateTxtContent(chatData, includeNote, rangeStart, rangeEnd) {
        let txt = `제목: ${chatData.title}\n`;
        txt += `저장일시: ${new Date().toLocaleString()}\n`;
        
        const totalMsgs = chatData.messages.length;
        const start = rangeStart ? Math.max(1, rangeStart) : 1;
        const end = rangeEnd ? Math.min(totalMsgs, rangeEnd) : totalMsgs;
        txt += `저장범위: ${start} ~ ${end} (총 ${end - start + 1}개)\n`;

        if (includeNote && chatData.userNote) {
            txt += `\n\n[ 유저 노트 ]\n\n${chatData.userNote}\n`;
        }

        txt += `\n\n[ 대화 내용 ]\n\n`;

        const slicedMessages = chatData.messages.slice(start - 1, end);

        slicedMessages.forEach(msg => {
            const speakerName = (msg.role === 'user') ? 'user' : chatData.charName;
            txt += `—— ${speakerName} ——\n`;
            txt += `${msg.content}\n\n\n`; 
        });

        return txt;
    }

    // ===================================================================================
    // PART 3: UI
    // ===================================================================================
    
    function makeDraggable(element) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        
        element.onmousedown = dragMouseDown;
        element.ontouchstart = dragMouseDown;

        function dragMouseDown(e) {
            // 버튼이나 인풋 클릭 시 드래그 방지 (중요)
            if (e.target.tagName === 'INPUT' || (e.target.tagName === 'BUTTON' && e.target.id !== 'rh-main-toggle')) {
                return;
            }
            
            e = e || window.event;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            pos3 = clientX;
            pos4 = clientY;
            
            document.onmouseup = closeDragElement;
            document.ontouchend = closeDragElement;
            document.onmousemove = elementDrag;
            document.ontouchmove = elementDrag;
        }

        function elementDrag(e) {
            e = e || window.event;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            pos1 = pos3 - clientX;
            pos2 = pos4 - clientY;
            pos3 = clientX;
            pos4 = clientY;

            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
            document.ontouchend = null;
            document.ontouchmove = null;
        }
    }

    function createFloatingPanel() {
        if (document.getElementById('crack-saver-panel')) return;

        // --- CSS 스타일 정의 (인라인으로 적용하여 충돌 방지) ---
        const fontStyle = "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;";
        const glassStyle = "background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.5); box-shadow: 0 8px 32px rgba(0,0,0,0.12);";
        const inputStyle = "width: 100%; padding: 8px 12px; background: #F2F2F7; border: none; border-radius: 8px; font-size: 13px; outline: none; color: #1c1c1e;";
        const btnStyle = "cursor: pointer; border: none; font-weight: 600; transition: all 0.2s;";

        const panel = document.createElement('div');
        panel.id = 'crack-saver-panel';
        panel.style.cssText = `position: fixed; top: 20px; left: 20px; z-index: 99999; display: flex; flex-direction: column; gap: 12px; align-items: flex-start; ${fontStyle} touch-action: none;`;

        // sub 패널
        const subPanel = document.createElement('div');
        subPanel.style.cssText = `display: none; flex-direction: column; gap: 15px; ${glassStyle} padding: 20px; border-radius: 20px; min-width: 240px; animation: fadeIn 0.2s ease-out;`;

        // check 생성
        const createCheckbox = (id, labelText, checked = true) => {
            const wrap = document.createElement('label');
            wrap.style.cssText = `display: flex; align-items: center; gap: 10px; font-size: 13px; color: #1c1c1e; cursor: pointer; user-select: none; font-weight: 500;`;
            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.id = id;
            chk.checked = checked;
            chk.style.accentColor = "#007AFF"; // Apple Blue
            wrap.appendChild(chk);
            wrap.appendChild(document.createTextNode(labelText));
            return { wrap, chk };
        };

        const createInput = (placeholder, id, width = '100%') => {
            const input = document.createElement('input');
            input.id = id;
            input.placeholder = placeholder;
            input.style.cssText = inputStyle + `width: ${width};`;
            return input;
        };

        const noteOpt = createCheckbox('opt-note', 'User Note 포함');

        // srch area
        const searchContainer = document.createElement('div');
        searchContainer.style.cssText = `display: flex; gap: 8px;`;
        const searchInput = createInput('단어 검색...', 'search-input');
        const searchBtn = document.createElement('button');
        // 돋보기 아이콘 (SVG)
        searchBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:#1c1c1e"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
        searchBtn.style.cssText = `${btnStyle} background: #E5E5EA; border-radius: 8px; width: 36px; display: flex; align-items: center; justify-content: center;`;
        
        const searchResult = document.createElement('div');
        searchResult.style.cssText = `font-size: 12px; color: #007AFF; background: rgba(0,122,255,0.1); padding: 10px; border-radius: 8px; margin-top: 5px; display: none; line-height: 1.4;`;

        searchBtn.onclick = async () => {
            const keyword = searchInput.value.trim();
            if (!keyword) return;
            searchBtn.style.opacity = '0.5';
            try {
                const data = await fetchAllChatData();
                const foundIndices = [];
                data.messages.forEach((msg, idx) => {
                    if (msg.content.includes(keyword)) foundIndices.push(idx + 1);
                });
                searchResult.style.display = 'block';
                if (foundIndices.length > 0) {
                    searchResult.innerHTML = `Found "<b>${keyword}</b>":<br>${foundIndices.join(', ')}<br><span style="opacity:0.7">Total: ${foundIndices.length}</span>`;
                } else {
                    searchResult.innerHTML = `Not found: "${keyword}"`;
                }
            } catch (e) { alert('Data Load Error'); }
            searchBtn.style.opacity = '1';
        };
        searchContainer.appendChild(searchInput);
        searchContainer.appendChild(searchBtn);

        // 구간 영역
        const rangeContainer = document.createElement('div');
        rangeContainer.style.cssText = `display: flex; gap: 8px; align-items: center;`;
        const startInput = createInput('Start (1)', 'range-start');
        startInput.type = 'number';
        const endInput = createInput('End (All)', 'range-end');
        endInput.type = 'number';
        const rangeSep = document.createElement('span');
        rangeSep.innerText = '~';
        rangeSep.style.color = '#8e8e93';
        
        rangeContainer.appendChild(startInput);
        rangeContainer.appendChild(rangeSep);
        rangeContainer.appendChild(endInput);

        // 저장 버튼 (검은색 min 버튼)
        const txtBtn = document.createElement('button');
        txtBtn.innerText = 'Save as TXT';
        txtBtn.style.cssText = `${btnStyle} width: 100%; padding: 12px; margin-top: 5px; background: #1c1c1e; color: #fff; border-radius: 10px; font-size: 14px; box-shadow: 0 4px 10px rgba(0,0,0,0.1);`;
        
        txtBtn.onmouseover = () => txtBtn.style.transform = 'scale(1.02)';
        txtBtn.onmouseout = () => txtBtn.style.transform = 'scale(1)';
        txtBtn.onclick = async () => {
            const originalText = txtBtn.innerText;
            txtBtn.innerText = 'Processing...';
            txtBtn.style.opacity = '0.7';
            try {
                const data = await fetchAllChatData();
                const useNote = noteOpt.chk.checked;
                const sVal = parseInt(startInput.value);
                const eVal = parseInt(endInput.value);
                const finalTxt = generateTxtContent(data, useNote, isNaN(sVal)?null:sVal, isNaN(eVal)?null:eVal);
                const safeTitle = data.title.replace(/[\\/:*?"<>|]/g, "").trim();
                downloadFile(finalTxt, `${safeTitle}.txt`);
                txtBtn.innerText = 'Done';
            } catch (e) { alert('Error: ' + e.message); txtBtn.innerText = 'Failed'; }
            setTimeout(() => { txtBtn.innerText = originalText; txtBtn.style.opacity = '1'; }, 2000);
        };

        // 섹션 제목 헬퍼
        const createHeader = (text) => {
            const div = document.createElement('div');
            div.innerText = text;
            div.style.cssText = "font-size: 11px; font-weight: 600; color: #8e8e93; text-transform: uppercase; letter-spacing: 0.5px;";
            return div;
        };

        subPanel.appendChild(createHeader('Options'));
        subPanel.appendChild(noteOpt.wrap);
        subPanel.appendChild(document.createElement('div')).style.cssText = "height: 1px; background: rgba(0,0,0,0.05); width: 100%;"; // Divider
        
        subPanel.appendChild(createHeader('Search'));
        subPanel.appendChild(searchContainer);
        subPanel.appendChild(searchResult);
        
        subPanel.appendChild(createHeader('Range'));
        subPanel.appendChild(rangeContainer);
        
        subPanel.appendChild(txtBtn);

        // 메인 토글 버튼 (아이콘 교체)
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'rh-main-toggle'; // 드래그 식별용 ID
        // 저장 아이콘 SVG
        const iconSave = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`;
        // 닫기 아이콘 SVG
        const iconClose = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
        
        toggleBtn.innerHTML = iconSave;
        toggleBtn.style.cssText = `${btnStyle} background: #1c1c1e; color: white; border-radius: 50%; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.15);`;
        
        toggleBtn.onmouseover = () => toggleBtn.style.transform = 'scale(1.05)';
        toggleBtn.onmouseout = () => toggleBtn.style.transform = 'scale(1)';
        
        toggleBtn.onclick = () => {
            const isHidden = subPanel.style.display === 'none';
            subPanel.style.display = isHidden ? 'flex' : 'none';
            toggleBtn.innerHTML = isHidden ? iconClose : iconSave;
        };

        panel.appendChild(toggleBtn);
        panel.appendChild(subPanel);
        document.body.appendChild(panel);

        // 드래그 적용
        makeDraggable(panel);
    }

    createFloatingPanel();
    setTimeout(createFloatingPanel, 1000);
    setInterval(createFloatingPanel, 3000);

})();
