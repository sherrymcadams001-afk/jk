// static/app.js - SMTP2GO Sender Pro Frontend Logic
document.addEventListener('DOMContentLoaded', function() {
  // --- Globals ---
  let uploadedRecipients = [];
  let availableVariables = [];
  let bulkSendJobId = null;
  let statusPollInterval = null;
  const MAX_DISPLAY_FAILED_EMAILS = 100;

  // Central element registry
  const elements = {
    singleTab: document.getElementById('tab-single'),
    bulkTab: document.getElementById('tab-bulk'),
    singlePanel: document.getElementById('panel-single'),
    bulkPanel: document.getElementById('panel-bulk'),
    singleForm: document.getElementById('single-email-form'),
    bulkForm: document.getElementById('bulk-email-form'),
    sendSingleEmailButton: document.getElementById('send-single-email'),
    sendBulkEmailButton: document.getElementById('send-bulk-email'),
    fileUploadInput: document.getElementById('recipient-file-input'),
    fileUploadArea: document.getElementById('file-drop-area'),
    clearFileButton: document.getElementById('clear-file-button'),
    intervalSlider: document.getElementById('interval-slider'),
    intervalValueSpan: document.getElementById('interval-value'),
    progressSection: document.getElementById('bulk-progress-section'),
    progressBar: document.getElementById('bulk-progress-bar'),
    progressStatus: document.getElementById('bulk-progress-status'),
    sendingIndicator: document.getElementById('sending-indicator'),
    statTotal: document.getElementById('stat-total'),
    statSuccess: document.getElementById('stat-success'),
    statFailed: document.getElementById('stat-failed'),
    completionTimeSpan: document.getElementById('completion-time'),
    failedEmailsSection: document.getElementById('failed-emails-section'),
    toggleFailedListButton: document.getElementById('toggle-failed-list'),
    failedCountDisplay: document.getElementById('failed-count-display'),
    failedEmailsList: document.getElementById('failed-emails-list'),
    statusMessageContainer: document.getElementById('status-message-container'),
    currentYearSpan: document.getElementById('current-year')
  };

    // --- Initial Setup ---
    if (!validateElements()) return;
  setupEventListeners();
  switchTab('single');
  createStarBackground();
  updateFooterYear();
  handleIntervalChange();
  loadScheduledFromStorage();
  renderHistorySidebar();

    // --- Element Validation ---
    function validateElements() {
        const criticalElements = [
            elements.singleTab, elements.bulkTab, elements.singlePanel, elements.bulkPanel, // Check panels
            elements.singleForm, elements.bulkForm, elements.fileUploadInput, elements.sendSingleEmailButton,
            elements.sendBulkEmailButton, elements.progressSection, elements.statusMessageContainer
        ];
        if (criticalElements.some(el => !el)) {
            console.error("CRITICAL ERROR: Essential UI elements are missing. App init failed.");
            document.body.innerHTML = '<div style="color: red; padding: 20px;">Error: Application failed to load components.</div>';
            return false;
        }
        return true;
    }

    // --- Event Listeners Setup ---
    function setupEventListeners() {
        elements.singleTab?.addEventListener('click', () => switchTab('single'));
        elements.bulkTab?.addEventListener('click', () => switchTab('bulk'));
        elements.intervalSlider?.addEventListener('input', handleIntervalChange);
        elements.fileUploadInput?.addEventListener('change', handleFileUpload);
        elements.fileUploadArea?.addEventListener('click', () => elements.fileUploadInput?.click());
        elements.fileUploadArea?.addEventListener('keydown', (e) => { if(['Enter',' '].includes(e.key)){ e.preventDefault(); elements.fileUploadInput?.click(); }});
        elements.clearFileButton?.addEventListener('click', () => resetFileUploadUI());
        elements.sendSingleEmailButton?.addEventListener('click', handleSendSingleEmail);
        elements.sendBulkEmailButton?.addEventListener('click', handleSendBulkEmail);
        elements.toggleFailedListButton?.addEventListener('click', toggleFailedEmailsList);
        elements.singleForm?.addEventListener('submit', e => e.preventDefault());
        elements.bulkForm?.addEventListener('submit', e => e.preventDefault());
        window.addEventListener('resize', debounce(createStarBackground, 300));
        // Scheduling preset buttons
        document.querySelectorAll('.preset-btn').forEach(btn => btn.addEventListener('click', () => applySchedulePreset(btn.dataset.offset)));

        const el = (id) => document.getElementById(id);
          const E = {
            singleTab: el('tab-single'), bulkTab: el('tab-bulk'),
            singlePanel: el('panel-single'), bulkPanel: el('panel-bulk'),
            singleForm: el('single-email-form'), bulkForm: el('bulk-email-form'),
            sendSingleBtn: el('send-single-email'), sendBulkBtn: el('send-bulk-email'),
            fileInput: el('recipient-file-input'), fileArea: el('file-drop-area'), clearFileBtn: el('clear-file-button'),
            intervalSlider: el('interval-slider'), intervalValue: el('interval-value'),
            progressSection: el('bulk-progress-section'), progressBar: el('bulk-progress-bar'),
            progressText: el('bulk-progress-text'), progressCount: el('bulk-progress-count'), currentRecipient: el('current-recipient'),
            sendingIndicator: el('sending-indicator'), statTotal: el('stat-total'), statSuccess: el('stat-success'), statFailed: el('stat-failed'),
            completionTime: el('completion-time'),
            failedSection: el('failed-emails-section'), failedList: el('failed-emails-list'), failedToggle: el('toggle-failed-list'), failedCount: el('failed-count-display'),
            statusContainer: el('status-message-container'), year: el('current-year'),
            historySidebar: el('history-sidebar')
          };

          window.beaconState = window.beaconState || { scheduled: [], history: [] };

          // --- Validation ---
          function validateEssential() {
            const needed = [E.singleTab, E.bulkTab, E.singlePanel, E.bulkPanel, E.singleForm, E.bulkForm, E.sendSingleBtn, E.sendBulkBtn, E.statusContainer];
            if (needed.some(n => !n)) {
              console.error('Essential elements missing – abort init');
              return false;
            }
            return true;
          }

          // --- Listeners ---
          function debounce(fn, wait){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),wait); }; }

          // --- Tabs ---
          function switchTab(name){
            const isSingle = name==='single';
            clearAllStatusMessages();
            E.singlePanel.classList.toggle('hidden', !isSingle);
            E.bulkPanel.classList.toggle('hidden', isSingle);
            if (!isSingle && bulkSendJobId) E.progressSection?.classList.remove('hidden'); else E.progressSection?.classList.add('hidden');
          }

          // --- Interval Slider ---
          function handleIntervalChange(){
            if (E.intervalSlider && E.intervalValue) E.intervalValue.textContent = `${E.intervalSlider.value}s`;
          }

          // --- Single Send ---
          async function handleSendSingleEmail(){
            clearAllStatusMessages();
            if (!E.singleForm) return;
            const formData = new FormData(E.singleForm);
            if (!formData.get('to_email')) { showStatusMessage('Recipient email required','error'); return; }
            if (!formData.get('subject')) { showStatusMessage('Subject required','error'); return; }
            // Scheduling
            const scheduleAt = document.getElementById('schedule-datetime')?.value;
            if (scheduleAt) {
              const when = new Date(scheduleAt).getTime();
              if (!isNaN(when) && when > Date.now() + 5000) { // require at least 5s future
                enqueueScheduled({ id: Date.now().toString(36), to: formData.get('to_email'), subject: formData.get('subject'), provider: 'smtp2go', scheduledAt: when, status:'scheduled' });
                showStatusMessage('Email scheduled.', 'success');
                renderHistorySidebar();
                return; // do not send immediately
              } else {
                showStatusMessage('Invalid schedule time (must be >5s future). Sending now.', 'warning');
              }
            }
            setButtonLoading(E.sendSingleBtn,true,'Sending...');
            try {
              const res = await fetch('/api/send-email',{method:'POST',body:formData});
              const data = await res.json().catch(()=>({}));
              if(res.ok && data.success){
                showStatusMessage(data.message||'Email sent','success');
                recordHistory({ to: formData.get('to_email'), subject: formData.get('subject'), provider: data.provider||'smtp2go', status:'sent' });
              } else {
                showStatusMessage(`Failed: ${data.error||res.status}`,'error');
                recordHistory({ to: formData.get('to_email'), subject: formData.get('subject'), provider: data.provider||'smtp2go', status:'failed' });
              }
            } catch(err){
              console.error(err); showStatusMessage('Network error','error');
            } finally {
              setButtonLoading(E.sendSingleBtn,false,'Send Email');
              renderHistorySidebar();
            }
          }

          // --- File Upload (Bulk Recipients) ---
          async function handleFileUpload(e){
            const input = e.target; if(!input.files||!input.files.length) return;
            const file = input.files[0];
            if(file.size > 10*1024*1024){ showStatusMessage('File exceeds 10MB','error'); resetFileUploadUI(); return; }
            const formData = new FormData(); formData.append('file',file);
            resetFileUploadUI(false);
            try {
              setButtonLoading(E.sendBulkBtn,true,'Processing...');
              const res = await fetch('/api/upload-recipients',{method:'POST',body:formData});
              const data = await res.json();
              if(res.ok && data.success){
                uploadedRecipients = data.recipients||[];
                showStatusMessage(`Loaded ${uploadedRecipients.length} recipient(s)`,'success');
              } else {
                showStatusMessage(data.error||'Upload failed','error'); resetFileUploadUI();
              }
            } catch(err){
              console.error(err); showStatusMessage('Upload network error','error'); resetFileUploadUI();
            } finally { setButtonLoading(E.sendBulkBtn,false,'Start Bulk Campaign'); }
          }

          function resetFileUploadUI(clear=true){ if(clear && E.fileInput) E.fileInput.value=''; }

          // --- Scheduling Helpers ---
          function enqueueScheduled(item){
            window.beaconState.scheduled.push(item);
            persistScheduled();
          }
          function persistScheduled(){
            try { localStorage.setItem('beacon_scheduled', JSON.stringify(window.beaconState.scheduled)); } catch(e){ console.warn('Persist scheduled failed',e); }
          }
          function loadScheduledFromStorage(){
            try { const raw = localStorage.getItem('beacon_scheduled'); if(raw){ window.beaconState.scheduled = JSON.parse(raw)||[]; } } catch(e){ console.warn('Load scheduled failed',e); }
          }
          function processScheduledQueue(){
            const now = Date.now();
            const due = window.beaconState.scheduled.filter(i=> i.scheduledAt <= now && i.status==='scheduled');
            if(!due.length) return;
            due.forEach(async item => {
              // For now simulate immediate send success
              item.status='sent'; item.sentAt=Date.now();
              window.beaconState.history.unshift({ id:item.id, to:item.to, subject:item.subject, provider:item.provider, sentAt:item.sentAt, status:'sent' });
            });
            window.beaconState.scheduled = window.beaconState.scheduled.filter(i=> i.status==='scheduled');
            persistScheduled();
            renderHistorySidebar();
          }
          setInterval(processScheduledQueue, 5000);
          function applySchedulePreset(offsetStr){
            const input = document.getElementById('schedule-datetime'); if(!input) return;
            const map = { m:60000, h:3600000, d:86400000 };
            const match = offsetStr.match(/(\d+)([mhd])/); if(!match) return;
            const amount = parseInt(match[1],10); const unitMs = map[match[2]]; const target = new Date(Date.now()+amount*unitMs);
            // Format to yyyy-MM-ddTHH:MM
            const pad = n => String(n).padStart(2,'0');
            const val = `${target.getFullYear()}-${pad(target.getMonth()+1)}-${pad(target.getDate())}T${pad(target.getHours())}:${pad(target.getMinutes())}`;
            input.value = val;
            input.dispatchEvent(new Event('change'));
            showStatusMessage(`Scheduled for ${target.toLocaleString()}`,'info');
          }

          // --- Bulk Send ---
          async function handleSendBulkEmail(){
            clearAllStatusMessages();
            if(uploadedRecipients.length===0){ showStatusMessage('Upload recipient file first','error'); return; }
            const form = E.bulkForm; if(!form){ return; }
            const formData = new FormData(form);
            if(!formData.get('subject')){ showStatusMessage('Subject required','error'); return; }
            if(!formData.get('html_content') && !formData.get('plain_content')){ showStatusMessage('Content required','error'); return; }
            formData.append('recipients', JSON.stringify(uploadedRecipients));
            formData.append('interval', E.intervalSlider?.value||'4');
            setButtonLoading(E.sendBulkBtn,true,'Starting...');
            E.progressSection?.classList.remove('hidden');
            resetProgressUI(uploadedRecipients.length);
            try {
              const res = await fetch('/api/send-bulk',{method:'POST',body:formData});
              const data = await res.json();
              if(res.ok && data.success && data.job_id){
                bulkSendJobId = data.job_id;
                showStatusMessage(`Campaign ${bulkSendJobId} started`,'info');
                const interval = parseInt(E.intervalSlider?.value||'4',10);
                const totalSecs = (data.details?.total_emails || uploadedRecipients.length)*interval;
                const finish = new Date(Date.now()+ totalSecs*1000);
                if(E.completionTime) E.completionTime.textContent = `Est. completion: ${formatTime(finish)} (~${formatDuration(totalSecs)})`;
                startPolling(bulkSendJobId);
              } else {
                showStatusMessage(`Failed: ${data.error||res.status}`,'error');
                E.progressSection?.classList.add('hidden');
                setButtonLoading(E.sendBulkBtn,false,'Start Bulk Campaign');
              }
            } catch(err){
              console.error(err); showStatusMessage('Network error starting campaign','error');
              E.progressSection?.classList.add('hidden'); setButtonLoading(E.sendBulkBtn,false,'Start Bulk Campaign');
            }
          }

          function resetProgressUI(total){
            if(!E.progressBar) return;
            E.progressBar.style.width='0%';
            E.progressBar.setAttribute('aria-valuenow','0');
            E.progressText && (E.progressText.textContent='0%');
            E.progressCount && (E.progressCount.textContent=`0 / ${total} Processed`);
            E.currentRecipient && (E.currentRecipient.textContent='Initializing...');
            E.statTotal && (E.statTotal.textContent=total);
            E.statSuccess && (E.statSuccess.textContent='0');
            E.statFailed && (E.statFailed.textContent='0');
            if(E.failedList) E.failedList.innerHTML='';
            E.failedSection?.classList.add('hidden');
            if(E.failedCount) E.failedCount.textContent='0';
          }

          function startPolling(jobId){ stopPolling(); pollStatus(jobId); statusPollInterval=setInterval(()=>pollStatus(jobId),2500); }
          function stopPolling(){ if(statusPollInterval){ clearInterval(statusPollInterval); statusPollInterval=null; } }

          async function pollStatus(jobId){
            if(!jobId || jobId!==bulkSendJobId){ stopPolling(); return; }
            try {
              const res = await fetch(`/api/bulk-status/${jobId}`);
              if(!res.ok){ if(res.status===404){ showStatusMessage(`Job ${jobId} missing (assuming done)`,'warning'); handleBulkSendCompletion(null); stopPolling(); } return; }
              const data = await res.json();
              if(!(data.success && data.status)) return;
              const st = data.status; if(st.job_id!==bulkSendJobId) return;
              updateProgressUI(st);
              if(st.error){ showStatusMessage(`Campaign failed: ${st.error}`,'error'); handleBulkSendCompletion(st); stopPolling(); }
              else if(!st.in_progress){ handleBulkSendCompletion(st); stopPolling(); }
            } catch(err){ console.error('Poll error',err); }
          }

          function updateProgressUI(st){
            if(!E.progressBar || !st) return;
            const pct = Math.min(st.completion_percentage||0,100);
            E.progressBar.style.width = pct+'%';
            E.progressBar.setAttribute('aria-valuenow', pct);
            E.progressText && (E.progressText.textContent = pct+'%');
            E.progressCount && (E.progressCount.textContent = `${st.processed||0} / ${st.total||0} Processed`);
            E.currentRecipient && (E.currentRecipient.textContent = st.current_recipient || '-');
            E.statSuccess && (E.statSuccess.textContent = st.success||0);
            E.statFailed && (E.statFailed.textContent = st.failed||0);
            E.failedCount && (E.failedCount.textContent = st.failed||0);
            if(st.failed>0 && st.failed_emails?.length){ E.failedSection?.classList.remove('hidden'); renderFailedEmails(st.failed_emails); } else { E.failedSection?.classList.add('hidden'); if(E.failedList) E.failedList.innerHTML=''; }
          }

          function renderFailedEmails(list){
            if(!E.failedList) return;
            const limit = MAX_DISPLAY_FAILED_EMAILS;
            E.failedList.innerHTML='';
            list.slice(0,limit).forEach(f=>{
              const li=document.createElement('li');
              li.innerHTML = `<span class="failed-email">${(f.email||'N/A')}</span><span class="failed-error">: ${(f.error||'Unknown error').slice(0,150)}</span>`;
              E.failedList.appendChild(li);
            });
            if(list.length>limit){
              const li=document.createElement('li'); li.className='text-xs text-gray-500 italic pt-2';
              li.textContent = `...and ${list.length-limit} more failures.`; E.failedList.appendChild(li);
            }
          }

          function handleBulkSendCompletion(st){
            setButtonLoading(E.sendBulkBtn,false,'Start Bulk Campaign');
            if(!st){ showStatusMessage('Campaign finished (final status unavailable)','warning'); bulkSendJobId=null; return; }
            updateProgressUI(st);
            let msg='Campaign finished'; let type='info';
            if(st.error){ msg=`Campaign failed: ${st.error}`; type='error'; }
            else if(st.failed>0 && st.success>0){ msg=`Finished: ${st.success} success, ${st.failed} failed.`; type='warning'; }
            else if(st.failed>0){ msg=`Finished with ${st.failed} failed.`; type='error'; }
            else if(st.success>0){ msg=`Completed successfully (${st.success})`; type='success'; }
            showStatusMessage(msg,type);
            bulkSendJobId=null;
          }

          function toggleFailedList(){
            if(!E.failedList) return;
            const hidden = E.failedList.classList.toggle('hidden');
            E.failedToggle?.setAttribute('aria-expanded', String(!hidden));
          }

          // --- History Sidebar (simplified) ---
          function recordHistory(entry){
            try {
              window.beaconState.history.unshift({ id: Date.now().toString(36), sentAt: Date.now(), ...entry });
              window.beaconState.history = window.beaconState.history.slice(0,200);
              localStorage.setItem('beacon_history', JSON.stringify(window.beaconState.history));
            } catch(e){ console.warn('History persist failed',e); }
          }

          function renderHistorySidebar(){
            const sidebar = E.historySidebar; if(!sidebar) return;
            const scheduled = (window.beaconState.scheduled||[]).sort((a,b)=>a.scheduledAt-b.scheduledAt).map(s=>{
              const diff = Math.max(s.scheduledAt - Date.now(),0); const badge = formatCountdownBadge(Math.round(diff/1000));
              return `<div class="history-item scheduled"><div class="history-item-main"><span class="hist-subject">${escapeHTML(s.subject||'')}</span><span class="hist-to">→ ${escapeHTML(s.to||'')}</span>${badge}</div><div class="history-item-meta">${formatRelative(s.scheduledAt)} • ${s.provider||'smtp2go'}</div><div class="history-item-status">${s.status}</div></div>`;
            }).join('') || '<div class="history-empty">No scheduled emails</div>';
            const hist = window.beaconState.history || [];
            const recent = hist.slice(0,25).map(h=>`
              <div class="history-item ${h.status}">
                <div class="history-item-main"><span class="hist-subject">${escapeHTML(h.subject||'')}</span><span class="hist-to">→ ${escapeHTML(h.to||'')}</span></div>
                <div class="history-item-meta">${formatRelative(h.sentAt)} • ${h.provider||'smtp2go'}</div>
                <div class="history-item-status">${h.status}</div>
              </div>`).join('') || '<div class="history-empty">No sent emails yet</div>';
            sidebar.innerHTML = `<div class="history-section"><h3>Scheduled</h3>${scheduled}</div><div class="history-section"><h3>Recent Sent</h3>${recent}</div>`;
          }

          function formatRelative(ts){ if(!ts) return '—'; const diff=Date.now()-ts; const m=Math.round(diff/60000); if(m<1)return'just now'; if(m<60)return `${m}m`; const h=Math.round(m/60); if(h<24) return `${h}h`; const d=Math.round(h/24); return `${d}d`; }
          function formatCountdownBadge(seconds){ let label, cls='countdown-badge'; if(seconds<=0){label='due'; cls+=' due';} else if(seconds<60){label=`${seconds}s`; cls+=' warning';} else if(seconds<3600){label=`${Math.ceil(seconds/60)}m`; } else {label=`${Math.ceil(seconds/3600)}h`; } return `<span class="${cls}" aria-label="Scheduled send in ${readableCountdown(seconds)}">${label}</span>`; }
          function readableCountdown(seconds){ if(seconds<=0) return 'now'; if(seconds<60) return seconds+' seconds'; if(seconds<3600) return Math.ceil(seconds/60)+' minutes'; return Math.ceil(seconds/3600)+' hours'; }
          function escapeHTML(s){ return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }

          // --- Status Messages ---
          function showStatusMessage(msg,type='info',duration=6000){
            if(!E.statusContainer) return; const div=document.createElement('div');
            const colors = {
              success:'bg-status_success_bg border-status_success_border text-status_success_text',
              error:'bg-status_error_bg border-status_error_border text-status_error_text',
              warning:'bg-yellow-800 border-yellow-600 text-yellow-200',
              info:'bg-status_info_bg border-status_info_border text-status_info_text'
            }[type] || 'bg-status_info_bg border-status_info_border text-status_info_text';
            const icon = {success:'fa-check-circle',error:'fa-times-circle',warning:'fa-exclamation-triangle',info:'fa-info-circle'}[type]||'fa-info-circle';
            div.className = `flex items-start p-4 mb-3 rounded-lg border shadow-lg transition-all duration-300 ease-out opacity-0 translate-y-2 ${colors}`;
            div.setAttribute('role', type==='error'||type==='warning'?'alert':'status');
            const safe = document.createTextNode(msg).textContent;
            div.innerHTML = `<div class="flex-shrink-0 mt-0.5"><i class="fas ${icon}"></i></div><div class="ml-3 flex-1 text-sm font-medium break-words">${safe}</div><div class="ml-auto pl-3 flex-shrink-0"><button type="button" aria-label="Dismiss"><i class="fas fa-times"></i></button></div>`;
            const dismiss = ()=>{ if(timer) clearTimeout(timer); div.style.opacity='0'; div.style.transform='scale(0.95)'; setTimeout(()=>div.remove(),300); };
            div.querySelector('button')?.addEventListener('click', dismiss);
            E.statusContainer.appendChild(div);
            requestAnimationFrame(()=>{ div.style.opacity='1'; div.style.transform='translateY(0)'; });
            let timer; if(duration>0) timer=setTimeout(dismiss,duration);
          }
          function clearAllStatusMessages(){ if(!E.statusContainer) return; E.statusContainer.innerHTML=''; }
          function setButtonLoading(btn,isLoading,text='Processing...'){ if(!btn) return; if(!btn.dataset.orig) btn.dataset.orig=btn.innerHTML; if(isLoading){ btn.disabled=true; btn.innerHTML=`<i class="fas fa-spinner fa-spin mr-2"></i>${text}`;} else { btn.disabled=false; btn.innerHTML=btn.dataset.orig; } }
          function formatTime(d){ try{return d.toLocaleTimeString([], { hour:'numeric', minute:'2-digit', hour12:true });}catch{return'';} }
          function formatDuration(sec){ sec=Math.round(sec); if(sec<1)return'<1s'; if(sec<60)return sec+'s'; const m=Math.floor(sec/60), s=sec%60; if(m<60)return m+'m'+(s?` ${s}s`:''); const h=Math.floor(m/60), mm=m%60; return h+'h'+(mm?` ${mm}m`:''); }

          // --- Visual ---
          function createStarBackground(){ const c=document.getElementById('stars-container'); if(!c) return; const w=c.clientWidth,h=c.clientHeight; const density=0.00008; const count=Math.min(Math.floor(w*h*density),250); const frag=document.createDocumentFragment(); for(let i=0;i<count;i++){ const s=document.createElement('div'); s.className='star'; const left=Math.random()*w, top=Math.random()*h, size=1+Math.random()*1.5, delay=Math.random()*10, dur=4+Math.random()*6; s.style.cssText=`left:${left}px;top:${top}px;width:${size}px;height:${size}px;animation:twinkle ${dur}s ease-in-out infinite alternate ${delay}s;`; frag.appendChild(s);} c.innerHTML=''; c.appendChild(frag);}  

      function updateYear(){ if(E.year) E.year.textContent=new Date().getFullYear(); }
    }

    // --- Progress Polling & UI Update ---
    function resetProgressUI(total) {
        if (!elements.progressSection) return;
        console.log(`Resetting progress UI for ${total} total recipients.`);
        elements.progressBar.style.width = '0%';
        elements.progressBar.className = 'shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-darkaccent transition-all duration-500 ease-in-out'; // Reset classes
        elements.progressBar.setAttribute('aria-valuenow', '0');
        elements.progressText.textContent = '0%';
        elements.progressCount.textContent = `0 / ${total} Processed`;
        elements.currentRecipientSpan.textContent = 'Initializing...';
        elements.sendingIndicator?.classList.add('hidden');
        elements.statTotal.textContent = total;
        elements.statSuccess.textContent = '0';
        elements.statFailed.textContent = '0';
        elements.completionTimeSpan.textContent = 'Calculating estimated time...';
        elements.failedEmailsList.innerHTML = '';
        elements.failedEmailsSection?.classList.add('hidden');
        elements.failedEmailsList?.classList.add('hidden');
        elements.toggleFailedListButton?.querySelector('i')?.classList.remove('rotate-90');
        elements.toggleFailedListButton?.setAttribute('aria-expanded', 'false');
        elements.failedCountDisplay.textContent = '0';
    }

    function startPolling(jobId) {
        stopPolling();
        console.log(`Starting status polling for job: ${jobId}`);
        pollStatus(jobId); // Initial check
        statusPollInterval = setInterval(() => pollStatus(jobId), 2500);
    }

    async function pollStatus(jobId) {
         if (!jobId || jobId !== bulkSendJobId) { stopPolling(); return; }
         console.debug(`Polling status for job ${jobId}...`);
         try {
             const response = await fetch(`/api/bulk-status/${jobId}`);
             if (!response.ok) {
                 console.warn(`Polling check for job ${jobId} returned HTTP ${response.status}.`);
                 if (response.status === 404) {
                    showStatusMessage(`Job ${jobId} not found. Assuming completion.`, 'warning');
                    handleBulkSendCompletion(null); stopPolling();
                 } return;
             }
             const data = await response.json();
             if (data.success && data.status) {
                if (data.status.job_id !== bulkSendJobId) { console.log(`Ignoring status for old job ${data.status.job_id}.`); return; }
                 updateProgressUI(data.status);
                 if (data.status.error) {
                     console.error(`Job ${jobId} failed server-side: ${data.status.error}`);
                     showStatusMessage(`Campaign failed: ${data.status.error}`, 'error');
                     handleBulkSendCompletion(data.status); stopPolling();
                 } else if (!data.status.in_progress) {
                     console.log(`Job ${jobId} completed.`);
                     handleBulkSendCompletion(data.status); stopPolling();
                 }
             } else { console.error('Received invalid status update payload:', data); }
         } catch (error) { console.error('Status polling network/fetch error:', error); }
    }

    function stopPolling() {
        if (statusPollInterval) { clearInterval(statusPollInterval); statusPollInterval = null; console.log("Status polling stopped."); }
    }

    function updateProgressUI(status) {
        if (!elements.progressBar || !status) return;
        const percentage = Math.min(status.completion_percentage || 0, 100);
        const processed = status.processed || 0; // Use 'processed' from backend
        const total = status.total || 0;
        const success = status.success || 0;
        const failed = status.failed || 0;

        elements.progressBar.style.width = `${percentage}%`;
        elements.progressBar.setAttribute('aria-valuenow', percentage);
        elements.progressText.textContent = `${percentage}%`;
        elements.progressCount.textContent = `${processed} / ${total} Processed`;
        elements.currentRecipientSpan.textContent = status.current_recipient || '-';
        elements.statSuccess.textContent = success;
        elements.statFailed.textContent = failed;
        elements.failedCountDisplay.textContent = failed;

        if (failed > 0 && status.failed_emails?.length > 0) {
            elements.failedEmailsSection?.classList.remove('hidden');
            renderFailedEmails(status.failed_emails);
        } else {
            elements.failedEmailsSection?.classList.add('hidden');
            elements.failedEmailsList.innerHTML = '';
        }
        elements.sendingIndicator?.classList.toggle('hidden', !status.in_progress);
    }

    function renderFailedEmails(failedItems) {
        if (!elements.failedEmailsList) return;
        const displayLimit = MAX_DISPLAY_FAILED_EMAILS;
        const itemsToDisplay = failedItems.slice(0, displayLimit);

        const currentRenderedCount = elements.failedEmailsList.children.length;
        // Crude check: only re-render if count changed OR if we previously truncated
        const wasTruncated = currentRenderedCount > 0 && elements.failedEmailsList.lastElementChild?.tagName === 'LI' && elements.failedEmailsList.lastElementChild.textContent.includes('more failures');
        if (currentRenderedCount === itemsToDisplay.length && !wasTruncated) { return; } // Avoid unnecessary DOM manipulation

        console.log(`Rendering ${itemsToDisplay.length} failed emails (limit ${displayLimit})`);
        elements.failedEmailsList.innerHTML = ''; // Clear and rebuild
        itemsToDisplay.forEach(fail => {
            const li = document.createElement('li');
            const emailSpan = document.createElement('span'); emailSpan.className = 'failed-email';
            emailSpan.textContent = fail.email || 'N/A';
            const errorSpan = document.createElement('span'); errorSpan.className = 'failed-error';
            const errorText = fail.error || 'Unknown error';
            errorSpan.textContent = `: ${errorText.length > 150 ? errorText.substring(0, 147) + '...' : errorText}`;
            li.appendChild(emailSpan); li.appendChild(errorSpan);
            elements.failedEmailsList.appendChild(li);
        });
        if (failedItems.length > displayLimit) {
            const li = document.createElement('li');
            li.className = 'text-xs text-gray-500 italic pt-2';
            li.textContent = `...and ${failedItems.length - displayLimit} more failures.`;
            elements.failedEmailsList.appendChild(li);
        }
    }

  function handleBulkSendCompletion(status) {
         const finalStatus = status;
         const jobId = finalStatus?.job_id || bulkSendJobId;
         stopPolling();
         setButtonLoading(elements.sendBulkEmailButton, false, 'Start Bulk Campaign');
         elements.sendingIndicator?.classList.add('hidden');

         if (finalStatus) {
             updateProgressUI(finalStatus);
             const durationStr = finalStatus.duration ? formatDuration(Math.round(finalStatus.duration)) : 'N/A';
             elements.completionTimeSpan.textContent = `Completed in ${durationStr}`;
             elements.currentRecipientSpan.textContent = 'Finished';
             elements.progressBar.style.width = '100%';
             elements.progressBar.setAttribute('aria-valuenow', '100');
             elements.progressBar.classList.remove('bg-darkaccent', 'bg-yellow-500', 'bg-red-500', 'bg-green-500', 'bg-gray-500');

             let finalMessage = `Bulk campaign ${jobId || ''} finished.`;
             let finalMessageType = 'info'; let finalProgressColor = 'bg-gray-500';
             if (finalStatus.error) { finalMessage = `Campaign failed: ${finalStatus.error}`; finalMessageType = 'error'; finalProgressColor = 'bg-red-500'; }
             else if (finalStatus.failed > 0 && finalStatus.success > 0) { finalMessage = `Finished: ${finalStatus.success} success, ${finalStatus.failed} failed.`; finalMessageType = 'warning'; finalProgressColor = 'bg-yellow-500'; }
             else if (finalStatus.failed > 0) { finalMessage = `Finished with ${finalStatus.failed} failed email(s).`; finalMessageType = 'error'; finalProgressColor = 'bg-red-500'; }
             else if (finalStatus.success > 0) { finalMessage = `Completed successfully! ${finalStatus.success} emails sent.`; finalMessageType = 'success'; finalProgressColor = 'bg-green-500'; }
             else { finalMessage = `Finished. No emails were sent or failed.`; finalMessageType = 'info'; finalProgressColor = 'bg-gray-500'; }

             elements.progressBar.classList.add(finalProgressColor);
             showStatusMessage(finalMessage, finalMessageType);
             if (finalStatus.failed > 0 && elements.failedEmailsSection) elements.failedEmailsSection.classList.remove('hidden');
         } else {
             elements.completionTimeSpan.textContent = "Finished (Final status unavailable)";
             elements.currentRecipientSpan.textContent = 'Finished';
             showStatusMessage(`Campaign ${jobId || 'Unknown'} finished, final status unavailable.`, "warning");
             if (elements.progressBar) {
                  elements.progressBar.style.width = '100%'; elements.progressBar.setAttribute('aria-valuenow', '100');
                  elements.progressBar.classList.remove('bg-darkaccent', 'bg-yellow-500', 'bg-red-500', 'bg-green-500');
                  elements.progressBar.classList.add('bg-gray-500');
             }
         }
         bulkSendJobId = null; // Clear active job ID *after* handling completion
     }

     function toggleFailedEmailsList() {
         if (!elements.failedEmailsList || !elements.toggleFailedListButton) return;
         const isHidden = elements.failedEmailsList.classList.toggle('hidden');
         const icon = elements.toggleFailedListButton.querySelector('i');
         if (icon) icon.classList.toggle('rotate-90', !isHidden);
         elements.toggleFailedListButton.setAttribute('aria-expanded', String(!isHidden));
     }

    // --- Utility Functions ---
    function setButtonLoading(button, isLoading, loadingText = 'Processing...') {
        if (!button) return;
        const originalContent = button.dataset.originalContent || button.innerHTML;
        if (!button.dataset.originalContent) button.dataset.originalContent = originalContent; // Store if first time

        if (isLoading) {
            button.disabled = true;
            button.innerHTML = `<i class="fas fa-spinner fa-spin mr-2" aria-hidden="true"></i> ${loadingText}`;
        } else {
            button.disabled = false;
            button.innerHTML = button.dataset.originalContent; // Restore original
        }
    }

    function formatTime(date) {
        if (!(date instanceof Date) || isNaN(date)) return '';
        try { return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }); }
        catch (e) { console.error("Time format error:", e); return ''; }
    }

    function formatDuration(totalSeconds) {
        if (isNaN(totalSeconds) || totalSeconds < 0) return 'N/A';
        totalSeconds = Math.round(totalSeconds);
        if (totalSeconds < 1) return '< 1 sec'; if (totalSeconds < 60) return `${totalSeconds} sec`;
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        let parts = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (hours === 0 && seconds > 0) parts.push(`${seconds}s`); // Show seconds only if less than an hour
        return parts.join(' ') || '0s';
    }

    // --- Status Messages Display ---
    function showStatusMessage(message, type = 'info', duration = 7000) {
        if (!elements.statusMessageContainer) return;
        console.log(`Status [${type}]: ${message}`);

        const messageDiv = document.createElement('div');
        const messageId = `status-msg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        messageDiv.id = messageId;
        messageDiv.className = `flex items-start p-4 mb-3 rounded-lg border shadow-lg transition-all duration-300 ease-out opacity-0 transform translate-y-2`;
        messageDiv.setAttribute('role', type === 'error' || type === 'warning' ? 'alert' : 'status'); // Use alert for errors/warnings

        let iconClass = ''; let colors = ''; // Use config colors from HTML <script>
        switch (type) {
            case 'success': iconClass = 'fa-check-circle'; colors = 'bg-status_success_bg border-status_success_border text-status_success_text'; break;
            case 'warning': iconClass = 'fa-exclamation-triangle'; colors = 'bg-yellow-800 border-yellow-600 text-yellow-200'; break; // Example override if needed
            case 'error': iconClass = 'fa-times-circle'; colors = 'bg-status_error_bg border-status_error_border text-status_error_text'; break;
            default: iconClass = 'fa-info-circle'; colors = 'bg-status_info_bg border-status_info_border text-status_info_text'; break;
        }
        messageDiv.classList.add(...colors.split(' '));

        const messageText = document.createTextNode(message).textContent; // Sanitize
        messageDiv.innerHTML = `
            <div class="flex-shrink-0 mt-0.5"><i class="fas ${iconClass}" aria-hidden="true"></i></div>
            <div class="ml-3 flex-1 text-sm font-medium break-words">${messageText}</div>
            <div class="ml-auto pl-3 flex-shrink-0">
                <button type="button" class="status-dismiss-button" aria-label="Dismiss notification" aria-controls="${messageId}">
                   <span class="sr-only">Dismiss</span><i class="fas fa-times h-4 w-4" aria-hidden="true"></i>
                </button>
            </div>`;

    const dismissButton = messageDiv.querySelector('button');
    const dismiss = () => {
      if (messageDiv.dataset.timerId) clearTimeout(parseInt(messageDiv.dataset.timerId));
      messageDiv.style.opacity = '0'; messageDiv.style.transform = 'scale(0.95)';
      messageDiv.style.marginBottom = `-${messageDiv.offsetHeight}px`;
      setTimeout(() => messageDiv.remove(), 350);
    };
    dismissButton?.addEventListener('click', dismiss);
    elements.statusMessageContainer.appendChild(messageDiv);
    requestAnimationFrame(() => { messageDiv.style.opacity = '1'; messageDiv.style.transform = 'translateY(0)'; });
    if (duration > 0) messageDiv.dataset.timerId = String(setTimeout(dismiss, duration));
  }

    function clearAllStatusMessages() {
        if (!elements.statusMessageContainer) return;
        elements.statusMessageContainer.querySelectorAll('div[id^="status-msg-"]').forEach(div => {
             if (div.dataset.timerId) clearTimeout(parseInt(div.dataset.timerId)); div.remove(); });
    }

    // --- Star Background Generation ---
    function createStarBackground() {
        const container = document.getElementById('stars-container'); if (!container) return;
        const containerWidth = container.clientWidth; const containerHeight = container.clientHeight;
        const starDensity = 0.00008; const starCount = Math.min(Math.floor(containerWidth * containerHeight * starDensity), 250);
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < starCount; i++) {
            const star = document.createElement('div'); star.classList.add('star');
            const left = Math.random() * containerWidth; const top = Math.random() * containerHeight;
            const size = 1 + Math.random() * 1.5; const delay = Math.random() * 10; const duration = 4 + Math.random() * 6;
            star.style.cssText = `left: ${left.toFixed(2)}px; top: ${top.toFixed(2)}px; width: ${size.toFixed(2)}px; height: ${size.toFixed(2)}px; animation: twinkle ${duration.toFixed(2)}s ease-in-out infinite alternate ${delay.toFixed(2)}s;`;
            fragment.appendChild(star);
        }
        container.innerHTML = ''; container.appendChild(fragment);
    }

}); // End DOMContentLoaded