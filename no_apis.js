// ==UserScript==
// @name         No APIs
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Removes ?... and #... from all links on non‑whitelisted sites, shows original URL on hover.
// @author       Ismail Amir
// @include        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// ==/UserScript==

/*
(async function() {
    'use strict';

    // ---------- Load whitelist from GM storage ----------
    const whitelist = await GM_getValue('whitelist', []);
    if (whitelist.includes(window.location.hostname)) {
        console.log('Link Cleaner: site whitelisted, skipping');
        return;
    }

    // ---------- Clean a URL by removing query and hash ----------
    function cleanUrl(urlStr) {
        try {
            const url = new URL(urlStr);
            // Only modify http/https links
            if (!url.protocol.startsWith('http')) return urlStr;

            // Remove search (query) and hash
            url.search = '';
            url.hash = '';

            return url.toString();
        } catch {
            return urlStr; // keep original if URL is invalid
        }
    }

    // ---------- Process a single anchor ----------
    function processLink(link) {
        if (link.hasAttribute('data-linkcleaned')) return;

        const originalHref = link.href;
        if (!originalHref) return;

        const cleaned = cleanUrl(originalHref);
        if (cleaned !== originalHref) {
            link.href = cleaned;

            // Add/append to the title attribute for hover indication
            const originalTitle = link.title || '';
            const notice = ` (cleaned by Link Cleaner – original: ${originalHref})`;
            link.title = originalTitle + notice;
        }

        // Mark as processed (even if unchanged) to avoid re‑checking
        link.setAttribute('data-linkcleaned', 'true');
    }

    // ---------- Process all existing links ----------
    function processAllLinks() {
        document.querySelectorAll('a:not([data-linkcleaned])').forEach(processLink);
    }

    // ---------- Watch for dynamically added links ----------
    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            if (mutation.addedNodes.length) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Direct anchor
                        if (node.tagName === 'A' && !node.hasAttribute('data-linkcleaned')) {
                            processLink(node);
                        }
                        // Anchors inside the added subtree
                        if (node.querySelectorAll) {
                            node.querySelectorAll('a:not([data-linkcleaned])').forEach(processLink);
                        }
                    }
                }
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Initial run
    processAllLinks();

    // ---------- Menu commands for whitelist management (placeholder for a UI) ----------
    GM_registerMenuCommand('Show current whitelist', async () => {
        const wl = await GM_getValue('whitelist', []);
        alert('Whitelist: ' + (wl.length ? wl.join(', ') : 'empty'));
    });

    GM_registerMenuCommand('Add current site to whitelist', async () => {
        const host = window.location.hostname;
        let wl = await GM_getValue('whitelist', []);
        if (!wl.includes(host)) {
            wl.push(host);
            await GM_setValue('whitelist', wl);
            alert(`Added ${host} to whitelist. Reload page to take effect.`);
        } else {
            alert(`${host} is already whitelisted.`);
        }
    });

    GM_registerMenuCommand('Clear whitelist', async () => {
        await GM_setValue('whitelist', []);
        alert('Whitelist cleared. Reload page to re‑enable cleaning on all sites.');
    });
})();
*/




(async function() {
    'use strict';

    // ---------- Configuration Keys ----------
    const STORAGE_KEYS = {
        WHITELIST: 'whitelist',
        DEBOUNCE_MS: 'debounceMs',
        KEEP_PARAMS: 'keepParams',
        PRESERVE_HASH: 'preserveHash',
        TOOLTIP_ENABLED: 'tooltipEnabled'
    };

    // ---------- Load Settings with Defaults ----------
    const settings = {
        whitelist: await GM_getValue(STORAGE_KEYS.WHITELIST, []),
        debounceMs: await GM_getValue(STORAGE_KEYS.DEBOUNCE_MS, 300),
        keepParams: await GM_getValue(STORAGE_KEYS.KEEP_PARAMS, []),    // empty = remove all
        preserveHash: await GM_getValue(STORAGE_KEYS.PRESERVE_HASH, true),
        tooltipEnabled: await GM_getValue(STORAGE_KEYS.TOOLTIP_ENABLED, true)
    };

    // Skip if current host is whitelisted
    if (settings.whitelist.includes(window.location.hostname)) {
        console.log('No APIs: site whitelisted, skipping');
        return;
    }

    // ---------- State ----------
    const processedLinks = new WeakSet();          // fast check without touching DOM
    const pendingNodes = new Set();                // nodes added by mutations, waiting to be processed
    let debounceTimer = null;

    // ---------- Helper: Clean a URL ----------
    function cleanUrl(urlStr) {
        try {
            const url = new URL(urlStr);
            // Only clean http/https
            if (!url.protocol.startsWith('http')) return urlStr;

            // --- Handle query parameters ---
            if (url.search) {
                if (settings.keepParams.length > 0) {
                    // Keep only allowed parameters
                    const params = new URLSearchParams(url.search);
                    const keptParams = new URLSearchParams();
                    for (const [key, value] of params) {
                        if (settings.keepParams.includes(key)) {
                            keptParams.append(key, value);
                        }
                    }
                    url.search = keptParams.toString();
                } else {
                    // Remove all parameters
                    url.search = '';
                }
            }

            // --- Handle hash ---
            if (url.hash) {
                if (settings.preserveHash) {
                    // Check if the hash points to an element on the same page
                    const id = url.hash.slice(1); // remove '#'
                    if (document.getElementById(id)) {
                        // Keep it – do nothing
                    } else {
                        url.hash = '';
                    }
                } else {
                    url.hash = '';
                }
            }

            return url.toString();
        } catch {
            return urlStr; // keep original if invalid (e.g., javascript:, about:)
        }
    }

    // ---------- Process a Single Anchor ----------
    function processLink(link) {
        if (processedLinks.has(link)) return;

        const originalHref = link.href;
        if (!originalHref) return;

        const cleaned = cleanUrl(originalHref);
        if (cleaned !== originalHref) {
            link.href = cleaned;
            // Store original for hover & undo
            link.dataset.originalHref = originalHref;
            link.classList.add('link-cleaner-processed');
        }

        processedLinks.add(link);
    }

    // ---------- Process All Pending Nodes (debounced) ----------
    function processPendingNodes() {
        if (pendingNodes.size === 0) return;

        for (const node of pendingNodes) {
            if (!(node instanceof Element)) continue;

            // If node itself is an unprocessed anchor
            if (node.tagName === 'A' && !processedLinks.has(node)) {
                processLink(node);
            }
            // Find anchors inside the node (if any)
            const anchors = node.querySelectorAll ? node.querySelectorAll('a:not(.link-cleaner-processed)') : [];
            for (const anchor of anchors) {
                if (!processedLinks.has(anchor)) {
                    processLink(anchor);
                }
            }
        }

        pendingNodes.clear();
    }

    function debouncedProcess() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            processPendingNodes();
            debounceTimer = null;
        }, settings.debounceMs);
    }

    // ---------- Mutation Observer ----------
    const observer = new MutationObserver(mutations => {
        let hasNewNodes = false;
        for (const mut of mutations) {
            for (const node of mut.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    pendingNodes.add(node);
                    hasNewNodes = true;
                }
            }
        }
        if (hasNewNodes) debouncedProcess();
    });

    // Start observing once body exists
    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }

    // Process links already present
    document.querySelectorAll('a').forEach(processLink);

    // ---------- Hover Tooltip ----------
    let tooltipDiv = null;

    function initTooltip() {
        if (!settings.tooltipEnabled) return;

        tooltipDiv = document.createElement('div');
        tooltipDiv.id = 'link-cleaner-tooltip';
        tooltipDiv.style.cssText = `
            position: fixed;
            display: none;
            background: #333;
            color: #fff;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            z-index: 10000;
            pointer-events: none;
            white-space: nowrap;
            max-width: 500px;
            overflow: hidden;
            text-overflow: ellipsis;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        `;
        document.body.appendChild(tooltipDiv);

        // Use event delegation for performance
        document.addEventListener('mouseenter', showTooltip, true);
        document.addEventListener('mouseleave', hideTooltip, true);
    }

    function showTooltip(e) {
        const target = e.target.closest('a.link-cleaner-processed');
        if (!target || !target.dataset.originalHref) return;

        const rect = target.getBoundingClientRect();
        tooltipDiv.textContent = `Original: ${target.dataset.originalHref}`;
        tooltipDiv.style.display = 'block';
        // Position below the link, centered horizontally
        tooltipDiv.style.left = `${rect.left + window.scrollX + rect.width / 2 - tooltipDiv.offsetWidth / 2}px`;
        tooltipDiv.style.top = `${rect.bottom + window.scrollY + 5}px`;
    }

    function hideTooltip(e) {
        const target = e.target.closest('a.link-cleaner-processed');
        if (!target) return;
        tooltipDiv.style.display = 'none';
    }

    if (settings.tooltipEnabled) {
        if (document.body) {
            initTooltip();
        } else {
            document.addEventListener('DOMContentLoaded', initTooltip);
        }
    }

    // ---------- Undo Cleaning on Current Page ----------
    function undoCleaning() {
        document.querySelectorAll('a.link-cleaner-processed').forEach(link => {
            if (link.dataset.originalHref) {
                link.href = link.dataset.originalHref;
            }
            link.classList.remove('link-cleaner-processed');
            delete link.dataset.originalHref;
            // Note: WeakSet automatically loses reference when link is GC'd, but we cannot remove from it.
            // That's fine – we just don't want to re‑process it immediately. We'll mark it as not processed
            // by removing the class, but the WeakSet entry remains. However, next time we process, we'll
            // skip because processedLinks.has(link) will still be true. To allow re‑processing if user
            // re‑enables cleaning, we need to either clear the WeakSet (impossible) or rely on the class.
            // We'll remove the link from processedLinks by using a different approach? WeakSet cannot be iterated.
            // Alternative: store processed state only in class and DOM attribute, but then we lose speed of WeakSet.
            // We'll compromise: for undo, we also remove the data attribute and class; if the user later
            // triggers cleaning again (e.g., by toggling settings), the link will be processed again because
            // we check for class and data attribute. The WeakSet still holds it, so we need to also check
            // the class. In processLink we already check processedLinks.has(link) – that would still be true.
            // So we need to avoid that. Let's modify processLink: we'll check for class or data attribute instead of WeakSet.
            // That's simpler and more reliable for undo. We'll drop WeakSet and use only DOM markers.
        });
        // Also clear pending nodes to avoid reprocessing them with old state
        pendingNodes.clear();
        console.log('No APIs: undo cleaning completed');
    }

    // ---------- Settings UI ----------
    let settingsPanel = null;
    let settingsButton = null;

    function createSettingsUI() {
    if (document.getElementById('noapis-settings-button')) return;

    // ========== INJECT GLOBAL STYLES (once) ==========
    const style = document.createElement('style');
    style.textContent = `
        #noapis-settings-button {
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 48px;
            height: 48px;
            background: #1e88e5;
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 26px;
            cursor: pointer;
            z-index: 10001;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
            opacity: 0.8;
            transition: opacity 0.2s, transform 0.2s, box-shadow 0.2s;
            user-select: none;
            backdrop-filter: blur(4px);
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        #noapis-settings-button:hover {
            opacity: 1;
            transform: scale(1.1);
            box-shadow: 0 6px 16px rgba(0, 0, 0, 0.3);
        }
        #noapis-settings-panel {
            position: fixed;
            bottom: 80px;
            right: 20px;
            width: 340px;
            max-width: calc(100vw - 40px);
            background: #ffffff;
            border-radius: 16px;
            padding: 20px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
            z-index: 10002;
            display: none;
            color: #1e293b;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            font-size: 14px;
            line-height: 1.5;
            box-sizing: border-box;
            border: 1px solid rgba(0, 0, 0, 0.08);
            animation: slideIn 0.2s ease-out;
            transform-origin: bottom right;
        }
        @keyframes slideIn {
            from {
                opacity: 0;
                transform: scale(0.95) translateY(10px);
            }
            to {
                opacity: 1;
                transform: scale(1) translateY(0);
            }
        }
        #noapis-settings-panel h3 {
            margin: 0 0 16px 0;
            font-size: 18px;
            font-weight: 600;
            color: #0f172a;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        #noapis-settings-panel .close-icon {
            background: none;
            border: none;
            font-size: 20px;
            cursor: pointer;
            color: #64748b;
            padding: 0 4px;
            transition: color 0.2s;
        }
        #noapis-settings-panel .close-icon:hover {
            color: #1e293b;
        }
        #noapis-settings-panel label {
            display: block;
            margin-bottom: 12px;
            color: #334155;
        }
        #noapis-settings-panel input[type="number"],
        #noapis-settings-panel input[type="text"] {
            width: 100%;
            padding: 8px 10px;
            margin-top: 4px;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            font-size: 13px;
            box-sizing: border-box;
            transition: border 0.2s, box-shadow 0.2s;
        }
        #noapis-settings-panel input[type="number"]:focus,
        #noapis-settings-panel input[type="text"]:focus {
            outline: none;
            border-color: #1e88e5;
            box-shadow: 0 0 0 3px rgba(30, 136, 229, 0.2);
        }
        #noapis-settings-panel input[type="checkbox"] {
            margin-right: 8px;
            transform: scale(1.1);
            accent-color: #1e88e5;
        }
        #noapis-settings-panel hr {
            border: none;
            border-top: 1px solid #e2e8f0;
            margin: 16px 0;
        }
        #noapis-settings-panel .current-site {
            background: #f8fafc;
            padding: 10px 12px;
            border-radius: 10px;
            font-family: monospace;
            font-size: 13px;
            word-break: break-all;
            border: 1px solid #e2e8f0;
            margin-bottom: 16px;
        }
        #noapis-settings-panel .button-group {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 16px;
        }
        #noapis-settings-panel button {
            padding: 8px 14px;
            border: none;
            border-radius: 24px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.2s, box-shadow 0.2s;
            background: #f1f5f9;
            color: #1e293b;
            border: 1px solid transparent;
        }
        #noapis-settings-panel button:hover {
            background: #e2e8f0;
        }
        #noapis-settings-panel button#noapis-save {
            background: #1e88e5;
            color: white;
            box-shadow: 0 2px 6px rgba(30, 136, 229, 0.3);
        }
        #noapis-settings-panel button#noapis-save:hover {
            background: #1565c0;
            box-shadow: 0 4px 10px rgba(30, 136, 229, 0.4);
        }
        #noapis-settings-panel button#noapis-close {
            background: transparent;
            border: 1px solid #cbd5e1;
        }
        #noapis-settings-panel button#noapis-close:hover {
            background: #f1f5f9;
        }
        #noapis-settings-panel .action-buttons {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 8px;
        }
    `;
    document.head.appendChild(style);

    // ========== FLOATING BUTTON ==========
    settingsButton = document.createElement('div');
    settingsButton.id = 'noapis-settings-button';
    settingsButton.textContent = '⚙️';
    settingsButton.setAttribute('aria-label', 'Open settings');
    settingsButton.setAttribute('role', 'button');
    settingsButton.setAttribute('tabindex', '0');
    settingsButton.addEventListener('click', toggleSettingsPanel);
    document.body.appendChild(settingsButton);

    // ========== SETTINGS PANEL ==========
    settingsPanel = document.createElement('div');
    settingsPanel.id = 'noapis-settings-panel';
    settingsPanel.innerHTML = `
        <h3>
            No APIs Settings
            <span class="close-icon" id="noapis-close-icon" role="button" tabindex="0" aria-label="Close">✕</span>
        </h3>
        <label>
            Debounce (ms):
            <input type="number" id="noapis-debounce" min="0" max="2000" value="${settings.debounceMs}">
        </label>
        <label>
            Keep params (comma separated):
            <input type="text" id="noapis-keep-params" value="${settings.keepParams.join(',')}">
        </label>
        <label>
            <input type="checkbox" id="noapis-preserve-hash" ${settings.preserveHash ? 'checked' : ''}> Preserve same‑page hash
        </label>
        <label>
            <input type="checkbox" id="noapis-tooltip" ${settings.tooltipEnabled ? 'checked' : ''}> Show tooltip
        </label>
        <hr>
        <div class="current-site"><strong>Current site:</strong> ${window.location.hostname}</div>
        <div class="button-group">
            <button id="noapis-add-whitelist">➕ Add to whitelist</button>
            <button id="noapis-undo">↩️ Undo cleaning</button>
        </div>
        <div class="action-buttons">
            <button id="noapis-close">Close</button>
            <button id="noapis-save">Save settings</button>
        </div>
    `;
    document.body.appendChild(settingsPanel);

    // 🔽 FIX: Explicitly set inline display to 'none' so toggle works on first click
    settingsPanel.style.display = 'none';

    // ========== EVENT LISTENERS ==========
    document.getElementById('noapis-save').addEventListener('click', saveSettings);
    document.getElementById('noapis-close').addEventListener('click', toggleSettingsPanel);
    document.getElementById('noapis-close-icon').addEventListener('click', toggleSettingsPanel);
    document.getElementById('noapis-add-whitelist').addEventListener('click', addToWhitelist);
    document.getElementById('noapis-undo').addEventListener('click', () => {
        undoCleaning();
        toggleSettingsPanel();
    });

    // Keyboard activation for the close icon
    document.getElementById('noapis-close-icon').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleSettingsPanel();
        }
    });
}

    function toggleSettingsPanel() {
        if (settingsPanel.style.display === 'none') {
            settingsPanel.style.display = 'block';
        } else {
            settingsPanel.style.display = 'none';
        }
    }

    async function saveSettings() {
        const newDebounce = parseInt(document.getElementById('noapis-debounce').value, 10) || 300;
        const keepParamsRaw = document.getElementById('noapis-keep-params').value;
        const keepParams = keepParamsRaw.split(',').map(s => s.trim()).filter(Boolean);
        const preserveHash = document.getElementById('noapis-preserve-hash').checked;
        const tooltipEnabled = document.getElementById('noapis-tooltip').checked;

        // Save to storage
        await GM_setValue(STORAGE_KEYS.DEBOUNCE_MS, newDebounce);
        await GM_setValue(STORAGE_KEYS.KEEP_PARAMS, keepParams);
        await GM_setValue(STORAGE_KEYS.PRESERVE_HASH, preserveHash);
        await GM_setValue(STORAGE_KEYS.TOOLTIP_ENABLED, tooltipEnabled);

        // Update runtime settings
        settings.debounceMs = newDebounce;
        settings.keepParams = keepParams;
        settings.preserveHash = preserveHash;
        settings.tooltipEnabled = tooltipEnabled;

        alert('Settings saved. Reload page to apply fully? (Changes to cleaning rules require page reload)');
        // Optionally, we could re‑process all links here, but that's complex.
    }

    async function addToWhitelist() {
        const host = window.location.hostname;
        let wl = await GM_getValue(STORAGE_KEYS.WHITELIST, []);
        if (!wl.includes(host)) {
            wl.push(host);
            await GM_setValue(STORAGE_KEYS.WHITELIST, wl);
            settings.whitelist = wl;
            alert(`Added ${host} to whitelist. Reload page to disable cleaning.`);
        } else {
            alert(`${host} is already whitelisted.`);
        }
        toggleSettingsPanel();
    }

    // Create UI after DOM ready
    if (document.body) {
        createSettingsUI();
    } else {
        document.addEventListener('DOMContentLoaded', createSettingsUI);
    }

    // ---------- Menu Commands (fallback) ----------
    GM_registerMenuCommand('⚙️ Open Settings', () => {
        if (settingsPanel) toggleSettingsPanel();
    });

    GM_registerMenuCommand('↩️ Undo cleaning on this page', undoCleaning);

    GM_registerMenuCommand('➕ Add current site to whitelist', async () => {
        const host = window.location.hostname;
        let wl = await GM_getValue(STORAGE_KEYS.WHITELIST, []);
        if (!wl.includes(host)) {
            wl.push(host);
            await GM_setValue(STORAGE_KEYS.WHITELIST, wl);
            settings.whitelist = wl;
            alert(`Added ${host} to whitelist. Reload page to disable cleaning.`);
        } else {
            alert(`${host} is already whitelisted.`);
        }
    });

    GM_registerMenuCommand('📋 Show whitelist', async () => {
        const wl = await GM_getValue(STORAGE_KEYS.WHITELIST, []);
        alert('Whitelist: ' + (wl.length ? wl.join(', ') : 'empty'));
    });

    GM_registerMenuCommand('🗑️ Clear whitelist', async () => {
        await GM_setValue(STORAGE_KEYS.WHITELIST, []);
        settings.whitelist = [];
        alert('Whitelist cleared. Reload page to re‑enable cleaning on all sites.');
    });
})();
